# Madge v8.0.0 compatibility corpus

This directory ports the complete **test inventory and fixture corpus**, not the
Madge implementation or its API. It contains all nine upstream Mocha files (58
`it` cases), every upstream fixture, and all 17 demonstrations in `output.sh`.
Not every contract can run against oxdg. Unsupported cases are inventoried with
reasons, never counted as passes. This is not evidence of drop-in compatibility.

## Run

From the repository root with development dependencies installed:

```bash
# Strict comparisons: JSON on stdout, summary on stderr.
# Exits 1 when any executed comparison differs or errors.
bun run test:madge-compat > /tmp/madge-compat.json

# Same comparisons and honest statuses; differences do not fail this reporting mode.
# Unexpected execution errors still exit 1.
bun run test:madge-compat --report-only > /tmp/madge-compat.json

# Regression checks for matching cases, corpus integrity, and harness behavior.
bun test ./test/madge-compat
bun run check
bun run format:check
```

The report-only command was run on macOS with Bun 1.4.4: **28 matches, 6
differences, 41 unsupported entries, and 0 execution errors**. The strict command
therefore exits 1 because differences remain. These are results of the adapted
comparisons in this checkout, not compatibility percentages or a claim that all
upstream tests pass.

The Bun suite registers matching comparisons as strict tests, known differences
as explicitly named `DIFFERENCE` todos, and unsupported contracts as explicitly
named `UNSUPPORTED` skips. It also has five harness/integrity tests. Thus a green
`bun test` is **not** a green full-compatibility result. Known-difference todos do
not execute there; the comparison command executes all 34 adapted cases every
time, including all known differences. Its statuses are computed from actual
results, never from the recorded baseline. A fixed difference becomes `match` in
the report immediately, even before its todo is promoted.

Exit codes: strict comparisons use 1 for differences/errors and 0 otherwise;
report-only uses 1 for errors and 0 otherwise; invalid arguments use 2. Unsupported
entries do not themselves make the comparison command fail: always read their
count and reasons. No report mode certifies unexecuted contracts.

## Provenance and license

Source: [pahen/madge v8.0.0](https://github.com/pahen/madge/tree/v8.0.0), annotated
tag object `e9a9006d4a17c11c6b7ff5de14e5c7cff02faeea`, resolving to commit
[`456057b85c2d063dad9c10147d7686ded4fc5ce5`](https://github.com/pahen/madge/tree/456057b85c2d063dad9c10147d7686ded4fc5ce5).
The source was obtained using GitHub's repository tarball API, and the tag target
was checked through its Git API. The tag is unsigned; this is source pinning,
not signature verification.

`upstream/` contains 127 byte-for-byte copies: the entire 124-file `test/` tree,
plus `LICENSE`, `package.json`, and `package-lock.json`. SHA-256 digests and the
pin live in `provenance.json`. The original MIT copyright and permission notice
are preserved in [`upstream/LICENSE`](upstream/LICENSE). The lockfile preserves
upstream dependency context; it does not control this project's resolver versions.
No upstream runtime dependency or Graphviz installation is required to run the
ported comparisons.

Files under `upstream/` are inert test data, not project source or installed
packages. Their syntax includes intentional parser errors, nonstandard exports,
Flow, JSX, and unresolved imports. Do not format them or fix their types. They are
excluded from project formatting and TypeScript checks. The six
`test/cjs/node_modules/*.js` files are real upstream fixtures and explicitly
unignored for Git. Hidden `.git_tmp/d.js` is preserved too. Integrity tests verify
the exact file set and every digest, including those normally ignored paths.

## Inventory and comparison boundary

[`cases.json`](cases.json) is the authoritative mapping: stable case ID, original
file and line, original title (including upstream typos), input, explicit root,
operation, literal upstream expectation, baseline classification, and any
limitation or unsupported reason. The corpus integrity test independently
enumerates upstream `it` declarations and shell headings, ensuring none disappear
from this mapping. Shell command text is checked as well.

| Upstream file   | Mocha cases | Executed comparisons |        Unsupported |
| --------------- | ----------: | -------------------: | -----------------: |
| `amd.js`        |           9 |                    0 |                  9 |
| `api.js`        |          26 |                   14 |                 12 |
| `cjs.js`        |           7 |                    7 |                  0 |
| `es6.js`        |           5 |                    4 |                  1 |
| `es7.js`        |           1 |                    1 |                  0 |
| `flow.js`       |           3 |                    3 |                  0 |
| `jsx.js`        |           1 |                    1 |                  0 |
| `typescript.js` |           4 |                    2 |                  2 |
| `vue.js`        |           2 |                    2 |                  0 |
| `output.sh`     |   Not Mocha |                    0 | 17 manual commands |

`compare.ts` calls the real public oxdg exports; no fake analyzer, injected graph,
or Madge result is used as the actual result. Expectations are transcribed from
upstream assertions, not generated from oxdg output. This is an expectation-based
port, **not a live differential run of both installed tools**. Upstream Mocha and
Graphviz tests have not been rerun here. To reproduce the reference environment,
use a separate checkout at the pinned commit and its package lock; do not run
`npm install` inside this vendored corpus. The complete upstream runtime is not
vendored, so `upstream/test/*.js` and `output.sh` are not standalone commands here.

Adaptations are deliberately narrow:

- Explicit `cwd` roots correspond to upstream's common input directory. Returned
  IDs are never rewritten to conceal differences, including `../d.js`. For
  `es6:01`, `cwd` is `test/es6`: `absolute/a` resolves from that root, while
  the transitive `test/es6/absolute/b` is not resolved by searching ancestors.
  This exercises oxdg's bounded cwd fallback, not Madge's `baseDir` option API
  or all of its resolution rules. Normal aliases, packages and builtins retain
  priority; fallback cannot escape cwd through symlinks or directory entrypoints.
- Graph comparisons project only internal adjacency, sorted by module/dependency
  ID and deduplicated across multiple import kinds. This matches the set-like
  Madge dependency object; npm nodes are **not** renamed or dropped. External and
  unresolved edges are outside that object comparison; native warnings are always
  emitted separately. Cycles and query lists retain the order oxdg returns.
- `obj`, cycle, cyclic graph, dependents, orphan and leaf expectations are compared
  using oxdg's corresponding public functions. This checks results, not Madge's
  chainable result-object methods or configuration API.
- Promise return is tested and awaited; missing-path rejection retains and
  compares the actual error wording against upstream's substring requirement.
- `api:17` compares both the graph and the unmodified native warning structure,
  deliberately exposing the warning API mismatch instead of translating it away.
- `api:10` copies the Git fixture into a unique temporary directory, renames
  `.git_tmp` there, and cleans it in `finally`. Unlike upstream's test, failures
  are not swallowed. The checked-in corpus and process cwd are never mutated.
- Flow/TypeScript mixed-import cases compare graphs under oxdg defaults, not the
  unsupported `detectiveOptions` setting. Vue cases omit Madge's empty object
  `tsConfig`, using oxdg's built-in extractor. These limitations also appear in
  each affected report entry's `scope`.

A graph match does not assert diagnostic compatibility. In particular, `flow:01`
currently matches adjacency **while emitting parse warnings**; it does not prove
Flow language support. The error-file and JSON-extension cycle cases likewise
only assert their original graph/cycle boundaries. Raw diagnostics remain visible
in JSON; absolute file paths and temporary paths make reports machine-dependent.

## Differences and unsupported boundaries

The six remaining known differences are listed with reasons in `cases.json` and
printed with both upstream expected and oxdg actual values by the strict runner:

- `api:03`: missing-path error wording.
- `api:17`: skipped-file warning object versus native diagnostic array.
- `cjs:07`: shallow npm file references versus package-level nodes.
- `es6:04`: unsupported export-default-from proposal syntax.
- `flow:02`, `flow:03`: unsupported Flow import-type syntax.

Matching scoped comparisons include `api:10` (`.git` import exclusion),
`es6:01` (base-directory bare imports), `typescript:01` (import-equals require),
and `typescript:04` (extensionless CommonJS TypeScript requires). This does not
establish full TypeScript or Madge API compatibility; in particular, the two
custom `tsConfig` API cases remain unsupported as listed above.

Unsupported contracts include AMD/RequireJS (all nine cases), predefined-tree
input, synchronous missing-argument validation, regex exclusion, traversal-filter
callbacks, DOT/Graphviz/image APIs, the async SVG Buffer API, webpack root config,
object-valued TypeScript configuration and exposed parsed configuration. No
similar-looking oxdg option is silently substituted. SVG string rendering exists
in oxdg but is not the upstream Buffer API contract.

`output.sh` is a manual showcase, not an assertion suite: it has no expected
stdout/stderr, includes a pipeline and file writes, and ends with unconditional
`exit 0`. Its 17 commands are preserved and inventoried as unsupported manual
comparisons, **not converted into passing CLI tests**. Some commands require
upstream `lib/` and `bin/`, npm dependencies, or Graphviz. No CLI text, image,
stdin, option spelling, styling, or exit-code compatibility is claimed.

## Maintaining the port

1. Keep the upstream pin, original tests, fixtures and license together. For an
   intentional version update, fetch that exact source separately, survey all
   tests/fixtures/license, replace only this corpus, and regenerate file digests.
2. Update the case inventory from upstream declarations and literal expectations.
   Never overwrite an upstream expected result with current oxdg output.
3. Run the strict reporter and inspect each mismatch and diagnostic. A difference
   remains a difference, regardless of whether it is intentional. Execution
   exceptions remain errors, not expected failures.
4. Promote a known difference's `baseline` to `match` only once the real public API
   comparison matches; remove its obsolete difference description. Add an adapter
   for an unsupported contract only when it can exercise that contract honestly.
5. Run the focused Bun suite, strict report, typecheck, and formatting check. The
   harness tests also deliberately perturb an expectation (must become a
   difference), exercise execution errors and unsupported isolation, and reorder
   equivalent graphs (must preserve adjacency).

The corpus adds no dependencies. Production resolution and exclusion behavior is
documented in the repository README; these comparisons cover only the scoped
upstream expectations above.
