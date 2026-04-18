import type { ReviewScope } from './types';

export function buildSystemPrompt(scope: ReviewScope): string {
  const scopeInstructions: Record<ReviewScope, string> = {
    bugs: 'Focus on logic errors, null/undefined risks, race conditions, off-by-one errors, and incorrect type usage.',
    a11y: 'Focus on accessibility: missing ARIA labels, incorrect roles, color contrast, keyboard navigation, screen reader compatibility, WCAG 2.1 compliance.',
    perf: 'Focus on performance: unnecessary re-renders, missing memoization, large bundle imports, N+1 queries, unoptimized images, layout thrashing.',
    security: 'Focus on security: XSS vulnerabilities, injection risks, exposed secrets, insecure dependencies, missing input validation, CSRF risks.',
    all: 'Review for bugs, accessibility (WCAG 2.1), performance, and security issues comprehensively.',
  };

  return `You are an expert senior front-end engineer performing a code review on a pull request.

${scopeInstructions[scope]}

For each issue found, respond with a JSON array of objects with these fields:
- "path": the file path
- "line": the line number in the diff (use the + line numbers)
- "severity": one of "critical", "warning", "suggestion", or "praise"
- "category": one of "bugs", "a11y", "perf", "security"
- "body": a concise review comment explaining the issue and how to fix it

Also provide a "summary" field with a brief overall assessment.

Respond ONLY with valid JSON in this format:
{
  "summary": "Overall assessment...",
  "comments": [...]
}

Rules:
- Be specific and actionable
- Include code fix suggestions where possible
- Don't flag style/formatting issues
- Don't flag issues in unchanged lines
- Praise good patterns you see (max 2 praise comments)`;
}

export function buildReviewPrompt(diffs: Array<{ filename: string; patch: string }>): string {
  const diffText = diffs
    .map((d) => `### ${d.filename}\n\`\`\`diff\n${d.patch}\n\`\`\``)
    .join('\n\n');

  return `Review the following pull request changes:\n\n${diffText}`;
}
