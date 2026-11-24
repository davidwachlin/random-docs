# CLI utilities for agents and humans

Research notes (November 2026) on building and auditing CLI utilities, especially Node.js CLIs, that work well for both people and AI agents like Claude.

| Document | Covers |
|---|---|
| [cli-utilities-for-agents-and-humans.md](cli-utilities-for-agents-and-humans.md) | Main guide: clig.dev foundations, the agent-ready CLI checklist, Claude skills and plugins, Node.js frameworks and patterns, testing, and auditing an existing CLI |
| [cli-token-efficiency-for-agents.md](cli-token-efficiency-for-agents.md) | Anthropic's "Writing effective tools for agents" translated into CLI terms, with examples from Arcjet, gws and gh; pre-defined chains and workflow commands; an eval loop; token budgets; coverage of the recommended skills |
| [cli-documentation-for-agents-and-humans.md](cli-documentation-for-agents-and-humans.md) | Help text, README, generated command reference, output and error contract docs, AGENTS.md/CLAUDE.md, changelogs, CI drift checks, and migrating a large README to per-command-group READMEs with per-group audits |

Related: [../unused-npm-dependencies-tools.md](../unused-npm-dependencies-tools.md) (Knip and friends, referenced from the audit sections).
