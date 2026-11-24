# Documenting CLIs for Agents and Humans (with a Node.js focus)

*Research notes — November 24, 2026. Sibling to `cli-utilities-for-agents-and-humans.md` and `cli-token-efficiency-for-agents.md`.*

## TL;DR

- **A CLI has several documentation layers with different readers:**
  - built-in help;
  - the README;
  - a command reference;
  - the output and error contract;
  - the companion skill (for agents *using* the CLI);
  - `AGENTS.md`/`CLAUDE.md` (for agents *developing* the CLI);
  - the changelog.

  Decide what goes in each so nothing is duplicated by hand.
- **One source of truth.** Command definitions in code generate `--help`, the command reference, and the JSON schemas. The README stays short and links out. The skill holds workflows. Everything generated is checked for drift in CI.
- **Built-in help is the most important document,** for humans and agents alike. Lead with examples, link to web docs, keep it short (see the token-efficiency doc).
- **The agent contract needs its own docs and its own changelog discipline:** JSON output shapes, exit codes, error codes, and deprecations. Agents break silently when it changes.
- **For your legacy CLI:** snapshot the current help, generate a reference from Commander, write a short README, document exit and error codes, add `AGENTS.md`/`CLAUDE.md` for whoever maintains it, and turn on drift checks.
- **Splitting a huge README into per-command-group READMEs:** do it group by group. **Migrate** (content only, verified lossless), then **audit** that group (findings only), then **fix** in separate PRs. Set whole-repo conventions first so every group is judged the same way (§11).

---

## 1. The documentation layers

| Layer | Primary reader | What belongs there | Source of truth |
|---|---|---|---|
| `--help` / `help <cmd>` | Humans at the terminal; agents discovering commands | Purpose, usage, required vs optional flags, defaults, 2–3 examples, output shape, link to web docs | Command definitions in code |
| README | Humans evaluating or installing; agents landing in the repo | What it is, install, auth, 60-second quickstart, links to everything else | Hand-written, kept short; generated sections embedded |
| Command reference (`docs/commands/*.md`, web page) | Humans looking things up; search engines | Every command, flag, and example in full | **Generated** from command definitions |
| Man pages (optional) | Unix users | Same as the reference | Generated from the same source |
| Output and error contract | Script authors; agents; integrators | JSON envelope, per-command output schema, exit-code table, error-code catalog | Zod (or similar) schemas, plus the `EXIT` and error-code constants in code |
| Companion `SKILL.md` | Agents **using** the CLI | When to use it, the 10–20 key commands, workflows and chain scripts, gotchas | Hand-written; lives in the CLI repo |
| `AGENTS.md` / `CLAUDE.md` | Agents **developing** the CLI | Build, test, and lint commands; architecture (core layer vs commands); conventions; contract rules ("never rename a flag") | Hand-written; lives in the CLI repo |
| `CHANGELOG.md` | Everyone upgrading | What changed, flagged by impact; deprecations with timelines | Generated from changesets or conventional commits |
| `CONTRIBUTING.md` | Human contributors | Dev setup, how to add a command, release process | Hand-written |

Keep the two agent files separate:
- the **skill** teaches an agent to *operate* the tool;
- **`AGENTS.md`** teaches an agent to *change* the tool.

`AGENTS.md` describes itself as a "README for agents" for working on a project. It's now read by most coding agents.

---

## 2. Principle: one source of truth, generated outward

Hand-maintained docs drift. The fix is structural:

```
command definitions (Commander + Zod schemas + EXIT/ERROR constants)
        │
        ├──► --help                       (runtime, always current)
        ├──► docs/commands/*.md, README    (generated, drift-checked in CI)
        ├──► man pages                     (generated, optional)
        ├──► schemas/*.json + `acme schema` (generated)
        └──► docs/errors.md                (generated from the error catalog)

hand-written, short: README prose · SKILL.md · AGENTS.md · CONTRIBUTING.md
generated from changes: CHANGELOG.md
```

Rule of thumb: if a fact exists in code (a flag name, a default, an exit code), generate its documentation. Only write by hand what code can't express: purpose, workflows, judgment calls.

---

## 3. Built-in help

clig.dev's guidance, with the agent-specific additions from the sibling docs:

- **Full help** on `-h`, `--help`, and `help <subcommand>`. `-h` always means help. ([clig.dev])
- **Concise help on bare invocation** when required input is missing: a description, one or two examples, the flags, and a pointer to `--help`. ([clig.dev])
- **Lead with examples**, especially common complex uses. Move long example sets to a cheat sheet or web page. ([clig.dev])
- **Most common flags and commands first.** No escape codes when piped. ([clig.dev])
- **A support path** (issues URL) in top-level help, and **links to the web docs** for the specific subcommand. ([clig.dev])
- **Agent additions:**
  - required vs optional stated explicitly;
  - defaults shown;
  - output shape and side effects stated;
  - "use this instead of X" guidance;
  - under ~60 lines per command;
  - long material behind `acme help <topic>`.

Commander specifics:
- `.addHelpText('after', examples)` on every command;
- `.showHelpAfterError()`;
- `.configureOutput()` to control streams;
- `.helpOption()`/`.addHelpCommand()` so `help <cmd>` works;
- add a docs URL per command in the `after` text.

```js
const logs = program.command('logs').description('Work with service logs');
logs.command('search')
  .description('Search log lines across services (prefer over "logs read").')
  .argument('<query>', 'words are ANDed; "phrase"; field:value')
  .option('--since <dur>', 'time window', '1h')
  .option('--limit <n>', 'max lines', '20')
  .addHelpText('after', `
Examples:
  $ acme logs search 'level:error "charge failed"' --since 24h
  $ acme logs search 'customer:cus_88' --service billing --limit 50

Output: matching lines with context (JSON when piped). Exit codes: 0 ok, 3 invalid query.
Docs: https://docs.example.com/acme/logs-search`);
```

---

## 4. The README

A CLI README's job is to get someone from "what is this?" to a first successful command, then point them elsewhere. Keep it short and let the generated reference carry the detail.

**Template:**

```markdown
# acme
One sentence: what it does and for whom.

## Install
npm i -g @org/acme      # or: npx @org/acme
Requires Node >= 22.

## Authenticate
acme auth login          # humans (browser/device flow)
export ACME_TOKEN=...    # CI and agents

## Quickstart
acme projects search "q4"
acme deploys list --env prod --limit 5
acme deploys rollback --env prod --dry-run

## Use with AI agents
- Output is JSON when piped; see docs/output-contract.md.
- Install the agent skill: npx skills add org/acme   (or copy skills/acme/)
- Exit codes: 0 ok · 1 error · 2 auth · 3 validation · 4 confirmation required

## Documentation
- Command reference: docs/commands/  (generated)
- Output & error contract: docs/output-contract.md, docs/errors.md
- Changelog: CHANGELOG.md
- Contributing: CONTRIBUTING.md
```

Notes:
- **The "Use with AI agents" section is the README's agent hook.** An agent dropped into the repo or the npm page learns the three things it needs: JSON when piped, where the skill is, and what the exit codes mean.
- **Don't paste the whole command list by hand.** Either link to the generated reference or embed a generated section between markers (§5).
- **Every command shown in the README must actually work.** Test it in CI (§8).

---

## 5. Generated command reference and man pages

### oclif (built in)

`oclif readme` regenerates the usage, commands, and table-of-contents sections of the README, using marker comments (`<!-- usage -->`, `<!-- commands -->`, `<!-- toc -->`), and can split topics into separate pages with `--multi`. Salesforce goes further with a command-reference plugin and treats diffs of the generated output as something to review: changes should be intentional.

### Commander (roll your own; it's small)

Commander has no built-in docs generator. Small community packages exist (`commander-to-markdown`, `commanderdoc`), and larger projects like Convex ship their own generator over Commander. The most robust approach is to walk the command tree and reuse Commander's own help output, so the reference can never disagree with `--help`:

```js
// scripts/gen-docs.js  →  docs/commands/<path>.md
import { writeFileSync, mkdirSync } from 'node:fs';
import { program } from '../src/cli.js';   // export the configured program without parsing argv

function walk(cmd, path = []) {
  const name = [...path, cmd.name()].filter(Boolean);
  const file = `docs/commands/${name.slice(1).join('-') || 'index'}.md`;
  const body = `# ${name.join(' ')}\n\n${cmd.description()}\n\n\`\`\`text\n${cmd.helpInformation()}\`\`\`\n`;
  mkdirSync('docs/commands', { recursive: true });
  writeFileSync(file, body);
  for (const sub of cmd.commands) walk(sub, name);
}
walk(program);
```

Run it as `npm run docs`. In CI, run it and fail if `git diff --exit-code docs/` shows changes (§8).

### Man pages (optional)

- clig.dev suggests considering man pages, generating them from the same source as web docs, and making them reachable through the tool itself, since `man` isn't everywhere.
- For Node: write Markdown and convert it with `marked-man`, then point `package.json`'s `man` field at the files.
- **Caveat:** an open npm issue reports that global installs don't always link man pages. So treat `acme help <topic>` (or `acme docs <cmd>`, which prints the reference) as the reliable in-tool path, and man pages as a bonus.

---

## 6. Documenting the output and error contract

Agents and scripts depend on this contract more than on any prose. Document it explicitly and generate it where possible.

**`docs/output-contract.md` should contain:**
- **The envelope:** `{ ok, data, meta }`. What `meta` can contain (`next_cursor`, `truncated`, `hint`, `warnings`, `schema_version`).
- **Format rules:**
  - text on a TTY, JSON when piped;
  - `--format json|tsv|text`;
  - `--fields`;
  - NDJSON with `--page-all`;
  - stdout vs stderr.
- **Per-command output schemas.** If you use Zod, Zod 4's native `z.toJSONSchema()` converts schemas to JSON Schema (Draft 2020-12 by default, with other targets available). Field descriptions set with `.meta()` carry over. Generate `schemas/<command>.json`, link them from the docs, and serve the same output from `acme schema <command>`.
- **The exit-code table**, generated from your `EXIT` constant.
- **Stability policy:** what counts as a breaking change. Removing or renaming a field, flag, or exit code is breaking. Adding is fine. Human-readable text output can change freely.

**`docs/errors.md`, the error-code catalog**, is generated from your error definitions. For each code: meaning, typical cause, and fix. Liran Tal's §6.1 recommends trackable error codes that map to documentation, so each error can include a link (`remediation` text plus `docs: https://…/errors#E_VALIDATION`).

```js
// gen-schemas.js
import * as z from 'zod';
import { outputs } from '../src/contract.js';   // { 'deploys.list': DeploysListOutput, ... }
for (const [cmd, schema] of Object.entries(outputs))
  writeFileSync(`schemas/${cmd}.json`, JSON.stringify(z.toJSONSchema(schema), null, 2));
```

---

## 7. Agent-facing documents

### The companion `SKILL.md` (agents *using* the CLI)

Covered in the main doc and the token-efficiency doc. In short:
- a description with trigger phrases;
- the key commands;
- workflow recipes and `scripts/` for pre-defined chains;
- gotchas;
- "run `acme schema X` before building a payload";
- details in `references/`;
- `allowed-tools: Bash(acme:*)`;
- versioned with the CLI.

**Doc-specific rule:** the skill links to the generated reference and contract docs rather than copying flag tables, so it can't drift.

### `AGENTS.md` / `CLAUDE.md` (agents *developing* the CLI)

`AGENTS.md` is the cross-tool convention: plain Markdown with no required schema, now stewarded under the Linux Foundation's Agentic AI Foundation and read by Codex, Cursor, Copilot, Gemini CLI, and others. Claude Code historically read only `CLAUDE.md`. A September 2026 guide reports native `AGENTS.md` support from Claude Code v2.1.277, with a setting to load either or both. The pattern that works everywhere: put shared content in `AGENTS.md`, and keep `CLAUDE.md` as a one-line `@AGENTS.md` import plus any Claude-only notes.

For a CLI repo, include only what an agent can't infer:

```markdown
# AGENTS.md
## Commands
npm test · npm run lint · npm run docs (regenerates docs/commands, schemas/) · npm run docs:check

## Architecture
- src/core/: pure functions, no console/process.exit/prompts
- src/commands/: thin Commander wrappers; render via src/output.js, errors via src/errors.js
- Workflow commands compose core functions in-process; never shell out to our own binary

## Contract rules (agents and scripts depend on these)
- Never rename/remove a command, flag, JSON field, or exit code; add instead and deprecate
- Every new command: --json support, examples in help, output schema in src/contract.js, docs regenerated
- Any contract change needs a changeset marked "contract"

## Gotchas
- listr2 renders to stderr; stdout is data only
- Prompts only behind isTTY + missing flag; every prompt has a flag
```

Keep it short. Guidance from the spec's community stresses brevity, and the files load into every agent session.

### Optional: `llms.txt`

For a hosted docs site, an `llms.txt` index (links to the reference, contract, and error pages) helps agents find the right page cheaply. Anthropic suggests feeding such files to Claude when building tools. It's low effort if you already generate Markdown.

---

## 8. Changelog, deprecation, and versioning docs

- **Additive changes by default.** Any non-additive change gets a long, documented deprecation. While running, the tool warns users of the affected flag, says when the change is coming, and says how to future-proof. It stops warning once they've migrated. ([clig.dev])
- **Human-readable output may change;** scripts should use `--plain` or `--json` for stability. Semver helps, but frequent major bumps make it meaningless. ([clig.dev])
- **Agent-specific additions:**
  - **Emit deprecation warnings in a machine-readable form too:** in JSON mode add `meta.warnings: [{code:"W_DEPRECATED_FLAG", flag:"--user", use:"--user-id", removal:"2.0"}]`, and in text mode write to stderr. Agents never see a deprecation printed only in human text.
  - **Mark contract changes in the changelog** (a "Contract" or "Breaking for automation" heading), separate from UX tweaks.
  - **Bump `schema_version`** in the envelope when an output shape changes.
- **Tooling:**
  - **Changesets:** each PR declares its release intent, and the CLI turns that into version bumps, changelog entries, and publishes. v3.0 shipped on 11 August 2026, its first major release in seven years.
  - **release-please / semantic-release:** derive versions and changelogs from conventional commits. Release-please and Changesets both use a reviewable "release PR" flow.
  - For a single-package internal CLI, either works. Changesets' explicit intent files make it easy to require a "contract" note.

---

## 9. Keeping docs in sync (CI)

| Check | How |
|---|---|
| Generated reference is current | `npm run docs && git diff --exit-code docs/ schemas/` |
| Help text changes are intentional | Snapshot tests of every `--help` (execa + Vitest), as in the main doc |
| README code blocks from real files | `embedme --verify README.md`, or `markdown-code check`. Both fail CI on drift. |
| README commands actually run | Extract shell blocks and run them against a test environment, asserting exit code 0. Doc-testing tools exist (`mdoctest`, `readme-ci`), but a small script with execa is enough for a CLI. |
| Docs match behavior (semantic drift) | `docs-sync-audit` skill (you have it) on PRs that touch commands; `tech-debt-audit` flags documentation drift on full audits |
| Every command has examples and a docs link | A unit test that walks `program.commands` and asserts the help includes "Examples:" and a URL |
| Every error code is documented | A test that every code in the error catalog appears in `docs/errors.md` (or generate the file, then diff-check it) |

---

## 10. Applying this to your legacy CLI

1. **Snapshot first.** Capture `--help` for every command (and representative outputs) as tests. This is also the raw material for the docs.
2. **Inventory existing docs** with `docs-sync-audit`, or `tech-debt-audit`'s documentation-drift dimension. List what's stale, missing, or contradictory.
3. **Fix help at the source.** Add `addHelpText('after')` examples, required/optional wording, and docs links per command. Regenerate the snapshots deliberately.
4. **Generate the reference** with the Commander walker (§5) and add the CI drift check.
5. **Rewrite the README** to the template (§4): short, with an agent section and links.
6. **Document the contract.** Write the exit-code table and error catalog (§6) as you introduce the shared `errors` layer, and output schemas as commands gain `--json`.
7. **Add `AGENTS.md`** (plus a `CLAUDE.md` that imports it) describing the target architecture and contract rules, so every agent-assisted refactor moves in the same direction.
8. **Adopt Changesets** (or release-please) and require a "contract" note on any change to flags, fields, or exit codes.
9. **Write the companion skill last,** linking to the generated docs rather than copying them.

---

## 11. Migrating a large README to per-command-group READMEs (with per-group audits)

This applies when the existing README is very large (thousands of lines) and you're moving each command group's section into its own README, leaving a short summary and link in the main README. It's a good move: Claude loads only the group it's working on instead of thousands of lines, and owners see the docs next to the code. Run it as **two separate phases per group, migrate then audit**, with a review checkpoint between them. Code fixes come later in their own PRs.

### 11a. Ground rules before the first group

1. **Run a whole-repo baseline once, and set the standard conventions.** Some issues don't belong to any one group:
   - the shared output and error handling, global flags, and the exit-code scheme;
   - dependencies, import cycles, and architecture.

   Run the cheap passes once across the repo (`knip`, `madge --circular`, `npm audit`, `cli-agent-lint` on the binary). Then write down the conventions every group is judged against: the JSON envelope, the exit-code table, the error-code format, help-text rules, and the group README template. Put them in `AGENTS.md`/`CLAUDE.md`. Without this, each group's audit invents its own recommendations.
2. **Snapshot `--help` for every command** before touching anything (execa + Vitest). The snapshots are the ground truth that migrated docs get checked against.
3. **Fix the template** so every migration produces the same structure:

```markdown
# acme <group>
<!-- One paragraph: what this group is for and when to use it. -->

## Concepts
## Common tasks            <!-- task-oriented examples with context -->
## Commands                <!-- GENERATED: do not edit between markers -->
<!-- commands:start --> … <!-- commands:end -->
## Output & exit codes     <!-- group-specific notes; link to docs/output-contract.md -->
## Gotchas
## Related                 <!-- other groups, workflows -->
```

4. **Location:** next to the code (`src/commands/<group>/README.md`), so agents working in that folder pick it up. The main README keeps one or two lines per group plus a link. Use absolute GitHub URLs (or make sure `repository` is set) so the links still work on npm, which renders the README without the group files.
5. **Track the work:** one tracking issue (or `docs/migration.md`) listing groups in priority order: most-used first, especially the ones agents will drive.

### 11b. Phase 1: migrate one group (content only)

- Move the group's section into the template. **Don't change meaning.** Rewording for structure is fine; fixing facts isn't yet. Mark suspected inaccuracies inline with `<!-- VERIFY: … -->` instead.
- Replace hand-written flag tables with the generated block (the Commander walker in §5, writing between the markers).
- Replace the section in the main README with a 1–2-line summary and a link.
- **Prove nothing was lost.** Produce a mapping of every heading and code block in the old section → its new location (or "replaced by generated reference"). Diff the old section's text against the new file plus generated output.
- Run a link checker (`lychee` or `markdown-link-check`) and the docs-generation drift check.
- **Checkpoint:** human review of a content-only PR.

### 11c. Phase 2: audit the same group (findings only, no code changes)

Run the checks scoped to the group's files, against the conventions from 11a:

| Check | Scope | Finds |
|---|---|---|
| `docs-sync-audit` | Group README vs group code and help snapshots | Claims the code doesn't back up; resolves the `VERIFY` markers |
| `create-cli` (reverse-spec) | Group's commands | Inconsistent flag names and meanings, missing examples, unclear exit behavior |
| `nodejs-cli-best-practices` (audit mode) | Group's command files | Node CLI practice violations (§ references) |
| `cli-agent-readiness-reviewer` | Group's commands | Blocker/Friction/Optimization findings for agents, including token efficiency |
| `tech-debt-audit` | Group's folder | Debt with `file:line` citations; **set the output path** per group (for example `src/commands/<group>/AUDIT.md`) so scoped runs don't overwrite the repo-root `TECH_DEBT_AUDIT.md` |
| Workflow candidates | Group's common tasks | Multi-step jobs to become skill scripts or workflow commands (token-efficiency doc §1b) |

Write all findings to one per-group file (or the group's tracking issue), ranked by severity, with "fix in group PR" vs "cross-cutting: escalate to conventions" marked separately.

### 11d. Phase 3: fixes (separate PRs)

Work through the findings in their own PRs. Behavior changes update the help snapshots deliberately, regenerate the reference, and add a changeset (a "contract" note if flags, fields, or exit codes change). Cross-cutting findings update the conventions in `AGENTS.md`, and then apply to groups not yet migrated.

### Why keep the phases separate

- **Reviewability:** a reviewer can trust a content-only PR quickly. Mixed "moved + changed" PRs hide behavior changes.
- **Accuracy:** migration surfaces suspect claims, and the audit resolves them against code and snapshots.
- **Context size:** each phase handles one group, so audits stay well within what Claude can hold, which follows `tech-debt-audit`'s own advice to scope large repos by module.

---

## 12. Do the recommended skills cover this?

| Topic | nodejs-cli-best-practices | create-cli | cli-agent-readiness-reviewer | Already in your setup |
|---|---|---|---|---|
| Good `--help` with examples | ✅ §1.9 | ✅ (help text, usage synopsis) | ✅ (progressive help discovery) | — |
| Error codes mapped to docs | ✅ §6.1 | ◐ (exit-code map) | ◐ (actionable errors) | — |
| Bug-report path | ✅ §6.5 | ❌ | ❌ | — |
| Version and changelog docs | ✅ §9.1–9.7 (version flag, semver, backward compatibility, update version docs) | ❌ | ❌ | — |
| README structure | ❌ | ❌ | ❌ | `engineering:documentation` (generic) |
| Generated reference / man pages | ❌ | ◐ (its spec output *is* a reference doc) | ❌ | — |
| Output-contract and schema docs | ❌ | ◐ (output rules in the spec) | ❌ | — |
| `AGENTS.md`/`CLAUDE.md` for the repo | ❌ | ❌ | ❌ | — |
| Doc drift detection | ❌ | ❌ | ❌ | `docs-sync-audit`; `tech-debt-audit` (documentation drift) |

**Verdict:** help text and error and version hygiene are well covered. README structure, generated references, contract documentation, `AGENTS.md`, and CI drift checks aren't in any CLI skill. `docs-sync-audit` handles detection after the fact. If you build the custom `cli-agent-efficiency` skill suggested in the token-efficiency doc, sections 4–9 here belong in it (or in a small sibling `cli-docs` skill), especially the README template, the `AGENTS.md` contract rules, and the CI checks table. The §11 process has its own skill (`cli-group-readme-migrate-audit`) so each group migration runs the same way.

---

## Sources

- [Command Line Interface Guidelines (clig.dev): Help, Documentation, Future-proofing](https://clig.dev/)
- [oclif `readme` command docs](https://www.github.com/oclif/oclif/blob/main/docs/readme.md)
- [@salesforce/plugin-command-reference](https://www.npmjs.com/package/%40salesforce%2Fplugin-command-reference)
- [commander-to-markdown](https://npmjs.com/package/commander-to-markdown) · [commanderdoc](https://npmjs.com/package/commanderdoc) · [Convex CLI generateDocs (Commander)](https://app.unpkg.com/convex@1.42.3/files/src/cli/lib/generateDocs.ts)
- [How to ship man pages with your Node programs](https://dev.to/hughrawlinson/how-to-ship-man-pages-with-your-node-programs-3j4g) · [npm/cli issue #4276: man pages not linked](https://github.com/npm/cli/issues/4276)
- [Zod: JSON Schema](https://zod.dev/json-schema)
- [Liran Tal: nodejs-cli-best-practices reference](https://tessl.io/registry/lirantal/nodejs-cli-best-practices/files/references/best-practices.md)
- [AGENTS.md vs CLAUDE.md (DEV, 2026)](https://dev.to/pederaa/agentsmd-vs-claudemd-which-context-file-should-your-coding-agents-use-in-2026-2ngb) · [Claude Code and AGENTS.md (eesel, Sep 2026)](https://www.eesel.ai/blog/claude-code-agents-md) · [AGENTS.md complete guide](https://codersera.com/blog/agents-md-complete-guide-2026/) · [Atlan: AGENTS.md](https://docs.atlan.com/agents/concepts/agents-md)
- [InfoQ: Changesets v3 release](https://infoq.com/news/2026/09/changesets-v3-release) · [Release automation with GitHub Actions](https://www.tenki.cloud/blog/release-automation-github-actions)
- [embedme](https://www.npmjs.com/package/embedme) · [markdown-code](https://socket.dev/npm/package/markdown-code) · [mdoctest](https://pypi.org/project/mdoctest/) · [readme-ci](https://pypi.org/project/readme-ci/)
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
