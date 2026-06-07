import { Conversation } from './storage.js';

export function scoreConversations(
  conversations: Conversation[],
  queryEmbedding: number[],
  scope?: { projectId?: string; harnessId?: string; agentId?: string },
): Array<{ conversation: Conversation; similarity: number }> {
  const filtered = conversations.filter(c => {
    if (!c.summaryEmbedding) return false;
    if (scope?.projectId && c.projectId !== scope.projectId) return false;
    if (scope?.harnessId && c.harnessId !== scope.harnessId) return false;
    if (scope?.agentId && c.agentId !== scope.agentId) return false;
    return true;
  });

  return filtered.map(c => ({
    conversation: c,
    similarity: queryEmbedding.reduce(
      (acc, val, i) => acc + val * (c.summaryEmbedding![i] || 0), 0
    ),
  })).sort((a, b) => b.similarity - a.similarity);
}
