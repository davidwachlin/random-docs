# Building CLI Utilities for Agents and Humans (with a Node.js focus)

*Research notes — November 24, 2026*

## TL;DR

- **Start from clig.dev**, then add an "agent layer" on top. The classic human-CLI rules (stdout for data, stderr for messages, honest exit codes, `--help` with examples, respect `NO_COLOR`) are already 70% of what agents need.
- **The agent layer** is: JSON output whenever stdout is not a TTY, a stable output envelope, typed errors with distinct exit codes and a `remediation` hint, no prompts (every prompt has a flag), `--dry-run` / explicit `--confirm` for mutations, field selection to keep output small, a schema/describe command, and a frozen, additive-only command surface.
- **Pre-define common chains.** Keep commands small and composable, then put frequent multi-step jobs in a skill script or an in-process workflow command so Claude doesn't work out the chain each time. See the sibling doc `cli-token-efficiency-for-agents.md`.
- **Documentation** (help, README, generated reference, output/error contract, `AGENTS.md`, changelog, CI drift checks) is covered in the sibling doc `cli-documentation-for-agents-and-humans.md`.
- **Ship a skill next to the CLI.** A short `SKILL.md` that teaches the CLI is the cheapest way to make Claude good at it — measured to beat loading MCP tool schemas by a wide margin in token cost.
- **For Node:** `node:util` `parseArgs` for small tools; Commander or citty for most; oclif for big plugin-style CLIs; **incur** if "agent-first" is the main goal (Zod schemas, `--json`/`--format`, auto-generated skills + MCP). Test by spawning the real binary with execa + Vitest (or `node:test`), and audit with `cli-agent-lint`.
- **Claude skills worth installing:** Liran Tal's `nodejs-cli-best-practices` (Node implementation and audit), steipete's `create-cli` (spec-first CLI design on clig.dev), and compound-engineering's `cli-agent-readiness-reviewer` (agent-readiness review). Add Anthropic's `skill-creator` to write and eval the companion skill.
- **Auditing an existing CLI:** `tech-debt-audit` for codebase health, `nodejs-cli-best-practices` in audit mode for CLI practices, and `cli-agent-readiness-reviewer` + `cli-agent-lint`/`anc` for agent readiness. See section 6.

---

## 1. Foundations: CLI design for humans

### The canonical guide: Command Line Interface Guidelines (clig.dev)

[clig.dev](https://clig.dev/) is the open-source guide that updates UNIX principles for modern CLIs, covering arguments and flags, errors, output, subcommands, and configuration. Many other style guides (Bloomberg's Stricli, Google's Pigweed, GitHub's `gh` "primer") explicitly build on it.

Core rules to internalize:

| Area | Rule |
|---|---|
| Streams | Primary output to **stdout**; logs, progress, warnings, prompts to **stderr**. |
| Exit codes | `0` = success, non-zero = failure. Document any custom codes. |
| Help | `-h/--help` on every command; lead with usage + **realistic examples**; suggest next commands. |
| Flags vs args | Prefer flags over positional args (more extensible). Use both long and short forms for common flags. |
| Output | Human-readable by default in a TTY; offer `--json` (or `--format`) for machines; `-q/--quiet`, `-v/--verbose`. |
| Color | Disable when not a TTY, when `NO_COLOR` is set, when `TERM=dumb`, or with `--no-color`. |
| Interactivity | Only prompt when stdin is a TTY; every prompt must have a flag equivalent; `--no-input` to forbid prompts. |
| Danger | Confirm destructive actions; offer `--dry-run`; `--force`/`--yes` to skip confirmation. |
| Config precedence | flags → env vars → project config → user config (XDG) → system config. |
| Signals | Handle Ctrl-C promptly; clean up; a second Ctrl-C forces exit. |
| Robustness | Validate input early; print something within ~100ms; be idempotent where possible. |
| Future-proofing | Changes should be additive; deprecate with warnings before removing. |

Other good human-CLI references: GitHub CLI's design "primer", PatternFly's CLI handbook, and Bloomberg Stricli's guiding principles.

---

## 2. Making CLIs that work for Claude and other agents

### Why CLIs (plus skills) are a good agent surface

Several 2026 benchmarks compared CLI, skills, and MCP for the same tasks:

- OpenRouter (Nov 2026): for one task, the CLI used ~1.4K input tokens, a skill ~3.3K, and a default MCP server ~59K; on Sonnet 5.5 the MCP setup cost ~17× more per 1,000 tasks.
- Scalekit (widely cited): MCP used 4–32× more tokens than equivalent CLI calls; an ~800-token `gh` skill file **outperformed** 28K tokens of MCP schemas with fewer tool calls.
- Counterpoint: an arXiv analysis argues MCP still wins on per-user auth, credential isolation, audit, and multi-tenant governance, and that progressive-disclosure MCP closes most of the token gap.

**Practical takeaway:** For local developer workflows (your case), a well-designed CLI + a small skill is the cheapest and most reliable way to give Claude a capability. Add an MCP server only when you need per-user auth, audit, or non-shell clients.

### Anthropic's guidance on tools for agents (applies directly to CLIs)

From Anthropic's engineering post *Writing effective tools for agents — with agents*:

1. **Choose tools deliberately** — don't just mirror every API endpoint. Pre-define common multi-step workflows instead of making the agent chain primitives itself (e.g. `events schedule` rather than `list` + `create`), as a skill script or an in-process workflow command. Prefer `search` over `list`-everything.
2. **Namespace** by service/resource so the agent picks the right one.
3. **Return meaningful context** — names and human-readable fields over opaque UUIDs/mime types; resolving IDs to names reduced hallucinations.
4. **Offer a concise vs detailed response mode** — concise used about a third of the tokens. In CLI terms: `--format concise|detailed` or `--fields`.
5. **Be token-efficient** — pagination, filtering, truncation with sensible defaults. (Claude Code caps a tool response at 25K tokens by default; long CLI output gets truncated too.)
6. **Make errors and truncation actionable** — say what to fix; when truncating, tell the agent which filter or page flag to use.
7. **Prompt-engineer the help text** — write it like onboarding a new hire; unambiguous parameter names (`--user-id`, not `--user`).
8. **Evaluate** — give Claude realistic multi-step tasks with verifiable outcomes, read the transcripts, and let Claude propose help/output improvements.

### The agent-ready CLI checklist

Synthesized from Arcjet's "Designing a CLI for AI agents", Google's Workspace CLI (`gws`) design, nibzard's nine principles, agentsurface.dev, and cli-agent-spec.

**Output**
- [ ] Text when stdout is a TTY; **JSON when it isn't** (Arcjet's default), plus an explicit `--output json` / `--json`.
- [ ] One consistent **envelope** across commands, e.g. `{ "ok": true, "data": ..., "meta": { "next_cursor": ... } }`.
- [ ] `--fields a,b,c` (or `--format concise`) to shrink output.
- [ ] Stream large lists as **NDJSON/JSONL** with `--page-all`; otherwise paginate with a cursor.
- [ ] No spinners, colors, banners, or "Tip:" lines on stdout in non-TTY mode.
- [ ] Help text goes where you document it. Note that Commander prints help to stdout by default; that's fine for humans, but don't mix it into data output.

**Errors and exit codes**
- [ ] Distinct, documented exit codes. Arcjet's example: `0` ok, `1` general, `2` auth, `3` validation, `4` confirmation required.
- [ ] In JSON mode, errors are objects on stderr: `{ "error": "...", "code": "E_VALIDATION", "remediation": "Pass --site-id site_…", "retryable": false }`.
- [ ] Agents branch on the exit code and the `code` field, never on message text, so keep both stable.
- [ ] Errors "teach": what went wrong, why, and the exact next command.

**Input**
- [ ] Validate everything locally before side effects (types, ranges, ID prefixes). Treat the agent as an untrusted caller.
- [ ] Unknown commands/flags **fail hard**. Arcjet disables "did you mean?" fuzzy correction so agents learn the real interface rather than relying on auto-correction.
- [ ] Accept complex input as raw JSON (`--json '{...}'`, `--json @file.json`, or stdin) that maps 1:1 to the underlying schema. `gws` does this: `--params` for query params, `--json` for request bodies.
- [ ] Read from stdin when the input is `-`.

**Non-interactive operation**
- [ ] Never block on a prompt when stdin isn't a TTY. Provide `--yes`, `--no-input`, and env vars such as `NO_PROMPT=1` or `CI`.
- [ ] Token/key auth via env var (e.g. `MYTOOL_TOKEN`) that overrides stored credentials. Browser/OAuth login is for humans only.
- [ ] No pagers (`less`) unless TTY; respect `PAGER=cat`.
- [ ] Time-bound everything (`--timeout`), handle SIGINT/SIGTERM, and don't leak child processes.

**Safety rails**
- [ ] `--dry-run` on every mutating command, showing the exact changes.
- [ ] Arcjet's **confirmation round-trip** pattern: mutating commands do nothing without `--confirm`. Without it they exit `4` and print `{ "status": "confirmation_required", "changes": [...], "confirmCommand": "mytool deploy --confirm ..." }`. Claude shows the user the changes, then reruns the exact `confirmCommand`. No prompts, so it also works in CI.
- [ ] Prefer declarative, idempotent verbs (`ensure`, `apply`, `sync`) over imperative ones (`create`, `delete`).
- [ ] If output may include untrusted text (emails, docs, web pages), consider a sanitize/quote mode. `gws` has `--sanitize` with Model Armor because that text can carry prompt injection.

**Discovery**
- [ ] `--help` for every subcommand: usage, required vs optional (agents won't guess), defaults, output shape, exit codes, 2–3 realistic examples.
- [ ] A machine-readable introspection command: `mytool schema <command>` (gws) or `mytool --describe --json` / `--agent-info` (proposed for GitLab's `glab`).
- [ ] Shell completions.
- [ ] A `mytool skills` (or `skills add`) command that installs or points to the companion skill. Arcjet does `npx skills add arcjet/skills`.
- [ ] Optionally `--llms` / an `llms.txt`-style manifest.

**Workflows (pre-defined chains)**
- [ ] Primitive commands stay small and composable: `--fields`, JSON/TSV output, stdin input, reliable exit codes.
- [ ] Common multi-step jobs are pre-defined so Claude doesn't work out the chain on the fly. Start as a script in the companion skill. Promote to a workflow command, composed in-process from the same core functions, when the job is stable, frequent, mutating, or logic-heavy.
- [ ] Workflow commands support `--dry-run` (prints the plan of steps), report which step failed, and return a concise result. See `cli-token-efficiency-for-agents.md` §1b for the levels and promotion rule.

**Contract stability**
- [ ] Treat commands, flags, output fields, and exit codes as an API. After 1.0, changes are **additive only**: new commands/flags/fields are fine; renames and meaning changes are not.
- [ ] Version the JSON schema and include it in the output (`"schema_version": 1`).
- [ ] Ask agents to discover via help/schema/skill, not runtime correction.

### Ship a skill with the CLI

Agent Skills (`SKILL.md` folders) are an open standard. Claude Code, Codex, Cursor, Copilot, and Gemini CLI read them. A good companion skill:

- Has a precise `description` with trigger phrases ("Use when the user asks to… / mentions…").
- Stays short (under ~500 lines). It covers the 10–20 commands that matter, common workflows, gotchas, and "always run `mytool schema X` before building a payload". Detail goes in `references/`.
- Uses `allowed-tools: Bash(mytool:*)` in Claude Code so the CLI runs without a permission prompt each time.
- Lives in the CLI's repo (`skills/mytool/SKILL.md`) so it versions with the binary. `gws` ships 100+ skills this way; Composio's `awesome-agent-clis` packages each listed CLI with a `SKILL.md`.
- Installs with `npx skills add <owner>/<repo>` (cross-agent), or as a Claude Code plugin marketplace (`/plugin marketplace add <owner>/<repo>`).

One measurement found a ~480-token skill paid back its fixed cost after ~24 operations in a session. After that, the smaller outputs keep saving tokens.

### Audit tools

- **agentnative (`anc`)** (Rust; `brew install brettdavies/tap/agentnative`). A linter for the same 7 agent-readiness principles. Runs both source checks and behavioral checks against the binary (`--source` / `--binary`), and outputs a JSON scorecard (`anc check . --output json`).
- **cli-agent-lint** (Go, `go install github.com/Camil-H/cli-agent-lint@latest`). Runs 34 checks in 5 categories against any CLI and gives a letter grade. Use `--no-probe` to parse help only. Arcjet used it with LLM review to check its CLI. Works on Node CLIs too since it treats the CLI as a black box.
- **cli-agent-spec** ([cli-agent-spec.github.io](https://cli-agent-spec.github.io/)): 76 failure modes and 167 requirements, plus per-framework scorecards. Commander scores 0 native / 13 partial / 20 missing of its 33 challenges, which tells you what you must build yourself on top of Commander.

---

## 3. Claude skills, plugins, and tools for designing and building CLIs

### Skills (install into `~/.claude/skills/` or via a plugin)

**Recommended core set (updated Nov 24):**

| Skill | Source | Use for |
|---|---|---|
| **nodejs-cli-best-practices** | Liran Tal, via tessl registry / his repo | Build or **audit** a Node CLI against ~40 practices. Has audit and "development guide" modes. Its evals showed 41% fewer tokens and 31% faster on "build a new CLI" vs no skill. **Top pick for Node implementation.** |
| **create-cli** | Peter Steinberger, `steipete/agent-scripts` (MIT; also on ClawHub, ~4K downloads) | **Replaces the clig.dev skill.** Short (~90 lines) and spec-first. It reads a bundled clig.dev rubric (`references/cli-guidelines.md`), asks a few clarifying questions, then outputs a command tree + usage synopsis, a flags table, output rules (stdout/stderr, TTY, `--json`/`--plain`), an exit-code map, safety rules (`--dry-run`, `--force`, `--no-input`), and config precedence. Also meant for refactoring an existing CLI's surface. Not agent-specific; pair it with the reviewer below. |
| **cli-agent-readiness-reviewer** | EveryInc **compound-engineering** plugin (added in v2.56.0, Mar 2026); standalone copy at `udecode/plate` on skills.sh | **The agent layer.** Reviews CLI source code, plans, or specs against 7 agent-readiness principles. Findings are tagged Blocker / Friction / Optimization, evaluated per command type. It finds entry points itself (Commander, yargs, oclif, `bin` field). Works on a new spec (step 2 of the workflow) and on existing code. |

Optional and situational:

| Skill | Source | Use for |
|---|---|---|
| **node** (and `node-best-practices`) | Matteo Collina, `mcollina/skills` (`npx skills add mcollina/skills`) | General modern-Node quality from a Node core contributor: TypeScript type stripping, async patterns, error handling, streams, testing. Useful when modernizing old Node code. |
| **cli-design** (clig.dev condensed) | `michaelliv/dotskills` | *Superseded by create-cli.* About 600 words of principles with no deliverable structure, little on machine output, and only a handful of installs. |
| **incur** skill | `wevm/incur` (`npx incur skills add`) | Teaches Claude the incur framework so it can scaffold a whole agent-ready CLI in one pass. |
| **cli-creator** | OpenAI's skills repo (`npx skills add openai/skills/cli-creator --agent claude-code`) | Workflow for building durable, composable CLIs for agents to reuse across repos; includes checking for install-name conflicts. Written for Codex but portable. |
| **cli-developer / cli-tools** | Various community (awesomeskill.ai, mcpmarket) | Generic Node/Python/Go CLI patterns. Quality varies; read before installing. |
| **skill-creator** | Anthropic (`claude-plugins-official`, also bundled in Claude) | Write the *companion* skill for your CLI, then run trigger/behavior evals on it. |
| **mcp-builder** / **mcp-server-dev** (`build-mcp-server`, `build-mcpb`) | Anthropic (`anthropics/skills`, `claude-plugins-official`) | If you also want an MCP server wrapping the same core library. |
| **plugin-dev** | Anthropic `claude-plugins-official` | Package the CLI's skill(s), slash commands, and hooks as a Claude Code plugin for your team. |
| **docs-sync-audit**, **engineering:documentation**, **engineering:testing-strategy** | Already available in your setup | Keep README/help in sync with code; plan the test matrix. |

> Caveat: third-party skills can execute code and steer the agent. Read every `SKILL.md` and its scripts before installing, especially for a work machine.

### Plugin marketplaces and catalogs

- `anthropics/skills` and `anthropics/claude-plugins-official`: official skills, `skill-creator`, `plugin-dev`, `mcp-server-dev`.
- skills.sh, tessl registry, claudepluginhub, skillsmp: indexes of community skills. tessl shows quality/eval scores.
- `ComposioHQ/awesome-agent-clis`: curated agent-ready CLIs, each with a `SKILL.md`. Good examples to copy patterns from.

### Exemplar CLIs to study

- **Google Workspace CLI (`gws`)** — schema-driven (generated from Discovery docs), raw JSON payloads, `gws schema <method>`, NDJSON pagination, `--dry-run`, structured exit codes 0–5, `--sanitize`, and 100+ bundled skills. Distributed on npm (`@googleworkspace/cli`).
- **Arcjet CLI** — TTY-aware output, `--fields`, typed exit codes, the confirmation round-trip, a frozen 1.0 surface, a shared response model with its MCP server.
- **GitHub CLI (`gh`)** — `--json field,field` + `--jq` + `--template`; the canonical example of field selection.
- **glab** — `--output json`, `NO_PROMPT=true`, and `glab mcp serve` (CLI and MCP from one binary).

---

## 4. Node.js: building high-quality CLIs for agents and humans

### Framework choice

| Option | When | Agent notes |
|---|---|---|
| `node:util` **`parseArgs`** (built in) | Small/medium single-purpose tools; zero deps | Strict mode rejects unknown flags for free. You write help/JSON/exit-code handling yourself. Liran Tal's guide now recommends starting here. |
| **Commander** (~35–50M weekly downloads) | Default for most CLIs; zero deps; huge example base, so Claude writes it fluently | Respects `NO_COLOR`/`FORCE_COLOR`. No JSON mode or schema introspection. Use `configureOutput()` to control streams, and `exitOverride()` to map parse errors to your exit codes. |
| **citty** (UnJS) | TypeScript-first, lazy sub-commands, ESM; good past ~20 commands | Light; pair with `@clack/prompts` for humans. |
| **yargs** | Rich validation, completions | Heavier, older API. |
| **oclif** (Salesforce/Heroku/Shopify) | Big multi-team CLIs with plugins, generators, auto-update | Class-based; built-in `--json` flag support on commands; the most "enterprise". |
| **Clipanion** (Yarn) / **Stricli** (Bloomberg) / **Optique** | Strict typing, no-magic parsing | Stricli's principles are clig-derived. |
| **incur** (wevm) | **Agent-first** CLIs | Zod schemas for args/options/env/**output**; `--json`, `--format`, `--full-output`, `--help`, `--version` on every CLI for free; call-to-action "next command" hints; `skills add` / `mcp add` to auto-register with agents; serve the same commands over HTTP/MCP; standalone binaries. Small API (`Cli.create`, `.command`, `.serve`) so Claude can build a whole CLI in one pass. Newer and less battle-tested, so pin versions. |

**Recommendation for work tools:** Commander (or `parseArgs` for tiny scripts) plus a small shared `output.ts`/`errors.ts` layer that implements the checklist above. If you're building several agent-facing tools, prototype one in **incur** and compare. It gives you most of the checklist for free.

### Supporting libraries

- **Color:** `util.styleText` (built in), `picocolors` (tiny; auto-disables off-TTY, respects `NO_COLOR`/`FORCE_COLOR`), `kleur`, `chalk`.
- **Prompts (humans only, behind a TTY check):** `@clack/prompts`, `@inquirer/prompts`.
- **Rich TUIs:** Ink (React for the terminal). Keep it out of the agent path.
- **Validation/schemas:** Zod (also lets you emit JSON Schema for a `schema` command), Valibot.
- **Config:** XDG paths (`env-paths`), `cosmiconfig` / `c12`.
- **Subprocesses:** `execa`, or `node:child_process` with `execFile` (never shell-interpolate user/agent input).
- **Startup speed:** lazy-`import()` subcommands, avoid heavy top-level imports, aim for <100ms to first output. Agents call CLIs many times, so startup cost multiplies.

### Implementation patterns (Node specifics)

```js
// output.js: one envelope; TTY-aware format
const isTTY = process.stdout.isTTY;
export function resolveFormat(flag) {
  return flag ?? (isTTY ? 'text' : 'json');
}
export function emit(data, { format, fields, render }) {
  if (format === 'json') {
    const out = fields ? pick(data, fields) : data;
    process.stdout.write(JSON.stringify({ ok: true, data: out }) + '\n');
  } else {
    process.stdout.write(render(data) + '\n');
  }
}

// errors.js: typed errors → exit codes + remediation
export const EXIT = { OK: 0, GENERAL: 1, AUTH: 2, VALIDATION: 3, CONFIRM: 4 };
export class CliError extends Error {
  constructor(code, message, { exit = EXIT.GENERAL, remediation, retryable = false } = {}) {
    super(message);
    Object.assign(this, { code, exit, remediation, retryable });
  }
}
export function fail(err, format) {
  const e = err instanceof CliError ? err : new CliError('E_INTERNAL', err.message);
  if (format === 'json') {
    process.stderr.write(JSON.stringify({ ok: false, error: e.message, code: e.code,
      remediation: e.remediation, retryable: e.retryable }) + '\n');
  } else {
    process.stderr.write(`error: ${e.message}\n${e.remediation ? `hint: ${e.remediation}\n` : ''}`);
  }
  process.exitCode = e.exit; // let streams flush instead of process.exit()
}
```

### Structure: a core layer, thin commands, and workflow commands

- **Core layer:** plain async functions with no CLI concerns. They take typed input, return data, and throw typed errors. No `console.log`, `process.exit`, prompts, or spinners.
- **Commands:** thin Commander wrappers. Each one parses flags, calls core functions, and renders through the shared `output`/`errors` layer.
- **Workflow commands:** compose several core functions in-process, for example `events schedule` = search users → list events → find slot → create event. Don't shell out to your own CLI with execa.
- For humans in a TTY, render workflow steps with listr2. For agents (non-TTY or `--json`), emit one JSON summary.

This split makes the code unit-testable without spawning processes, and it lets primitive and workflow commands share validation and errors.

Other Node-specific practices:

- `#!/usr/bin/env node` shebang; `"bin": { "mytool": "./dist/cli.js" }`; `"files"` whitelist; `"engines": { "node": ">=22" }` with a clear message on older runtimes.
- Prefer `process.exitCode = n` over `process.exit(n)` so piped stdout isn't truncated.
- Handle `EPIPE` on stdout (e.g. `mytool list | head`) quietly.
- Read stdin with `for await (const chunk of process.stdin)` when the input is `-` or stdin is not a TTY.
- **TypeScript:** Node 22.18+ / 24 LTS strip types natively, so `node cli.ts` works for local/internal tools (erasable syntax only; use `erasableSyntaxOnly` and run `tsc --noEmit` in CI). Node won't strip types for files inside `node_modules`, so **published** CLIs still ship compiled JS (bundle with tsdown/tsup/esbuild for faster startup).
- **Distribution:** npm (`npx mytool`), plus optional **Single Executable Applications** (`node --build-sea sea-config.json` in Node 25/26; supports assets, code cache, and a read-only VFS) for machines without Node. Commit `npm-shrinkwrap.json` if you want end users' transitive dependencies pinned.
- Cross-platform: `path.join`, no shell-specific chaining, test on Windows if anyone uses it.

### Testing

- **Unit:** test command handlers as plain functions (inject stdout/stderr/env).
- **Integration (most important):** spawn the real binary with **execa** under **Vitest** (or `node:test` with `execFile`). Assert on **exit code**, **stdout JSON** (parse it, validate against the Zod schema), and **stderr**. Run with `NO_COLOR=1`, non-TTY, and a fixed locale.
- **Contract/snapshot tests:** snapshot `--help` and JSON output so any breaking change to the agent contract fails CI. Helpers include `@scalvert/bin-tester`, `shell-cassette` (record/replay), and `citty-test-utils`.
- **Agent-readiness:** run `cli-agent-lint check ./bin/mytool` in CI and fail below a grade threshold.
- **Agent evals:** follow Anthropic's loop. Give Claude 10–20 realistic tasks using only the CLI + skill, check outcomes, and read transcripts for wrong flags, retries, and wasted tokens. Then improve help text, errors, and the skill. `skill-creator` can run the skill side of this.

---

## 5. Suggested workflow for building a new CLI with Claude

1. **Install** `nodejs-cli-best-practices`, `create-cli`, and `cli-agent-readiness-reviewer` (+ the incur skill if trying incur).
2. **Design first:** have Claude write a one-page command spec with `create-cli`. Include resources/verbs, flags, the JSON envelope, the exit-code table, which commands mutate (and so need `--dry-run`/`--confirm`), and env vars. Run `cli-agent-readiness-reviewer` on the spec, then review it yourself as if it were an API.
3. **Scaffold** with Commander/citty/incur and the shared `output`/`errors` layer.
4. **Write the companion `SKILL.md`** with `skill-creator`, in the same repo.
5. **Test:** execa integration tests, help/JSON snapshots, `cli-agent-lint` in CI.
6. **Eval with Claude** on real tasks; iterate on help text and error remediation.
7. **Freeze the surface at 1.0**; additive changes only from then on.

---

## 6. Auditing an existing, under-maintained Node CLI

Audit in three separate passes, because they need different tools:

1. **Codebase health:** architecture, dead code, dependencies, tests, types, security hygiene.
2. **CLI surface quality for humans:** clig.dev and Node CLI practices.
3. **Agent readiness:** can Claude drive it reliably?

### Pass 1: codebase health / tech debt

**Skill: `tech-debt-audit`** (`ksimback/tech-debt-skill`, MIT, ~600 stars).
- Install by downloading its `SKILL.md` into `~/.claude/skills/tech-debt-audit/` (or `.claude/skills/` in the repo), then run `/tech-debt-audit`. It only runs when invoked.
- Covers 9 dimensions: architectural decay, consistency rot, type/contract debt, test debt, dependency/config debt, performance/resource hygiene, error handling/observability, security hygiene, documentation drift.
- Grounds itself by running real tools; for JS/TS: `npm audit`, `knip`, `madge`, `depcheck`.
- Writes a committable `TECH_DEBT_AUDIT.md`:
  - every finding cites `file:line`;
  - a findings table with severity and effort, plus top-5 priorities and quick wins;
  - a required "looks bad but is actually fine" section and open questions for the maintainer.
- Re-running marks findings RESOLVED / NEW, so you can track paydown.
- Dispatches subagents on repos over ~50K LOC.
- Limits: static only (not a pen test), misses business-logic bugs, and goes shallow above ~200K LOC. On large repos, scope it by module.

Alternative: `technical-debt` (`AsyrafHussin/agent-skills`), with 42 rules across 10 categories and an effort-by-impact debt ledger.

You already have `engineering:tech-debt`, `engineering:code-review`, and `docs-sync-audit`. They're fine for follow-up work and per-PR checks. They aren't designed for a citable whole-repo baseline.

**Ground truth tools** (run these yourself or let the skill run them):

| Tool | Finds |
|---|---|
| `knip` | Unused files, exports, deps, unlisted deps (see the unused-deps doc; prefer it over archived `depcheck`) |
| `madge --circular` / `dependency-cruiser` | Import cycles, layering violations; dependency-cruiser can enforce rules in CI |
| `npm audit` / `npm outdated` | Vulnerable and stale dependencies |
| `eslint` + `eslint-plugin-n` (+ `sonarjs` for complexity) | Node API misuse, `process.exit` misuse, complexity hot spots |
| `tsc --noEmit` (with `checkJs` for JS code) / `type-coverage` | Type holes, `any` density |
| `c8` / Vitest coverage | Untested commands |
| `jscpd` | Copy-paste duplication across commands |
| `publint` | `package.json` `bin`/`files`/`exports` mistakes |

### Pass 2: CLI surface quality

- **`nodejs-cli-best-practices` in audit mode.** Ask it to audit the CLI. It produces a report referencing each practice (§6.4 exit codes, §3.2 `--json`, and so on), prioritized by user impact.
- **`create-cli` on the existing surface.** Ask it to reverse-engineer the current command tree, flags, and exit codes into its spec format. The resulting spec is useful documentation in itself, and it highlights inconsistent naming, missing `--help` examples, and flags that mean different things in different commands.
- **Snapshot the current behavior first.** Before touching anything, capture `--help` and representative outputs and exit codes for every command into snapshot tests (execa + Vitest). That gives a legacy codebase a safety net for refactoring.

### Pass 3: agent readiness

- **`cli-agent-readiness-reviewer`** on the source code gives you Blocker / Friction / Optimization findings.
- **Black-box graders** on the built binary: `cli-agent-lint check ./bin/<tool>` (letter grade, 34 checks) and/or `anc check .`. Re-run them after fixes to show progress.
- Common blockers in older Node CLIs:
  - inquirer prompts with no flag equivalent;
  - spinners or colors written to stdout when piped;
  - `console.log` used for both data and logs;
  - `process.exit(1)` for every failure;
  - help text that lacks examples.

### Your current stack (Commander, chalk, @inquirer/prompts, execa, listr2)

Keep all five. Agent problems come from how they're used, not which libraries they are. Audit for:

- **Commander:**
  - Use `exitOverride()` so parse errors get your exit codes.
  - Use `configureOutput()` to keep help and errors off the data stream.
  - Add `.addHelpText('after', …)` with examples on every command.
  - Add a program-level `--json`/`--output` option inherited by every command.
- **chalk:** already respects `NO_COLOR`/`FORCE_COLOR` and non-TTY. Look for chalk-styled strings written into data output.
- **@inquirer/prompts:**
  - Every prompt needs a flag equivalent.
  - Prompt only when `process.stdin.isTTY` is true and the flag is missing; otherwise exit 3 with a hint.
  - Respect `--no-input`/`CI`.
  - Catch `ExitPromptError` (Ctrl-C) and exit cleanly.
- **execa:**
  - Pass arguments as arrays, never `shell: true` with input.
  - Set timeouts and kill children on SIGINT.
  - Turn child failures into typed errors.
  - Also use it for the snapshot tests.
- **listr2:**
  - Use the fallback or silent renderer when not on a TTY or when `--json`/`--quiet` is set.
  - Route rendering to stderr (`processOutput`, and the logger's `toStderr`).
  - Emit a final summary, because ✔ marks aren't a result.
  - Old versions (v5 or earlier) use different option names.

### Workflow commands in the legacy CLI

Legacy commands often bundle several steps (prompt → fetch → transform → write) inside one handler. While refactoring:

1. **Extract the steps into core functions** (section 4's structure). This is the same refactor that removes `console.log`/`process.exit` mixing.
2. **Expose the useful steps as primitive commands** with `--json` and `--fields`.
3. **Rebuild the original command as a workflow command** over those functions. It keeps its name and flags for compatibility, and adds `--dry-run`, step-level errors, and a JSON summary.
4. **For multi-step jobs people currently do by running several commands by hand,** first ship a script in the companion skill. Promote it to a workflow command if evals show it's frequent or error-prone.

### Suggested order of work

1. Snapshot tests for current behavior (safety net).
2. `/tech-debt-audit` → fix security and dependency issues and the top-5 priorities.
3. Adopt a shared `output`/`errors` layer (section 4) and migrate command by command. Add `--json` and TTY-aware output first, since that's the biggest agent win.
4. Remove prompt blockers (`--yes`, `--no-input`, env-var auth).
5. Extract core functions and rebuild multi-step handlers as workflow commands (above).
6. Write the companion `SKILL.md` (with scripts for common chains) and add `cli-agent-lint` to CI.

**If the CLI has a very large README:** steps 2–5 can run one command group at a time, alongside splitting the README into per-group READMEs. Set whole-repo conventions first, then for each group: **migrate** its README section (content only), **audit** that group's code and docs (findings only), and **fix** in separate PRs. See `cli-documentation-for-agents-and-humans.md` §11 and the `cli-group-readme-migrate-audit` skill.

> Work-machine caution: all of these are third-party. Read each `SKILL.md` (and any scripts) before installing. For compound-engineering you can copy just the single reviewer file instead of installing the whole plugin (~29 agents).

---

## Sources

- [Command Line Interface Guidelines (clig.dev)](https://clig.dev/)
- [Anthropic: Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Arcjet: Designing a CLI for AI agents](https://arcjet.com/blog/designing-a-cli-for-ai-agents)
- [Rewrite Your CLI for AI Agents (gws design)](https://understandingdata.com/posts/rewrite-cli-for-agents/)
- [Better Stack: Google Workspace CLI, an agent-first interface](https://betterstack.com/community/guides/ai/cli-gws-ai-agents/)
- [Writing CLI Tools That AI Agents Actually Want to Use (DEV)](https://dev.to/uenyioha/writing-cli-tools-that-ai-agents-actually-want-to-use-39no)
- [nibzard: Designing CLI Tools for AI Agents](https://www.nibzard.com/ai-native)
- [Agent Surface: CLI Design](https://agentsurface.dev/docs/cli-design)
- [CLI Agent Spec: Commander.js scorecard](https://cli-agent-spec.github.io/research/commander-js/)
- [cli-agent-lint](https://github.com/Camil-H/cli-agent-lint)
- [GitLab glab issue: agent-friendliness](https://gitlab.com/gitlab-org/cli/-/issues/8177)
- [InfoQ: Patterns for AI Agent Driven CLIs](https://www.infoq.com/articles/ai-agent-cli)
- [OpenRouter: MCP vs CLI vs Skills context cost](https://openrouter.ai/blog/insights/mcp-vs-cli-vs-skills/)
- [Firecrawl: MCP vs CLI for AI Agents](https://www.firecrawl.dev/blog/mcp-vs-cli)
- [Mornati: MCP Servers vs CLI, data-driven comparison](https://blog.mornati.net/the-future-of-agentic-tooling-mcp-servers-vs-cli-a-data-driven-comparison/)
- [arXiv: MCP vs CLI for AI Agents](https://arxiv.org/html/2610.30157)
- [Liran Tal: Node.js CLI Apps Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)
- [tessl: lirantal/nodejs-cli-best-practices skill](https://tessl.io/registry/lirantal/nodejs-cli-best-practices)
- [incur (wevm)](https://github.com/wevm/incur) · [incur docs](https://wevm-incur.mintlify.app/introduction)
- [PkgPulse: Best CLI Frameworks for Node.js 2026](https://www.pkgpulse.com/guides/best-cli-frameworks-nodejs-2026)
- [Optique: framework comparison](https://optique.dev/compare/)
- [Node.js docs: Single executable applications](https://nodejs.org/api/single-executable-applications.html)
- [Node.js: Running TypeScript natively](https://nodejs.org/en/learn/typescript/run-natively)
- [Claude Code docs: Skills](https://code.claude.com/docs/en/skills)
- [Claude Platform: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [anthropics/claude-plugins-official skills (tessl index)](https://tessl.io/registry/skills/github/anthropics/claude-plugins-official)
- [ComposioHQ/awesome-agent-clis](https://github.com/ComposioHQ/awesome-agent-clis)
- [skills.sh: cli-design (clig.dev condensed)](https://skills.sh/michaelliv/dotskills/cli-design)
- [steipete/agent-scripts: create-cli SKILL.md](https://github.com/steipete/agent-scripts/blob/main/skills/create-cli/SKILL.md)
- [EveryInc compound-engineering plugin](https://github.com/everyinc/compound-engineering-plugin) · [v2.56.0 release (CLI agent-readiness reviewer)](https://newreleases.io/project/github/EveryInc/compound-engineering-plugin/release/cli-v2.56.0)
- [skills.sh: cli-agent-readiness-reviewer (standalone copy)](https://skills.sh/udecode/plate/cli-agent-readiness-reviewer)
- [agentnative (anc) CLI linter](https://docs.rs/crate/agentnative/0.1.2/source/README.md)
- [ksimback/tech-debt-skill](https://github.com/ksimback/tech-debt-skill)
- [AsyrafHussin technical-debt skill](https://skillselion.com/skills/asyrafhussin/agent-skills/technical-debt)
- [mcollina/skills](https://github.com/mcollina/skills)
- [Testing CLI tools with execa + Vitest (DEV)](https://dev.to/chengyixu/how-to-test-cli-tools-a-practical-guide-for-nodejs-developers-22fd)
