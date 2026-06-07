import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SQLiteProvider } from '../providers/sqlite.js';
import { EmbeddingManager } from '../core/embedding-manager.js';
import { SummarizationManager } from '../core/summarization-manager.js';

const storage = new SQLiteProvider();
const embeddingManager = new EmbeddingManager({
  provider: process.env.MEMCP_EMBEDDING_PROVIDER as 'local' | 'openai' || 'local',
  apiKey: process.env.MEMCP_EMBEDDING_KEY,
  baseUrl: process.env.MEMCP_EMBEDDING_URL,
  model: process.env.MEMCP_EMBEDDING_MODEL,
});
const summarizationManager = new SummarizationManager({
  apiKey: process.env.MEMCP_EMBEDDING_KEY,
  baseUrl: process.env.MEMCP_EMBEDDING_URL,
  model: process.env.MEMCP_EMBEDDING_MODEL,
});

const server = new Server(
  {
    name: 'memcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'store_conversation',
        description: 'Store a conversation with metadata for later retrieval',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            harnessId: { type: 'string' },
            agentId: { type: 'string' },
            category: { type: 'string' },
            summary: { type: 'string', description: 'Pre-computed summary provided by the agent' },
            autoSummarize: { type: 'boolean', description: 'Whether the server should generate a summary if one is not provided' },
            messages: { 
              type: 'array', 
              items: { 
                type: 'object', 
                properties: { 
                  role: { type: 'string', enum: ['user', 'assistant', 'system'] }, 
                  content: { type: 'string' } 
                },
                required: ['role', 'content']
              } 
            },
          },
          required: ['projectId', 'harnessId', 'agentId', 'messages'],
        },
      },
      {
        name: 'search_conversations',
        description: 'Search through stored conversations by keyword or summary',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_context',
        description: 'Retrieve full or partial context of a stored conversation',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            limit: { type: 'number', description: 'Limit number of messages to retrieve' },
            offset: { type: 'number', description: 'Offset for pagination' },
          },
          required: ['conversationId'],
        },
      },
      {
        name: 'update_conversation',
        description: 'Update metadata or summary of a stored conversation',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            category: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['conversationId'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'store_conversation': {
        const params = z.object({
          projectId: z.string(),
          harnessId: z.string(),
          agentId: z.string(),
          category: z.string().optional(),
          summary: z.string().optional(),
          autoSummarize: z.boolean().optional(),
          messages: z.array(z.object({
            role: z.enum(['user', 'assistant', 'system']),
            content: z.string(),
          })),
        }).parse(args);

        let finalSummary = params.summary;
        if (!finalSummary && params.autoSummarize) {
          finalSummary = await summarizationManager.summarize(params.messages);
        }

        let summaryEmbedding;
        if (finalSummary) {
          summaryEmbedding = await embeddingManager.embed(finalSummary);
        }

        const conversation = await storage.saveConversation({
          projectId: params.projectId,
          harnessId: params.harnessId,
          agentId: params.agentId,
          category: params.category,
          summary: finalSummary,
          summaryEmbedding,
        });

        for (const msg of params.messages) {
          await storage.saveMessage({
            conversationId: conversation.id,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(),
          });
        }

        return {
          content: [{ type: 'text', text: `Conversation stored with ID: ${conversation.id}${finalSummary ? `\nSummary: ${finalSummary}` : ''}` }],
        };
      }

      case 'search_conversations': {
        const params = z.object({
          query: z.string(),
          limit: z.number().optional(),
        }).parse(args);

        const queryEmbedding = await embeddingManager.embed(params.query);
        const allConversations = await storage.searchConversations('', 1000); // Get a reasonable batch
        
        const scored = allConversations
          .filter(c => c.summaryEmbedding)
          .map(c => {
            const similarity = queryEmbedding.reduce((acc, val, i) => acc + val * (c.summaryEmbedding![i] || 0), 0);
            return { conversation: c, similarity };
          })
          .sort((a, b) => b.similarity - a.similarity);

        const results = scored.slice(0, params.limit || 10).map(s => s.conversation);
        
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_context': {
        const params = z.object({
          conversationId: z.string(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }).parse(args);

        const conversation = await storage.getConversation(params.conversationId);
        if (!conversation) {
          throw new Error('Conversation not found');
        }

        let messages = await storage.getConversationMessages(params.conversationId);
        
        if (params.offset) {
          messages = messages.slice(params.offset);
        }
        if (params.limit) {
          messages = messages.slice(0, params.limit);
        }

        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              conversation,
              messages
            }, null, 2) 
          }],
        };
      }

      case 'update_conversation': {
        const params = z.object({
          conversationId: z.string(),
          category: z.string().optional(),
          summary: z.string().optional(),
        }).parse(args);

        let summaryEmbedding;
        if (params.summary) {
          summaryEmbedding = await embeddingManager.embed(params.summary);
        }

        const updated = await storage.updateConversation(params.conversationId, {
          category: params.category,
          summary: params.summary,
          summaryEmbedding,
        });

        return {
          content: [{ type: 'text', text: `Conversation updated: ${updated.id}` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MemCP Server running on stdio');
}

main().catch(console.error);
