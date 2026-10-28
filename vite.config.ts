import { relative } from "node:path";
import { defineConfig } from "vite-plus";
import { bundledLicenses } from "./scripts/bundled-licenses.ts";

export default defineConfig({
  staged: {
    "*": (files) => {
      // Preserve upstream bytes and syntax outside this project's lint contract.
      const targets = files.filter(
        (file) => !relative(import.meta.dirname, file).startsWith("test/madge-compat/upstream/"),
      );
      return targets.length
        ? `vp check --fix ${targets.map((file) => JSON.stringify(file)).join(" ")}`
        : [];
    },
  },
  pack: {
    entry: {
      index: "src/index.ts",
      "cli/main": "src/cli/main.ts",
    },
    format: "esm",
    platform: "node",
    dts: true,
    sourcemap: false,
    clean: true,
    // Keep the emitted names aligned with package.json's .js/.d.ts exports.
    fixedExtension: false,
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
      alwaysBundle: ["@dagrejs/dagre", "commander", "ignore", "yaml"],
      neverBundle: ["oxc-parser", "oxc-resolver", "oxc-walker"],
    },
    minify: true,
    plugins: [bundledLicenses()],
    treeshake: true,
  },
  fmt: {
    ignorePatterns: ["test/madge-compat/upstream/**"],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    categories: {
      correctness: "error",
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    env: {
      builtin: true,
    },
    ignorePatterns: ["test/fixtures"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
});
