import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  extractAddedLines,
  parseReviewResponse,
  filterCommentsToAddedLines,
  computeStats,
  type ReviewComment,
} from "../src/lib.js";

describe("buildSystemPrompt", () => {
  it("embeds scope-specific guidance", () => {
    expect(buildSystemPrompt("a11y")).toContain("ARIA");
    expect(buildSystemPrompt("security")).toContain("XSS");
    expect(buildSystemPrompt("perf")).toContain("re-renders");
    expect(buildSystemPrompt("bugs")).toContain("null/undefined");
  });
  it("injects project context when provided", () => {
    const p = buildSystemPrompt("all", "Next.js 15 App Router repo");
    expect(p).toContain("Next.js 15");
  });
  it("requires JSON-only output", () => {
    expect(buildSystemPrompt("all")).toContain('"summary"');
    expect(buildSystemPrompt("all")).toContain('"comments"');
  });
});

describe("buildUserPrompt", () => {
  it("fences each file as a diff block", () => {
    const out = buildUserPrompt([
      { filename: "a.ts", patch: "+const x = 1;" },
      { filename: "b.ts", patch: "-old\n+new" },
    ]);
    expect(out).toContain("### a.ts");
    expect(out).toContain("### b.ts");
    expect(out).toContain("```diff");
  });
});

describe("extractAddedLines", () => {
  it("maps hunk headers to new-file line numbers for + lines", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " line1",
      "+added2",
      " line3",
      "+added4",
    ].join("\n");
    const map = extractAddedLines([{ filename: "x.ts", patch }]);
    const set = map.get("x.ts")!;
    expect(set.has(2)).toBe(true);
    expect(set.has(4)).toBe(true);
    expect(set.has(1)).toBe(false);
    expect(set.has(3)).toBe(false);
  });

  it("handles multiple hunks", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      " a",
      "+b",
      "@@ -10,2 +20,2 @@",
      " c",
      "+d",
    ].join("\n");
    const map = extractAddedLines([{ filename: "y.ts", patch }]);
    const set = map.get("y.ts")!;
    expect(set.has(2)).toBe(true);
    expect(set.has(21)).toBe(true);
  });
});

describe("parseReviewResponse", () => {
  it("extracts JSON from a fenced block", () => {
    const text = "Some prose\n```json\n{\"summary\":\"ok\",\"comments\":[]}\n```";
    expect(parseReviewResponse(text)).toEqual({ summary: "ok", comments: [] });
  });
  it("extracts raw JSON without fences", () => {
    const text = '{"summary":"fine","comments":[]}';
    expect(parseReviewResponse(text).summary).toBe("fine");
  });
  it("returns empty comments on malformed input", () => {
    expect(parseReviewResponse("not json at all").comments).toEqual([]);
  });
  it("rejects comments that fail the schema", () => {
    const text =
      '{"summary":"x","comments":[{"path":"a","line":"not-a-number","severity":"critical","category":"bugs","body":"b"}]}';
    expect(parseReviewResponse(text).comments).toEqual([]);
  });
});

describe("filterCommentsToAddedLines", () => {
  it("drops comments on lines not in the diff", () => {
    const comments: ReviewComment[] = [
      { path: "a.ts", line: 2, severity: "warning", category: "bugs", body: "x" },
      { path: "a.ts", line: 99, severity: "warning", category: "bugs", body: "hallucinated" },
      { path: "b.ts", line: 1, severity: "suggestion", category: "perf", body: "unknown file" },
    ];
    const added = new Map([["a.ts", new Set([2])]]);
    const out = filterCommentsToAddedLines(comments, added);
    expect(out).toHaveLength(1);
    expect(out[0]!.line).toBe(2);
  });
});

describe("computeStats", () => {
  it("counts by severity", () => {
    const comments: ReviewComment[] = [
      { path: "a", line: 1, severity: "critical", category: "bugs", body: "" },
      { path: "a", line: 2, severity: "warning", category: "perf", body: "" },
      { path: "a", line: 3, severity: "warning", category: "a11y", body: "" },
      { path: "a", line: 4, severity: "suggestion", category: "bugs", body: "" },
      { path: "a", line: 5, severity: "praise", category: "bugs", body: "" },
    ];
    const s = computeStats(3, comments);
    expect(s).toEqual({
      filesReviewed: 3,
      criticalIssues: 1,
      warnings: 2,
      suggestions: 1,
      praise: 1,
    });
  });
});
