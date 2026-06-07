import { Router, Request, Response } from 'express';
import { TokenManager, Session } from '../session/token.js';
import { StorageProvider } from '../core/storage.js';
import { EmbeddingManager } from '../core/embedding-manager.js';
import { scoreConversations } from '../core/search.js';

export function createSessionRouter(
  tokenManager: TokenManager,
  storage: StorageProvider,
  embeddingManager: EmbeddingManager,
): Router {
  const router = Router();

  // Helper to validate token and return session
  function validateToken(token: string, res: Response): Session | null {
    const session = tokenManager.getSession(token);
    if (!session) {
      res.status(410).type('text').send(
        'Session expired or invalid. Please get a new session URL from your MCP agent.'
      );
      return null;
    }
    return session;
  }

  function formatTools(token: string): string {
    return [
      `# MemCP Tools (GET-based API)`,
      ``,
      `All tools are accessible via GET requests. No POST required.`,
      ``,
      `## 1. Read Context`,
      `  URL: /session/${token}/context`,
      `  Method: GET`,
      `  Returns: Plain text with current memory context.`,
      ``,
      `## 2. Store Memory`,
      `  URL: /session/${token}/store`,
      `  Method: GET`,
      `  Query Parameters:`,
      `    summary (optional) — text summary of the conversation`,
      `    role_0, content_0 — first message`,
      `    role_1, content_1 — second message`,
      `    ... (continue numbering for more messages)`,
      `  Returns: Confirmation with the stored conversation ID.`,
      ``,
      `## 3. Search Memory`,
      `  URL: /session/${token}/search`,
      `  Method: GET`,
      `  Query Parameters:`,
      `    q — the search query`,
      `  Returns: Matching memories as plain text.`,
    ].join('\n');
  }

  // GET /session/:token — entry point: tools overview + context
  router.get('/:token', async (req: Request, res: Response) => {
    const token = req.params.token as string;
    const session = validateToken(token, res);
    if (!session) return;

    const text = [
      `# MemCP Session Active`,
      ``,
      `This session is scoped to project "${session.projectId}", harness "${session.harnessId}", agent "${session.agentId}".`,
      `Session expires after 20 minutes of inactivity.`,
      ``,
      `## Available Tools`,
      ``,
      `You can call these tools by navigating to the following URLs (all use GET):`,
      ``,
      `### 1. Read Context`,
      `URL: /session/${session.token}/context`,
      `Returns the stored memory context for this session as plain text.`,
      ``,
      `### 2. Store Memory`,
      `URL: /session/${session.token}/store`,
      `Parameters (query string):`,
      `  - summary (optional) — a summary of the conversation`,
      `  - role_0, content_0 — first message (role + content)`,
      `  - role_1, content_1 — second message`,
      `  - ... and so on for as many messages as needed`,
      `Example:`,
      `/session/${session.token}/store?summary=Brainstorm+about+X&role_0=user&content_0=Let%27s+think&role_1=assistant&content_1=Sure`,
      ``,
      `### 3. Search Memory`,
      `URL: /session/${session.token}/search`,
      `Parameters (query string):`,
      `  - q — search query text`,
      `Example:`,
      `/session/${session.token}/search?q=previous+ideas`,
      ``,
      `### 4. View Tools`,
      `URL: /session/${session.token}/tools`,
      `Returns this same list of available tools.`,
      ``,
      `---`,
      `To get started, fetch /session/${session.token}/context to see current memory,`,
      `or store a new memory using /session/${session.token}/store.`,
    ].join('\n');

    res.type('text').send(text);
  });

  // GET /session/:token/tools — tool definitions only
  router.get('/:token/tools', (req: Request, res: Response) => {
    const session = validateToken(req.params.token as string, res);
    if (!session) return;

    res.type('text').send(formatTools(session.token));
  });

  // GET /session/:token/context — retrieve current memory context
  router.get('/:token/context', async (req: Request, res: Response) => {
    const session = validateToken(req.params.token as string, res);
    if (!session) return;

    try {
      const conversations = await storage.searchConversations('', 100);
      const sessionConversations = conversations.filter(
        c => c.projectId === session.projectId &&
             c.harnessId === session.harnessId &&
             c.agentId === session.agentId
      );

      if (sessionConversations.length === 0) {
        res.type('text').send('No memories stored yet for this session.');
        return;
      }

      const lines: string[] = ['# Memory Context', ''];
      for (const conv of sessionConversations) {
        lines.push(`## Conversation: ${conv.summary || '(no summary)'}`);
        lines.push(`  ID: ${conv.id}`);
        if (conv.category) lines.push(`  Category: ${conv.category}`);
        lines.push(`  Created: ${conv.createdAt}`);
        lines.push('');
        const messages = await storage.getConversationMessages(conv.id);
        for (const msg of messages.slice(0, 10)) {
          lines.push(`  ${msg.role}: ${msg.content.slice(0, 200)}`);
        }
        if (messages.length > 10) {
          lines.push(`  ... (${messages.length - 10} more messages)`);
        }
        lines.push('');
      }

      res.type('text').send(lines.join('\n'));
    } catch (error: any) {
      res.status(500).type('text').send(`Error reading context: ${error.message}`);
    }
  });

  // GET /session/:token/store — store a conversation via GET params
  router.get('/:token/store', async (req: Request, res: Response) => {
    const session = validateToken(req.params.token as string, res);
    if (!session) return;

    const summary = req.query.summary as string | undefined;

    // Parse messages from numbered role_N / content_N params
    const messages: { role: string; content: string }[] = [];
    let i = 0;
    while (true) {
      const roleKey = `role_${i}`;
      const contentKey = `content_${i}`;
      const role = req.query[roleKey] as string | undefined;
      const content = req.query[contentKey] as string | undefined;
      if (!role || !content) break;
      messages.push({ role, content });
      i++;
    }

    if (messages.length === 0) {
      res.status(400).type('text').send(
        'No messages provided. Add role_0 and content_0 query parameters with at least one message.'
      );
      return;
    }

    const validRoles = new Set(['user', 'assistant', 'system']);
    for (const msg of messages) {
      if (!validRoles.has(msg.role)) {
        res.status(400).type('text').send(`Invalid role "${msg.role}". Must be one of: user, assistant, system.`);
        return;
      }
    }

    try {
      let finalSummary = summary;
      let summaryEmbedding: number[] | undefined;
      if (finalSummary) {
        summaryEmbedding = await embeddingManager.embed(finalSummary);
      }

      const conversation = await storage.saveConversation({
        projectId: session.projectId,
        harnessId: session.harnessId,
        agentId: session.agentId,
        category: session.category,
        summary: finalSummary,
        summaryEmbedding,
      });

      for (const msg of messages) {
        await storage.saveMessage({
          conversationId: conversation.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          timestamp: new Date(),
        });
      }

      res.type('text').send(
        `Stored: ${conversation.id}${finalSummary ? `\nSummary: ${finalSummary}` : ''}`
      );
    } catch (error: any) {
      res.status(500).type('text').send(`Error storing memory: ${error.message}`);
    }
  });

  // GET /session/:token/search — search stored conversations
  router.get('/:token/search', async (req: Request, res: Response) => {
    const session = validateToken(req.params.token as string, res);
    if (!session) return;

    const query = req.query.q as string | undefined;
    if (!query) {
      res.status(400).type('text').send('Missing search query. Add ?q=your search text.');
      return;
    }

    try {
      const queryEmbedding = await embeddingManager.embed(query);
      const allConversations = await storage.searchConversations('', 1000);
      const scored = scoreConversations(allConversations, queryEmbedding, {
        projectId: session.projectId,
        harnessId: session.harnessId,
        agentId: session.agentId,
      });

      const results = scored.slice(0, 10).map(s => s.conversation);

      if (results.length === 0) {
        res.type('text').send('No matching memories found.');
        return;
      }

      const lines: string[] = ['# Search Results', ''];
      for (const conv of results) {
        lines.push(`## ${conv.summary || '(no summary)'}`);
        lines.push(`  ID: ${conv.id}`);
        if (conv.category) lines.push(`  Category: ${conv.category}`);
        lines.push(`  Created: ${conv.createdAt}`);
        lines.push('');
      }

      res.type('text').send(lines.join('\n'));
    } catch (error: any) {
      res.status(500).type('text').send(`Error searching memories: ${error.message}`);
    }
  });

  return router;
}
