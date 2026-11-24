---
name: cli-agent-efficiency
description: Design, review, or evaluate a CLI for token efficiency when Claude and other agents run it, using Anthropic's "Writing effective tools for agents" guidance translated to CLIs. Use when asked to make a CLI more efficient or agent-friendly, cut tokens or calls an agent spends using a CLI, review a CLI spec or command group for agent efficiency, decide which multi-step chains to pre-define, or run token/accuracy evals of a CLI with Claude.
allowed-tools: Read, Grep, Glob, Bash
---

# CLI agent efficiency

The goal is **fewer tokens and tool calls per task without lowering task success**. Always weigh both. Never trade accuracy for brevity.

A CLI command is effectively an agent tool:

| Tool concept | CLI equivalent |
|---|---|
| Description | `--help` text, plus the companion `SKILL.md` |
| Input schema | Flags with validated types; `--json` payload; `<cli> schema <cmd>` |
| Result | stdout (JSON envelope when piped) |
| Error | Exit code + structured error on stderr with remediation |

## Modes

Pick the mode from the request. If it's unclear, ask once.

- **design:** a new CLI or a spec. Apply the checklist to the plan and output a revised spec plus open decisions.
- **review:** existing code, a command group, or a built binary. Output findings (format below). Don't edit code unless asked.
- **eval:** measure real agent usage. Follow the eval procedure and `scripts/run-evals.mjs`.

In review mode, also run any linters that are installed, and fold their results in: `cli-agent-lint check <bin>` (github.com/Camil-H/cli-agent-lint) or `anc check .` (agentnative).

## Checklist

Full before/after patterns are in `references/checklist.md`. Read it for design or review work.

1. **Search over list-all:** the default read path filters inside the CLI. Every list or search has a small default `--limit`.
2. **Pre-defined chains:** keep primitives composable, then put frequent multi-step jobs in front of the agent so it never works out the chain itself. Decide the level for each workflow:
   - **L1 ad hoc:** Claude composes the chain itself; rare tasks only.
   - **L2a skill recipe:** exact commands written in `SKILL.md`.
   - **L2b skill script:** one Bash call; only the final output enters context.
   - **L3 workflow command:** in the CLI, composed in-process from core functions, never by shelling out to itself.

   Start at L2b. Promote to L3 when the workflow is stable and frequent, mutating, logic-heavy, or also used by humans or CI.
3. **Distinct commands:** no overlapping commands. Legacy aliases are hidden and deprecated.
4. **Namespacing:** one consistent `<cli> <resource> <verb>` shape.
5. **Meaningful context:** human-readable fields first. Resolve foreign keys to names. Keep only the IDs the next command needs.
6. **Response format:** concise by default when piped, with `--format detailed` and `--fields a,b,c`. Evaluate TSV, NDJSON, or compact formats against JSON for long tabular output.
7. **Bounding:**
   - cursor pagination in `meta`;
   - range flags (`--since`, `--tail`);
   - server-side filters;
   - a stdout budget;
   - `--out <file>` for big results (print the path plus a summary).
8. **Truncation with guidance:** when output is cut, `meta.hint` names the exact narrowing or paging flag.
9. **Actionable errors:**
   - a stable `code`, a distinct exit code, one-sentence cause, and `remediation` with a corrected example;
   - no stack trace without `--debug`;
   - validate before side effects;
   - unknown flags fail hard, with no fuzzy "did you mean".
10. **No waste off-TTY:** no spinners, colors, banners, tips, or update notices on stdout when piped. Mutations print only the ID, status, and URL.
11. **Help as onboarding:** purpose, when to use it vs its siblings, query syntax, ID meaning, output shape, side effects, 2–3 examples. Under ~60 lines. Long material goes behind `help <topic>`.
12. **Schema on demand:** `<cli> schema <cmd>` returns JSON Schema only when asked.
13. **Unambiguous names:** `--user-id`, not `--user`. Strict validation; complex input as one validated `--json` payload.
14. **Explicit side effects:**
    - `--dry-run` shows the exact changes;
    - mutations require `--confirm`, otherwise exit 4 with `{status:"confirmation_required", changes, confirmCommand}`;
    - untrusted text in output is marked as untrusted.
15. **Fast startup:** lazy-load subcommands.
16. **Contract stability:** additive changes only; `schema_version` in the envelope; deprecations in `meta.warnings` and on stderr.

## Default budgets

Use these unless the project has its own:

| Setting | Default |
|---|---|
| List/search limit | 20 (max 100 per page) |
| Piped output | Concise JSON envelope `{ok, data, meta}` |
| Max stdout per call | ~10–20K tokens; beyond that, truncate with a hint or require `--out` |
| Mutation output | id, status, url |
| Help per command | Under ~60 lines |
| Errors | `{code, error, remediation, retryable}` + exit code (0 ok, 1 general, 2 auth, 3 validation, 4 confirmation required) |
| Progress/decoration | stderr, TTY only |
| Schemas | On demand only |

## Review output format

```markdown
# <cli or group>: agent efficiency review
## Summary
Top 5 changes by estimated token/call savings, with accuracy risk noted.
## Findings
| ID | Checklist # | Severity (blocker/high/med/low) | file:line or command | Finding | Fix (before → after) | Est. effect (tokens/calls) |
## Chain decisions
| Workflow | Current level | Recommended level | Reason |
## Looks inefficient but is fine
## Open questions
```

Every finding cites `file:line`, a command invocation, or captured output. Estimate effects from real output sizes. Run the command against dev/QA data when it's safe and read-only. Otherwise mark the estimate as a guess.

## Eval procedure

Use this when asked to measure, or before and after a set of changes.

1. **Tasks:**
   - Write 10–30 realistic, multi-step tasks in a tasks JSON file (see `scripts/tasks.example.json`). Each has a `prompt` and a `verify` shell command that exits 0 on success.
   - Use dev/QA environments only.
   - Hold back ~30% as a held-out set (`"heldOut": true`) that you never tune against.
2. **Run:** `node scripts/run-evals.mjs --tasks tasks.json --allow "Bash(<cli>:*)" --runs 3`. This runs each task headlessly with Claude Code (`claude -p`), with only the CLI allowed, then runs `verify`. It writes `eval-results/<timestamp>.json` and prints a summary: pass rate, turns, tool calls, tool errors, tokens, cost, and wall time.
3. **Read transcripts,** not just the scores. Raw stream output is saved per run. Map symptoms to fixes:

| Symptom | Fix |
|---|---|
| Same list run repeatedly with growing `--limit` | Better default + cursor + truncation hint |
| Output piped to `jq`/`grep` for one field | `--fields` or a search command |
| Repeated exit 3 on the same flag | Rename it, add a help example, mention it in the skill |
| `--help` called every task | Move the essentials into `SKILL.md` |
| 3+ commands chained, passing IDs by hand | Pre-define the chain (L2b, then L3) |
| Huge stdout, then truncation | Output budget + `--out` + hint |
| Invented flags | Fail hard on unknown flags, and list the valid ones in the error |

4. **Change, then re-run** the full set. Accept a change only if held-out pass rate holds or improves while tokens or calls drop. Keep `--help` and JSON snapshot tests so improvements don't silently break the contract.

## Related skills (optional, install separately)

- `create-cli`, from github.com/steipete/agent-scripts: CLI surface spec.
- `nodejs-cli-best-practices`, from Liran Tal on the tessl registry: Node implementation quality.
- `cli-agent-readiness-reviewer`: the last MIT version of Every's removed reviewer, which scores the 7 agent-readiness principles.

This skill adds what those don't cover:
- deciding which chains to pre-define;
- meaningful context and field selection;
- schema on demand;
- explicit token budgets;
- the eval loop.
