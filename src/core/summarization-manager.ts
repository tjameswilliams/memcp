import { Summarizer } from "../core/summarization.js";
import { OpenAISummarizer } from "../providers/summarization/openai.js";
import "dotenv/config";

export class SummarizationManager {
  private summarizer: Summarizer | null = null;

  constructor(config: { apiKey?: string; baseUrl?: string; model?: string }) {
    if (config.apiKey) {
      // Adjust baseUrl to be the chat completion endpoint if it's the embeddings one
      const chatUrl = config.baseUrl
        ? config.baseUrl.replace("/embeddings", "/chat/completions")
        : "https://api.openai.com/v1/chat/completions";

      this.summarizer = new OpenAISummarizer(
        config.apiKey,
        chatUrl,
        config.model || "gpt-4o-mini",
      );
    }
  }

  async summarize(
    messages: { role: string; content: string }[],
  ): Promise<string> {
    if (!this.summarizer) {
      throw new Error(
        "Summarization is only available when an API key is provided.",
      );
    }
    return this.summarizer.summarize(messages);
  }
}
