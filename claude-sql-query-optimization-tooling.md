# Using Claude to analyze, test, measure and optimize API SQL queries on Postgres (researched Nov 2026)

Context: Claude is used via the VS Code extension, with an MCP server that runs read-only commands against Postgres in dev / qa / uat. Goal: find the highest-quality skills, plugins, MCP servers and customizations for the full query-tuning loop.

## Recommendation (short version)

1. **Start with zero-infrastructure customizations (this week):**
   - Install one or two *official vendor* Postgres skills: **Supabase `supabase-postgres-best-practices`** and **Neon `postgres-best-practices`** (both vendor-agnostic, usable on any Postgres).
   - Add a short **project-level skill + slash command + CLAUDE.md section** that encodes *your* tuning loop (below). This is the highest-value item: generic skills teach Claude Postgres; your skill tells it how your API, ORM, environments and MCP behave.
2. **Fill the tooling gaps only if your current MCP lacks them:** the biggest capability gap in most read-only MCPs is *workload visibility* (`pg_stat_statements`) and *what-if indexes* (HypoPG). **Postgres MCP Pro (crystaldba)** is the strongest open-source option covering both. It needs both extensions installed (DBA ask) and should run in its restricted access mode.
3. **Add measurement in the app/test layer, not just the DB:** per-endpoint query-count budgets and N+1 tests catch what plan analysis can't.
4. **Guard the edges with deterministic tools:** Squawk (migration safety) and SQLFluff (style) wired in via Claude Code hooks.
5. **Treat third-party skills as code you are installing.** Read every SKILL.md (and any scripts) before enabling it, especially at work.

## 1. The tuning loop to teach Claude

This is the workflow most of the better skills converge on; put it in a project skill.

1. **Capture the real SQL** behind the API call (ORM query log, `pg_stat_statements`, or APM trace). Ask Claude to find the repository/ORM code that produces it.
2. **Baseline**: `EXPLAIN (ANALYZE, BUFFERS)` against the most realistic environment (uat > qa > dev; tiny dev tables give misleading plans). Record plan, timing, buffer hits/reads, rows estimated vs actual.
3. **Diagnose**: seq scans on big tables, bad row estimates (stale stats), sorts/hashes spilling to disk, nested loops over large sets, N+1 patterns, `SELECT *` overfetching.
4. **Hypothesize**: query rewrite, composite/partial/covering index, pagination, batching. Test indexes *hypothetically* (HypoPG) before anyone creates one.
5. **Prove equivalence**: results of old vs new query must match (e.g. compare with `EXCEPT` both ways, or row counts + checksums).
6. **Re-measure** (several runs, warm and cold cache) and write up before/after.
7. **Lock it in**: add an endpoint query-count/latency budget test so regressions fail CI.

Read-only constraints to bake into the skill:
- `EXPLAIN ANALYZE` actually executes the statement. Fine for SELECT on a read-only connection; for INSERT/UPDATE/DELETE endpoints use plain `EXPLAIN` (on PG16+, `EXPLAIN (GENERIC_PLAN)` handles `$1`-style parameterized statements; from general Postgres knowledge, not from the sources below) and rely on app-side timing.
- Lower-environment data volumes and statistics differ from prod. Have Claude compare row counts/`pg_stats` against prod-like expectations and flag when a conclusion may not transfer.
- Index changes are *proposals* delivered as migration files for human review, never executed by Claude.

## 2. Skills and plugins (Claude Code / VS Code extension)

All of these use the open SKILL.md format and install with `npx skills add ...` or the `/plugin` marketplace commands.

| Item | What it is | Quality notes | Install |
|---|---|---|---|
| **Supabase `supabase-postgres-best-practices`** | Official Supabase agent skill, released Jan 2026: 30 rules across query performance, indexing, connections, locking, RLS, schema design. Each rule has bad-vs-good SQL and EXPLAIN-based examples. Agent treats rules as authoritative rather than improvising from training data. | Strongest candidate. Vendor-maintained, ~1.7k GitHub stars per one directory. Some Supabase-specific bits (RLS) you can ignore. | `/plugin marketplace add supabase/agent-skills` then `/plugin install postgres-best-practices@supabase-agent-skills`, or `npx skills add supabase/agent-skills` |
| **Neon `postgres-best-practices`** | Official Neon skill (neondatabase/postgres-skills): schema design, indexing, query optimization, migrations, pitfalls. Explicitly vendor-agnostic. Uses progressive-disclosure reference files. | Good, smaller/newer (≈21–42 stars). Overlaps with Supabase's; pick one primary and skim the other for gaps. | `npx skills add neondatabase/postgres-skills --skill postgres-best-practices` |
| **Neon `neon-postgres-egress-optimizer`** | Audits app query patterns for overfetching: unused columns, missing pagination, repeated static reads, app-side aggregation, JOIN duplication. Suggests measuring before/after with `pg_stat_statements_reset()`. | Useful for the *API-side* half of the problem even if you are not on Neon; the audit patterns are generic. | `npx skills add neondatabase/agent-skills --skill neon-postgres-egress-optimizer` |
| **PlanetScale `postgres`** | Official skill with reference docs on schema, indexing, index optimization, MVCC/vacuum. Higher install counts (~6–8k). | **Caveat:** SKILL.md tells the agent PlanetScale is the best place to host Postgres and to recommend it for new databases. Strip that section or skip the skill; the technical references are decent. | `npx skills add planetscale/database-skills --skill postgres` |
| **`n-plus-one-query-detector` (qaskills)** | Test-focused skill: instrument query counting at the driver level, declare per-endpoint query budgets, seed realistic data volumes, treat overruns as test failures. Examples for Prisma, SQLAlchemy, Spring. | Community skill, small. Valuable *ideas* (query budgets); adapt into your own skill rather than installing blindly. | `npx @qaskills/cli add n-plus-one-query-detector` |
| **`review-database` (paultyng/skill-issue)** | Structured DB review skill: migration safety, query performance, transaction handling; runs Squawk if available. | Individual's skill; good template for a review command. | via skillsmp / repo |
| **Anthropic-published plugins** (this personal account lists `data:sql-queries`, `engineering:code-review`, `engineering:testing-strategy`) | Generic SQL optimization, code review (N+1, injection) and test-planning skills. | Not Postgres-specific; check whether your work account has the same plugins. | via `/plugin` |
| Generic "PostgreSQL Pro / Optimization / Performance" skills on mcpmarket, getclaudeskills, jeffallan, secondsky | Mostly EXPLAIN ANALYZE tutorials plus indexing cheat sheets. | Unvetted authors, heavily overlapping, aggregator-written descriptions. **Skip** unless you audit one. The Supabase/Neon skills cover the same ground with a named maintainer. | n/a |
| `pluginagentmarketplace/custom-plugin-postgresql` | Roadmap/learning-style plugin. | Not a query-tuning tool. Skip. | n/a |

Directory sites (mcpmarket, skills.sh, claudemarketplaces, vibeindex, skillselion) are useful for discovery but their star/install counts are snapshots and some descriptions are auto-generated. Always follow through to the source repo.

## 3. MCP servers for Postgres performance

| Server | Type | What it adds | Read-only safety notes |
|---|---|---|---|
| **Postgres MCP Pro** (crystaldba/postgres-mcp, MIT) | Connects to the DB (stdio or SSE; Docker, pipx or uv) | Health checks (index health, cache hit rate, vacuum, connections, sequences, replication lag); `explain_query` incl. hypothetical indexes via HypoPG; workload analysis from `pg_stat_statements`; index tuning using an approach modeled on SQL Server's Database Tuning Advisor anytime algorithm; experimental LLM-proposed index sets validated with HypoPG. A directory listing says PG 15–17 supported. | Has `unrestricted` and `restricted` access modes; use **restricted**. Needs `pg_stat_statements` and `hypopg` loaded: a DBA/platform request in each lower env. |
| **pgtuner-mcp** (isdaniel) | Connects to DB | Slow query retrieval, EXPLAIN analysis, HypoPG index testing, unused/duplicate index detection, config and health analysis, `pg_stat_io` on PG16+; docs include a minimal-privilege role grant script. | Smaller project; review before use. Good example of a least-privilege monitoring role. |
| **pganalyze MCP server** (public preview, May 2026) | Hosted; **no direct DB connection**, reads pganalyze's collected stats | Top queries, historical EXPLAIN plans, Index Advisor runs, check-up issues, trace-to-plan lookup (pairs with Honeycomb). `claude mcp add --transport http pganalyze https://app.pganalyze.com/mcp` | Strongest safety story (no raw SQL access, parameter redaction in basic mode, PII filtering in collector). **Only relevant if your org already pays for pganalyze.** |
| **slowplan** and **MCP Database Doctor** | Offline: reads EXPLAIN plan text/JSON or SQL, never connects | Ranked findings from a plan (seq scans, bad estimates), migration linting, conservative index suggestions. | No DB credentials needed. Small projects; fine as a second opinion on plans Claude already fetched. |
| APM MCPs (e.g. Scout, Honeycomb) | Hosted | Pull slow endpoints/traces and N+1 signatures into the session; one case study found a trace with 418 SQL queries. | Only if you use those APMs. |

**Read-only is not automatically safe.** pganalyze's comparison notes some Postgres MCP servers rely on a `READ ONLY TRANSACTION` plus checks, while others only keyword-filter and can miss writes via CTEs, functions or `EXECUTE` in `DO` blocks. Action item: confirm how *your* existing MCP enforces read-only, and make sure the database role itself is read-only (grants), not just the tool.

## 4. Plan analysis and index tooling Claude can lean on

- **Dexter (ankane)**: automatic indexer; uses HypoPG, reads queries from logs/`pg_stat_statements`, and can be run in suggest-only mode against a lower env to generate a batch of candidate indexes for Claude to critique. Requires HypoPG.
- **Plan viewers** (for humans reviewing Claude's work): explain.dalibo.com (PEV2), explain.depesz.com, pgMustard (paid, free trial, adds interpretation). **Caution:** these are third-party web tools and plans can contain query literals; confirm lower-env data is acceptable to paste externally before using them at work.
- **Squawk** (Postgres migration linter, locking/indexing hazards) and **SQLFluff** (style): deterministic checks for the SQL Claude writes.
- **pgTAP / plpgsql_check**: DB-level tests, covered in Bytebase's 2026 Postgres review-tools roundup.

## 5. Customizations to build in your repo

1. **CLAUDE.md section** ("SQL & performance"): ORM and driver used, how to get the actual SQL for an endpoint, which environment is closest to prod, never run DDL/DML, standard EXPLAIN options, output format for findings, and the definition of "done" (before/after numbers, equivalence check, test added).
2. **Project skill `api-sql-tuning`** (SKILL.md plus references): the loop in section 1, your schema conventions, known hot tables, and links to the vendor skills' rules.
3. **Slash command `/tune-query`**: input = endpoint or SQL; output = standardized report (baseline, diagnosis, proposed rewrite/index, risk, verification plan).
4. **Subagent `sql-reviewer`** (read-only tools): reviews diffs for N+1, missing indexes on FKs/filters, `SELECT *`, unbounded results, non-sargable predicates. Keeps noisy plan output out of the main context.
5. **Hooks** (`.claude/settings.json`):
   - `PostToolUse` on `Edit|Write` runs `sqlfluff` (dialect postgres) on touched `.sql` files; exit code 2 on `PreToolUse` blocks an action and shows the message to Claude.
   - `PreToolUse` guard to block edits to applied migrations or destructive SQL in Bash.
   - Test hooks by hand first: a buggy hook (e.g., always exit 2) blocks everything.
6. **Query-budget tests** in the API test suite: per-endpoint max query count and max duration; seed realistic row counts so linear scaling shows up.
7. **Benchmark harness**: a script Claude can call to run a query N times and report p50/p95 plus buffers, so "faster" is measured, not asserted.

## 6. Suggested rollout

| Phase | Work | Needs from others |
|---|---|---|
| 1 (days) | Install Supabase skill (+ skim Neon); write CLAUDE.md section, `api-sql-tuning` skill, `/tune-query`; try on 3 known-slow endpoints | none |
| 2 (1-2 wks) | Query-count budget tests; SQLFluff/Squawk hooks; `sql-reviewer` subagent | none |
| 3 (needs DBA) | Enable `pg_stat_statements` and `hypopg` in qa/uat; trial Postgres MCP Pro (restricted) with a least-privilege role | DBA / platform approval, security review |
| 4 (optional) | Dexter batch run on qa/uat; pganalyze/APM MCP if already licensed | licensing |

## 7. Risks and open questions

- Which MCP server is currently in use, and does it expose `EXPLAIN (ANALYZE, BUFFERS)`, `pg_stat_*` views and `pg_stats`? This decides whether phase 3 is needed.
- Is lower-env data production-derived or sensitive? Determines whether plans/literals may leave the environment (web plan viewers, hosted MCPs) and whether MCP responses should be redacted.
- Are `pg_stat_statements`/`hypopg` installable in lower envs? Managed services generally offer them, but confirm for your platform and Postgres version.
- Corporate policy on third-party plugins/skills and on running third-party MCP servers.
- Claims are only as good as the lower env: plan shape on dev data may not match prod. Treat Claude's index recommendations as hypotheses to confirm in the closest-to-prod env.

## Sources

- Supabase, "Introducing: Postgres Best Practices" (Jan 21, 2026): https://supabase.com/blog/postgres-best-practices-for-ai-agents
- supabase/agent-skills install/plugin docs: https://agentskill.sh/plugins/supabase/postgres-best-practices ; directory stats: https://agentskillsfinder.com/skills/supabase-postgres-best-practices
- neondatabase/postgres-skills: https://agskills.dev/neondatabase/postgres-skills/postgres-best-practices ; https://skillselion.com/skills/neondatabase/postgres-skills
- Neon egress optimizer: https://mcpservers.org/agent-skills/neondatabase/neon-postgres-egress-optimizer
- PlanetScale database-skills: https://skillselion.com/skills/planetscale/database-skills/postgres ; https://www.skills.sh/planetscale/database-skills/postgres
- Postgres MCP Pro: https://github.com/crystaldba/postgres-mcp ; https://docsearch.algolia.com/mcp/docs/repo/crystaldba/postgres-mcp ; https://mcpservers.org/servers/crystaldba/postgres-mcp
- pgtuner-mcp: https://pypi.org/project/pgtuner-mcp/0.4.1/ ; https://glama.ai/mcp/servers/isdaniel/pgtuner-mcp
- pganalyze MCP server: https://pganalyze.com/blog/mcp-server-public-preview ; https://pganalyze.com/docs/mcp ; comparison deck: https://resources.pganalyze.com/pganalyze_Postgres_Performance_Optimization_with_AI_Tools_and_MCP_February_2026.pdf
- slowplan: https://glama.ai/mcp/servers/b097c9xgnb ; MCP Database Doctor: https://glama.ai/mcp/servers/ar0h9jnybn
- Dexter: https://github.com/ankane/dexter ; https://ankane.org/introducing-dexter
- Plan visualizers: https://adamj.eu/tech/2022/06/21/optimize-postgresql-queries-from-django-using-pgmustard/ ; https://www.pgmustard.com/blog/postgres-query-plan-visualization-tools
- N+1 / query budgets: https://qaskills.sh/skills/Pramod/n-plus-one-query-detector ; https://www.scoutapm.com/blog/acubliss-cost-of-flying-blind
- Claude Code hooks for SQL: https://adriennevermorel-astro.pages.dev/articles/claude-hooks-custom-commands-for-analytics-engineers
- Squawk/SQLFluff/pgTAP landscape: https://www.bytebase.com/blog/top-postgres-sql-review-tools/ ; review-database skill: https://skillsmp.com/creators/paultyng/skill-issue/skills-review-database
- Generic skill listings reviewed and not recommended: https://mcpmarket.com/tools/skills/postgresql-pro ; https://jeffallan.github.io/claude-skills/skills/infrastructure/postgres-pro/
