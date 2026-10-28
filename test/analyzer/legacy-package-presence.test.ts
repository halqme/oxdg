import { mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../../src/index.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

const calls = [
  ['import "SPEC";', "import"],
  ['import("SPEC");', "dynamic-import"],
  ['require("SPEC");', "require"],
  ['require.resolve("SPEC");', "require-resolve"],
] as const;

test("installed package presence does not override aliases or builtins", async () => {
  const specifiers = ["alias", "alias/subpath", "fs", "node:fs"];
  const root = await createFixture({
    "src/entry.ts": specifiers
      .flatMap((specifier) => calls.map(([call]) => call.replace("SPEC", specifier)))
      .join("\n"),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { alias: ["./mapped.ts"], "alias/*": ["./mapped.ts"] } },
    }),
    "mapped.ts": "export {};",
    "node_modules/alias/package.json": JSON.stringify({ main: "absent.js" }),
    "node_modules/fs/package.json": JSON.stringify({ main: "absent.js" }),
    "alias.ts": "export const wrong = true;",
    "alias/subpath.ts": "export const wrong = true;",
    "fs.ts": "export const wrong = true;",
  });
  try {
    for (const includeNpm of [false, true]) {
      for (const explicit of [false, true]) {
        const result = await analyze("src/entry.ts", {
          cwd: root,
          includeNpm,
          ...(explicit ? { tsconfig: "tsconfig.json" } : {}),
        });
        expect([...result.graph.nodes.keys()]).toEqual(["mapped.ts", "src/entry.ts"]);
        expect(result.graph.edges).toHaveLength(specifiers.length * calls.length);
        for (const edge of result.graph.edges) {
          if (edge.specifier.startsWith("alias")) {
            expect(edge.status).toBe("internal");
            expect(edge.to).toBe("mapped.ts");
          } else {
            expect(edge.status).toBe("external");
            expect(edge.to).toBeUndefined();
          }
        }
        expect(result.warnings).toEqual([]);
      }
    }
  } finally {
    await removeFixture(root);
  }
});

for (const layout of ["local", "nested", "ancestor", "symlink"] as const) {
  test(`installed legacy packages never fall back to cwd (${layout})`, async () => {
    const packages = ["broken-main", "@scope/broken-main", "no-manifest", "valid-entry"];
    const specifiers = packages.flatMap((name) =>
      name === "valid-entry" ? [`${name}/missing`] : [name, `${name}/missing`],
    );
    const files: Record<string, string> = {
      "project/src/entry.ts": specifiers
        .flatMap((specifier) => calls.map(([call]) => call.replace("SPEC", specifier)))
        .join("\n"),
    };
    const installRoot =
      layout === "ancestor"
        ? "node_modules"
        : layout === "nested"
          ? "project/src/node_modules"
          : "project/node_modules";
    for (const name of packages) {
      // Each cwd target would be an incorrect but otherwise valid fallback.
      files[`project/${name}.ts`] = "export const wrong = true;";
      files[`project/${name}/missing.ts`] = "export const wrong = true;";
      const packageRoot = layout === "symlink" ? `store/${name}` : `${installRoot}/${name}`;
      if (name === "no-manifest") {
        files[`${packageRoot}/README.md`] = "Package without a manifest or index.";
      } else {
        files[`${packageRoot}/package.json`] = JSON.stringify({
          name,
          main: name === "valid-entry" ? "index.js" : "absent.js",
        });
        if (name === "valid-entry") {
          files[`${packageRoot}/index.js`] = "export {};";
        }
      }
    }
    const root = await createFixture(files);
    try {
      if (layout === "symlink") {
        for (const name of packages) {
          const link = join(root, installRoot, name);
          await mkdir(dirname(link), { recursive: true });
          await symlink(join(root, "store", name), link, "junction");
        }
      }
      for (const includeNpm of [false, true]) {
        const result = await analyze("src/entry.ts", { cwd: join(root, "project"), includeNpm });
        expect([...result.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
        expect(result.graph.edges).toHaveLength(specifiers.length * calls.length);
        for (const specifier of specifiers) {
          for (const [, kind] of calls) {
            expect(result.graph.edges).toContainEqual({
              from: "src/entry.ts",
              specifier,
              kind,
              typeOnly: false,
              status: includeNpm ? "unresolved" : "external",
            });
          }
        }
        expect(result.warnings.map((warning) => warning.code)).toEqual(
          includeNpm ? Array(specifiers.length * calls.length).fill("unresolved-import") : [],
        );
      }
    } finally {
      await removeFixture(root);
    }
  });
}
