export interface Conversation {
  id: string;
  projectId: string;
  harnessId: string;
  agentId: string;
  category?: string;
  summary?: string;
  summaryEmbedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface StorageProvider {
  saveConversation(conversation: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Conversation>;
  saveMessage(message: Omit<Message, 'id'>): Promise<Message>;
  getConversation(id: string): Promise<Conversation | null>;
  getConversationMessages(conversationId: string): Promise<Message[]>;
  searchConversations(query: string, limit?: number): Promise<Conversation[]>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
}
