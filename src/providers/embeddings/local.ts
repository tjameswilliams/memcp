import { EmbeddingProvider } from '../../core/embeddings.js';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private extractor: any;
  public modelName = 'Xenova/all-MiniLM-L6-v2';

  async init() {
    const { pipeline } = await import('@xenova/transformers');
    this.extractor = await pipeline('feature-extraction', this.modelName);
  }

  async embed(text: string): Promise<number[]> {
    if (!this.extractor) await this.init();
    
    const output = await this.extractor(text, { 
      pooling: 'mean', 
      normalize: true 
    });
    
    return Array.from(output.data);
  }
}
