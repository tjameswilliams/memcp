import { EmbeddingProvider } from '../core/embeddings.js';
import { LocalEmbeddingProvider } from '../providers/embeddings/local.js';
import { OpenAIEmbeddingProvider } from '../providers/embeddings/openai.js';
import 'dotenv/config';

export type EmbeddingConfig = {
  provider: 'local' | 'openai';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export class EmbeddingManager {
  private provider: EmbeddingProvider;

  constructor(config: EmbeddingConfig) {
    if (config.provider === 'openai') {
      if (!config.apiKey) throw new Error('OpenAI API key is required for openai provider');
      this.provider = new OpenAIEmbeddingProvider(
        config.apiKey, 
        config.baseUrl, 
        config.model
      );
    } else {
      this.provider = new LocalEmbeddingProvider();
    }
  }

  async embed(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  get modelName() {
    return this.provider.modelName;
  }
}
