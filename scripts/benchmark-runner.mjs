import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const extensions = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
const extensionSet = new Set(extensions.map((extension) => `.${extension}`));
const defaultWarmup = 8;
const defaultRuns = 20;

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name) {
  const value = optionValue(name);
  if (!value) throw new Error(`missing required option: ${name}`);
  return value;
}

function positiveIntegerOption(name, fallback) {
  const value = optionValue(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readCommand(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

async function countSourceFiles(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await countSourceFiles(path);
    } else if (entry.isFile() && extensionSet.has(extname(entry.name))) {
      count += 1;
    }
  }
  return count;
}

async function readPackageVersion(path) {
  const packageJson = JSON.parse(await readFile(path, "utf8"));
  return packageJson.version;
}

async function execJson(command, args, cwd, label) {
  try {
    const { stdout } = await execFile(command, args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`${label} probe failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}

function normalizeModuleId(cwd, value) {
  let moduleId = String(value).replaceAll("\\", "/");
  if (isAbsolute(moduleId)) {
    moduleId = relative(cwd, moduleId).replaceAll("\\", "/");
  }
  while (moduleId.startsWith("./")) {
    moduleId = moduleId.slice(2);
  }
  return moduleId;
}

function summarizeModuleIds(cwd, ids) {
  const moduleIds = [...new Set(ids.map((id) => normalizeModuleId(cwd, id)))].sort();
  const sourceModuleIds = moduleIds.filter((id) =>
    extensionSet.has(extname(id).toLowerCase()),
  );
  return {
    graphNodes: moduleIds.length,
    sourceModules: sourceModuleIds.length,
    sourceModuleIds,
  };
}

async function probeModuleCoverage({ cwd, directoryInput, entrypointInput, label }) {
  const extensionList = extensions.join(",");
  const dpdmExtensionList = extensions.map((extension) => `.${extension}`).join(",");
  const dpdmOutput = join(outputDirectory, `benchmark-${label}-dpdm-probe.json`);

  async function probeOxdg(cli, input, probeLabel) {
    const result = await execJson(
      cli,
      ["--extensions", extensionList, input, "--json"],
      cwd,
      probeLabel,
    );
    if (!Array.isArray(result?.modules)) {
      throw new Error(`${probeLabel} probe is missing modules`);
    }
    return summarizeModuleIds(
      cwd,
      result.modules.map((module) => module.id),
    );
  }

  async function probeMadge(input, probeLabel) {
    const script =
      'const madge = require(process.argv[1]); madge(process.argv[2], { fileExtensions: process.argv[3].split(",") }).then((result) => process.stdout.write(JSON.stringify(Object.keys(result.obj())))).catch((error) => { console.error(error); process.exitCode = 1; });';
    try {
      const { stdout } = await execFile(
        process.execPath,
        ["-e", script, madgePackageDirectory, input, extensionList],
        { cwd, maxBuffer: 20 * 1024 * 1024 },
      );
      const ids = JSON.parse(stdout);
      if (!Array.isArray(ids)) {
        throw new Error(`${probeLabel} probe did not return module ids`);
      }
      return summarizeModuleIds(cwd, ids);
    } catch (error) {
      const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
      throw new Error(`${probeLabel} probe failed${detail ? `:\n${detail}` : ""}`, {
        cause: error,
      });
    }
  }

  async function probeDpdm(input, probeLabel) {
    await rm(dpdmOutput, { force: true });
    try {
      await execFile(
        dpdmCli,
        [
          "--extensions",
          dpdmExtensionList,
          "--js",
          dpdmExtensionList,
          input,
          "--output",
          dpdmOutput,
          "--no-tree",
          "--no-circular",
          "--no-warning",
        ],
        { cwd, maxBuffer: 20 * 1024 * 1024 },
      );
      const result = JSON.parse(await readFile(dpdmOutput, "utf8"));
      if (!result?.tree || typeof result.tree !== "object" || Array.isArray(result.tree)) {
        throw new Error(`${probeLabel} probe is missing tree`);
      }
      const ids = Object.entries(result.tree)
        .filter(([, dependencies]) => dependencies !== null)
        .map(([id]) => id);
      return summarizeModuleIds(cwd, ids);
    } finally {
      await rm(dpdmOutput, { force: true });
    }
  }

  async function probeWorkload(input, dpdmInput, workloadLabel) {
    const [release, main, dpdm, madge] = await Promise.all([
      probeOxdg(releaseCli, input, `${workloadLabel} released oxdg`),
      probeOxdg(mainCli, input, `${workloadLabel} main oxdg`),
      probeDpdm(dpdmInput, `${workloadLabel} dpdm`),
      probeMadge(input, `${workloadLabel} Madge`),
    ]);
    return { release, main, dpdm, madge };
  }

  return {
    directory: await probeWorkload(
      directoryInput,
      `${directoryInput}/**/*.{${extensionList}}`,
      `${label} directory`,
    ),
    entrypoint: await probeWorkload(entrypointInput, entrypointInput, `${label} entrypoint`),
  };
}

async function runHyperfine({ commands, output, cwd, env }) {
  const args = [
    "--warmup",
    String(warmup),
    "--runs",
    String(runs),
    "--shell",
    "bash",
    "--export-json",
    output,
    ...commands,
  ];
  try {
    const { stdout, stderr } = await execFile("hyperfine", args, {
      cwd,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`hyperfine failed${detail ? `:\n${detail}` : ""}`, { cause: error });
  }
}

function commandsFor(directoryInput, entrypointInput) {
  const extensionList = extensions.join(",");
  const dpdmExtensionList = extensions.map((extension) => `.${extension}`).join(",");
  return {
    directory: {
      release: `"$OXDG_RELEASE_CLI" --extensions ${extensionList} ${directoryInput}`,
      main: `"$OXDG_MAIN_CLI" --extensions ${extensionList} ${directoryInput}`,
      dpdm: `"$DPDM_CLI" --extensions ${dpdmExtensionList} --js ${dpdmExtensionList} '${directoryInput}/**/*.{${extensionList}}'`,
      madge: `"$MADGE_CLI" --extensions ${extensionList} ${directoryInput}`,
    },
    entrypoint: {
      release: `"$OXDG_RELEASE_CLI" --extensions ${extensionList} ${entrypointInput}`,
      main: `"$OXDG_MAIN_CLI" --extensions ${extensionList} ${entrypointInput}`,
      dpdm: `"$DPDM_CLI" --extensions ${dpdmExtensionList} --js ${dpdmExtensionList} ${entrypointInput}`,
      madge: `"$MADGE_CLI" --extensions ${extensionList} ${entrypointInput}`,
    },
  };
}

const workspace = resolve(requiredOption("--workspace"));
const outputDirectory = resolve(optionValue("--output") ?? ".");
const warmup = positiveIntegerOption("--warmup", defaultWarmup);
const runs = positiveIntegerOption("--runs", defaultRuns);
const mainPackageFootprint = JSON.parse(
  await readFile(resolve(requiredOption("--main-package-footprint")), "utf8"),
);
const releasePackageFootprint = JSON.parse(
  await readFile(resolve(requiredOption("--release-package-footprint")), "utf8"),
);

const corpusDefinitions = [
  {
    key: "hono",
    name: "honojs/hono",
    profile: "ESM / TypeScript",
    repository: process.env.HONO_REPOSITORY ?? "https://github.com/honojs/hono.git",
    expectedCommit: process.env.HONO_COMMIT,
    directory: resolve(requiredOption("--hono-dir")),
    directoryInput: "src",
    entrypointInput: "src/index.ts",
  },
  {
    key: "webpack",
    name: "webpack/webpack",
    profile: "CommonJS / JavaScript",
    repository: process.env.WEBPACK_REPOSITORY ?? "https://github.com/webpack/webpack.git",
    expectedCommit: process.env.WEBPACK_COMMIT,
    directory: resolve(requiredOption("--webpack-dir")),
    directoryInput: "lib",
    entrypointInput: "lib/index.js",
  },
];

const releaseCli = join(workspace, "consumers", "release", "node_modules", ".bin", "oxdg");
const mainCli = join(workspace, "consumers", "main", "node_modules", ".bin", "oxdg");
const dpdmCli = join(workspace, "consumers", "dpdm", "node_modules", ".bin", "dpdm");
const madgeCli = join(workspace, "consumers", "madge", "node_modules", ".bin", "madge");
const madgePackageDirectory = join(workspace, "consumers", "madge", "node_modules", "madge");
const env = {
  ...process.env,
  OXDG_RELEASE_CLI: releaseCli,
  OXDG_MAIN_CLI: mainCli,
  DPDM_CLI: dpdmCli,
  MADGE_CLI: madgeCli,
};

await Promise.all([
  readFile(releaseCli, "utf8"),
  readFile(mainCli, "utf8"),
  readFile(dpdmCli, "utf8"),
  readFile(madgeCli, "utf8"),
]);
await mkdir(outputDirectory, { recursive: true });
const corpora = {};
const commandArtifact = {};

for (const definition of corpusDefinitions) {
  const sourceDirectory = join(definition.directory, definition.directoryInput);
  const entrypoint = join(definition.directory, definition.entrypointInput);
  await readFile(entrypoint, "utf8").catch((error) => {
    throw new Error(`benchmark entrypoint does not exist: ${entrypoint}`, { cause: error });
  });

  const sourceFileCount = await countSourceFiles(sourceDirectory);
  if (sourceFileCount === 0) {
    throw new Error(`no benchmark source files found in ${sourceDirectory}`);
  }

  const commands = commandsFor(definition.directoryInput, definition.entrypointInput);
  const directoryOutput = join(outputDirectory, `benchmark-${definition.key}-directory.json`);
  const entrypointOutput = join(outputDirectory, `benchmark-${definition.key}-entrypoint.json`);
  await Promise.all([rm(directoryOutput, { force: true }), rm(entrypointOutput, { force: true })]);

  await runHyperfine({
    commands: [
      commands.directory.release,
      commands.directory.main,
      commands.directory.dpdm,
      commands.directory.madge,
    ],
    output: directoryOutput,
    cwd: definition.directory,
    env,
  });
  await runHyperfine({
    commands: [
      commands.entrypoint.release,
      commands.entrypoint.main,
      commands.entrypoint.dpdm,
      commands.entrypoint.madge,
    ],
    output: entrypointOutput,
    cwd: definition.directory,
    env,
  });

  const moduleCoverage = await probeModuleCoverage({
    cwd: definition.directory,
    directoryInput: definition.directoryInput,
    entrypointInput: definition.entrypointInput,
    label: definition.key,
  });

  const commit = readCommand("git", ["-C", definition.directory, "rev-parse", "HEAD"]);
  if (definition.expectedCommit && commit !== definition.expectedCommit) {
    throw new Error(
      `${definition.name} commit ${commit} does not match ${definition.expectedCommit}`,
    );
  }

  corpora[definition.key] = {
    name: definition.name,
    profile: definition.profile,
    repository: definition.repository,
    commit,
    workloads: {
      directory: {
        input: definition.directoryInput,
        extensions,
        files: sourceFileCount,
        moduleCoverage: moduleCoverage.directory,
        commands: commands.directory,
        workingDirectory: definition.directory,
      },
      entrypoint: {
        input: definition.entrypointInput,
        extensions,
        moduleCoverage: moduleCoverage.entrypoint,
        commands: commands.entrypoint,
        workingDirectory: definition.directory,
      },
    },
  };
  commandArtifact[definition.key] = commands;
  console.log(
    `Benchmarked ${sourceFileCount} files in ${definition.name} ${definition.directoryInput} at ${commit}`,
  );
  console.log(
    `Module coverage (${definition.key}): directory ${JSON.stringify(moduleCoverage.directory)}, entrypoint ${JSON.stringify(moduleCoverage.entrypoint)}`,
  );
}

const mainCommit = readCommand("git", ["-C", projectRoot, "rev-parse", "HEAD"]);
const releaseVersion = await readPackageVersion(
  join(workspace, "consumers/release/node_modules/oxdg/package.json"),
);
const mainVersion = await readPackageVersion(
  join(workspace, "consumers/main/node_modules/oxdg/package.json"),
);
const metadata = {
  runner: {
    label: process.env.RUNNER_LABEL ?? "local",
    imageOS: process.env.ImageOS ?? "unknown",
    imageVersion: process.env.ImageVersion ?? "unknown",
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  },
  host: {
    uname: readCommand("uname", ["-a"]),
    cpu: JSON.parse(readCommand("lscpu", ["-J"])),
  },
  revisions: {
    release: {
      label: `Released v${releaseVersion}`,
      source: "npm",
      version: releaseVersion,
      packageFootprint: releasePackageFootprint,
    },
    main: {
      label: "Development main",
      source: "git",
      version: mainVersion,
      gitCommit: mainCommit,
      packageFootprint: mainPackageFootprint,
    },
  },
  tools: {
    madge: {
      version: await readPackageVersion(
        join(workspace, "consumers/madge/node_modules/madge/package.json"),
      ),
    },
    dpdm: {
      version: await readPackageVersion(
        join(workspace, "consumers/dpdm/node_modules/dpdm/package.json"),
      ),
    },
  },
  runtimes: {
    node: { requested: process.env.NODE_VERSION ?? "unknown", actual: process.version },
    bun: {
      requested: process.env.BUN_VERSION ?? "unknown",
      actual: readCommand("bun", ["--version"]),
    },
    npm: readCommand("npm", ["--version"]),
    hyperfine: {
      requested: process.env.HYPERFINE_VERSION ?? "unknown",
      actual: readCommand("hyperfine", ["--version"]),
    },
  },
  benchmark: { warmup, runs },
  corpora,
};

await writeFile(
  join(outputDirectory, "benchmark-metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);
await writeFile(
  join(outputDirectory, "benchmark-commands.json"),
  `${JSON.stringify(commandArtifact, null, 2)}\n`,
);
