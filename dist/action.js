#!/usr/bin/env node
// src/action.ts
import * as core from "@actions/core";
import * as github from "@actions/github";

// src/lib.ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
var DEFAULT_MODEL = "claude-sonnet-4-20250514";
var ReviewCommentSchema = z.object({
  path: z.string(),
  line: z.number().int().nonnegative(),
  severity: z.enum(["critical", "warning", "suggestion", "praise"]),
  category: z.enum(["bugs", "a11y", "perf", "security"]),
  body: z.string(),
  suggestion: z.string().optional()
});
var ReviewResponseSchema = z.object({
  summary: z.string(),
  comments: z.array(ReviewCommentSchema)
});
var SCOPE_GUIDANCE = {
  bugs: "Focus on logic errors, null/undefined risks, race conditions, off-by-one errors, incorrect type usage, and unhandled error paths.",
  a11y: "Focus on accessibility: missing ARIA labels, incorrect roles, focus management, color-only cues, keyboard traps, and WCAG 2.2 AA compliance.",
  perf: "Focus on performance: unnecessary re-renders, missing memoization, N+1 queries, oversized imports, layout thrashing, blocking work on the main thread.",
  security: "Focus on security: XSS via dangerouslySetInnerHTML/innerHTML, injection risks, exposed secrets, SSRF, CSRF, missing input validation, unsafe deserialization.",
  all: "Review for bugs, accessibility (WCAG 2.2 AA), performance, and security comprehensively."
};
function buildSystemPrompt(scope, projectContext) {
  const context2 = projectContext ? `

Project context:
${projectContext}` : "";
  return `You are a senior staff engineer performing a code review on a pull request.

${SCOPE_GUIDANCE[scope]}${context2}

Output rules \u2014 READ CAREFULLY:
- Only comment on lines that are added or modified in the diff (lines prefixed with "+"). Never cite a line that is context-only or removed.
- The "line" field MUST be the 1-based line number as it would appear in the NEW file (after the patch), i.e. the "+n" from the hunk header plus the offset of the "+" line inside the hunk.
- Do not flag formatting, import ordering, or style preferences.
- Be specific and actionable. If you suggest a code change, put it in the optional "suggestion" field as a code block the reviewer could paste.
- At most 2 "praise" comments total.

Respond with a single JSON object (no prose, no markdown fence) matching this shape:
{
  "summary": "string \u2014 overall assessment in 2-4 sentences",
  "comments": [
    {
      "path": "string \u2014 file path from the diff header",
      "line": 123,
      "severity": "critical" | "warning" | "suggestion" | "praise",
      "category": "bugs" | "a11y" | "perf" | "security",
      "body": "string \u2014 what and why",
      "suggestion": "optional code fix"
    }
  ]
}`;
}
function buildUserPrompt(diffs) {
  const body = diffs.map((d) => `### ${d.filename}
\`\`\`diff
${d.patch}
\`\`\``).join("\n\n");
  return `Review the following pull request changes:

${body}`;
}
function extractAddedLines(diffs) {
  const map = /* @__PURE__ */ new Map();
  for (const d of diffs) {
    const set = /* @__PURE__ */ new Set();
    let newLine = 0;
    for (const raw of d.patch.split("\n")) {
      const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        newLine = parseInt(hunk[1], 10);
        continue;
      }
      if (raw.startsWith("+") && !raw.startsWith("+++")) {
        set.add(newLine);
        newLine++;
      } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      } else if (!raw.startsWith("\\")) {
        newLine++;
      }
    }
    map.set(d.filename, set);
  }
  return map;
}
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) return fenced[1] ?? null;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return null;
}
function parseReviewResponse(text) {
  const jsonText = extractJson(text);
  if (!jsonText) {
    return { summary: "Model did not return parseable JSON.", comments: [] };
  }
  try {
    const parsed = ReviewResponseSchema.parse(JSON.parse(jsonText));
    return parsed;
  } catch {
    return { summary: "Model returned JSON that did not match the schema.", comments: [] };
  }
}
function filterCommentsToAddedLines(comments, addedLines) {
  return comments.filter((c) => {
    const lines = addedLines.get(c.path);
    if (!lines) return false;
    return lines.has(c.line);
  });
}
function computeStats(filesReviewed, comments) {
  return {
    filesReviewed,
    criticalIssues: comments.filter((c) => c.severity === "critical").length,
    warnings: comments.filter((c) => c.severity === "warning").length,
    suggestions: comments.filter((c) => c.severity === "suggestion").length,
    praise: comments.filter((c) => c.severity === "praise").length
  };
}
async function reviewDiffs(diffs, options) {
  const scope = options.scope ?? "all";
  const model = options.model ?? DEFAULT_MODEL;
  const maxFiles = options.maxFiles ?? 15;
  const maxPatchChars = options.maxPatchChars ?? 12e3;
  const trimmed = diffs.slice(0, maxFiles).filter((d) => d.patch && d.patch.trim().length > 0).map((d) => ({
    ...d,
    patch: d.patch.length > maxPatchChars ? d.patch.slice(0, maxPatchChars) + "\n... [truncated]" : d.patch
  }));
  if (trimmed.length === 0) {
    return {
      summary: "No reviewable changes found.",
      comments: [],
      stats: computeStats(0, [])
    };
  }
  const client = new Anthropic({ apiKey: options.apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: buildSystemPrompt(scope, options.projectContext),
    messages: [{ role: "user", content: buildUserPrompt(trimmed) }]
  });
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = parseReviewResponse(text);
  const addedLines = extractAddedLines(trimmed);
  const validComments = filterCommentsToAddedLines(parsed.comments, addedLines);
  return {
    summary: parsed.summary,
    comments: validComments,
    stats: computeStats(trimmed.length, validComments)
  };
}

// src/action.ts
var SEVERITY_EMOJI = {
  critical: "\u{1F534}",
  warning: "\u{1F7E1}",
  suggestion: "\u{1F4A1}",
  praise: "\u{1F31F}"
};
async function run() {
  try {
    const apiKey = core.getInput("anthropic-api-key", { required: true });
    const token = core.getInput("github-token", { required: true });
    const model = core.getInput("model") || void 0;
    const scope = core.getInput("review-scope") || "all";
    const maxFiles = parseInt(core.getInput("max-files") || "15", 10);
    const projectContext = core.getInput("project-context") || void 0;
    const octokit = github.getOctokit(token);
    const { pull_request: pr } = github.context.payload;
    if (!pr) {
      core.setFailed("This action can only run on pull_request events.");
      return;
    }
    core.info(`Reviewing PR #${pr.number}: ${pr.title}`);
    const { data: files } = await octokit.rest.pulls.listFiles({
      ...github.context.repo,
      pull_number: pr.number
    });
    const diffs = files.map((f) => ({
      filename: f.filename,
      patch: f.patch ?? "",
      status: f.status,
      additions: f.additions,
      deletions: f.deletions
    }));
    core.info(`Found ${diffs.length} changed files`);
    const result = await reviewDiffs(diffs, {
      apiKey,
      model,
      scope,
      maxFiles,
      projectContext
    });
    const reviewComments = result.comments.filter((c) => c.severity !== "praise").map((c) => ({
      path: c.path,
      line: c.line,
      body: renderComment(c)
    }));
    if (reviewComments.length > 0) {
      await octokit.rest.pulls.createReview({
        ...github.context.repo,
        pull_number: pr.number,
        event: result.stats.criticalIssues > 0 ? "REQUEST_CHANGES" : "COMMENT",
        body: formatSummary(result),
        comments: reviewComments
      });
    } else {
      await octokit.rest.issues.createComment({
        ...github.context.repo,
        issue_number: pr.number,
        body: formatSummary(result)
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
function renderComment(c) {
  const emoji = SEVERITY_EMOJI[c.severity] ?? "";
  const head = `${emoji} **[${c.category.toUpperCase()}]** ${c.body}`;
  if (!c.suggestion) return head;
  return `${head}

\`\`\`suggestion
${c.suggestion}
\`\`\``;
}
function formatSummary(result) {
  return `## \u{1F916} AI Code Review

${result.summary}

| Metric | Count |
|--------|-------|
| Files reviewed | ${result.stats.filesReviewed} |
| \u{1F534} Critical | ${result.stats.criticalIssues} |
| \u{1F7E1} Warnings | ${result.stats.warnings} |
| \u{1F4A1} Suggestions | ${result.stats.suggestions} |
| \u{1F31F} Praise | ${result.stats.praise} |

---
*Powered by Claude \xB7 [@ashios15/ai-code-review](https://github.com/ashios15/ai-code-review-action)*`;
}
run();
