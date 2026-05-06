import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reviewDiffs, type FileDiff, type ReviewScope } from "./lib.js";

const ScopeEnum = z.enum(["bugs", "a11y", "perf", "security", "all"]);

function resolveApiKey(override?: string): string {
  const key = override ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "No Anthropic API key available. Set ANTHROPIC_API_KEY or pass `apiKey` in the tool arguments."
    );
  }
  return key;
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}
function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}
function errorResult(msg: string) {
  return textResult(`ERROR: ${msg}`, true);
}

async function main() {
  const server = new McpServer(
    { name: "ai-code-review", version: "2.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Run Claude-powered PR reviews. Use `review_diffs` when you already have unified diffs in hand; use `review_github_pr` to fetch + review a PR by owner/repo/number (requires GITHUB_TOKEN env var).",
    }
  );

  server.registerTool(
    "review_diffs",
    {
      title: "Review Unified Diffs",
      description:
        "Review an array of file diffs. Returns structured review comments with severity, category, line number, and optional suggested fix.",
      inputSchema: {
        diffs: z
          .array(
            z.object({
              filename: z.string(),
              patch: z.string(),
              status: z.string().optional(),
              additions: z.number().optional(),
              deletions: z.number().optional(),
            })
          )
          .describe("Unified diff per file — typically the output of `git diff` split per file."),
        scope: ScopeEnum.optional(),
        model: z.string().optional().describe("Anthropic model id (default claude-sonnet-4-20250514)."),
        maxFiles: z.number().int().positive().optional(),
        projectContext: z
          .string()
          .optional()
          .describe("Extra system-prompt context (stack, conventions, known pitfalls)."),
        apiKey: z.string().optional().describe("Override for ANTHROPIC_API_KEY env var."),
      },
    },
    async (args) => {
      try {
        const apiKey = resolveApiKey(args.apiKey);
        const result = await reviewDiffs(args.diffs as FileDiff[], {
          apiKey,
          scope: args.scope as ReviewScope | undefined,
          model: args.model,
          maxFiles: args.maxFiles,
          projectContext: args.projectContext,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "review_github_pr",
    {
      title: "Review GitHub Pull Request",
      description:
        "Fetch a GitHub PR's file list via the REST API and review it. Requires GITHUB_TOKEN env var (or githubToken arg) with pull-request read access.",
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        pullNumber: z.number().int().positive(),
        scope: ScopeEnum.optional(),
        model: z.string().optional(),
        maxFiles: z.number().int().positive().optional(),
        projectContext: z.string().optional(),
        apiKey: z.string().optional(),
        githubToken: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const apiKey = resolveApiKey(args.apiKey);
        const token = args.githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
        if (!token) {
          return errorResult("No GitHub token. Set GITHUB_TOKEN or pass `githubToken`.");
        }
        const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/files?per_page=100`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!res.ok) {
          return errorResult(`GitHub API ${res.status}: ${await res.text()}`);
        }
        const files = (await res.json()) as Array<{
          filename: string;
          patch?: string;
          status: string;
          additions: number;
          deletions: number;
        }>;
        const diffs: FileDiff[] = files.map((f) => ({
          filename: f.filename,
          patch: f.patch ?? "",
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        }));
        const result = await reviewDiffs(diffs, {
          apiKey,
          scope: args.scope as ReviewScope | undefined,
          model: args.model,
          maxFiles: args.maxFiles,
          projectContext: args.projectContext,
        });
        return jsonResult({
          pr: `${args.owner}/${args.repo}#${args.pullNumber}`,
          ...result,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
}

main().catch((err) => {
  console.error("[ai-code-review-mcp] fatal:", err);
  process.exit(1);
});
