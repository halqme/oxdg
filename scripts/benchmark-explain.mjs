import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

const runsIndex = process.argv.indexOf("--runs");
const runs = runsIndex === -1 ? 20 : Number(process.argv[runsIndex + 1]);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be positive");
const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "dist/cli/main.js");
const cases = [
  {
    name: "source dependents",
    cwd: root,
    args: ["src", "--depends", "src/graph/graph.ts"],
  },
  {
    name: "workspace dependents",
    cwd: resolve(root, "test/fixtures/workspace-pnpm"),
    args: [".", "--packages", "--depends", "@fixture/core"],
  },
];

function runCase(test, explain) {
  const start = performance.now();
  const args = [...test.args, ...(explain ? ["--explain"] : [])];
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: test.cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${test.name} failed (${result.status}): ${result.stderr}`);
  }
  return performance.now() - start;
}

function summary(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
  return { medianMs: Number(median.toFixed(2)), p95Ms: Number(p95.toFixed(2)) };
}
for (const test of cases) {
  const baseline = [],
    explained = [];
  for (let index = 0; index < 4; index++) {
    runCase(test, false);
    runCase(test, true);
  }
  for (let index = 0; index < runs; index++) {
    if (index % 2 === 0) {
      baseline.push(runCase(test, false));
      explained.push(runCase(test, true));
    } else {
      explained.push(runCase(test, true));
      baseline.push(runCase(test, false));
    }
  }
  const normal = summary(baseline);
  const explain = summary(explained);
  console.log(
    JSON.stringify({
      case: test.name,
      runs,
      normal,
      explain,
      ratio: Number((explain.medianMs / normal.medianMs).toFixed(3)),
    }),
  );
}
