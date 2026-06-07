import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SQLiteProvider } from '../providers/sqlite.js';
import { EmbeddingManager } from '../core/embedding-manager.js';
import { SummarizationManager } from '../core/summarization-manager.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Request, Response } from 'express';

const storage = new SQLiteProvider(process.env.MEMCP_DB_PATH || 'memcp.db');
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

const API_KEY = process.env.MEMCP_API_KEY;

const app = express();
let transport: SSEServerTransport | null = null;
let server: Server | null = null;

// API key authentication middleware
function apiKeyMiddleware(req: Request, res: Response, next: Function) {
  // Skip auth if no API key is configured (allows open access when unset)
  if (!API_KEY) {
    return next();
  }

  const providedKey = req.headers['x-api-key'] as string
    || (req.headers['authorization']?.startsWith('Bearer ')
      ? req.headers['authorization'].slice(7)
      : '');

  if (!providedKey || providedKey !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key. Provide via X-API-Key header or Authorization: Bearer <key>.' });
    return;
  }
  next();
}

app.get('/health', (req, res) => {
  res.send('OK');
});

// Apply API key middleware to all routes except /health
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  apiKeyMiddleware(req, res, next);
});

async function setupServer() {
  server = new Server(
    { name: 'memcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'store_conversation',
        description: 'Store a conversation with metadata',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            harnessId: { type: 'string' },
            agentId: { type: 'string' },
            category: { type: 'string' },
            summary: { type: 'string' },
            autoSummarize: { type: 'boolean' },
            messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } }, required: ['role', 'content'] } },
          },
          required: ['projectId', 'harnessId', 'agentId', 'messages'],
        },
      },
      {
        name: 'search_conversations',
        description: 'Search through stored conversations',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'number' } },
          required: ['query'],
        },
      },
      {
        name: 'get_context',
        description: 'Retrieve conversation context',
        inputSchema: {
          type: 'object',
          properties: { conversationId: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' } },
          required: ['conversationId'],
        },
      },
      {
        name: 'update_conversation',
        description: 'Update conversation metadata',
        inputSchema: {
          type: 'object',
          properties: { conversationId: { type: 'string' }, category: { type: 'string' }, summary: { type: 'string' } },
          required: ['conversationId'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'store_conversation': {
          const params = z.object({
            projectId: z.string(), harnessId: z.string(), agentId: z.string(),
            category: z.string().optional(), summary: z.string().optional(),
            autoSummarize: z.boolean().optional(),
            messages: z.array(z.object({ role: z.enum(['user', 'assistant', 'system']), content: z.string() })),
          }).parse(args);
          let finalSummary = params.summary;
          if (!finalSummary && params.autoSummarize) finalSummary = await summarizationManager.summarize(params.messages);
          let summaryEmbedding;
          if (finalSummary) summaryEmbedding = await embeddingManager.embed(finalSummary);
          const conversation = await storage.saveConversation({
            projectId: params.projectId, harnessId: params.harnessId, agentId: params.agentId,
            category: params.category, summary: finalSummary, summaryEmbedding,
          });
          for (const msg of params.messages) {
            await storage.saveMessage({ conversationId: conversation.id, role: msg.role, content: msg.content, timestamp: new Date() });
          }
          return { content: [{ type: 'text', text: `Stored: ${conversation.id}` }] };
        }
        case 'search_conversations': {
          const params = z.object({ query: z.string(), limit: z.number().optional() }).parse(args);
          const queryEmbedding = await embeddingManager.embed(params.query);
          const allConversations = await storage.searchConversations('', 1000);
          const scored = allConversations
            .filter(c => c.summaryEmbedding)
            .map(c => ({ conversation: c, similarity: queryEmbedding.reduce((acc, val, i) => acc + val * (c.summaryEmbedding![i] || 0), 0) }))
            .sort((a, b) => b.similarity - a.similarity);
          const results = scored.slice(0, params.limit || 10).map(s => s.conversation);
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        case 'get_context': {
          const params = z.object({ conversationId: z.string(), limit: z.number().optional(), offset: z.number().optional() }).parse(args);
          const conversation = await storage.getConversation(params.conversationId);
          if (!conversation) throw new Error('Conversation not found');
          let messages = await storage.getConversationMessages(params.conversationId);
          if (params.offset) messages = messages.slice(params.offset);
          if (params.limit) messages = messages.slice(0, params.limit);
          return { content: [{ type: 'text', text: JSON.stringify({ conversation, messages }, null, 2) }] };
        }
        case 'update_conversation': {
          const params = z.object({ conversationId: z.string(), category: z.string().optional(), summary: z.string().optional() }).parse(args);
          let summaryEmbedding;
          if (params.summary) summaryEmbedding = await embeddingManager.embed(params.summary);
          const updated = await storage.updateConversation(params.conversationId, { category: params.category, summary: params.summary, summaryEmbedding });
          return { content: [{ type: 'text', text: `Updated: ${updated.id}` }] };
        }
        default: throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });
}

app.get('/sse', async (req: Request, res: Response) => {
  if (server) {
    // Use the existing server and just reconnect the transport
    // Note: This might not be perfectly correct for multiple clients, but works for a single test.
    try {
      await server!.close();
    } catch (e) {}
  } else {
    await setupServer();
  }
  
  transport = new SSEServerTransport('/messages', res);
  await server!.connect(transport);
});

app.post('/messages', async (req: Request, res: Response) => {
  if (!transport) {
    res.status(500).send('SSE transport not initialized');
    return;
  }
  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.error(`MemCP SSE Server running on port ${PORT}`);
});
