import { spawn } from "node:child_process";

const child = spawn("node", ["dist/mcp.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, ANTHROPIC_API_KEY: "dummy-for-listing" },
});
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  const lines = buf.split("\n");
  buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    } else if (msg.id === 2) {
      console.log("TOOLS:", msg.result.tools.map((t) => t.name).join(", "));
      child.kill();
      process.exit(0);
    }
  }
});
child.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0" },
    },
  }) + "\n"
);
setTimeout(() => {
  console.error("timeout");
  child.kill();
  process.exit(1);
}, 10000);
