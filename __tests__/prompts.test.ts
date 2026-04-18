import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildReviewPrompt } from '../src/prompts';

describe('buildSystemPrompt', () => {
  it('includes bug-specific instructions for bugs scope', () => {
    const prompt = buildSystemPrompt('bugs');
    expect(prompt).toContain('logic errors');
    expect(prompt).toContain('null/undefined');
    expect(prompt).toContain('JSON');
  });

  it('includes a11y-specific instructions for a11y scope', () => {
    const prompt = buildSystemPrompt('a11y');
    expect(prompt).toContain('ARIA');
    expect(prompt).toContain('WCAG');
    expect(prompt).toContain('keyboard');
  });

  it('includes all categories for all scope', () => {
    const prompt = buildSystemPrompt('all');
    expect(prompt).toContain('bugs');
    expect(prompt).toContain('accessibility');
    expect(prompt).toContain('performance');
    expect(prompt).toContain('security');
  });
});

describe('buildReviewPrompt', () => {
  it('formats file diffs correctly', () => {
    const diffs = [
      { filename: 'src/App.tsx', patch: '+const x = 1;' },
      { filename: 'src/utils.ts', patch: '-old\n+new' },
    ];
    const prompt = buildReviewPrompt(diffs);
    expect(prompt).toContain('### src/App.tsx');
    expect(prompt).toContain('### src/utils.ts');
    expect(prompt).toContain('```diff');
  });
});
