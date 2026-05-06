import { promises as fs } from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const shebang = "#!/usr/bin/env node\n";

for (const file of ["mcp.js", "action.js"]) {
  const full = path.join(dist, file);
  try {
    const src = await fs.readFile(full, "utf8");
    if (!src.startsWith("#!")) {
      await fs.writeFile(full, shebang + src);
    }
    await fs.chmod(full, 0o755);
  } catch (err) {
    console.error(`postbuild: skipped ${file}: ${(err instanceof Error ? err.message : String(err))}`);
  }
}
console.log("postbuild: shebang + chmod done");
