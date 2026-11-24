# Checklist with before/after patterns

Each item gives Anthropic's tool guidance, its CLI translation, and an example. `acme` is a hypothetical CLI.

## 1. Search over list-all
Agents have limited context, so filter in the CLI.
```bash
# Before: dumps 4,000 rows; the agent greps them in context
acme contacts list
# After
acme contacts search "dana" --limit 5
acme contacts list --filter company=globex --limit 20
```
Real example: `gh issue list` defaults to 30 results, with `--search`, `--label`, and `--limit`.

## 2. Pre-defined chains
```bash
# Before: 3 calls, 3 outputs in context, IDs copied by hand
acme customers get --id 8812
acme transactions list --customer 8812
acme notes list --customer 8812
# After (L3 workflow command, or an L2b skill script that runs the same steps in one Bash call)
acme customers context 8812 --format concise
```

| Level | Context cost | Best for |
|---|---|---|
| L1 ad hoc | Reasoning and `--help` lookups each time; retries | Rare tasks |
| L2a recipe in SKILL.md | Each step's output enters context; drift possible | Medium-frequency, read-only |
| L2b script in skill `scripts/` | Only final output | Workflows still evolving; no CLI release needed |
| L3 workflow command | One call, one compact result; logic in code | Stable, frequent, mutating, or logic-heavy; also used by humans or CI |

To build an L3 workflow command in Node:
- put the primitives in a core layer of plain functions (no `console.log`, `process.exit`, or prompts);
- make primitive and workflow commands thin wrappers over that layer;
- compose in-process, never by shelling out to your own binary.

Workflow command rules:
- name it by outcome;
- reuse the primitives' flag names;
- `--dry-run` prints the plan;
- make it idempotent or resumable;
- errors name the failed step and what state was left behind;
- return a concise result plus the follow-up IDs.

Real example: Google Workspace CLI (`gws`) keeps the raw API as primitives, plus "+" helpers like `gws gmail +send` and `gws calendar +agenda`.

## 3. Distinct commands
Hide legacy aliases (Commander: `{ hidden: true }`, `.alias()`) and deprecate them, so `deploy`/`release`/`ship` don't all appear in help.

## 4. Namespacing
`acme projects search`, `acme users search`, `acme deploys list --env prod`. Use one ordering everywhere.

## 5. Meaningful context
```jsonc
// Before
{"id":"c3f1e9a2-...","owner_id":"77ab...","mime":"application/vnd.acme.report+json","created":1732406400,"etag":"W/\"a81\""}
// After (concise default)
{"id":"rpt_42","name":"Q4 churn","owner":"Dana Reyes","type":"report","created":"2026-11-24"}
```
Arcjet uses readable typed ID prefixes (`site_…`) and rejects bare UUIDs.

## 6. Response format
```bash
acme threads list --channel eng                       # concise
acme threads list --channel eng --format detailed     # adds IDs for follow-ups
acme threads list --channel eng --fields ts,author,text
acme deploys list --format tsv                        # no repeated keys
```
Anthropic's concise mode used about a third of the tokens of the detailed one. `gh --json a,b --jq` is the canonical field-selection example.

## 7. Bounding
```jsonc
{"ok":true,"data":[ /* 20 items */ ],"meta":{"returned":20,"total":1384,"next_cursor":"c_9f2"}}
```
```bash
acme deploys list --cursor c_9f2
acme logs search "timeout" --since 1h --tail 50
acme export orders --since 2026-11-01 --out /tmp/orders.ndjson   # prints {path, rows, bytes}
```
Claude Code caps a tool result at 25K tokens by default, so stay well under that.

## 8. Truncation with guidance
```jsonc
{"ok":true,"data":[ /* 50 lines */ ],
 "meta":{"truncated":true,"shown":50,"matched":9120,
         "hint":"Narrow with --since 15m or --service api; page with --cursor c_77."}}
```

## 9. Actionable errors
```text
# Before (exit 1)
TypeError: Cannot read properties of undefined (reading 'split') at parseSite (...cli.js:812:19)
# After (exit 3)
{"ok":false,"code":"E_VALIDATION","error":"--site must be a site ID",
 "remediation":"Use the site_ prefix, e.g. --site site_01h9x...; list IDs with: acme sites list --fields id,name",
 "retryable":false}
```

## 10. No waste off-TTY
Spinner frames and ANSI codes are pure token waste when piped. Send progress to stderr, and only on a TTY. Mutations print only `{id, status, url}`.

## 11. Help as onboarding
```text
Search log lines across services. Prefer this over 'acme logs read' (which streams everything).
Usage: acme logs search <query> [--since <dur>] [--service <name>] [--context <n>] [--limit <n>]
Query syntax: words are ANDed; "quoted phrase"; field:value (service:api level:error).
Output: matching lines with context; concise by default. Defaults: --since 1h --limit 20 --context 2
Examples:
  acme logs search 'level:error "charge failed"' --since 24h
  acme logs search 'customer:cus_88' --service billing --limit 50
```

## 12. Schema on demand
`acme schema events.create` prints the JSON Schema (generated from Zod with `z.toJSONSchema()`). Never print schemas by default.

## 13. Unambiguous names
```bash
acme users get --user-id usr_12          # not --user 12
acme events create --json @event.json    # validated against: acme schema events.create
```

## 14. Explicit side effects
```jsonc
// acme env delete staging   (no --confirm) → exit 4
{"status":"confirmation_required",
 "changes":[{"action":"delete","resource":"env","name":"staging","services":7}],
 "confirmCommand":"acme env delete staging --confirm"}
```

## 15. Fast startup
Lazy `import()` per subcommand; avoid heavy top-level imports. Aim for under 100 ms to first output.

## 16. Contract stability
After 1.0, changes are additive only. Emit `meta.warnings: [{code:"W_DEPRECATED_FLAG", flag:"--user", use:"--user-id", removal:"2.0"}]` and the same warning on stderr. Bump `schema_version` when an output shape changes.

Sources: Anthropic, "Writing effective tools for agents — with agents"; Arcjet, "Designing a CLI for AI agents"; Google Workspace CLI; GitHub CLI; clig.dev.
