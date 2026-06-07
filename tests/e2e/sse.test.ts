import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { spawn } from 'child_process';

const BASE_URL = 'http://127.0.0.1:35714';
const AUTH_BASE_URL = 'http://127.0.0.1:35715';
const DB_PATH = './tests/e2e/data/memcp.db';
const TEST_API_KEY = 'memcp-test-key-for-e2e-tests';

/**
 * Helper to establish an SSE connection, call an MCP tool, and wait for the response.
 */
async function callToolViaSse(
  toolName: string,
  args: Record<string, any>
): Promise<string[]> {
  const abortController = new AbortController();
  const sseResponse = await fetch(`${BASE_URL}/sse`, {
    signal: abortController.signal,
  });
  const reader = sseResponse.body!.getReader();
  const sseMessages: string[] = [];

  const readSse = async () => {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseMessages.push(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      // Expected when abortController aborts the connection
    }
  };
  const ssePromise = readSse();

  // Wait for session endpoint
  let sessionId: string | undefined;
  let attempts = 0;
  while (!sessionId && attempts < 100) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const endpointMsg = sseMessages.find(m => m.includes('endpoint'));
    sessionId = endpointMsg?.match(/sessionId=([^\n]+)/)?.[1];
    attempts++;
  }
  expect(sessionId, 'Failed to get sessionId').toBeDefined();

  // Send JSON-RPC 2.0 tool call
  const messageId = crypto.randomUUID();
  const res = await fetch(`${BASE_URL}/messages?sessionId=${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  });
  expect(res.ok, `Tool call request to ${toolName} failed`).toBe(true);

  // Wait for JSON-RPC result or error
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (sseMessages.some(m => m.includes('"result"') || m.includes('"error"'))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Cleanup SSE stream by aborting
  abortController.abort();
  await ssePromise.catch(() => {});

  return sseMessages;
}

describe('MemCP E2E SSE Tests (no auth)', () => {
  let dockerProcess: any;

  beforeAll(async () => {
    console.log('Attempting to start server (no auth)...');
    try {
      console.log('Trying Docker...');
      dockerProcess = spawn('docker-compose', ['-f', 'docker-compose.test.yml', 'up', '--build', '--force-recreate', '-d']);

      let ready = false;
      let attempts = 0;
      while (!ready && attempts < 10) {
        attempts++;
        try {
          const res = await fetch(`${BASE_URL}/sse`);
          if (res.ok) {
            console.log('Server is ready via Docker!');
            ready = true;
          }
        } catch (e) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      if (ready) return;
    } catch (e) {
      console.log('Docker failed, trying local...');
    }

    console.log('Starting server locally (no auth)...');
    dockerProcess = spawn('npm', ['run', 'start-sse'], {
      env: { ...process.env, MEMCP_DB_PATH: DB_PATH, PORT: '35714' }
    });
    dockerProcess.stdout.on('data', (data: any) => console.log(`[SERVER STDOUT]: ${data}`));
    dockerProcess.stderr.on('data', (data: any) => console.error(`[SERVER STDERR]: ${data}`));

    let ready = false;
    let attempts = 0;
    while (!ready && attempts < 15) {
      attempts++;
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
          console.log('Server is ready locally!');
          ready = true;
        }
      } catch (e) { /* ignore */ }
      if (!ready) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    if (!ready) throw new Error('Server failed to start');
  }, 90000);

  afterAll(async () => {
    if (dockerProcess) {
      try {
        spawn('docker-compose', ['-f', 'docker-compose.test.yml', 'down']);
        dockerProcess.kill();
      } catch (e) {}
    }
  });

  it('should store a conversation and verify it in the DB', async () => {
    const sseMessages = await callToolViaSse('store_conversation', {
      projectId: 'test-project',
      harnessId: 'test-harness',
      agentId: 'test-agent',
      summary: 'Test conversation summary',
      autoSummarize: false,
      messages: [
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I am doing well, thank you!' }
      ]
    });

    expect(sseMessages.some(m => m.includes('Stored:'))).toBe(true);

    const db = new Database(DB_PATH);
    const conversation = db.prepare('SELECT * FROM conversations WHERE projectId = ?').get('test-project') as any;
    expect(conversation).toBeDefined();
    expect(conversation.projectId).toBe('test-project');
    expect(conversation.summary).toBeDefined();

    const messages = db.prepare('SELECT * FROM messages WHERE conversationId = ?').all(conversation.id) as any[];
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello, how are you?');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('I am doing well, thank you!');

    db.close();
  }, 15000);

  it('should retrieve stored conversation context', async () => {
    const db = new Database(DB_PATH);
    const conversation = db.prepare('SELECT id FROM conversations WHERE projectId = ?').get('test-project') as any;
    db.close();
    expect(conversation).toBeDefined();

    const sseMessages = await callToolViaSse('get_context', {
      conversationId: conversation.id
    });

    // Verify the server returned a result containing the message content
    const hasResponse = sseMessages.some(m => m.includes('"result"') && m.includes('Hello, how are you?'));
    expect(hasResponse).toBe(true);
  }, 15000);

  it('should update conversation metadata', async () => {
    const db = new Database(DB_PATH);
    const conversation = db.prepare('SELECT id FROM conversations WHERE projectId = ?').get('test-project') as any;
    db.close();
    expect(conversation).toBeDefined();

    const sseMessages = await callToolViaSse('update_conversation', {
      conversationId: conversation.id,
      category: 'updated-category',
      autoSummarize: false
    });

    expect(sseMessages.some(m => m.includes('Updated:'))).toBe(true);

    const updatedDb = new Database(DB_PATH);
    const updatedConversation = updatedDb.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id) as any;
    updatedDb.close();

    expect(updatedConversation.category).toBe('updated-category');
  }, 15000);

  it('should search conversations by keyword', async () => {
    const sseMessages = await callToolViaSse('search_conversations', {
      query: 'Test conversation summary',
      limit: 5
    });

    // Verify the server returned a valid JSON-RPC result
    const hasResponse = sseMessages.some(m => m.includes('"result"'));
    expect(hasResponse).toBe(true);
  }, 15000);
});

describe('MemCP E2E SSE Tests (with API key auth)', () => {
  let authProcess: any;

  beforeAll(async () => {
    console.log('Starting auth-enabled server locally...');
    authProcess = spawn('npm', ['run', 'start-sse'], {
      env: { ...process.env, MEMCP_DB_PATH: DB_PATH, MEMCP_API_KEY: TEST_API_KEY, PORT: '35715' }
    });
    authProcess.stderr.on('data', (data: any) => console.error(`[AUTH SERVER STDERR]: ${data}`));

    let ready = false;
    let attempts = 0;
    while (!ready && attempts < 15) {
      attempts++;
      try {
        const res = await fetch(`${AUTH_BASE_URL}/health`);
        if (res.ok) {
          console.log('Auth-enabled server is ready!');
          ready = true;
        }
      } catch (e) { /* ignore */ }
      if (!ready) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    if (!ready) throw new Error('Auth server failed to start');
  }, 90000);

  afterAll(async () => {
    if (authProcess) {
      authProcess.kill();
    }
  });

  it('should reject SSE requests without API key', async () => {
    const res = await fetch(`${AUTH_BASE_URL}/sse`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Unauthorized');
  });

  it('should reject POST /messages without API key', async () => {
    const res = await fetch(`${AUTH_BASE_URL}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/call', params: {} })
    });
    expect(res.status).toBe(401);
  });

  it('should allow health check without API key', async () => {
    const res = await fetch(`${AUTH_BASE_URL}/health`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('OK');
  });

  it('should accept SSE request with valid X-API-Key header', async () => {
    const res = await fetch(`${AUTH_BASE_URL}/sse`, {
      headers: { 'x-api-key': TEST_API_KEY }
    });
    expect(res.status).toBe(200);
  });

  it('should accept SSE request with valid Authorization Bearer header', async () => {
    const res = await fetch(`${AUTH_BASE_URL}/sse`, {
      headers: { 'authorization': `Bearer ${TEST_API_KEY}` }
    });
    expect(res.status).toBe(200);
  });

  it('should reject SSE request with invalid API key', async () => {
    const res = await fetch(`${AUTH_BASE_URL}/sse`, {
      headers: { 'x-api-key': 'wrong-key' }
    });
    expect(res.status).toBe(401);
  });

  it('should reject POST /messages with invalid API key after establishing SSE', async () => {
    // Establish SSE session with valid key
    const abortController = new AbortController();
    const sseRes = await fetch(`${AUTH_BASE_URL}/sse`, {
      headers: { 'x-api-key': TEST_API_KEY },
      signal: abortController.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const sseMessages: string[] = [];
    const readSse = async () => {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseMessages.push(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        // Expected when abortController aborts
      }
    };
    const ssePromise = readSse();

    // Get sessionId
    let sessionId: string | undefined;
    let attempts = 0;
    while (!sessionId && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const endpointMsg = sseMessages.find(m => m.includes('endpoint'));
      sessionId = endpointMsg?.match(/sessionId=([^\n]+)/)?.[1];
      attempts++;
    }
    expect(sessionId).toBeDefined();

    // Send message with invalid key - should fail
    const res = await fetch(`${AUTH_BASE_URL}/messages?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-key' },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name: 'store_conversation', arguments: {} } })
    });
    expect(res.status).toBe(401);

    abortController.abort();
    await ssePromise.catch(() => {});
  }, 15000);

  it('should successfully call a tool with valid API key', async () => {
    const abortController = new AbortController();
    const sseRes = await fetch(`${AUTH_BASE_URL}/sse`, {
      headers: { 'x-api-key': TEST_API_KEY },
      signal: abortController.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const sseMessages: string[] = [];
    const readSse = async () => {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseMessages.push(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        // Expected when abortController aborts
      }
    };
    const ssePromise = readSse();

    // Get sessionId
    let sessionId: string | undefined;
    let attempts = 0;
    while (!sessionId && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const endpointMsg = sseMessages.find(m => m.includes('endpoint'));
      sessionId = endpointMsg?.match(/sessionId=([^\n]+)/)?.[1];
      attempts++;
    }
    expect(sessionId).toBeDefined();

    // Send tool call with valid key
    const res = await fetch(`${AUTH_BASE_URL}/messages?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_API_KEY },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/list',
        params: {}
      })
    });
    expect(res.ok).toBe(true);

    abortController.abort();
    await ssePromise.catch(() => {});
  }, 15000);
});
