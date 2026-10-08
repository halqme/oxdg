import { describe, expect, test } from "bun:test";
import { extractImports } from "../../src/analyzer/imports.ts";

describe("dependency extraction", () => {
  test("captures only line numbers when requested, including Unicode prefixes", () => {
    const source = [
      'const message = "日本語 😀";',
      'import { a } from "./a.js";',
      'require("./b.js");',
    ].join("\n");
    const result = extractImports(source, "sample.ts", true);
    expect(result.imports.map((item) => item.location)).toEqual([{ line: 2 }, { line: 3 }]);
    expect(extractImports(source, "sample.ts").imports.every((item) => !item.location)).toBe(true);
  });

  test("reports original Vue SFC line numbers", () => {
    const source = [
      "<template><div /></template>",
      '<script setup lang="ts">',
      'import { a } from "./a";',
      "</script>",
    ].join("\n");
    const result = extractImports(source, "component.vue", true);
    expect(result.imports[0]?.location).toEqual({ line: 3 });
  });

  test("extracts static ESM imports", () => {
    const result = extractImports('import { value } from "./value.js";', "sample.ts");

    expect(result.imports).toEqual([{ specifier: "./value.js", kind: "import", typeOnly: false }]);
    expect(result.warnings).toEqual([]);
  });

  test("preserves type-only import metadata", () => {
    const result = extractImports('import type { Value } from "./types.js";', "sample.ts");

    expect(result.imports).toEqual([{ specifier: "./types.js", kind: "import", typeOnly: true }]);
  });

  test("extracts re-export dependencies", () => {
    const result = extractImports('export * from "./exports.js";', "sample.ts");

    expect(result.imports).toEqual([
      { specifier: "./exports.js", kind: "re-export", typeOnly: false },
    ]);
  });

  test("extracts dynamic import dependencies", () => {
    const result = extractImports('import("./dynamic.js");', "sample.ts");

    expect(result.imports).toEqual([
      { specifier: "./dynamic.js", kind: "dynamic-import", typeOnly: false },
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("extracts require and require.resolve dependencies", () => {
    const result = extractImports(
      ['require("./common.js");', 'require.resolve("./resolved.js");'].join("\n"),
      "sample.ts",
    );

    expect(result.imports).toEqual([
      { specifier: "./common.js", kind: "require", typeOnly: false },
      { specifier: "./resolved.js", kind: "require-resolve", typeOnly: false },
    ]);
  });

  test("preserves escaped require identifiers", () => {
    const result = extractImports('requ\\u0069re("./escaped.js");', "sample.js");

    expect(result.imports).toEqual([
      { specifier: "./escaped.js", kind: "require", typeOnly: false },
    ]);
  });

  test("warns when dynamic imports and require calls use non-static specifiers", () => {
    const result = extractImports("import(path);\nrequire(name);", "sample.ts");

    expect(result.imports).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((warning) => warning.code === "dynamic-specifier")).toBe(true);
  });
});
