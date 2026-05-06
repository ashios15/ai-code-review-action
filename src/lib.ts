import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export type ReviewScope = "bugs" | "a11y" | "perf" | "security" | "all";

export interface FileDiff {
  filename: string;
  patch: string;
  status?: string;
  additions?: number;
  deletions?: number;
}

export interface ReviewComment {
  path: string;
  line: number;
  severity: "critical" | "warning" | "suggestion" | "praise";
  category: "bugs" | "a11y" | "perf" | "security";
  body: string;
  suggestion?: string;
}

export interface ReviewStats {
  filesReviewed: number;
  criticalIssues: number;
  warnings: number;
  suggestions: number;
  praise: number;
}

export interface ReviewResult {
  summary: string;
  comments: ReviewComment[];
  stats: ReviewStats;
}

export interface ReviewOptions {
  apiKey: string;
  model?: string;
  scope?: ReviewScope;
  maxFiles?: number;
  maxPatchChars?: number;
  /** Optional extra guidance injected into the system prompt. */
  projectContext?: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

const ReviewCommentSchema = z.object({
  path: z.string(),
  line: z.number().int().nonnegative(),
  severity: z.enum(["critical", "warning", "suggestion", "praise"]),
  category: z.enum(["bugs", "a11y", "perf", "security"]),
  body: z.string(),
  suggestion: z.string().optional(),
});

const ReviewResponseSchema = z.object({
  summary: z.string(),
  comments: z.array(ReviewCommentSchema),
});

const SCOPE_GUIDANCE: Record<ReviewScope, string> = {
  bugs: "Focus on logic errors, null/undefined risks, race conditions, off-by-one errors, incorrect type usage, and unhandled error paths.",
  a11y: "Focus on accessibility: missing ARIA labels, incorrect roles, focus management, color-only cues, keyboard traps, and WCAG 2.2 AA compliance.",
  perf: "Focus on performance: unnecessary re-renders, missing memoization, N+1 queries, oversized imports, layout thrashing, blocking work on the main thread.",
  security: "Focus on security: XSS via dangerouslySetInnerHTML/innerHTML, injection risks, exposed secrets, SSRF, CSRF, missing input validation, unsafe deserialization.",
  all: "Review for bugs, accessibility (WCAG 2.2 AA), performance, and security comprehensively.",
};

export function buildSystemPrompt(scope: ReviewScope, projectContext?: string): string {
  const context = projectContext ? `\n\nProject context:\n${projectContext}` : "";
  return `You are a senior staff engineer performing a code review on a pull request.

${SCOPE_GUIDANCE[scope]}${context}

Output rules — READ CAREFULLY:
- Only comment on lines that are added or modified in the diff (lines prefixed with "+"). Never cite a line that is context-only or removed.
- The "line" field MUST be the 1-based line number as it would appear in the NEW file (after the patch), i.e. the "+n" from the hunk header plus the offset of the "+" line inside the hunk.
- Do not flag formatting, import ordering, or style preferences.
- Be specific and actionable. If you suggest a code change, put it in the optional "suggestion" field as a code block the reviewer could paste.
- At most 2 "praise" comments total.

Respond with a single JSON object (no prose, no markdown fence) matching this shape:
{
  "summary": "string — overall assessment in 2-4 sentences",
  "comments": [
    {
      "path": "string — file path from the diff header",
      "line": 123,
      "severity": "critical" | "warning" | "suggestion" | "praise",
      "category": "bugs" | "a11y" | "perf" | "security",
      "body": "string — what and why",
      "suggestion": "optional code fix"
    }
  ]
}`;
}

export function buildUserPrompt(diffs: FileDiff[]): string {
  const body = diffs
    .map((d) => `### ${d.filename}\n\`\`\`diff\n${d.patch}\n\`\`\``)
    .join("\n\n");
  return `Review the following pull request changes:\n\n${body}`;
}

/**
 * Extract the set of (path, lineNumber) pairs that correspond to added or
 * modified lines in a unified diff. We use this to drop AI comments that
 * point at lines outside the diff.
 */
export function extractAddedLines(diffs: FileDiff[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const d of diffs) {
    const set = new Set<number>();
    let newLine = 0;
    for (const raw of d.patch.split("\n")) {
      const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        newLine = parseInt(hunk[1]!, 10);
        continue;
      }
      if (raw.startsWith("+") && !raw.startsWith("+++")) {
        set.add(newLine);
        newLine++;
      } else if (raw.startsWith("-") && !raw.startsWith("---")) {
        // removed lines don't advance new-file counter
      } else if (!raw.startsWith("\\")) {
        // context line
        newLine++;
      }
    }
    map.set(d.filename, set);
  }
  return map;
}

function extractJson(text: string): string | null {
  // Prefer fenced JSON
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) return fenced[1] ?? null;
  // Fallback: first { ... last }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return null;
}

export function parseReviewResponse(text: string): { summary: string; comments: ReviewComment[] } {
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

export function filterCommentsToAddedLines(
  comments: ReviewComment[],
  addedLines: Map<string, Set<number>>
): ReviewComment[] {
  return comments.filter((c) => {
    const lines = addedLines.get(c.path);
    if (!lines) return false;
    return lines.has(c.line);
  });
}

export function computeStats(filesReviewed: number, comments: ReviewComment[]): ReviewStats {
  return {
    filesReviewed,
    criticalIssues: comments.filter((c) => c.severity === "critical").length,
    warnings: comments.filter((c) => c.severity === "warning").length,
    suggestions: comments.filter((c) => c.severity === "suggestion").length,
    praise: comments.filter((c) => c.severity === "praise").length,
  };
}

export async function reviewDiffs(
  diffs: FileDiff[],
  options: ReviewOptions
): Promise<ReviewResult> {
  const scope: ReviewScope = options.scope ?? "all";
  const model = options.model ?? DEFAULT_MODEL;
  const maxFiles = options.maxFiles ?? 15;
  const maxPatchChars = options.maxPatchChars ?? 12000;

  const trimmed = diffs
    .slice(0, maxFiles)
    .filter((d) => d.patch && d.patch.trim().length > 0)
    .map((d) => ({
      ...d,
      patch: d.patch.length > maxPatchChars ? d.patch.slice(0, maxPatchChars) + "\n... [truncated]" : d.patch,
    }));

  if (trimmed.length === 0) {
    return {
      summary: "No reviewable changes found.",
      comments: [],
      stats: computeStats(0, []),
    };
  }

  const client = new Anthropic({ apiKey: options.apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: buildSystemPrompt(scope, options.projectContext),
    messages: [{ role: "user", content: buildUserPrompt(trimmed) }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = parseReviewResponse(text);
  const addedLines = extractAddedLines(trimmed);
  const validComments = filterCommentsToAddedLines(parsed.comments, addedLines);
  return {
    summary: parsed.summary,
    comments: validComments,
    stats: computeStats(trimmed.length, validComments),
  };
}
