# AI Agent Conventions

How AI agents are used in cap4 development.

---

## Roles

### Claude (Opus)

Primary role: **planning, auditing, and prompt-crafting**.

- Performs code audits and identifies bugs with exact file:line references
- Designs implementation plans with dependency ordering
- Crafts detailed Codex prompts for batch execution
- Updates documentation and tracks project state
- Answers architectural and debugging questions

### Codex

Primary role: **batch code execution**.

- Receives detailed prompts from Claude with exact file paths, line numbers, and commit messages
- Executes multi-file changes across the repo
- Runs verification commands after changes
- Does not push to remote (owner pushes manually)

---

## Workflow

1. **Claude audits** — reviews code, identifies issues, creates a structured plan
2. **Claude crafts prompt** — produces a self-contained, copy-pasteable prompt with all context embedded
3. **Codex executes** — applies all changes per the prompt, commits with specified messages
4. **Owner verifies** — reviews changes, runs tests, pushes to remote

---

## Prompt Format for Codex

When delegating to Codex, prompts include:

- Exact file paths and line numbers for every change
- Explicit commit messages (one per logical phase)
- Verification commands to run after (`pnpm build && pnpm typecheck && pnpm lint && pnpm test`)
- "Do NOT push" instruction

---

## Conventions

- **CLAUDE.md** is the primary context file — loaded at the start of every Claude session
- **Memory files** (`.claude/projects/`) persist user preferences and project state across sessions
- All plans should be traceable: link findings to file:line, link fixes to the finding they resolve
- Documentation updates are part of every change — never let docs drift from code
- Audit work uses independent reviews (Claude + Codex) with cross-validation for critical findings
