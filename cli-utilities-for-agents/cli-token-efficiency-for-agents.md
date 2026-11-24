# Token-Efficient CLIs for Agents: Anthropic's Tool Guidance Translated to the Command Line

*Research notes — November 24, 2026. Sibling to `cli-utilities-for-agents-and-humans.md`.*

## Purpose

Anthropic's engineering post *Writing effective tools for agents — with agents* is written for MCP tools. Almost every point carries over to a CLI that Claude runs through Bash, because a CLI command is effectively a tool: its `--help` is the tool description, its flags are the input schema, its stdout is the tool result, and its exit code plus stderr is the error channel.

This doc goes through every recommendation in the post in order and gives each one:
- **Anthropic:** what the post says (paraphrased);
- **CLI translation:** what it means for a command-line tool;
- **Example:** a before/after sample;
- **Seen in:** real CLIs that already do it (Arcjet, Google Workspace `gws`, GitHub `gh`, incur, and others).

The goal is fewer tokens per task *without* lowering task success. Anthropic measures both together, and so should we.

Examples use a hypothetical CLI called `acme` so they aren't confused with real tools. Real commands are labeled.

---

## The mapping in one table

| Anthropic recommendation | CLI equivalent |
|---|---|
| Tool description | `--help` text, plus the companion `SKILL.md` |
| Input schema / strict data model | Flags with validated types; `--json` payload validated against a schema; `acme schema <cmd>` |
| Tool result | stdout (JSON envelope when piped) |
| Error response | Exit code + structured error on stderr with a remediation hint |
| `response_format` enum | `--format concise\|detailed`, `--fields`, `--full-output` |
| Pagination / filtering / truncation | `--limit`, `--cursor`, `--since`, `--filter`, `--page-all` (NDJSON), truncation footer |
| Namespacing | Command tree: `acme <resource> <verb>` |
| Consolidated tool | A pre-defined chain of primitives: a skill script, or a workflow subcommand composed in-process |
| Tool annotations (destructive / open-world) | `--dry-run`, `--confirm`, documented side effects in help |
| Eval loop | Headless Claude runs real tasks with only `Bash(acme:*)` allowed; measure tokens, calls, errors, success |

---

## Part 1 — Principles

### 1. Choose the right tools (and not too many)

#### 1a. Don't just wrap every endpoint; agents have limited context

**Anthropic:** More tools don't guarantee better results. Agents have limited context while computer memory is cheap, so a tool that returns every contact (to then search through it) wastes context. A `search_contacts` tool beats `list_contacts`.

**CLI translation:** Make the *default* read path a search or filter, not a list-everything. When `list` must exist, give it a small default limit and push filtering into the CLI so the filtering happens in the process, not in Claude's context.

```bash
# Before: dumps 4,000 rows; Claude greps them in context
acme contacts list

# After: the CLI does the filtering
acme contacts search "dana" --limit 5
acme contacts list --filter company=globex --limit 20   # list exists, but bounded
```

**Seen in:** `gh` (real) defaults `gh issue list` to 30 results and supports `--search`, `--label`, `--state`, and `--limit`. Arcjet adds `--fields` to shrink output.

#### 1b. Pre-define multi-step workflows (skill scripts and workflow commands)

**Anthropic:** Prefer `schedule_event` (finds availability and books) over separate `list_users` + `list_events` + `create_event`. Prefer `search_logs` (only relevant lines plus context) over `read_logs`. Prefer `get_customer_context` over three separate lookups.

**CLI translation:** Keep small, composable primitive commands. Then put a **pre-defined chain** of them in front of Claude for the multi-step jobs agents actually do, so Claude never has to work out the chain on the fly. Every separate call costs a model turn plus the full output of the intermediate step. A pre-defined chain returns only the final answer.

```bash
# Before: Claude reasons out the chain; 3 calls, 3 outputs in context, IDs copied by hand
acme customers get --id 8812
acme transactions list --customer 8812
acme notes list --customer 8812

# After: one call, one compact summary
acme customers context 8812 --format concise

# Logs: search, don't read
acme logs search "triple charge" --since 24h --context 3 --limit 20   # not: acme logs read
```

**Where the chain lives.** There are three levels. Choose per workflow by how often it happens and how complex it is:

| Level | What it is | Context cost | Best for |
|---|---|---|---|
| 1. Ad hoc composition | Claude builds a pipeline itself from primitives (`--fields`, TSV/JSON, stdin) | Reasoning tokens and `--help` lookups each time; retries when a step is wrong | Rare, one-off tasks |
| 2a. Skill recipe | Exact command sequence written in `SKILL.md` | No reasoning, but each step's output enters context if run as separate calls; Claude can drift | Medium-frequency, read-only workflows |
| 2b. Skill script | `scripts/<workflow>.sh` or `.mjs` in the skill, run as one Bash call | Only final output enters context | Workflows still evolving; no CLI release needed |
| 3. Workflow command | Built into the CLI, composed in-process from the same core functions | One call, one compact result; logic runs in code | Stable, frequent, mutating, or logic-heavy workflows; also used by humans or CI |

**Promotion rule:** start at 2b and run evals. Promote to level 3 when the workflow is stable and frequent, mutates state (so it needs real `--dry-run`/`--confirm`), has branching or join logic, or is also useful outside agents. Leave rare chains at 1 or 2a.

**How to build a workflow command (Node):** put each primitive in a core layer of plain functions. Primitive commands and workflow commands are both thin wrappers over that layer. The workflow command calls the core functions in-process; it should not spawn its own CLI through execa (slower startup, lost types, re-parsing JSON).

```js
// core/: no CLI concerns (no console.log, no process.exit)
export async function searchUsers(q, opts) { /* ... */ }
export async function listEvents(userId, range) { /* ... */ }
export async function createEvent(input) { /* ... */ }

// commands/events-schedule.js: workflow = composition of core functions
export async function schedule({ who, duration, within, dryRun }) {
  const users = await Promise.all(who.map(w => searchUsers(w, { limit: 1 })));
  const busy  = await Promise.all(users.map(u => listEvents(u.id, within)));
  const slot  = findSlot(busy, duration);            // logic Claude never has to do
  if (!slot) throw new CliError('E_NO_SLOT', 'No common slot', {
    remediation: 'Widen --within (e.g. 14d) or shorten --duration' });
  if (dryRun) return { plan: { create: { ...slot, attendees: users.map(u => u.name) } } };
  return pick(await createEvent({ ...slot, attendees: users.map(u => u.id) }), ['id', 'start', 'url']);
}
```

**Rules for workflow commands:**
- Name them by outcome (`events schedule`, `customers context`).
- Reuse the primitives' flag names.
- Make `--dry-run` print the plan of steps.
- Make them idempotent, or safe to resume after a partial failure.
- On error, report which step failed and what state was left behind.
- Return a concise result plus only the IDs needed for follow-up.

For humans in a terminal, the steps map naturally to a listr2 task list. For agents (non-TTY or `--json`), emit one JSON summary.

**Seen in:** `gws` (real) keeps the raw API as primitives and adds a small set of "+" helper commands for common workflows, such as `gws gmail +send`, `gws calendar +agenda`, and `gws gmail +triage`. That is level 3 on top of level 1. Its 100+ bundled skills supply the level-2 recipes.

#### 1c. Give every command a distinct purpose; start small

**Anthropic:** Overlapping tools distract agents. Build a few high-impact tools matched to real tasks, then scale.

**CLI translation:** Avoid two commands that do nearly the same thing (`acme deploy` vs `acme release` vs `acme ship`). If legacy aliases must stay, hide them from the main help and mark them deprecated so they don't cost Claude tokens or cause confusion. When adding agent features to an existing CLI, start with the handful of commands that real tasks use.

```text
$ acme --help
Commands:
  deploy     Deploy a build to an environment
  ...
# 'release' and 'ship' still work but are hidden aliases of 'deploy'.
```

**Seen in:** Commander's `.alias()` and hidden commands (`{ hidden: true }`) make this easy.

### 2. Namespace tools

**Anthropic:** With many tools, vague or overlapping names confuse agents. Group by service and resource, like `asana_search` or `asana_projects_search`. Prefix vs suffix naming measurably changes results, so test it.

**CLI translation:** The command tree *is* the namespace. Use a consistent `acme <resource> <verb>` (or `<verb> <resource>`) shape everywhere. The binary name namespaces it from other tools, and the companion skill names it in its description.

```bash
acme projects search "q4"      # resource → verb, consistent everywhere
acme users search "dana"
acme deploys list --env prod
```

**Seen in:** `gh pr list`, `gh issue view`, `gws drive files list`, `gws gmail users messages send`. Arcjet treats the command tree as a frozen contract after 1.0. One consistent ordering is what matters; Anthropic's note about testing prefix vs suffix applies to your skill's wording too.

### 3. Return meaningful context

#### 3a. High-signal fields over low-level identifiers

**Anthropic:** Prioritize relevance. Avoid low-level fields like UUIDs, raw image URLs, and MIME types in favor of name, image URL, and file type. Resolving UUIDs to meaningful names, or using 0-indexed IDs, improved precision and cut hallucinations. Keep the technical ID when it's needed to chain calls.

**CLI translation:** In the default (concise) output, lead with human-meaningful fields and resolve foreign keys to names. Keep exactly one ID per object that the *next* command accepts.

```jsonc
// Before (raw API passthrough, ~4x the tokens)
{"id":"c3f1e9a2-...","owner_id":"77ab...","mime":"application/vnd.acme.report+json","created":1732406400,"etag":"W/\"a81\"", ...}

// After (concise default)
{"id":"rpt_42","name":"Q4 churn","owner":"Dana Reyes","type":"report","created":"2026-11-24"}
```

**Seen in:** Arcjet uses typed, readable ID prefixes (`site_…`, `team_…`) and rejects bare UUIDs. That helps both readability and validation.

#### 3b. A response-format switch (concise vs detailed)

**Anthropic:** Add a `response_format` enum. In their Slack example the detailed response kept the thread, channel, and user IDs needed for follow-ups, while the concise one dropped them and used about a third of the tokens. You can go further and let agents pick exact fields, GraphQL-style.

**CLI translation:** Default to concise in agent (non-TTY) mode, and offer `--format detailed` and `--fields`:

```bash
acme threads list --channel eng                       # concise: text + author, no IDs
acme threads list --channel eng --format detailed     # adds thread_ts, channel_id, user_id
acme threads list --channel eng --fields ts,author,text
```

**Seen in:**
- `gh pr list --json number,title,author` plus `--jq` is the canonical field-selection example (real).
- Arcjet: `--fields` limits JSON to chosen top-level fields.
- incur gives every CLI `--format` and `--full-output` flags for free (so the default is the reduced view), and supports compact output formats.

#### 3c. Test the response structure itself

**Anthropic:** XML, JSON, or Markdown can each perform best depending on task and model, so evaluate.

**CLI translation:** JSON is the safe default for anything Claude will parse or pipe into `jq`. For long tabular results, compare JSON against NDJSON, TSV (`--format tsv`), or a compact format in your evals. Uniform rows in TSV or compact formats often cost far fewer tokens than repeated JSON keys. Keep one stable envelope for errors and metadata either way.

```bash
acme deploys list --format json    # default for agents
acme deploys list --format tsv     # same data, no repeated keys
acme deploys list --page-all       # NDJSON stream, one object per line
```

**Seen in:** `gws --page-all` streams NDJSON; incur offers alternative compact formats; `gh --template` gives Go templates.

### 4. Optimize for token efficiency

#### 4a. Pagination, range selection, filtering, truncation, with sensible defaults

**Anthropic:** Any response that could be large needs pagination, range selection, filtering, and truncation with good defaults. Claude Code caps a tool response at 25,000 tokens by default.

**CLI translation:**
- **Default limits** on every list/search command (for example 20–50), never "all".
- **Cursor pagination** surfaced in the envelope.
- **Range selection** for logs and large text: `--since`, `--until`, `--lines 100-200`, `--tail 50`.
- **Server-side filters** (`--filter`, `--state`, `--owner`).
- **Hard output budget**: cap stdout at a byte or line budget and say so.
- **Big artifacts go to files**: `--out report.json` writes the file and prints a one-line summary plus the path. Claude can then read slices.

```jsonc
// acme deploys list   (non-TTY)
{"ok":true,
 "data":[ ...20 items... ],
 "meta":{"returned":20,"total":1384,"next_cursor":"c_9f2"}}
```

```bash
acme deploys list --cursor c_9f2           # next page
acme logs search "timeout" --since 1h --tail 50
acme export orders --since 2026-11-01 --out /tmp/orders.ndjson
# → stdout: {"ok":true,"data":{"path":"/tmp/orders.ndjson","rows":18233,"bytes":4120117}}
```

**Seen in:** `gws` (`--page-all`, `--params '{"pageSize": 10}'`), `gh` (`--limit`, `--paginate` for `gh api`), Arcjet (`--fields`).

#### 4b. Truncate with guidance, and steer toward targeted calls

**Anthropic:** When you truncate, tell the agent what to do next, and encourage several small targeted searches over one broad one.

**CLI translation:** When output is cut, the response itself says *exactly* which flag narrows it. Put the hint in the JSON `meta` (and on stderr in text mode).

```jsonc
{"ok":true,"data":[ ...50 lines... ],
 "meta":{"truncated":true,"shown":50,"matched":9120,
         "hint":"Too many matches. Narrow with --since 15m, --service api, or a more specific query; page with --cursor c_77."}}
```

**Seen in:**
- incur's call-to-action feature suggests next commands after a run.
- `gh` tells you how to see more when a list is capped.
- The `cli-agent-readiness-reviewer` skill explicitly checks for truncation messages that tell the agent how to narrow.

#### 4c. Helpful errors instead of opaque codes or stack traces

**Anthropic:** Errors should be clear and actionable and show correctly formatted input. Opaque codes and tracebacks waste turns.

**CLI translation:** Every error gives a stable machine code, a distinct exit code, one sentence of cause, and a corrected example. Never a stack trace unless `--debug`. Validate before side effects so failures are cheap.

```text
# Before (exit 1, stack trace)
TypeError: Cannot read properties of undefined (reading 'split')
    at parseSite (/usr/lib/node_modules/acme/dist/cli.js:812:19) ...

# After (exit 3)
{"ok":false,"code":"E_VALIDATION","error":"--site must be a site ID",
 "remediation":"Use the site_ prefix, e.g. --site site_01h9x... ; list IDs with: acme sites list --fields id,name",
 "retryable":false}
```

**Seen in:** Arcjet's exact pattern:
- exit codes `0` ok / `1` general / `2` auth / `3` validation / `4` confirmation required;
- JSON errors with `error`, `code`, and `remediation` on stderr;
- validation before any API call;
- unknown flags fail hard, with no "did you mean?" guessing.

#### 4d. CLI-specific token savers (not in the post, but the same principle)

- **Quiet success:** mutations print the changed object's ID and status, not a celebration banner or a reprint of the whole resource.
- **No decoration off-TTY:** no spinners, colors, emoji, ASCII tables, or update notices on stdout when piped. Spinner frames and ANSI codes are pure token waste.
- **Short help:** keep each command's `--help` focused, with usage, required vs optional flags, and 2–3 examples. Put long docs behind `acme help <topic>` or in `references/` of the skill. (The readiness reviewer flags help over about 200 lines.)
- **Schema on demand:** `acme schema <command>` returns the exact input/output JSON Schema *only when asked*, instead of front-loading every schema. This is the CLI's progressive disclosure, and it's why `gws` stays cheap despite covering every Workspace API.
- **Fast startup:** agents run commands many times, so lazy-load subcommands.

### 5. Prompt-engineer the descriptions (help text and the skill)

#### 5a. Write help like onboarding a new hire

**Anthropic:** Descriptions are one of the most effective levers. Spell out implicit knowledge: special query formats, niche terminology, and how resources relate.

**CLI translation:** Each command's help should state:
- what the command is for, and when to use it instead of its siblings;
- the query syntax;
- what the IDs refer to;
- what the output contains;
- the side effects.

The `SKILL.md` carries the cross-command knowledge, like which command to run first, common workflows, and gotchas.

```text
$ acme logs search --help
Search log lines across services. Prefer this over 'acme logs read' (which streams everything).

Usage: acme logs search <query> [--since <dur>] [--service <name>] [--context <n>] [--limit <n>]

Query syntax: plain words are ANDed; "quoted phrase"; field:value (service:api level:error).
Output: matching lines with <n> lines of context; concise by default.
Defaults: --since 1h  --limit 20  --context 2

Examples:
  acme logs search 'level:error "charge failed"' --since 24h
  acme logs search 'customer:cus_88' --service billing --limit 50
```

**Seen in:**
- Arcjet puts a usage line plus realistic examples on every command.
- `gws` ships 100+ skills that hold the workflow knowledge.
- An ~800-token `gh` skill file beat 28K tokens of MCP schemas in Scalekit's benchmark.

#### 5b. Unambiguous parameter names and strict data models

**Anthropic:** Use `user_id`, not `user`. Enforce input and output with strict models.

**CLI translation:** Name flags by what they take (`--user-id`, `--user-email`), validate types and ranges locally, and accept complex input as one JSON payload validated against a published schema instead of dozens of flags.

```bash
acme users get --user-id usr_12          # not: --user 12 (is that an ID? a name?)
acme events create --json @event.json    # validated against: acme schema events.create
```

**Seen in:** `gws` (`--params` and `--json` map 1:1 to the API schema; `gws schema <method>` for introspection), Arcjet (typed ID prefixes, range-checked integers), incur (Zod schemas for args, options, env, and output).

#### 5c. Flag destructive and open-world actions

**Anthropic:** For MCP, use annotations to mark destructive or open-world tools.

**CLI translation:** Make side effects explicit:
- state them in help ("Side effects: deletes …");
- support `--dry-run` that shows the exact changes;
- require `--confirm`, using Arcjet's round-trip so no prompt is needed;
- mark open-world output (emails, web pages, docs) as untrusted.

```jsonc
// acme env delete staging   (no --confirm) → exit 4
{"status":"confirmation_required",
 "changes":[{"action":"delete","resource":"env","name":"staging","services":7}],
 "confirmCommand":"acme env delete staging --confirm"}
```

**Seen in:** Arcjet (exactly this envelope and exit 4), `gws` (`--dry-run`, `--sanitize` for prompt-injection-prone content).

---

## Part 2 — The process: evaluate the CLI with Claude

### 6. Build a prototype

**Anthropic:** Have Claude Code build the tools, give it the docs of the underlying APIs (`llms.txt` where available), wrap tools in a local server, try them yourself, and collect real use cases.

**CLI translation:** No wrapper needed, because Claude Code can already run a CLI. Put the binary on PATH, write a first `SKILL.md`, allow `Bash(acme:*)`, and use it on real tasks for a few days. Note every wrong flag, retry, or wall of output.

### 7. Generate realistic evaluation tasks

**Anthropic:** Use real data and multi-step tasks (dozens of calls), each paired with a verifiable outcome. Don't over-specify the strategy or make verifiers too strict.

**CLI translation:** Write 10–30 tasks against a dev/QA environment, each with a checkable result.

```yaml
- id: deploy-rollback
  prompt: "Prod checkout errors spiked after the last deploy. Find the deploy, confirm it's the cause, and roll it back."
  verify: "acme deploys list --env prod --limit 1 --fields version → previous version"
- id: duplicate-charges
  prompt: "Customer cus_88 says they were charged three times on Nov 20. Confirm and check whether other customers were affected."
  verify: "answer lists the 3 charge IDs and the 2 other affected customers"
```

Hold some tasks back as a **held-out set** that you never tune against.

### 8. Run the evaluation programmatically and track the right metrics

**Anthropic:** Use a simple agent loop per task. Ask for reasoning before tool calls (interleaved thinking helps). Track accuracy, per-call and per-task runtime, total tool calls, total tokens, and tool errors.

**CLI translation:** Run Claude headless with only your CLI allowed, and log each run's result and usage. For example, with Claude Code's non-interactive mode:

```bash
claude -p "$(cat tasks/deploy-rollback.md)" \
  --allowedTools "Bash(acme:*)" \
  --output-format json > runs/deploy-rollback.json
# record: success (verifier), num_turns, tokens/cost, wall time, count of non-zero exits
```

Or use the Claude Agent SDK for a scripted loop. CLI-specific metrics worth adding:
- **non-zero exit rate by exit code** (validation errors point to unclear help);
- **bytes of stdout per call** (spots unbounded output);
- **help/schema lookups per task** (too many means the skill is missing knowledge).

### 9. Analyze results

**Anthropic:** Read transcripts, not just scores, including what the agent *didn't* do. Many redundant calls suggest pagination or limit problems. Many invalid-parameter errors suggest the description needs clearer wording or examples. In their example, Claude kept appending "2025" to search queries until the description was fixed.

**CLI translation, as a symptom → fix table:**

| Symptom in transcripts | Likely fix |
|---|---|
| Same list command run repeatedly with growing `--limit` | Better default limit + cursor in `meta` + truncation hint |
| Claude pipes output into `jq`/`grep` to find one field | Add `--fields` or a search command |
| Exit 3 (validation) on the same flag across tasks | Rename the flag, add an example to help, mention it in the skill |
| Claude calls `--help` on every command every task | Move the essentials into `SKILL.md` |
| Claude chains 3+ commands passing IDs by hand | Pre-define the chain: a skill script (level 2b) first, then a workflow command (level 3) if it stays frequent, mutating, or error-prone |
| Large stdout followed by "the output was truncated" | Output budget + `--out file` + narrowing hint |
| Claude adds a flag it "thinks" exists | Fail hard on unknown flags (no fuzzy match) and list valid flags in the error |

### 10. Let Claude improve the CLI, then check against held-out tasks

**Anthropic:** Paste the concatenated transcripts into Claude Code and refactor together, keeping descriptions and implementation consistent. Agent-improved tools beat expert-written ones on held-out sets.

**CLI translation:** Give Claude Code the transcripts plus the CLI source and ask for changes to help text, defaults, errors, and the skill. Re-run the full eval, and accept a change only if held-out success holds or improves while tokens and calls drop. Keep snapshot tests of `--help` and JSON output so the improvements don't silently break the contract.

---

## Part 3 — Default token budget cheat sheet

| Setting | Suggested default |
|---|---|
| List/search default limit | 20 (max 100 per page) |
| Output when piped | Concise JSON envelope; IDs only where needed for chaining |
| Detail | `--format detailed` / `--fields` opt-in |
| Max stdout per call | ~10–20K tokens (well under Claude Code's 25K cap); beyond that truncate with a hint or require `--out` |
| Mutation success output | One line / one small object: id, status, URL |
| Help per command | Under ~60 lines; usage, required vs optional, defaults, 2–3 examples |
| Errors | Exit code + `{code, error, remediation, retryable}`; no stack trace without `--debug` |
| Progress/decoration | stderr only, and only on a TTY |
| Schemas | On demand via `schema <cmd>`, never printed by default |

---

## Part 4 — Do the recommended skills capture this guidance?

There are three recommended skills:
- `nodejs-cli-best-practices` (Liran Tal);
- `create-cli` (steipete);
- `cli-agent-readiness-reviewer` (compound-engineering).

Coverage, item by item (✅ covered, ◐ partial, ❌ not covered):

| Anthropic point | nodejs-cli-best-practices | create-cli | cli-agent-readiness-reviewer |
|---|---|---|---|
| 1a. Search over list-all / bounded defaults | ❌ | ❌ | ✅ (bounded, high-signal responses: default limits, narrowing controls) |
| 1b. Pre-defined chains (skill scripts / workflow commands) and when to promote them | ❌ | ◐ (designs the command tree, but not around agent workflows) | ◐ (rewards composability, but not deciding which chains to pre-define) |
| 1c. Distinct, non-overlapping commands | ❌ | ◐ (consistency of the surface) | ◐ (composable, predictable structure) |
| 2. Namespacing | ❌ | ✅ (subcommand hierarchy) | ◐ (consistent patterns) |
| 3a. High-signal fields, readable IDs | ❌ | ❌ | ◐ ("high-signal" in principle 7) |
| 3b. Concise/detailed, field selection | ◐ (JSON vs text, debug mode) | ◐ (`--json`/`--plain`, quiet/verbose) | ◐ (verbosity modes; fields only loosely) |
| 3c. Test response structure | ❌ | ❌ | ❌ |
| 4a. Pagination, filtering, range, limits | ❌ | ❌ | ✅ |
| 4b. Truncation with guidance | ❌ | ❌ | ✅ |
| 4c. Actionable errors | ✅ (§6.2, §6.1 error codes, §6.4 exit codes) | ✅ (error + exit-code map) | ✅ (fail-fast, actionable errors) |
| 4d. No decoration off-TTY, stdout/stderr | ✅ (§3.5, §3.6, §1.4) | ✅ | ✅ |
| 4d. Short help with examples | ◐ (§1.9 helpful help) | ✅ | ✅ (progressive help; flags very long help) |
| 4d. Schema introspection | ❌ | ❌ | ❌ |
| 5a. Help as onboarding text | ◐ | ◐ | ◐ |
| 5b. Unambiguous names, strict validation | ◐ (§10.1 argument injection) | ◐ (flag table with types) | ✅ (validation before side effects) |
| 5c. Dry-run / confirm / destructive marking | ❌ | ✅ (`--dry-run`, confirmations, `--force`) | ✅ (safe retries and mutation boundaries) |
| Contract stability / versioning | ✅ (§9.5 backward compatibility) | ❌ | ❌ |
| 6–10. Prototype → eval → analyze → improve loop | ❌ | ❌ | ❌ |

### Verdict

**Partly.** Together the three skills cover Anthropic's *output-hygiene* guidance well:
- non-interactive operation;
- stdout/stderr separation;
- structured output;
- exit codes and actionable errors;
- dry-run and confirmation;
- bounded output with truncation hints.

`cli-agent-readiness-reviewer` does most of the token-efficiency work. Its seventh principle (default limits, narrowing controls, pagination, verbosity modes, and truncation messages that tell the agent how to narrow) is the closest thing to Anthropic's token-efficiency section in any of them.

**What none of them cover:**
1. **Pre-defining chains for real agent tasks.** That means keeping primitives composable, then deciding from evals which multi-step workflows become skill scripts and which become in-process workflow commands (`customers context`, `events schedule`). This is Anthropic's biggest lever, and no skill prompts for that decision.
2. **Meaningful context:** resolving IDs to names and keeping only the IDs needed for chaining.
3. **Field selection as a first-class feature** (`--fields`), and testing alternative output formats.
4. **Schema introspection** (`schema <cmd>`) as progressive disclosure.
5. **The evaluation loop:** realistic multi-step tasks, headless runs, token/call/error metrics, transcript review, held-out sets. (Anthropic's `skill-creator` can eval the *companion skill*, but not the CLI's design.)
6. **Explicit token budgets** (default limits, max output per call).

`nodejs-cli-best-practices` is about good Node CLI engineering in general. Its own reference has no coverage of token efficiency, pagination, field selection, or truncation. It's the right skill for implementation quality, not for agent efficiency.

**Recommendation:** Keep the three skills, and add a small custom skill (for example `cli-agent-efficiency`) that encodes this document:
- Part 1 as a design and review checklist with the before/after patterns, including the chain levels and the promotion rule;
- Part 3 as defaults;
- Part 2 as an eval procedure with a script that runs tasks headlessly and summarizes tokens, calls, exit codes, and success.

That fills the six gaps above and gives your legacy-CLI audit a token-efficiency pass that the other skills don't run.

---

## Sources

- [Anthropic: Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Arcjet: Designing a CLI for AI agents](https://arcjet.com/blog/designing-a-cli-for-ai-agents)
- [Better Stack: Google Workspace CLI, an agent-first interface](https://betterstack.com/community/guides/ai/cli-gws-ai-agents/)
- [Google Workspace CLI README (mirror)](https://github.com/Huglo/cli)
- [gws on awesome-agent-clis (helper commands, exit codes)](https://www.skills.sh/composiohq/awesome-agent-clis/google-workspace-cli-(gws))
- [Rewrite Your CLI for AI Agents](https://understandingdata.com/posts/rewrite-cli-for-agents/)
- [incur (wevm)](https://github.com/wevm/incur) · [incur agent skill summary](https://mcpapp-store.com/skills/wevm-incur/incur)
- [Firecrawl: MCP vs CLI (Scalekit skill-file result)](https://www.firecrawl.dev/blog/mcp-vs-cli)
- [CLI agent-readiness reviewer rubric (compound-engineering derivative)](https://cdn.jsdelivr.net/npm/spec-first@1.13.2/agents/spec-cli-agent-readiness-reviewer.agent.md)
- [Liran Tal: nodejs-cli-best-practices reference](https://tessl.io/registry/lirantal/nodejs-cli-best-practices/files/references/best-practices.md)
- [steipete create-cli](https://github.com/steipete/agent-scripts/blob/main/skills/create-cli/SKILL.md)
- [Olostep: How to turn a CLI into an agent skill](https://www.olostep.com/blog/turn-cli-into-agent-skill)
