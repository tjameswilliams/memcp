import crypto from 'node:crypto';

export interface Session {
  token: string;
  projectId: string;
  harnessId: string;
  agentId: string;
  category?: string;
  createdAt: number;
  lastUsedAt: number;
  expiresInMs: number;
}

export class TokenManager {
  private sessions = new Map<string, Session>();
  private cleanupInterval: ReturnType<typeof setInterval>;
  private readonly defaultExpiryMs: number;
  private readonly maxSessions: number;

  constructor(
    defaultExpiryMs = parseInt(process.env.MEMCP_SESSION_TTL || `${20 * 60 * 1000}`, 10),
    maxSessions?: number,
  ) {
    this.defaultExpiryMs = defaultExpiryMs;
    this.maxSessions = maxSessions ?? parseInt(process.env.MEMCP_MAX_SESSIONS || '1000', 10);
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  createSession(params: {
    projectId: string;
    harnessId: string;
    agentId: string;
    category?: string;
  }): Session {
    if (this.sessions.size >= this.maxSessions) {
      this.cleanup();
    }
    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const session: Session = {
      token,
      projectId: params.projectId,
      harnessId: params.harnessId,
      agentId: params.agentId,
      category: params.category,
      createdAt: now,
      lastUsedAt: now,
      expiresInMs: this.defaultExpiryMs,
    };
    this.sessions.set(token, session);
    return session;
  }

  getSession(token: string): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (this.isExpired(session)) {
      this.sessions.delete(token);
      return null;
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  private isExpired(session: Session): boolean {
    return Date.now() - session.lastUsedAt > session.expiresInMs;
  }

  private cleanup() {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (now - session.lastUsedAt > session.expiresInMs) {
        this.sessions.delete(token);
      }
    }
  }

  stop() {
    clearInterval(this.cleanupInterval);
  }
}
