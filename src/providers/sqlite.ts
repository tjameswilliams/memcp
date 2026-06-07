import Database from 'better-sqlite3';
import { StorageProvider, Conversation, Message } from '../core/storage.js';

export class SQLiteProvider implements StorageProvider {
  private db: Database.Database;

  constructor(dbPath: string = 'memcp.db') {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        harnessId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        category TEXT,
        summary TEXT,
        summaryEmbedding TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversationId) REFERENCES conversations(id)
      );
    `);
  }

  async saveConversation(conversation: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Conversation> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const updatedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, projectId, harnessId, agentId, category, summary, summaryEmbedding, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, conversation.projectId, conversation.harnessId, conversation.agentId, conversation.category, conversation.summary, JSON.stringify(conversation.summaryEmbedding), createdAt, updatedAt);

    return { ...conversation, id, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) };
  }

  async saveMessage(message: Omit<Message, 'id'>): Promise<Message> {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversationId, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, message.conversationId, message.role, message.content, timestamp);

    return { ...message, id, timestamp: new Date(timestamp) };
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      ...row,
      summaryEmbedding: row.summaryEmbedding ? JSON.parse(row.summaryEmbedding) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    };
  }

  async getConversationMessages(conversationId: string): Promise<Message[]> {
    const rows = this.db.prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp ASC').all(conversationId) as any[];
    return rows.map(row => ({
      ...row,
      timestamp: new Date(row.timestamp)
    }));
  }

  async searchConversations(query: string, limit: number = 10): Promise<Conversation[]> {
    // Simple keyword search for now
    const rows = this.db.prepare(`
      SELECT * FROM conversations 
      WHERE summary LIKE ? OR projectId LIKE ? OR agentId LIKE ?
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];

    return rows.map(row => ({
      ...row,
      summaryEmbedding: row.summaryEmbedding ? JSON.parse(row.summaryEmbedding) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    }));
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation> {
    const fields = Object.keys(updates).filter(k => k !== 'id' && k !== 'createdAt');
    if (fields.length === 0) {
      const conversation = await this.getConversation(id);
      if (!conversation) throw new Error('Conversation not found');
      return conversation;
    }

    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => {
      const val = (updates as any)[f];
      return (f === 'summaryEmbedding') ? JSON.stringify(val) : val;
    });
    
    values.push(id);

    this.db.prepare(`UPDATE conversations SET ${setClause}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
    
    const updated = await this.getConversation(id);
    if (!updated) throw new Error('Conversation not found');
    return updated;
  }

  async deleteConversation(id: string): Promise<void> {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM messages WHERE conversationId = ?').run(id);
  }
}
