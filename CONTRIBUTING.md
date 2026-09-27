# Contributing to oxdg

Thanks for considering a contribution.

oxdg is intentionally small: Oxc handles parsing and module resolution, while this project focuses on dependency extraction, graph analysis, queries, rendering, and CLI behavior. Contributions should preserve that separation where practical.

## Before opening a pull request

For bugs, open an issue with a minimal reproduction when possible. For larger features or behavior changes, an issue first is useful so the scope and compatibility expectations are clear before implementation.

Security vulnerabilities should follow [SECURITY.md](SECURITY.md), not the public bug template.

## Development setup

Requirements:

- Node.js 22 or newer
- Bun 1.4.2

Install dependencies:

```bash
bun install
```

Useful checks:

```bash
bun run check
bun run lint
bun run format:check
bun test
bun run build
bun run release:check
```

Before committing formatting changes, run:

```bash
bun run format
```

`check` runs TypeScript type checking. `release:check` builds and packs the package, validates the published contents, installs the tarball into a temporary project, and exercises the packaged CLI.

## Tests

Prefer tests that describe stable behavior rather than implementation details.

Use persistent fixtures for realistic dependency-graph behavior. Temporary fixtures are appropriate for malformed input, parser edge cases, scanner edge cases, and other cases where keeping a project fixture would add noise.

Avoid snapshotting exact human-readable renderer output unless the formatting itself is the contract.

Bug fixes should normally include a regression test.

## Performance changes

Performance is part of the project, but benchmark results are informational rather than a correctness gate.

When a change is intended to improve performance:

- keep semantics and analyzed coverage comparable;
- measure the base and candidate on the same runner;
- use the fixed Hono and Webpack benchmark corpora;
- avoid optimizing only for the benchmark fixture;
- explain meaningful changes in graph coverage or tool behavior.

The public benchmark workflow records exact commands, pinned corpus commits, runtime versions, package footprint, and runner metadata.

## Pull requests

Keep pull requests focused and reviewable. A PR should explain:

- what changed;
- why the change is needed;
- how it was validated;
- whether CLI/API behavior, package footprint, or benchmark semantics changed.

Do not include unrelated refactors in a functional fix unless they are required for the change.

The project uses CI across supported Node.js versions and operating systems. A pull request is expected to pass type checking, linting, formatting, tests, build checks, and package validation where applicable.

## Commit messages

Prefer concise semantic subjects that say what changed, with a body when the reason is not obvious.

Examples:

```text
fix: resolve extensionless CommonJS imports
perf: avoid unnecessary AST materialization
ci: compare release and main benchmarks
```

## Releases

Releases are performed by the maintainer from tags on `main`. Contributors should not include release-only changes unless the pull request is specifically about release infrastructure.
