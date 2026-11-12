# Finding unused dependencies in package.json (researched Sep 2026)

## Recommendation
Standardize on **Knip** across repos. Run `npx knip --dependencies` (deps-only mode: unused deps/devDeps, unlisted deps, unlisted binaries, unresolved imports). Add `--reporter json` for aggregation, `--fix --fix-type dependencies` to auto-remove, `--production` to find deps only used by tests/tooling, `--strict` in monorepos to require each workspace to declare its own deps.

## Options
| Tool | Status | Notes |
|---|---|---|
| Knip | Active, de facto standard | Framework/tool plugins (reads configs for Jest, ESLint, Vite, Next, etc. so tooling isn't flagged as unused), first-class workspaces, auto-fix, JSON/GitHub reporters. Slower on huge repos; some config for dynamic imports. |
| depcheck | Archived June 2025 | README tells users to move to Knip. Weak on monorepos/modern frameworks. |
| npm-check | Low activity | Uses depcheck internally for its "unused" check; mainly an outdated/update tool. |
| unimported | Archived | Recommends Knip. Production-mode only. |
| rev-dep | Active, newer | Native binary, ~18x faster than Knip on a 580k-LOC benchmark (vendor claim). `rev-dep config init` / `config run`; per-workspace toggle. Fewer plugins, so expect more config. |
| Nx `@nx/dependency-checks` ESLint rule | Active | Nx monorepos only; flags obsolete (unused), missing, and version-mismatched deps per project. |
| eslint-plugin-import `no-extraneous-dependencies` / eslint-plugin-n `no-extraneous-import` | Active | Inverse check only: imports NOT declared in package.json. Complements, doesn't replace. |
| mridang/action-dependency-insight | GitHub Action | Wraps Knip for JS/TS in CI (also PHP/Python). |

## Multi-repo approach
Loop over repos, run `npx -y knip --dependencies --reporter json > report.json` in each, and merge into one summary. Or add Knip as a CI step per repo, starting non-blocking, then enforcing once baseline is clean.

## Gotchas
- Tools can't see deps used only in shell scripts, Dockerfiles, dynamic `require(variable)`, or plugins loaded by string name -> use `ignoreDependencies`.
- `@types/*` packages are paired with their runtime package by Knip.
- Always review before `--fix`; run tests after.

## Sources
- https://github.com/depcheck/depcheck
- https://knip.dev/typescript/unused-dependencies
- https://knip.dev/explanations/comparison-and-migration
- https://www.pkgpulse.com/guides/knip-vs-depcheck-2026
- https://rev-dep.com/
- https://github.com/dylang/npm-check
- https://github.com/mridang/action-dependency-insight
- https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-extraneous-dependencies.md
