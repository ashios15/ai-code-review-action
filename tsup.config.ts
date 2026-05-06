import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    lib: "src/lib.ts",
    action: "src/action.ts",
    mcp: "src/mcp.ts",
  },
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: { entry: { lib: "src/lib.ts" } },
  sourcemap: false,
  splitting: false,
  shims: false,
  onSuccess: "node scripts/postbuild.mjs",
});
