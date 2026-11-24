# CLI utilities for agents and humans

Research notes (November 2026) on building and auditing CLI utilities, especially Node.js CLIs, that work well for both people and AI agents like Claude.

| Document | Covers |
|---|---|
| [cli-utilities-for-agents-and-humans.md](cli-utilities-for-agents-and-humans.md) | Main guide: clig.dev foundations, the agent-ready CLI checklist, Claude skills and plugins, Node.js frameworks and patterns, testing, and auditing an existing CLI |
| [cli-token-efficiency-for-agents.md](cli-token-efficiency-for-agents.md) | Anthropic's "Writing effective tools for agents" translated into CLI terms, with examples from Arcjet, gws and gh; pre-defined chains and workflow commands; an eval loop; token budgets; coverage of the recommended skills |
| [cli-documentation-for-agents-and-humans.md](cli-documentation-for-agents-and-humans.md) | Help text, README, generated command reference, output and error contract docs, AGENTS.md/CLAUDE.md, changelogs, CI drift checks, and migrating a large README to per-command-group READMEs with per-group audits |

## Skills

Copy a skill's folder into `~/.claude/skills/` or a repo's `.claude/skills/` to install it.

| Skill | What it does |
|---|---|
| [skills/cli-agent-efficiency](skills/cli-agent-efficiency/SKILL.md) | Designs, reviews, or evaluates a CLI for agent token efficiency, using Anthropic's tool guidance translated to CLIs: a 16-item checklist with before/after patterns, default budgets, decisions on which chains to pre-define, and an eval runner (`scripts/run-evals.mjs`, headless Claude Code) that reports pass rate, turns, tool calls, errors, and tokens. |
| [skills/cli-group-readme-migrate-audit](skills/cli-group-readme-migrate-audit/SKILL.md) | Splits one command group's section out of a large CLI README into its own group README (content only), then audits that group's code and docs (findings only). |
| [skills/cli-agent-readiness-reviewer](skills/cli-agent-readiness-reviewer/SKILL.md) | Reviews CLI source, plans, or specs for agent readiness against 7 principles (Blocker/Friction/Optimization). This is the last MIT version from Every's compound-engineering plugin (commit `2d207574`), which removed it in May 2026 (PR #734). Not maintained upstream. |

Related: [../unused-npm-dependencies-tools.md](../unused-npm-dependencies-tools.md) (Knip and friends, referenced from the audit sections).
