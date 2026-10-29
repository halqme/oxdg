# Changelog

All notable user-facing and maintenance changes to oxdg are documented here.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Maintenance

- Prepare the package for version 0.6.0.
- Added a pinned, MIT-attributed Madge 8.0.0 compatibility corpus with runnable comparisons and reporting of differences and unsupported cases.
- Keep vendored Madge sources unchanged by excluding only upstream corpus paths from staged checks.

### Changed

- Reduce installation size by bundling JavaScript dependencies and omitting debug source maps from the published package.

### Fixed

- Keep installed legacy packages with missing entry points or subpaths from resolving to unrelated files in the analysis base directory, including symlinked packages.
- Resolve otherwise missing bare imports from the analysis base directory without overriding aliases, npm packages, builtins, or package export restrictions. Keep fallback targets inside that directory.
- Exclude `.git` paths from explicit inputs and imported dependencies as well as directory scans, including symlink targets, without modifying files.
- Extract TypeScript import-equals dependencies, including type-only imports, on Bun and Node.js. Preserve TypeScript resolution options and require package conditions for CommonJS dependencies.
- Preserve Vue script imports when script, style, or custom blocks contain less-than characters.
- Return exit code 1 when source parsing fails, so incomplete graphs are detectable in scripts.

## [0.5.2] - 2026-10-25

### Maintenance

- Grouped minor and patch GitHub Actions updates in Dependabot pull requests.
- The minimum required Node.js version is v22.23.4. See [Node.js — Wednesday, October 21, 2026 Security Releases](https://nodejs.org/ja/blog/vulnerability/october-2026-security-releases).
- Use Vite Plus across workflows and follow its current Bun release instead of pinning Bun in CI or development requirements.

## [0.5.1] - 2026-10-10

### Fixed

- Keep routed SVG edges inside the viewport with bottom padding.

### Added

- Explain dependency origins using only `path:line` source locations via `--depends --explain` and `--circular --explain` in both file and workspace package modes, with optional JSON output.
- Generate package-level graphs from actual imports in npm, pnpm, Bun, and Yarn workspaces with `--packages`, including package queries, cycle detection, and all existing output formats.

### Maintenance

- Added a repeatable benchmark for normal vs. explanation queries, reported by CI without performance gating.
- Added checked-in workspace fixtures for npm, pnpm, Bun, and Yarn to verify package graphs, cycles, exclusions, and type-only imports without installed workspace links.

## [0.5.0] - 2026-10-04

### Added

- With `--include-npm`, resolved npm dependencies are represented by package-level `npm:<package>` nodes with distinct colors in Mermaid, D2, and SVG output.

### Fixed

- SVG output no longer clips long dependency edges that Dagre routes above the graph.

### Maintenance

- Fixed Vite+ checks to type-check tests with their Bun and Node declarations and enforce explicit, deterministic sorting.
- Organized shared types by analysis, graph, and rendering responsibilities.
- Removed the unused aggregate type barrel; tests import types from their domain modules.

### Changed

- Consistent color-coding for "normal", "leaf", and "cyclic" modules and edges across D2, Mermaid, and SVG renderers, making visualizations more informative and easier to interpret.

## [0.4.2] - 2026-10-02

### Performance

- Defer loading the analyzer until the CLI needs to analyze dependencies.
- Cache canonical paths during analysis to avoid repeated filesystem lookups for repeated imports.

### Changed

- Refined SVG graph layout with more compact, centered nodes and updated edge styling.
- Benchmark reporting now distinguishes comparable JavaScript/TypeScript source-module coverage from tool-specific graph nodes.
- dpdm benchmark commands use its documented dotted extension syntax and apply the selected extension set consistently during recursive analysis.
- Use vite-plus for local development.

## [0.4.1] - 2026-09-26

### Changed

- Added per-module benchmark reporting and graph-module coverage probes to the benchmark report.

## [0.4.0] - 2026-09-26

### Performance

- Reduced dependency-extraction cost by avoiding unnecessary AST materialization and using Oxc's lazy raw-transfer path when available.
- Lazy-loaded SVG rendering dependencies.
- Improved CommonJS-heavy analysis substantially while preserving a stable fallback path.

### Changed

- Added separate fixed ESM/TypeScript and CommonJS/JavaScript benchmark corpora using Hono and Webpack.
- Benchmarks now distinguish the latest published npm release from the current `main` revision.
- Added quick full-corpus benchmark mode for development validation.

## [0.3.0] - 2026-09-25

### Added

- Added Vue single-file component support for `<script>` and `<script setup>` using JavaScript, TypeScript, JSX, and TSX.
- Expanded automated test coverage.

## [0.2.2] - 2026-09-23

### Fixed

- Corrected release artifact staging so the verified npm tarball is found during publishing.

## [0.2.1] - 2026-09-23

### Fixed

- Fixed the release workflow path used to locate the verified npm tarball.

## [0.2.0] - 2026-09-23

### Added

- Added orphan, leaf, and direct-dependent graph queries.
- Added `--fail-on-circular`.
- Added configurable source extensions and gitignore-style exclusion patterns.
- Added graph direction control for Mermaid and SVG.
- Added `--ts-config` as an alias for `--tsconfig`.
- Added CI, release, benchmark, and package-footprint automation.

### Changed

- CLI usage errors now exit with status 2.
- Mermaid and SVG rendering APIs support configurable graph direction.

## [0.1.0] - 2026-09-22

### Added

- Initial release.
- JavaScript and TypeScript dependency analysis.
- ESM and CommonJS dependency extraction, including dynamic imports, `require()`, `require.resolve()`, and re-exports.
- Oxc-based parsing and module resolution.
- Circular dependency detection.
- Text, JSON, Mermaid, D2, and standalone SVG output.
- Public analysis and rendering API.

[Unreleased]: https://github.com/halqme/oxdg/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/halqme/oxdg/releases/tag/v0.5.2
[0.5.1]: https://github.com/halqme/oxdg/releases/tag/v0.5.1
[0.5.0]: https://github.com/halqme/oxdg/releases/tag/v0.5.0
[0.4.2]: https://github.com/halqme/oxdg/releases/tag/v0.4.2
[0.4.1]: https://github.com/halqme/oxdg/releases/tag/v0.4.1
[0.4.0]: https://github.com/halqme/oxdg/releases/tag/v0.4.0
[0.3.0]: https://github.com/halqme/oxdg/releases/tag/v0.3.0
[0.2.2]: https://github.com/halqme/oxdg/releases/tag/v0.2.2
[0.2.1]: https://github.com/halqme/oxdg/releases/tag/v0.2.1
[0.2.0]: https://github.com/halqme/oxdg/releases/tag/v0.2.0
[0.1.0]: https://github.com/halqme/oxdg/releases/tag/v0.1.0
