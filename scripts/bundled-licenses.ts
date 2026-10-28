import { readFile, readdir } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import type { Plugin } from "vite-plus";

export function bundledLicenses(): Plugin {
  return {
    name: "bundled-licenses",
    async generateBundle(_options, bundle) {
      const packages = new Map<string, { directory: string; modules: Set<string> }>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of Object.keys(output.modules)) {
          if (!id.replaceAll("\\", "/").includes("/node_modules/")) continue;
          let directory = dirname(id);
          while (directory !== parse(directory).root) {
            try {
              const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
              if (typeof manifest.name === "string" && typeof manifest.version === "string") {
                const entry = packages.get(directory) ?? { directory, modules: new Set<string>() };
                entry.modules.add(id);
                packages.set(directory, entry);
                break;
              }
              directory = dirname(directory);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
              directory = dirname(directory);
            }
          }
        }
      }
      if (packages.size === 0) throw new Error("No bundled dependency licenses found");
      const notices: string[] = [];
      for (const [, { directory, modules }] of [...packages].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
        const name = `${manifest.name}@${manifest.version}`;
        const files = (await readdir(directory))
          .filter((file) => /^(license|licence|copying)(\.|-|$)/i.test(file))
          .sort();
        if (files.length === 0) throw new Error(`No license file found for ${name}`);
        const texts = new Set<string>();
        for (const file of files) texts.add((await readFile(join(directory, file), "utf8")).trim());
        for (const id of modules) {
          try {
            texts.add((await readFile(`${id}.LEGAL.txt`, "utf8")).trim());
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        notices.push(`=== ${name} ===\n\n${[...texts].join("\n\n")}`);
      }
      this.emitFile({
        type: "asset",
        fileName: "THIRD_PARTY_LICENSES",
        source: `${notices.join("\n\n")}\n`,
      });
    },
  };
}
