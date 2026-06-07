export interface Summarizer {
  summarize(messages: { role: string; content: string }[]): Promise<string>;
}
