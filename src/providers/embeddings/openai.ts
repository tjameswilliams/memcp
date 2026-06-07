import { EmbeddingProvider } from '../../core/embeddings.js';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.openai.com/v1/embeddings',
    public modelName: string = 'text-embedding-3-small'
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: this.modelName,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data: any = await response.json();
    return data.data[0].embedding;
  }
}
