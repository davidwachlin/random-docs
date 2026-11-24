---
name: cli-group-readme-migrate-audit
description: Migrate one command group's section of a large CLI README into its own group README, then audit that group's code and docs. Use when the user says to migrate, split out, or audit a command group.
---

# Migrate and audit one CLI command group

This skill works on **one command group per run**, in up to three phases with a human checkpoint between each:

1. **Migrate:** content only.
2. **Audit:** findings only.
3. **Fix:** separate PRs, only when asked.

Never combine phases in one change set. Content moves and behavior changes must be reviewable separately.

Arguments: `<group>` (required) and optionally `--phase migrate|audit|fix`. If no phase is given, check the tracking file (below) and run the next pending phase for that group.

## Step 0: Preconditions (check every run)

Read `AGENTS.md` / `CLAUDE.md` and look for a **Conventions** section covering:
- JSON envelope
- exit-code table
- error-code format
- help-text rules
- group README template
- group README location

If any are missing, STOP. Tell the user the whole-repo baseline isn't done yet, and offer to run it:
- Run `npx knip`, `npx madge --circular <src>`, and `npm audit`. Run `cli-agent-lint check <bin>` or `anc check .` if installed.
- Summarize the cross-cutting issues.
- Draft the conventions for the user to approve.

Do not invent conventions per group.

Also confirm that `--help` snapshot tests exist for this group's commands. If not, create them first (execa + the repo's test runner), commit them, and continue. They are the ground truth for both phases.

Tracking file: `docs/migration.md` (create it if missing). It holds one row per group: `group | migrate status | audit status | findings file | notes`.

## Phase 1: Migrate (content only)

1. **Locate** the group's section(s) in the main README. List every heading and fenced code block in it, with line numbers. This is the inventory.
2. **Create the group README** at the location given in the conventions (default `src/commands/<group>/README.md`), using the conventions' template. Default template:
   - title and one-paragraph purpose
   - Concepts
   - Common tasks
   - Commands (generated, between `<!-- commands:start -->` / `<!-- commands:end -->`)
   - Output & exit codes
   - Gotchas
   - Related
3. **Move the content without changing its meaning.** Restructuring and light rewording are fine. Correcting facts is not. Where something looks wrong or out of date, keep it and add `<!-- VERIFY: reason -->`.
4. **Replace hand-written flag/usage tables** with the generated block. Use the repo's docs generator if one exists (for example `npm run docs`). Otherwise, for Commander, generate from `cmd.helpInformation()` for each command in the group. Note any hand-written table content that the generated output doesn't cover, and keep it in Concepts or Gotchas.
5. **Replace the section in the main README** with a 1–2-line summary and a link. Use an absolute GitHub URL if the package is published to npm.
6. **Verify nothing was lost:**
   - Write a mapping table: every inventory item → its new location, or "replaced by generated reference", or "intentionally dropped: reason". Any item left unmapped means STOP.
   - Run a link check (`lychee` or `npx markdown-link-check`) on both files.
   - Run the docs drift check if the repo has one.
7. **Report** to the user:
   - the files changed;
   - the mapping table;
   - the count of `VERIFY` markers;
   - a suggested commit/PR title: `docs(<group>): move README section to group README (no content changes)`.

   Update the tracking file to `migrate: done (pending review)`. **STOP here** and wait for the user to review.

## Phase 2: Audit (findings only, no code or doc edits)

Scope everything to the group's command files, its folder, its group README, and its help snapshots. Judge against the Conventions, not personal preference. For each check below, use the named skill if it's installed; otherwise do the check directly with the same intent.

| Check | Skill if installed | Look for |
|---|---|---|
| Docs vs code | `docs-sync-audit` | README claims the code or help snapshots don't support; resolve every `VERIFY` marker |
| CLI surface | `create-cli` (reverse-spec the group) | Inconsistent flag names and meanings, missing examples, unclear exit behavior, prompts without flags |
| Node CLI practices | `nodejs-cli-best-practices` (audit mode) | stdout/stderr misuse, `process.exit`, missing `--json`, error codes, signals |
| Agent readiness and token efficiency | `cli-agent-readiness-reviewer` | Blocker/Friction/Optimization: non-interactive paths, structured output, bounded output (limits, pagination, `--fields`, truncation hints), actionable errors, dry-run/confirm |
| Code health | `tech-debt-audit`, scoped to the group folder | Debt with `file:line` citations. Write its output to the group findings file, never the repo-root `TECH_DEBT_AUDIT.md` |
| Workflow candidates | — | Multi-step tasks in Common tasks that users or agents perform by chaining commands, which could become a skill script or a workflow command |

Write **one findings file** at `src/commands/<group>/AUDIT.md` (or the path set in the conventions):

```markdown
# <group> audit, <date>
## Summary (counts by severity)
## Findings
| ID | Severity (blocker/high/med/low) | Category | file:line | Finding | Fix | Effort | Scope (group / cross-cutting) |
## VERIFY markers resolved
| Marker | Verdict (doc wrong / code wrong / both ok) | Evidence |
## Workflow candidates
## Looks bad but is fine
## Open questions
```

Rules:
- Every finding cites `file:line` or a specific help snapshot.
- Mark findings that affect conventions or other groups as **cross-cutting**. Recommend a conventions update instead of a group-local fix.
- Don't edit code or docs in this phase.

Report the summary and the top 5 findings. Update the tracking file to `audit: done`. **STOP.**

## Phase 3: Fix (only when the user asks)

- Work from `AUDIT.md`, one PR per coherent fix, ordered by severity. Fix docs-only `VERIFY` verdicts first, in a small docs PR.
- Behavior changes:
  - update the help snapshots deliberately;
  - regenerate the commands block;
  - add a changeset, noting "contract" if flags, JSON fields, or exit codes change;
  - prefer additive changes plus deprecation warnings (stderr and JSON `meta.warnings`) over renames.
- Cross-cutting findings: propose the conventions change in `AGENTS.md` first, and don't apply it to only this group.
- Mark fixed findings in `AUDIT.md` as `RESOLVED (PR link)`.

## Guardrails

- One group per run. If the user names several groups, do them one after another with a checkpoint for each.
- Never delete README content without a mapping entry.
- Never "fix" facts during migration. Mark them with `VERIFY`.
- Never overwrite another group's files or the repo-root `TECH_DEBT_AUDIT.md`.
- If the group's section can't be found clearly (scattered mentions across the README), list the candidate sections and ask the user before moving anything.
