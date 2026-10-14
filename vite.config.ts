import { defineConfig } from "vite-plus";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const pluginRoot = resolve(import.meta.dirname);
const buildDir = resolve(pluginRoot, ".plugin-build");

export default defineConfig({
  build: {
    outDir: ".plugin-build",
    target: "es2020",
    sourcemap: "inline",
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    codeSplitting: false,
    rollupOptions: {
      external: [
        "obsidian",
        "electron",
        "fs",
        "path",
        "child_process",
        "util",
        "os",
        "crypto",
        "stream",
        "events",
      ],
    },
    emptyOutDir: false,
    minify: false,
  },
  plugins: [
    {
      name: "copy-obsidian-entrypoint",
      closeBundle() {
        mkdirSync(pluginRoot, { recursive: true });
        copyFileSync(resolve(buildDir, "main.js"), resolve(pluginRoot, "main.js"));
        rmSync(buildDir, { recursive: true, force: true });
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
  fmt: {
    semi: true,
    singleQuote: false,
  },
});
