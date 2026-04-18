import * as core from '@actions/core';
import * as github from '@actions/github';
import { reviewWithClaude } from './reviewer';
import type { ReviewConfig, ReviewScope, FileDiff } from './types';

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  suggestion: '💡',
  praise: '🌟',
};

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('anthropic-api-key', { required: true });
    const token = core.getInput('github-token', { required: true });
    const model = core.getInput('model') || 'claude-sonnet-4-20250514';
    const scope = (core.getInput('review-scope') || 'all') as ReviewScope;
    const maxFiles = parseInt(core.getInput('max-files') || '15', 10);

    const octokit = github.getOctokit(token);
    const { pull_request: pr } = github.context.payload;

    if (!pr) {
      core.setFailed('This action can only run on pull_request events.');
      return;
    }

    core.info(`🔍 Reviewing PR #${pr.number}: ${pr.title}`);
    core.info(`📋 Scope: ${scope} | Model: ${model} | Max files: ${maxFiles}`);

    // Fetch PR diff
    const { data: files } = await octokit.rest.pulls.listFiles({
      ...github.context.repo,
      pull_number: pr.number,
    });

    const diffs: FileDiff[] = files.map((f) => ({
      filename: f.filename,
      patch: f.patch ?? '',
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    }));

    core.info(`📁 Found ${diffs.length} changed files`);

    const config: ReviewConfig = { model, scope, maxFiles };
    const result = await reviewWithClaude(apiKey, diffs, config);

    // Post review comments
    if (result.comments.length > 0) {
      const reviewComments = result.comments
        .filter((c) => c.severity !== 'praise')
        .map((c) => ({
          path: c.path,
          line: c.line,
          body: `${SEVERITY_EMOJI[c.severity] ?? ''} **[${c.category.toUpperCase()}]** ${c.body}`,
        }));

      if (reviewComments.length > 0) {
        await octokit.rest.pulls.createReview({
          ...github.context.repo,
          pull_number: pr.number,
          event: result.stats.criticalIssues > 0 ? 'REQUEST_CHANGES' : 'COMMENT',
          body: formatSummary(result),
          comments: reviewComments,
        });
      }
    } else {
      // Post summary comment if no inline comments
      await octokit.rest.issues.createComment({
        ...github.context.repo,
        issue_number: pr.number,
        body: formatSummary(result),
      });
    }

    // Set action outputs
    core.setOutput('review-summary', result.summary);
    core.setOutput('critical-issues', result.stats.criticalIssues);
    core.setOutput('total-comments', result.comments.length);

    if (result.stats.criticalIssues > 0) {
      core.warning(`Found ${result.stats.criticalIssues} critical issue(s)`);
    }

    core.info('✅ AI review complete');
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

function formatSummary(result: { summary: string; stats: { filesReviewed: number; criticalIssues: number; warnings: number; suggestions: number } }): string {
  return `## 🤖 AI Code Review

${result.summary}

| Metric | Count |
|--------|-------|
| Files reviewed | ${result.stats.filesReviewed} |
| 🔴 Critical | ${result.stats.criticalIssues} |
| 🟡 Warnings | ${result.stats.warnings} |
| 💡 Suggestions | ${result.stats.suggestions} |

---
*Powered by Claude AI · [ai-code-review-action](https://github.com/ashishjoshi/ai-code-review-action)*`;
}

run();
