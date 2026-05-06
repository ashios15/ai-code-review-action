# ai-code-review

> **One engine, three front doors.** A Claude-powered pre-PR reviewer you can ship as a **GitHub Action**, an **MCP server**, or a **Claude Code subagent** — all sharing the same validated review core.

The model comments only on lines that actually appear in the diff (hallucinated line numbers are filtered out post-hoc), emits structured JSON for every finding, and supports `suggestion` blocks GitHub renders as one-click apply patches.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What it catches

| Scope      | Examples                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| `bugs`     | null/undefined risks, off-by-one, race conditions, unhandled errors                   |
| `a11y`     | missing ARIA, focus traps, color-only cues, WCAG 2.2 AA violations                    |
| `perf`     | unnecessary re-renders, N+1 queries, oversized imports, main-thread blocking          |
| `security` | XSS, injection, exposed secrets, CSRF/SSRF, unsafe deserialization                    |
| `all`      | every scope above (default)                                                           |

Every finding has: `path`, `line`, `severity` (critical/warning/suggestion/praise), `category`, a human-readable `body`, and an optional `suggestion` code block.

---

## 1. GitHub Action

```yaml
# .github/workflows/review.yml
name: AI Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: ashios15/ai-code-review-action@v2
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          review-scope: all
          max-files: 20
          project-context: |
            Next.js 15 App Router. Use RSC by default. No `any` types.
            Tailwind for styling, Zod for validation.
```

Outputs: `review-summary`, `critical-issues`, `total-comments`. If any critical issue is found, the action posts a `REQUEST_CHANGES` review.

## 2. MCP server (for Claude Desktop / Cursor / VS Code agent mode)

```bash
npm i -g @ashios15/ai-code-review
export ANTHROPIC_API_KEY=sk-ant-...
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-code-review": {
      "command": "ai-code-review-mcp",
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "GITHUB_TOKEN": "ghp_..."
      }
    }
  }
}
```

### Cursor

Settings → MCP → Add server:

```json
{ "ai-code-review": { "command": "ai-code-review-mcp" } }
```

### VS Code (Copilot agent mode)

`.vscode/mcp.json`:

```json
{ "servers": { "ai-code-review": { "command": "ai-code-review-mcp" } } }
```

### Tools exposed

| Tool                | Use for                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `review_diffs`      | You have diffs in hand (e.g. from `git diff`). Pass `{ filename, patch }[]` plus optional scope. |
| `review_github_pr`  | Given `owner`, `repo`, `pullNumber`, fetch the PR's files and review. Needs `GITHUB_TOKEN`.      |

Both return:

```json
{
  "summary": "...",
  "comments": [
    {
      "path": "src/Button.tsx",
      "line": 42,
      "severity": "critical",
      "category": "a11y",
      "body": "Button lacks an accessible name.",
      "suggestion": "<button aria-label=\"Close\">×</button>"
    }
  ],
  "stats": { "filesReviewed": 5, "criticalIssues": 1, "warnings": 2, "suggestions": 3, "praise": 0 }
}
```

## 3. Claude Code subagent

Drop [`agents/code-reviewer.md`](agents/code-reviewer.md) into your repo's `.claude/agents/` directory. Once the MCP server is configured (see above), the subagent self-invokes on phrases like "review my branch" or "is this ready to merge".

```bash
curl -fsSL https://raw.githubusercontent.com/ashios15/ai-code-review-action/main/agents/code-reviewer.md \
  -o .claude/agents/code-reviewer.md
```

---

## Programmatic usage

```ts
import { reviewDiffs } from "@ashios15/ai-code-review";

const result = await reviewDiffs(
  [{ filename: "src/App.tsx", patch: "@@ -1,3 +1,4 @@\n ..." }],
  { apiKey: process.env.ANTHROPIC_API_KEY!, scope: "all" }
);
console.log(result.stats);
```

## Why this over a plain Anthropic call?

- **No hallucinated line numbers.** `extractAddedLines()` parses hunk headers and drops any comment the model points at outside the diff — the #1 failure mode of naive reviewers.
- **One engine, three surfaces.** The Action, MCP server, and subagent all call `reviewDiffs()`. Fix a prompt bug once.
- **Scoped reviews.** `bugs` / `a11y` / `perf` / `security` / `all` switch the system prompt to match.
- **Suggestion blocks.** GitHub renders `\`\`\`suggestion` as a one-click commit.
- **Line-validated, schema-validated.** Every comment survives both the Zod schema check and the diff-membership check.

## Development

```bash
git clone https://github.com/ashios15/ai-code-review-action.git
cd ai-code-review-action
npm install
npm run test         # 12 unit tests, no network
npm run build        # dist/lib.js + dist/action.js + dist/mcp.js
node scripts/smoke.mjs   # MCP stdio tools/list
```

## License

MIT © [ashios15](https://github.com/ashios15)
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
