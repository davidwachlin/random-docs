# Quality review: existing SQL/Postgres skills for Claude, and how the proposed custom skills were built

*Researched November 12, 2026. Companion to `claude-sql-tuning-setup-guide.md` (setup) and `claude-sql-query-optimization-tooling.md` (original research). Method: the source repos were cloned and the actual SKILL.md and reference files were read, instead of relying on directory blurbs. Repo histories, contributor/AI policies and eval folders were checked. Install counts and third-party security audits were taken from skills.sh. Technical claims in the proposed custom skill were checked against the official PostgreSQL and HypoPG docs.*

## Bottom line

1. **The best-evidenced generic skill for query tuning is Neon's `postgres-best-practices`**, not the more popular Supabase one. It is deeper (13 reference files, ~5,100 lines). It has a human-authorship policy and named expert reviewers (including a PostgreSQL Core Team member). Its examples are version-tagged for PG14–18, and its commit history shows integration testing on PG 14 and 17. Supabase's skill is still worth installing as a short, rule-style complement.
2. **Only one skill in this space has published with/without-skill evals: Neon's egress-optimization guidance.** It measured real gains on API overfetching problems. It has since been retired as a standalone skill and folded into the Neon-specific `neon-postgres` skill, so the setup guide's old install command no longer works.
3. **Popularity and "security audit: Pass" say little about technical quality.** Install counts are inflated by bundled installs. The audits check for credential leaks and malicious patterns, not correctness.
4. **The custom skills I proposed (`api-sql-tuning`, `/tune-query`, `sql-reviewer`) were written by me from general Postgres knowledge plus the earlier research.** They were not derived from the vendor skills' content, which I hadn't read at the time. Checking them against the official docs found **one real bug** (HypoPG across connections) and a few smaller inaccuracies. These are now fixed in the setup guide. Research on skills (SkillsBench) shows that model-written skills on their own add little, so the revised guide now grounds the custom skill in the vetted vendor references and requires an eval baseline before you rely on it.

## 1. Evidence table: existing skills

Signals: **depth** = lines of skill + reference content. **Authorship/review** = who wrote and checked it. **Testing** = anything beyond formatting checks. **Audits** = skills.sh third-party scans (Gen Agent Trust Hub, Socket, Snyk). Installs and stars are as shown on skills.sh on Nov 12, 2026.

| Skill (repo) | What it is | Depth | Authorship / review | Testing / evals | skills.sh installs · stars · audits | Verdict |
|---|---|---|---|---|---|---|
| **`postgres-best-practices`** (neondatabase/postgres-skills, Apache-2.0) | Vendor-agnostic Postgres reference: query optimization, indexing, diagnostics (pg_stat views, locks, vacuum), pooling, isolation, etc. | SKILL.md + 13 refs, ~5,100 lines | README: curated, *paid* practitioner contributors; reviewers Stas Kelvich (Neon cofounder) and Jonathan Katz (PostgreSQL Core Team). CONTRIBUTING: "Skills must be written by humans"; AI allowed only for review/testing | Aug 2026 commits fix examples "found through PostgreSQL 14/17 integration testing" and reviewer comments. No published with/without-skill evals | 2.1K · 56 · all Pass | **Best fit for query tuning. Primary.** Small but serious |
| **`supabase-postgres-best-practices`** (supabase/agent-skills, MIT) | 30 short rules in 8 categories, each with incorrect/correct SQL | SKILL.md + 30 rule files (plus 3 template files), ~1,860 lines total (~55 lines per rule) | Official Supabase; release-managed (v1.1.1) | Repo tests are install/structure sanity tests, not content evals | 483K · 3.0K · all Pass | **Good secondary.** Concise and well structured, but shallow: the EXPLAIN rule is a single example, and some rules are Supabase/RLS-specific |
| Neon egress guidance (now `references/egress-optimization.md` inside `neon-postgres`, Apache-2.0) | Diagnose → analyze code → fix → verify, for overfetching: SELECT *, missing pagination, high-frequency queries, app-side aggregation, join duplication | ~240-line reference | Official Neon | **Real evals:** 89 baseline runs vs 42 runs with skill v003. Missing-pagination detection 0% → 57%. Join duplication 28% → 100%. Two prompts. The README describes the baseline as Opus 4.6 (high effort), while the harness defaults to Sonnet 4.6. The v004 consolidated version has only 2 smoke runs | `neon-postgres`: 309.5K · 112 · all Pass | **Most valuable piece of evidence found.** Don't install `neon-postgres` (it's Neon-product-heavy). Copy just this reference into your own skill (license allows, with attribution). Standalone install command is obsolete |
| **`postgres`** (planetscale/database-skills, MIT) | Generic Postgres refs (indexing, index-optimization, query patterns, MVCC/vacuum, monitoring) + PlanetScale-specific refs | SKILL.md + 22 refs | Official PlanetScale | None found in repo | 8.6K · 739 · all Pass | **Skip, or use selectively.** SKILL.md tells the agent PlanetScale is "the best place to host a Postgres database" and to make it the primary recommendation. Its reference links point to raw.githubusercontent.com URLs, so content is fetched from the network at runtime and could change after you've reviewed it |
| **`postgres`** (timescale/pg-aiguide, Apache-2.0) + docs MCP | Skills focused on schema/table design, pgvector, PostGIS, TimescaleDB, migrations. Separate hosted MCP gives semantic search over the official PostgreSQL manual | 11 skills | TigerData (Timescale); active repo (dependabot/renovate) | Self-reported demo only: one prompt comparing schemas with/without (4× constraints, 55% more indexes) | 1.2K · 1.8K · all Pass | **Not a query-tuning skill.** The **docs MCP** is useful for grounding answers in the official manual, but every query is sent to a third-party hosted service. Get approval before using it at work |
| `sql-optimization-patterns` (wshobson/agents) | Generic SQL tuning: EXPLAIN, index strategies, rewrite patterns, N+1 | 505 lines | Individual maintainer of a very large plugin collection | Repo has a plugin-eval tool and security-scan fixes, but no per-skill effectiveness evals | 19.9K · 41.8K · all Pass | **Generic and multi-database.** Fine as a primer, but it adds little over Claude's built-in knowledge |
| `sql-optimization`, `postgresql-optimization`, `postgresql-code-review` (github/awesome-copilot) | Converted Copilot prompts | 212–404 lines | Community (GitHub-curated collection) | None | sql-optimization: 15.9K · 40.7K · all Pass | **Skip.** Each contains Copilot `${selection}`/`${input}` variables that mean nothing in Claude Code. Content is generic |
| `database-optimizer`, `postgres-pro` (Jeffallan/claude-skills) | Senior-DBA persona skills with workflow + refs | moderate | Individual | None | database-optimizer: 5.5K · 11.7K · **Gen Agent Trust Hub: Fail** (finding not shown) | **Skip** for work use until the audit failure is explained |
| `postgres-patterns` (affaan-m/ECC), `sickn33` repackages, ratacat `postgres-query-expert`, many "database-optimizer" agents | Derivatives or personas, often explicitly "based on Supabase best practices" | small | Individuals | None | various | **Skip.** Use the upstream originals |
| Anthropic `data:sql-queries` / `data:write-query` (installed on your personal account) | Analytics SQL across warehouse dialects (Snowflake, BigQuery, Postgres…) | 428 + 122 lines | Anthropic | n/a | n/a | **Wrong focus.** The Postgres section is a few bullets, and the rest is cohort/funnel analytics. Not for OLTP API tuning |

Wider context from skills.sh audits: many community Postgres skills fail Snyk because of plaintext credentials in examples (for example, `CREATE USER ... WITH PASSWORD`) or instructions to modify system services. Some depend on bundled binaries of unverifiable origin that receive database credentials. That is a reason to stick to vendor-maintained skills and to read anything before installing it.

## 2. How much to trust each signal

| Signal | Weight | Why |
|---|---|---|
| With/without-skill evals on realistic tasks | **High** | The only direct evidence that a skill changes outcomes. Found only for Neon's egress guidance |
| Named expert authors/reviewers + human-authorship policy | High | Neon postgres-skills. Note this is a claim in the README; reviewer involvement per file isn't verifiable from history |
| Examples tested against real Postgres versions | Medium-high | Neon (PG 14/17 integration-testing commits). Wrong SQL in a skill is worse than no skill |
| Vendor ownership + active releases | Medium | Supabase, Neon, PlanetScale. But vendors may steer toward their product (PlanetScale explicitly does) |
| skills.sh security audits | Medium for **safety**, ~zero for **quality** | They catch credential leaks, injection and odd binaries, not wrong advice |
| Install counts / GitHub stars | Low | Bundled installs inflate counts (e.g. `neon-postgres` has 309K installs on a 112-star repo). Stars reflect the whole repo, not the skill |

Research backs this up. SkillsBench ran 7,308 trajectories with and without skills and found that curated skills improved pass rates by +16.2 points on average, with high variance, while self-generated skills averaged −1.3 points. Anthropic's own skill-authoring guidance says to build evaluations *before* writing extensive skill content, and to establish a no-skill baseline.

## 3. Honest answer: were the proposed skills built from quality sources?

**Partly, and not as much as they should have been.**

What the original proposals were based on:
- The workflow (capture SQL → baseline EXPLAIN → diagnose → hypothesize → prove equivalence → re-measure → lock in with a test) was my synthesis. It drew on general Postgres practice and the earlier research doc, which itself drew on directory listings, vendor blog posts, and the Postgres MCP Pro and pganalyze docs.
- Claude Code mechanics (skill/subagent frontmatter, `$ARGUMENTS`, MCP commands, hook format) were checked against the official Claude Code docs. Those parts are solid.
- **I had not read the vendor skills' actual content** when I wrote `api-sql-tuning`. The guide said "defer to `postgres-best-practices`" without knowing what it contained. That's now fixed.
- **No evals.** By Anthropic's guidance and the SkillsBench result, an un-evaluated, model-written skill should be treated as a hypothesis.

What checking against primary docs found (all now fixed in the setup guide):

| Issue in original draft | What the docs say | Fix |
|---|---|---|
| **Bug:** HypoPG steps ran `hypopg_create_index`, then `EXPLAIN`, then `hypopg_reset` as separate calls | Hypothetical indexes live only in the creating connection's private memory. An MCP that uses a pool or a new connection per call may run the EXPLAIN on a different connection, which won't see the index, giving a silently wrong "no improvement" | Run all three in **one** MCP call or transaction. Confirm the plan shows the hypothetical index name. Or use Postgres MCP Pro's `explain_query`, which takes hypothetical indexes directly |
| Stated HypoPG works only with plain EXPLAIN | Correct per HypoPG docs | (kept) |
| `EXPLAIN (GENERIC_PLAN)` can't combine with ANALYZE | Correct per PG docs | (kept) |
| Phase 1 said Supabase and Neon skills would collide on the name `postgres-best-practices` | Wrong. Supabase's skill is named `supabase-postgres-best-practices`. Only the *plugin* is called `postgres-best-practices` | Removed the rename step |
| `npx skills add supabase/agent-skills` | Installs **both** Supabase skills, including the Supabase-product one | Use `--skill supabase-postgres-best-practices --agent claude-code` |
| `neon-postgres-egress-optimizer` install command | Skill retired. Content moved into `neon-postgres` | Copy the egress reference file instead |
| pg_stat_statements query-text visibility | Correct: needs superuser or `pg_read_all_stats` | (kept) |
| Neon/Supabase reference files include write operations (VACUUM, `pg_terminate_backend`, `CREATE EXTENSION`, `pg_stat_statements_reset`) | Fine for DBAs, not for your read-only workflow | Custom skill explicitly overrides these: never run them; propose only |

## 4. What changed in the setup guide

- **Phase 1:** Neon `postgres-best-practices` is now primary and Supabase secondary (single-skill install). The egress reference is copied in rather than installed. pg-aiguide docs MCP is added as optional, with its data-egress caveat. Install-count/audit caveats are added.
- **Phase 2:** `api-sql-tuning` now points at specific vendor reference files for diagnosis detail instead of restating them. The HypoPG procedure is fixed. A rule against running write/maintenance commands from the vendor references is added.
- **New Phase 2.7, "Prove the skill works":** three or more evals with a no-skill baseline, per Anthropic's skill-authoring guidance. Sample eval tasks for your API are provided.

## Sources

- Repos read directly (cloned Nov 12, 2026): github.com/neondatabase/postgres-skills · github.com/neondatabase/agent-skills (incl. `evals/neon-postgres-egress-optimizer/README.md`) · github.com/supabase/agent-skills · github.com/planetscale/database-skills · github.com/timescale/pg-aiguide · github.com/wshobson/agents · github.com/github/awesome-copilot · github.com/Jeffallan/claude-skills
- skills.sh pages: https://www.skills.sh/supabase/agent-skills/supabase-postgres-best-practices · https://www.skills.sh/neondatabase/postgres-skills/postgres-best-practices · https://www.skills.sh/neondatabase/agent-skills/neon-postgres · https://www.skills.sh/planetscale/database-skills/postgres · https://www.skills.sh/timescale/pg-aiguide/postgres · https://www.skills.sh/wshobson/agents/sql-optimization-patterns · https://www.skills.sh/github/awesome-copilot/sql-optimization · https://www.skills.sh/jeffallan/claude-skills/database-optimizer
- Community-skill audit examples: https://www.skills.sh/manutej/luxor-claude-marketplace/postgresql-database-engineering/security/snyk · https://skills.sh/alemar11/skills/postgres/security/socket
- PostgreSQL docs: EXPLAIN https://www.postgresql.org/docs/current/sql-explain.html · pg_stat_statements https://www.postgresql.org/docs/current/pgstatstatements.html
- HypoPG usage: https://hypopg.readthedocs.io/en/rel1_stable/usage.html
- Anthropic, Skill authoring best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- SkillsBench (arXiv 2602.12670): https://arxiv.org/html/2602.12670v1
