import { cases, compareCase } from "./compare.ts";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--report-only")) {
  console.error("Usage: bun test/madge-compat/run.ts [--report-only]");
  process.exit(2);
}
const results = [];
for (const entry of cases) results.push(await compareCase(entry));
const counts = { match: 0, difference: 0, unsupported: 0, error: 0 };
for (const result of results) counts[result.status]++;
console.log(JSON.stringify({ upstream: "madge@8.0.0", counts, results }, null, 2));
console.error(
  `Madge 8.0.0: ${counts.match} match, ${counts.difference} difference, ${counts.unsupported} unsupported, ${counts.error} error. Matches concern only each case's documented scope.`,
);
process.exitCode =
  counts.error > 0 || (!args.includes("--report-only") && counts.difference > 0) ? 1 : 0;
