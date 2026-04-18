# ai-code-review-action

[![CI](https://github.com/ashios15/ai-code-review-action/actions/workflows/ci.yml/badge.svg)](https://github.com/ashios15/ai-code-review-action/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A **GitHub Action** that uses **Claude AI** to automatically review pull requests — flags bugs, suggests refactors, checks accessibility, and identifies security issues.

<!-- ![Screenshot](./docs/screenshot.png) -->

## Features

- **Bug Detection** — Logic errors, null risks, race conditions, type misuse
- **Accessibility** — WCAG 2.1 violations, missing ARIA, keyboard navigation issues
- **Performance** — Unnecessary re-renders, missing memoization, bundle size concerns
- **Security** — XSS, injection risks, exposed secrets, missing validation
- **Inline Comments** — Posts review comments directly on the PR diff
- **Summary Report** — Overall assessment with statistics table
- **Configurable** — Choose review scope, model, and file limits

## Usage

```yaml
# .github/workflows/ai-review.yml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ashios15/ai-code-review-action@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          review-scope: 'all'        # bugs | a11y | perf | security | all
          model: 'claude-sonnet-4-20250514'
          max-files: '15'
```

## How It Works

```
PR Opened/Updated
    ↓
Fetch changed files via GitHub API
    ↓
Send diffs to Claude with review prompt
    ↓
Parse structured review response
    ↓
Post inline comments + summary on PR
```

1. Triggers on `pull_request` events
2. Fetches the PR diff via GitHub API
3. Sends code changes to Claude with a specialized review prompt
4. Parses Claude's structured JSON response
5. Posts inline review comments directly on the PR
6. Adds a summary comment with statistics

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `anthropic-api-key` | Yes | — | Your Anthropic API key |
| `github-token` | Yes | `${{ github.token }}` | GitHub token for PR access |
| `model` | No | `claude-sonnet-4-20250514` | Claude model to use |
| `review-scope` | No | `all` | What to check: `bugs`, `a11y`, `perf`, `security`, `all` |
| `max-files` | No | `15` | Max changed files to review |

## Outputs

| Output | Description |
|--------|-------------|
| `review-summary` | Text summary from the AI review |
| `critical-issues` | Count of critical issues found |
| `total-comments` | Total review comments posted |

## Example Review Output

> ## AI Code Review
>
> Overall the changes look solid. Found 1 accessibility issue in the new Modal component
> and a potential XSS risk in the search input.
>
> | Metric | Count |
> |--------|-------|
> | Files reviewed | 5 |
> | Critical | 1 |
> | Warnings | 2 |
> | Suggestions | 3 |

## Development

```bash
npm install
npm run build
npm run test
```

## License

MIT © [Ashish Joshi](https://github.com/ashios15)
