import { Summarizer } from "../../core/summarization.js";

export class OpenAISummarizer implements Summarizer {
  constructor(
    private apiKey: string,
    private baseUrl: string = "https://api.openai.com/v1/chat/completions",
    private model: string = "gpt-5-mini",
  ) {}

  async summarize(
    messages: { role: string; content: string }[],
  ): Promise<string> {
    const prompt = {
      role: "system",
      content:
        "Provide a concise, high-level summary of the following conversation for later retrieval. Focus on the main goals, key decisions, and outcome.",
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [prompt, ...messages],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Summarization API error: ${error}`);
    }

    const data: any = await response.json();
    return data.choices[0].message.content.trim();
  }
}
