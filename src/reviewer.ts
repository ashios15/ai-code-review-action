import Anthropic from '@anthropic-ai/sdk';
import type { ReviewConfig, ReviewResult, FileDiff } from './types';
import { buildSystemPrompt, buildReviewPrompt } from './prompts';

export async function reviewWithClaude(
  apiKey: string,
  diffs: FileDiff[],
  config: ReviewConfig
): Promise<ReviewResult> {
  const client = new Anthropic({ apiKey });

  const filteredDiffs = diffs.slice(0, config.maxFiles).filter((d) => d.patch);

  if (filteredDiffs.length === 0) {
    return {
      summary: 'No reviewable changes found.',
      comments: [],
      stats: { filesReviewed: 0, criticalIssues: 0, warnings: 0, suggestions: 0 },
    };
  }

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: buildReviewPrompt(filteredDiffs),
      },
    ],
    system: buildSystemPrompt(config.scope),
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      summary: 'AI review completed but could not parse structured response.',
      comments: [],
      stats: { filesReviewed: filteredDiffs.length, criticalIssues: 0, warnings: 0, suggestions: 0 },
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as ReviewResult;

  // Compute stats
  const stats = {
    filesReviewed: filteredDiffs.length,
    criticalIssues: parsed.comments.filter((c) => c.severity === 'critical').length,
    warnings: parsed.comments.filter((c) => c.severity === 'warning').length,
    suggestions: parsed.comments.filter((c) => c.severity === 'suggestion').length,
  };

  return { ...parsed, stats };
}
