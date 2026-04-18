export interface ReviewConfig {
  model: string;
  scope: ReviewScope;
  maxFiles: number;
}

export type ReviewScope = 'bugs' | 'a11y' | 'perf' | 'security' | 'all';

export interface FileDiff {
  filename: string;
  patch: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  severity: 'critical' | 'warning' | 'suggestion' | 'praise';
  category: ReviewScope;
}

export interface ReviewResult {
  summary: string;
  comments: ReviewComment[];
  stats: {
    filesReviewed: number;
    criticalIssues: number;
    warnings: number;
    suggestions: number;
  };
}
