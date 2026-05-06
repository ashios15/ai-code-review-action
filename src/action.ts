import * as core from "@actions/core";
import * as github from "@actions/github";
import { reviewDiffs, type FileDiff, type ReviewResult, type ReviewScope } from "./lib.js";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  suggestion: "💡",
  praise: "🌟",
};

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput("anthropic-api-key", { required: true });
    const token = core.getInput("github-token", { required: true });
    const model = core.getInput("model") || undefined;
    const scope = (core.getInput("review-scope") || "all") as ReviewScope;
    const maxFiles = parseInt(core.getInput("max-files") || "15", 10);
    const projectContext = core.getInput("project-context") || undefined;

    const octokit = github.getOctokit(token);
    const { pull_request: pr } = github.context.payload;
    if (!pr) {
      core.setFailed("This action can only run on pull_request events.");
      return;
    }

    core.info(`Reviewing PR #${pr.number}: ${pr.title}`);
    const { data: files } = await octokit.rest.pulls.listFiles({
      ...github.context.repo,
      pull_number: pr.number,
    });
    const diffs: FileDiff[] = files.map((f) => ({
      filename: f.filename,
      patch: f.patch ?? "",
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    }));
    core.info(`Found ${diffs.length} changed files`);

    const result = await reviewDiffs(diffs, {
      apiKey,
      model,
      scope,
      maxFiles,
      projectContext,
    });

    const reviewComments = result.comments
      .filter((c) => c.severity !== "praise")
      .map((c) => ({
        path: c.path,
        line: c.line,
        body: renderComment(c),
      }));

    if (reviewComments.length > 0) {
      await octokit.rest.pulls.createReview({
        ...github.context.repo,
        pull_number: pr.number,
        event: result.stats.criticalIssues > 0 ? "REQUEST_CHANGES" : "COMMENT",
        body: formatSummary(result),
        comments: reviewComments,
      });
    } else {
      await octokit.rest.issues.createComment({
        ...github.context.repo,
        issue_number: pr.number,
        body: formatSummary(result),
      });
    }

    core.setOutput("review-summary", result.summary);
    core.setOutput("critical-issues", String(result.stats.criticalIssues));
    core.setOutput("total-comments", String(result.comments.length));
    if (result.stats.criticalIssues > 0) {
      core.warning(`Found ${result.stats.criticalIssues} critical issue(s)`);
    }
    core.info("AI review complete");
  } catch (err) {
    if (err instanceof Error) core.setFailed(err.message);
    else core.setFailed(String(err));
  }
}

function renderComment(c: ReviewResult["comments"][number]): string {
  const emoji = SEVERITY_EMOJI[c.severity] ?? "";
  const head = `${emoji} **[${c.category.toUpperCase()}]** ${c.body}`;
  if (!c.suggestion) return head;
  return `${head}\n\n\`\`\`suggestion\n${c.suggestion}\n\`\`\``;
}

function formatSummary(result: ReviewResult): string {
  return `## 🤖 AI Code Review

${result.summary}

| Metric | Count |
|--------|-------|
| Files reviewed | ${result.stats.filesReviewed} |
| 🔴 Critical | ${result.stats.criticalIssues} |
| 🟡 Warnings | ${result.stats.warnings} |
| 💡 Suggestions | ${result.stats.suggestions} |
| 🌟 Praise | ${result.stats.praise} |

---
*Powered by Claude · [@ashios15/ai-code-review](https://github.com/ashios15/ai-code-review-action)*`;
}

run();
