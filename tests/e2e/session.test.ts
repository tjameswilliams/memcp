import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';

const BASE_URL = 'http://127.0.0.1:35716';
const DB_PATH = './tests/e2e/data/session-test.db';

/**
 * Call an MCP tool via SSE and return the session URL from create_session.
 */
async function createSessionViaMcp(
  args: { projectId: string; harnessId: string; agentId: string; category?: string }
): Promise<{ sessionUrl: string; token: string }> {
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
      // Expected when abortController aborts
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

  // Send create_session tool call
  const messageId = crypto.randomUUID();
  const res = await fetch(`${BASE_URL}/messages?sessionId=${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: messageId,
      method: 'tools/call',
      params: { name: 'create_session', arguments: args }
    })
  });
  expect(res.ok).toBe(true);

  // Wait for JSON-RPC result
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (sseMessages.some(m => m.includes('"result"') || m.includes('"error"'))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Parse the session URL from the SSE messages
  const resultMsg = sseMessages.find(m => m.includes('sessionUrl'));
  expect(resultMsg, 'Session URL not found in SSE response').toBeDefined();
  // Extract JSON-RPC envelope, then parse inner text content
  const envelope = JSON.parse(resultMsg!.replace(/^event: message\ndata: /, '').trim());
  const textContent = envelope.result.content[0].text;
  const parsed = JSON.parse(textContent);
  expect(parsed.sessionUrl).toContain('/session/');

  abortController.abort();
  await ssePromise.catch(() => {});

  return {
    sessionUrl: parsed.sessionUrl,
    token: parsed.token,
  };
}

describe('MemCP Session Web Bridge', () => {
  let serverProcess: any;
  let uidCounter = 0;
  function uid(prefix: string): string {
    uidCounter++;
    return `${prefix}-${uidCounter}`;
  }

  beforeAll(async () => {
    console.log('Starting session test server...');
    serverProcess = spawn('npm', ['run', 'start-sse'], {
      env: { ...process.env, MEMCP_DB_PATH: DB_PATH, PORT: '35716' }
    });
    serverProcess.stderr.on('data', (data: any) => console.error(`[SERVER STDERR]: ${data}`));

    let ready = false;
    let attempts = 0;
    while (!ready && attempts < 15) {
      attempts++;
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
          console.log('Server is ready!');
          ready = true;
        }
      } catch (e) { /* ignore */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!ready) throw new Error('Server failed to start');
  }, 90000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
    }
    // Clean up test DB
    try {
      const fs = await import('fs');
      fs.unlinkSync(DB_PATH);
    } catch (e) {}
  });

  it('should create a session via MCP and return a valid URL', async () => {
    const { sessionUrl, token } = await createSessionViaMcp({
      projectId: uid('p'),
      harnessId: uid('h'),
      agentId: uid('a'),
      category: 'test-category',
    });

    expect(sessionUrl).toContain(`/session/${token}`);
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
  });

  it('should serve the session entry point (tools overview)', async () => {
    const { sessionUrl } = await createSessionViaMcp({
      projectId: uid('p'),
      harnessId: uid('h'),
      agentId: uid('a'),
    });

    const res = await fetch(sessionUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('MemCP Session Active');
    expect(body).toContain('Available Tools');
    expect(body).toContain('Read Context');
    expect(body).toContain('Store Memory');
    expect(body).toContain('Search Memory');
  });

  it('should serve the tools definition page', async () => {
    const { sessionUrl } = await createSessionViaMcp({
      projectId: uid('p'),
      harnessId: uid('h'),
      agentId: uid('a'),
    });

    const res = await fetch(`${sessionUrl}/tools`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('MemCP Tools');
    expect(body).toContain('Read Context');
    expect(body).toContain('Store Memory');
    expect(body).toContain('Search Memory');
  });

  it('should store a conversation via GET params', async () => {
    const { sessionUrl } = await createSessionViaMcp({
      projectId: uid('p'),
      harnessId: uid('h'),
      agentId: uid('a'),
    });

    const storeUrl = `${sessionUrl}/store` +
      `?summary=Session+Test+Summary` +
      `&role_0=user&content_0=Hello+from+session` +
      `&role_1=assistant&content_1=Hi+there`;

    const res = await fetch(storeUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Stored:');
    expect(body).toContain('Session Test Summary');
  });

  it('should read stored context', async () => {
    const pid = uid('p');
    const { sessionUrl } = await createSessionViaMcp({
      projectId: pid,
      harnessId: uid('h'),
      agentId: uid('a'),
    });

    // First store something
    const storeUrl = `${sessionUrl}/store` +
      `?summary=Read+Test` +
      `&role_0=user&content_0=Read+me`;
    const storeRes = await fetch(storeUrl);
    expect(storeRes.status).toBe(200);

    // Now read context
    const res = await fetch(`${sessionUrl}/context`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Memory Context');
    expect(body).toContain('Read Test');
    expect(body).toContain('user: Read me');
  });

  it('should search stored conversations', async () => {
    const { sessionUrl } = await createSessionViaMcp({
      projectId: uid('p'),
      harnessId: uid('h'),
      agentId: uid('a'),
    });

    // Store something searchable
    const storeUrl = `${sessionUrl}/store` +
      `?summary=Unique+Search+Query+For+Testing` +
      `&role_0=user&content_0=Test+content`;
    const storeRes = await fetch(storeUrl);
    expect(storeRes.status).toBe(200);

    // Search for it
    const res = await fetch(`${sessionUrl}/search?q=Unique+Search+Query`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Search Results');
    expect(body).toContain('Unique Search Query For Testing');
  });

  it('should return 410 for expired/invalid token', async () => {
    const res = await fetch(`${BASE_URL}/session/invalid-token`);
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain('Session expired or invalid');
  });

  it('should return 400 for store with no messages', async () => {
    const { sessionUrl } = await createSessionViaMcp({
      projectId: uid('p'),
      harnessId: uid('h'),
      agentId: uid('a'),
    });

    const res = await fetch(`${sessionUrl}/store`);
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('No messages provided');
  });

  it('should return 400 for search with no query', async () => {
    const { sessionUrl } = await createSessionViaMcp({
      projectId: uid('p'),
      harnessId: uid('h'),
      agentId: uid('a'),
    });

    const res = await fetch(`${sessionUrl}/search`);
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Missing search query');
  });

  it('should return empty context when no memories exist', async () => {
    const { sessionUrl } = await createSessionViaMcp({
      projectId: uid('empty'),
      harnessId: uid('empty'),
      agentId: uid('empty'),
    });

    const res = await fetch(`${sessionUrl}/context`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('No memories stored yet');
  });

  it('should scope sessions to project/harness/agent', async () => {
    const { sessionUrl: url1 } = await createSessionViaMcp({
      projectId: 'scope-test-a',
      harnessId: 'scope-test-a',
      agentId: 'scope-test-a',
    });

    const { sessionUrl: url2 } = await createSessionViaMcp({
      projectId: 'scope-test-b',
      harnessId: 'scope-test-b',
      agentId: 'scope-test-b',
    });

    // Store in session A
    const storeA = await fetch(`${url1}/store` +
      `?summary=Scope+A+Memory&role_0=user&content_0=A+content`);
    expect(storeA.status).toBe(200);

    // Store in session B
    const storeB = await fetch(`${url2}/store` +
      `?summary=Scope+B+Memory&role_0=user&content_0=B+content`);
    expect(storeB.status).toBe(200);

    // Session A should only see its own memory
    const ctxA = await fetch(`${url1}/context`);
    const bodyA = await ctxA.text();
    expect(bodyA).toContain('Scope A Memory');
    expect(bodyA).not.toContain('Scope B Memory');

    // Session B should only see its own memory
    const ctxB = await fetch(`${url2}/context`);
    const bodyB = await ctxB.text();
    expect(bodyB).toContain('Scope B Memory');
    expect(bodyB).not.toContain('Scope A Memory');
  });
});
