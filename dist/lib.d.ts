type ReviewScope = "bugs" | "a11y" | "perf" | "security" | "all";
interface FileDiff {
    filename: string;
    patch: string;
    status?: string;
    additions?: number;
    deletions?: number;
}
interface ReviewComment {
    path: string;
    line: number;
    severity: "critical" | "warning" | "suggestion" | "praise";
    category: "bugs" | "a11y" | "perf" | "security";
    body: string;
    suggestion?: string;
}
interface ReviewStats {
    filesReviewed: number;
    criticalIssues: number;
    warnings: number;
    suggestions: number;
    praise: number;
}
interface ReviewResult {
    summary: string;
    comments: ReviewComment[];
    stats: ReviewStats;
}
interface ReviewOptions {
    apiKey: string;
    model?: string;
    scope?: ReviewScope;
    maxFiles?: number;
    maxPatchChars?: number;
    /** Optional extra guidance injected into the system prompt. */
    projectContext?: string;
}
declare function buildSystemPrompt(scope: ReviewScope, projectContext?: string): string;
declare function buildUserPrompt(diffs: FileDiff[]): string;
/**
 * Extract the set of (path, lineNumber) pairs that correspond to added or
 * modified lines in a unified diff. We use this to drop AI comments that
 * point at lines outside the diff.
 */
declare function extractAddedLines(diffs: FileDiff[]): Map<string, Set<number>>;
declare function parseReviewResponse(text: string): {
    summary: string;
    comments: ReviewComment[];
};
declare function filterCommentsToAddedLines(comments: ReviewComment[], addedLines: Map<string, Set<number>>): ReviewComment[];
declare function computeStats(filesReviewed: number, comments: ReviewComment[]): ReviewStats;
declare function reviewDiffs(diffs: FileDiff[], options: ReviewOptions): Promise<ReviewResult>;

export { type FileDiff, type ReviewComment, type ReviewOptions, type ReviewResult, type ReviewScope, type ReviewStats, buildSystemPrompt, buildUserPrompt, computeStats, extractAddedLines, filterCommentsToAddedLines, parseReviewResponse, reviewDiffs };
