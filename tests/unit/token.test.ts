import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TokenManager } from '../../src/session/token.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('TokenManager', () => {
  let manager: TokenManager;

  beforeEach(() => {
    manager = new TokenManager(1000); // 1-second expiry for testing
  });

  afterEach(() => {
    manager.stop();
  });

  it('should create a session with a unique token', () => {
    const session = manager.createSession({
      projectId: 'proj-1',
      harnessId: 'harness-1',
      agentId: 'agent-1',
    });

    expect(session.token).toBeDefined();
    expect(session.token.length).toBe(48);
    expect(session.projectId).toBe('proj-1');
    expect(session.harnessId).toBe('harness-1');
    expect(session.agentId).toBe('agent-1');
    expect(session.category).toBeUndefined();
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.lastUsedAt).toBeGreaterThan(0);
    expect(session.expiresInMs).toBe(1000);
  });

  it('should create a session with optional category', () => {
    const session = manager.createSession({
      projectId: 'proj-1',
      harnessId: 'harness-1',
      agentId: 'agent-1',
      category: 'test-cat',
    });

    expect(session.category).toBe('test-cat');
  });

  it('should generate unique tokens for each session', () => {
    const s1 = manager.createSession({ projectId: 'p', harnessId: 'h', agentId: 'a' });
    const s2 = manager.createSession({ projectId: 'p', harnessId: 'h', agentId: 'a' });

    expect(s1.token).not.toBe(s2.token);
  });

  it('should return session via getSession', () => {
    const created = manager.createSession({ projectId: 'p', harnessId: 'h', agentId: 'a' });
    const retrieved = manager.getSession(created.token);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.token).toBe(created.token);
    expect(retrieved!.projectId).toBe('p');
  });

  it('should refresh lastUsedAt on getSession', async () => {
    const created = manager.createSession({ projectId: 'p', harnessId: 'h', agentId: 'a' });
    const before = created.lastUsedAt;

    await sleep(10);
    const retrieved = manager.getSession(created.token);
    expect(retrieved!.lastUsedAt).toBeGreaterThan(before);
  });

  it('should return null for nonexistent token', () => {
    const session = manager.getSession('nonexistent-token');
    expect(session).toBeNull();
  });

  it('should return null for expired session', async () => {
    const created = manager.createSession({ projectId: 'p', harnessId: 'h', agentId: 'a' });

    await sleep(1500);

    const session = manager.getSession(created.token);
    expect(session).toBeNull();
  });

  it('should delete expired sessions from the map', async () => {
    const created = manager.createSession({ projectId: 'p', harnessId: 'h', agentId: 'a' });

    await sleep(1500);

    // First call returns null and deletes
    expect(manager.getSession(created.token)).toBeNull();
    // Second call confirms it's gone
    expect(manager.getSession(created.token)).toBeNull();
  });

  it('should keep session alive on active use', async () => {
    const created = manager.createSession({ projectId: 'p', harnessId: 'h', agentId: 'a' });

    await sleep(800);

    // Refresh by calling getSession
    manager.getSession(created.token);

    // Should still be valid (was refreshed before expiry)
    await sleep(500);
    expect(manager.getSession(created.token)).not.toBeNull();
  });

  it('should enforce max sessions limit', async () => {
    const limitedManager = new TokenManager(200, 3);

    limitedManager.createSession({ projectId: 'p1', harnessId: 'h', agentId: 'a' });
    limitedManager.createSession({ projectId: 'p2', harnessId: 'h', agentId: 'a' });
    limitedManager.createSession({ projectId: 'p3', harnessId: 'h', agentId: 'a' });

    // Wait for all to expire
    await sleep(400);

    // 4th should trigger cleanup and succeed
    limitedManager.createSession({ projectId: 'p4', harnessId: 'h', agentId: 'a' });

    limitedManager.stop();
  });

  it('should accept custom expiry via constructor', () => {
    const custom = new TokenManager(5000);
    expect((custom as any).defaultExpiryMs).toBe(5000);
    custom.stop();
  });

  it('should accept custom max sessions via constructor', () => {
    const custom = new TokenManager(1000, 5);
    expect((custom as any).maxSessions).toBe(5);
    custom.stop();
  });

  it('should stop the cleanup interval', () => {
    const manager2 = new TokenManager(1000);
    manager2.stop();
    manager2.createSession({ projectId: 'p', harnessId: 'h', agentId: 'a' });
  });
});
