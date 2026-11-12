# Setup guide: Claude for analyzing, measuring and optimizing API SQL (Postgres)

*Companion to `claude-sql-query-optimization-tooling.md` (the research and rationale). This file is the **hands-on setup**. It's written so you can hand it straight to Claude Code (VS Code extension) in a work repo. Researched November 2026; install commands checked against vendor docs that month.*

---

## How to use this document

1. Copy this file into the API repo, for example at `docs/claude-sql-tuning-setup-guide.md`. Don't commit it until you're happy with it.
2. Open the repo in VS Code, open the Claude panel, and paste:

   > Read `docs/claude-sql-tuning-setup-guide.md`. Follow the "Instructions for Claude" section. Start with Phase 0 and stop after each phase so I can review.

3. Phases 0–4 need no one else's approval. Phase 5 needs a DBA or platform ticket. Phase 6 is optional.

---

## Instructions for Claude (read first)

You are setting up a query-tuning workflow for this repository. Ground rules:

- **Never write to any database.** Use only the existing read-only Postgres MCP server. Never run DDL or DML, even in dev. Index changes and other fixes are delivered as **migration files or code diffs for human review**.
- **Ask before installing anything** (skills, plugins, packages, MCP servers). Show the exact command and what it will touch. After installing a third-party skill, **open its SKILL.md and any scripts and summarize them for the user** before using it.
- **Don't commit or push** unless the user asks.
- If a step doesn't fit this repo (different ORM, language, test framework), adapt it and say what you changed.
- Wherever this guide shows `<PLACEHOLDER>`, fill it in from Phase 0 findings or ask the user.
- Finish each phase with a short checklist of what was done and what's pending.

---

## Phase 0: Discovery (about 15 minutes, read-only)

Goal: learn what the existing MCP can do and how the app produces SQL. Later phases depend on this.

### 0.1 Inventory the MCP server

- Run `claude mcp list` in the VS Code integrated terminal, or `/mcp` in the Claude panel. Record the Postgres server's **name** (tool names look like `mcp__<server>__<tool>`) and its tools.
- Note the configured environments (dev, qa, uat) and how you switch between them (separate servers? a parameter?).

### 0.2 Probe capabilities: run each query in **every** environment

```sql
-- version and role
SELECT version(), current_user, current_database();

-- is the session actually read-only? (should be 'on')
SHOW transaction_read_only;
SHOW default_transaction_read_only;

-- role privileges: anything beyond SELECT is a red flag to report
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb
FROM pg_roles WHERE rolname = current_user;
SELECT r.rolname AS member_of
FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user);

-- installed extensions
SELECT extname, extversion FROM pg_extension ORDER BY 1;

-- is pg_stat_statements usable and is query text visible?
SELECT count(*) FROM pg_stat_statements;
SELECT query FROM pg_stat_statements LIMIT 1;  -- '<insufficient privilege>' means the role lacks pg_read_all_stats

-- can we read planner statistics?
SELECT count(*) FROM pg_stats WHERE schemaname NOT IN ('pg_catalog','information_schema');

-- relative data volume, to judge how realistic each environment is
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15;
```

Then test plan access with a harmless query:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT 1;
```

Optionally check whether HypoPG is available, if Phase 5 hasn't happened yet: `SELECT * FROM pg_available_extensions WHERE name IN ('hypopg','pg_stat_statements');`

**Ask the user how the MCP enforces read-only** (database role grants, read-only transactions, or just keyword filtering). Keyword filtering alone can miss writes hidden in CTEs or functions, so the role itself should be read-only.

### 0.3 Discover the application side

Find and record:
- Language, framework, ORM or query builder, and DB driver.
- How to make the app **log its actual SQL with parameters** (ORM debug or logging setting). Write down the exact config or env var.
- Where SQL lives: repository/DAO layer, raw `.sql` files, migrations directory, migration tool.
- Test framework, and whether integration tests run against a real Postgres (Testcontainers, docker-compose, shared dev DB).

### 0.4 Output

Write findings to `docs/sql-tuning-context.md` with this structure: MCP server name and tools · per-environment capability table (read-only? pg_stat_statements? query text visible? HypoPG? rough size of top tables) · which environment is closest to prod · ORM, logging switch, migrations path, test setup · gaps found. **Stop and show the user.**

---

## Phase 1: Install vendor Postgres skills (about 10 minutes)

The CLI and the VS Code extension read the same `~/.claude` and `.claude/` configuration. If a `/plugin` command isn't available in the panel, run `claude` in the integrated terminal and do it there.

### 1.1 Supabase `postgres-best-practices` (primary)

Official, vendor-agnostic: 30 rules across 8 categories, with query performance and connection management rated critical.

Option A, plugin (recommended: easy to update or remove). Inside Claude:
```
/plugin marketplace add supabase/agent-skills
/plugin install postgres-best-practices@supabase-agent-skills
```

Option B, skills CLI (needs Node/npx):
```bash
npx skills add supabase/agent-skills
```

Ignore the Supabase-specific RLS and Supabase-product guidance. Everything else applies to any Postgres.

### 1.2 Neon `postgres-best-practices` (secondary, optional)

```bash
npx -y skills add neondatabase/postgres-skills --skill postgres-best-practices --agent claude-code
```

> ⚠️ Pass `--agent claude-code`. One directory notes that the `skills` CLI may otherwise install to `.agents/skills/`, which Claude Code might not pick up. Alternatively, copy the skill folder by hand into `.claude/skills/` (this project) or `~/.claude/skills/` (personal). Note that two skills with the same name, `postgres-best-practices`, will collide. If you install both, rename the Neon folder, for example to `neon-postgres-best-practices`, and update the `name:` in its frontmatter.

### 1.3 Neon `neon-postgres-egress-optimizer` (optional, API overfetching audit)

Useful for the "API returns too much data" half of the problem: unused columns, missing pagination, app-side aggregation. Not Neon-specific in practice.
```bash
npx -y skills add neondatabase/agent-skills --skill neon-postgres-egress-optimizer --agent claude-code
```

### 1.4 Not recommended without auditing

- **PlanetScale `postgres` skill**: decent references, but its SKILL.md tells the agent to recommend PlanetScale for hosting. Skip it, or delete that section after install.
- Generic "PostgreSQL Pro / Optimizer" skills on directory sites: unvetted and overlapping. Skip.

### 1.5 Verify

- `/plugin` or `/skills` (or type `/` in the panel) shows the new skills.
- Ask Claude: *"Which Postgres skills are loaded, and what does each cover?"*
- **Claude: open each installed SKILL.md and its reference files and give the user a 5-line summary of each, flagging anything that tells you to run commands, fetch URLs, or recommend products.**

---

## Phase 2: Project customizations (about 30–60 minutes)

These files encode *your* workflow. They're the highest-value part of the setup. Create them, fill the placeholders from Phase 0, and commit them so the team gets them too.

```
CLAUDE.md                                   (add a section)
.claude/skills/api-sql-tuning/SKILL.md      (auto-loaded knowledge and workflow)
.claude/skills/tune-query/SKILL.md          (/tune-query slash command)
.claude/agents/sql-reviewer.md              (read-only reviewer subagent)
docs/sql-tuning/                            (reports land here)
```

### 2.1 `CLAUDE.md`: add this section

```markdown
## SQL & database performance

- Postgres access is via the read-only MCP server `<MCP_SERVER_NAME>`. Environments: dev, qa, uat.
  Closest to prod for performance work: `<uat>`. Dev data volumes are small, so dev plans can mislead.
- NEVER run DDL/DML against any database. Deliver index or schema changes as migration files in
  `<MIGRATIONS_PATH>` (tool: `<MIGRATION_TOOL>`) for human review.
- ORM / driver: `<ORM>` / `<DRIVER>`. To log real SQL with params: `<LOGGING_SWITCH>`.
- For query analysis, follow the `api-sql-tuning` skill. Use `/tune-query <endpoint|file|SQL>` for a full report.
- "Done" for a query fix = before/after EXPLAIN numbers + result-equivalence check + a regression test
  (query-count or latency budget) + report saved in `docs/sql-tuning/`.
- Background details: `docs/sql-tuning-context.md`.
```

### 2.2 `.claude/skills/api-sql-tuning/SKILL.md`

```markdown
---
name: api-sql-tuning
description: Workflow and rules for analyzing, measuring and optimizing the SQL behind this API's endpoints on Postgres using the read-only MCP. Use when investigating a slow endpoint or query, reviewing repository/ORM code for performance, proposing indexes, checking N+1 patterns, or reading EXPLAIN plans.
---

# API SQL tuning workflow

Context file: `docs/sql-tuning-context.md` (MCP name, environments, ORM, migrations path). Read it first.
For Postgres rules, defer to the `postgres-best-practices` skill. Treat its rules as authoritative.

## Hard rules
- Read-only. Never execute DDL/DML. Index/schema proposals become migration files for review.
- `EXPLAIN ANALYZE` executes the statement: only use it on SELECTs. For INSERT/UPDATE/DELETE,
  use plain `EXPLAIN` (or `EXPLAIN (GENERIC_PLAN)` on PG16+ for `$1`-style statements; it can't be
  combined with ANALYZE) and measure write cost from app-side timing.
- Keep exploratory queries bounded (LIMIT, narrow filters). Don't scan huge tables just to look.
- State which environment every number came from. Flag when lower-env data volume or distribution
  makes a conclusion unlikely to transfer to prod.

## Steps
1. **Locate**: find the code path for the endpoint (controller → service → repository/ORM) and every
   query it issues, including lazy loads in loops. Count queries per request. Flag N+1s.
2. **Capture real SQL**: from ORM logs, `pg_stat_statements` (match on normalized text), or by
   reconstructing it from the ORM code. Get realistic parameter values from the data. Test BOTH a
   typical value and the worst-case value (e.g. the tenant/customer with the most rows):
   `SELECT <fk>, count(*) FROM <table> GROUP BY 1 ORDER BY 2 DESC LIMIT 5;`
3. **Baseline**: in the closest-to-prod env, run
   `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT TEXT) <query>` 5 times.
   Report the median Execution Time and Planning Time, shared hit/read buffers, and rows.
   Note warm vs cold (first run is usually cold).
4. **Diagnose**: check, in order:
   - estimated vs actual rows off by >10x → stale stats or correlated columns (check `pg_stats`,
     `pg_stat_user_tables.last_analyze/last_autoanalyze`)
   - Seq Scan on large tables with selective filters; "Rows Removed by Filter" large
   - Sort/Hash spilling to disk ("external merge", "Batches: >1") → work_mem or a better index
   - Nested Loop with high loops × inner cost
   - non-sargable predicates (functions on columns, implicit casts, leading-wildcard LIKE, OR across columns)
   - OFFSET pagination on deep pages; unbounded result sets; SELECT * / unused columns
   - existing indexes: `SELECT indexdef FROM pg_indexes WHERE tablename = '<t>';` and usage from
     `pg_stat_user_indexes` (idx_scan). Look for duplicates or unused ones too.
5. **Hypothesize**: rank options by impact/risk: query rewrite → ORM fix (eager load, batch, projection)
   → index (composite column order, partial, covering INCLUDE) → schema change.
   If HypoPG is available, test proposed indexes hypothetically:
   `SELECT * FROM hypopg_create_index('CREATE INDEX ON <t> (<cols>)');` then plain `EXPLAIN <query>`
   (not ANALYZE: hypothetical indexes only affect planning), then `SELECT hypopg_reset();`.
   Estimate write/size cost of any new index (table write rate from `pg_stat_user_tables`).
6. **Prove equivalence** for rewrites (both must return 0):
   `SELECT count(*) FROM ((<old>) EXCEPT ALL (<new>)) a;` and the reverse.
   If ORDER BY/LIMIT semantics differ, compare without LIMIT and verify ordering separately.
7. **Re-measure** the rewrite (5 runs, median) with the same parameters. Index proposals can only be
   measured hypothetically until applied in a lower env by a human.
8. **Lock in**: add or extend a query-count/latency budget test for the endpoint (see the testing
   conventions in `docs/sql-tuning-context.md`).
9. **Report**: write `docs/sql-tuning/<yyyy-mm-dd>-<endpoint-slug>.md` using the template below.

## Report template
- Endpoint / query, environment(s), data volume notes
- Queries per request (before → after)
- Baseline: median exec ms, planning ms, buffers (hit/read), key plan nodes
- Diagnosis (ranked)
- Changes proposed: rewrite diff / ORM diff / migration file path
- After: same metrics; equivalence check result
- Risks: write overhead, lock impact of index build (recommend CREATE INDEX CONCURRENTLY), prod transferability
- Test added
```

### 2.3 `.claude/skills/tune-query/SKILL.md`: the `/tune-query` command

```markdown
---
name: tune-query
description: Run the full api-sql-tuning workflow on one endpoint, code file, or SQL statement and produce a report.
argument-hint: "<endpoint path | file path | SQL>"
disable-model-invocation: true
---

Target: $ARGUMENTS

Follow the `api-sql-tuning` skill end to end for this target.
- If the target is an endpoint or file, first list every query it issues and the per-request count.
- Use the closest-to-prod environment from `docs/sql-tuning-context.md`. Say if you had to fall back.
- Do not modify application code yet. Produce the report in `docs/sql-tuning/`, then show me a
  5-line summary and the top recommendation, and ask before implementing anything.
```

### 2.4 `.claude/agents/sql-reviewer.md`: read-only reviewer subagent

Keeps long plan output out of the main conversation. Replace `<MCP_SERVER_NAME>`.

```markdown
---
name: sql-reviewer
description: Reviews diffs or files that touch database access (ORM models, repositories, raw SQL, migrations) for performance and safety problems. Use proactively after changes to data-access code, or when asked to review SQL.
tools: Read, Grep, Glob, mcp__<MCP_SERVER_NAME>__*
model: sonnet
---

You review data-access code for this API against Postgres. You may read code and run read-only
queries/EXPLAIN through the MCP. You never edit files or write to the database.

Check for:
- N+1 queries (lazy relations accessed in loops, per-item repository calls)
- unbounded queries (no LIMIT/pagination), deep OFFSET pagination
- SELECT * or fetching columns/relations the caller doesn't use
- non-sargable WHERE clauses, implicit casts, leading-wildcard LIKE
- filters/joins/ORDER BY on columns with no supporting index (verify with pg_indexes)
- missing indexes on foreign keys used in joins
- migrations: CREATE INDEX without CONCURRENTLY on large tables, table rewrites, long locks,
  NOT NULL/DEFAULT changes on big tables
- transactions held open across network calls

For each finding, give file:line, severity (high/med/low), evidence (plan excerpt or row counts,
with environment), and a concrete fix. End with a short verdict. Be concise. No praise.
```

> If the Phase 5 Postgres MCP Pro server gets added later, add `mcp__<that-server>__*` to `tools` too.

### 2.5 Permissions (optional, reduces approval prompts)

In `.claude/settings.json`, pre-approve only the MCP's read tools you've verified, for example:
```json
{
  "permissions": {
    "allow": ["mcp__<MCP_SERVER_NAME>__<read_tool_name>"]
  }
}
```
Don't blanket-allow tools you haven't confirmed are read-only.

### 2.6 Try it

Run `/tune-query <a known slow endpoint>` on two or three endpoints. Adjust the skill wherever Claude's output misses something or doesn't fit how your team works.

---

## Phase 3: Deterministic guardrails via hooks (about 30 minutes)

Hooks run linters automatically on SQL that Claude writes, and feed failures back to Claude.

### 3.1 Install the linters (ask the user first)

```bash
pip install sqlfluff          # SQL style/lint   (or: pipx install sqlfluff)
npm install -g squawk-cli     # Postgres migration safety linter
brew install jq               # used by the hook script (macOS)
```

Add `.sqlfluff` at the repo root:
```ini
[sqlfluff]
dialect = postgres
# Start lenient; tighten later. Excluding layout rules avoids noise on existing files.
exclude_rules = LT01,LT02,LT05
```

### 3.2 `.claude/hooks/sql-lint.sh`

```bash
#!/usr/bin/env bash
# PostToolUse hook: lint .sql files Claude just edited. Exit 2 = show stderr to Claude.
set -uo pipefail
f=$(jq -r '.tool_input.file_path // empty')
[[ -z "$f" || "$f" != *.sql || ! -f "$f" ]] && exit 0

out=""; rc=0
if command -v sqlfluff >/dev/null; then
  out+=$(sqlfluff lint "$f" --dialect postgres 2>&1) || rc=2
fi
# Run squawk only on migration files. Adjust the path pattern to <MIGRATIONS_PATH>.
if [[ "$f" == *"/migrations/"* ]] && command -v squawk >/dev/null; then
  out+=$'\n'$(squawk "$f" 2>&1) || rc=2
fi
if [[ $rc -ne 0 ]]; then
  echo "SQL lint issues in $f:" >&2; echo "$out" >&2; exit 2
fi
exit 0
```
`chmod +x .claude/hooks/sql-lint.sh`

### 3.3 Register it in `.claude/settings.json`

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/sql-lint.sh" }
        ]
      }
    ]
  }
}
```

### 3.4 Test the hook by hand before relying on it

```bash
echo '{"tool_input":{"file_path":"'"$PWD"'/some/test.sql"}}' | .claude/hooks/sql-lint.sh; echo "exit=$?"
```
A buggy hook that always exits 2 will block every edit. Then run `/hooks` in Claude to confirm it's registered.

> Many ORMs keep SQL inside source files rather than `.sql` files. In that case the hook won't fire, and the `sql-reviewer` subagent is your main guardrail.

---

## Phase 4: Measurement in the test suite (about 1–3 hours)

Plan analysis can't catch everything. Per-endpoint **query-count budgets** catch N+1 regressions in CI. Ask Claude:

> Using `docs/sql-tuning-context.md`, add a reusable test helper that counts SQL statements executed during a block, and add budget tests for our 5 busiest endpoints: max query count, plus a soft latency budget. Seed enough rows (e.g. 50 children per parent) that N+1 patterns show up. Show me the plan first.

Common hooks for counting, by stack (Claude should pick the one that matches):
- **Java / Spring + Hibernate**: Hibernate `Statistics` (`hibernate.generate_statistics=true`) → `getPrepareStatementCount()`; or a datasource-proxy listener.
- **Node**: wrap the `pg` client's `query` method, Prisma `$on('query')`, Knex `on('query')`, TypeORM logger.
- **Python**: SQLAlchemy `event.listen(engine, "before_cursor_execute", ...)`; Django `assertNumQueries`.
- **.NET**: EF Core `DbCommandInterceptor`.

Budget tests must run against real Postgres (Testcontainers or the existing integration DB), not an in-memory substitute.

---

## Phase 5: Workload visibility and what-if indexes (needs DBA)

The biggest gap in most read-only MCPs is finding the slow queries across the whole workload and testing indexes without creating them. That needs two extensions in qa/uat and, optionally, a stronger MCP server.

### 5.1 Ticket for DBA / platform (copy and paste)

> In **qa and uat** Postgres, please:
> 1. Enable `pg_stat_statements`. On self-managed Postgres, add it to `shared_preload_libraries` (needs a restart). Managed services usually expose it as a parameter. Then run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`
> 2. Install `hypopg`: `CREATE EXTENSION IF NOT EXISTS hypopg;` (self-managed may need the OS package first). It creates *hypothetical* indexes that exist only in the session's memory and never touch disk or other sessions.
> 3. Grant our read-only role `<RO_ROLE>` monitoring visibility: `GRANT pg_read_all_stats TO <RO_ROLE>;` (or `pg_monitor`). This lets it see query text in `pg_stat_statements` for all users.
> 4. Confirm the role is read-only at the role level: no write grants, and ideally `ALTER ROLE <RO_ROLE> SET default_transaction_read_only = on;` plus a `statement_timeout` such as `30s`.

### 5.2 Optional: Postgres MCP Pro (crystaldba) in **restricted** mode

Adds `get_top_queries` (from pg_stat_statements), `explain_query` with hypothetical indexes, `analyze_workload_indexes`, `analyze_query_indexes` and `analyze_db_health`. Get security approval for running a third-party MCP server first.

Install (pick one):
```bash
pipx install postgres-mcp            # or: uv pip install postgres-mcp   or: docker pull crystaldba/postgres-mcp
```

Add to Claude Code, one per environment. **Always use `--access-mode=restricted`.** Unrestricted mode allows full read/write. Restricted mode runs read-only transactions with an execution-time limit.
```bash
claude mcp add --transport stdio --env DATABASE_URI="$PG_UAT_RO_URI" pg-uat-pro \
  -- postgres-mcp --access-mode=restricted
```
- Keep the URI in an environment variable or secret manager, never in a committed file. To share via `.mcp.json`, use `${PG_UAT_RO_URI}` expansion so each developer supplies their own.
- Scope: default `local` (just you, this project). Use `--scope project` to write `.mcp.json` for the team.
- Verify with `claude mcp list` and `/mcp`, then ask: *"Using pg-uat-pro, run analyze_db_health and get_top_queries by total time. Summarize the top 10."*

After this, update the `api-sql-tuning` skill: step 2 can start from `get_top_queries`, and step 5 can use `analyze_query_indexes`.

Alternative: **pgtuner-mcp** (smaller project; includes a least-privilege role grant script). Review it before use.

---

## Phase 6: Optional extras

- **Dexter** (automatic indexer, suggest-only): `gem install pgdexter`, then run against qa/uat with `pg_stat_statements` + HypoPG to get candidate indexes. Have Claude critique them. Without `--create` it only suggests.
- **pganalyze MCP**: only if the org already licenses pganalyze. It doesn't connect to the DB directly. `claude mcp add --transport http pganalyze https://app.pganalyze.com/mcp`
- **APM MCPs** (Datadog, Honeycomb, etc.): if available, use them to find slow endpoints and N+1 traces, then feed those into `/tune-query`.
- **Plan viewers** for humans: explain.dalibo.com, explain.depesz.com, pgMustard. These are external sites, so check data policy before pasting plans that contain literal values.

---

## Everyday prompts (once set up)

- `/tune-query GET /api/v1/orders`
- "Use the sql-reviewer agent on my staged changes."
- "Which of our endpoints issue more than 10 queries per request? Check the repository layer and verify the worst three with logs or EXPLAIN."
- "Compare the plan for `<query>` in dev vs uat and explain why they differ."
- "Find unused and duplicate indexes in uat (pg_stat_user_indexes, pg_indexes) and draft a cleanup proposal. Don't create a migration yet."
- "Check stats freshness for the tables behind `<endpoint>`: last analyze, dead tuples, estimate errors."
- (After Phase 5) "Top 10 queries by total time in uat. Map each to the code that issues it."

## Final verification checklist

- [ ] `docs/sql-tuning-context.md` written; MCP confirmed read-only at the **role** level
- [ ] Supabase skill installed and audited; Neon skills installed under non-colliding names (optional)
- [ ] CLAUDE.md section, `api-sql-tuning`, `/tune-query`, `sql-reviewer` created with placeholders filled
- [ ] `/tune-query` tried on 2–3 real endpoints; skill adjusted
- [ ] Hook tested by hand and visible in `/hooks` (if using .sql files)
- [ ] Query-budget tests in CI for top endpoints
- [ ] DBA ticket filed for pg_stat_statements + hypopg + pg_read_all_stats
- [ ] (After DBA) Postgres MCP Pro added in restricted mode; skill updated

## Sources

- Supabase, "Postgres Best Practices for AI agents": https://supabase.com/blog/postgres-best-practices-for-ai-agents
- Neon postgres-skills: https://skillselion.com/skills/neondatabase/postgres-skills/postgres-best-practices · install-path note: https://www.vibeindex.ai/skills/neondatabase/postgres-skills/postgres-best-practices · https://claudemarketplaces.com/skills/neondatabase/postgres-skills/postgres-best-practices
- Postgres MCP Pro: https://github.com/crystaldba/postgres-mcp
- Claude Code docs: MCP https://code.claude.com/docs/en/mcp · Skills https://code.claude.com/docs/en/skills · Subagents https://code.claude.com/docs/en/sub-agents
- Research and rationale for every tool here: `claude-sql-query-optimization-tooling.md`
