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
  const context = projectContext ? `

Project context:
${projectContext}` : "";
  return `You are a senior staff engineer performing a code review on a pull request.

${SCOPE_GUIDANCE[scope]}${context}

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
export {
  buildSystemPrompt,
  buildUserPrompt,
  computeStats,
  extractAddedLines,
  filterCommentsToAddedLines,
  parseReviewResponse,
  reviewDiffs
};
