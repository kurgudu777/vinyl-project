# CLAUDE.md — rules for Claude Code in this repository

This file is loaded automatically by Claude Code. Keep it short and actionable.

## Project context

- Repository name: `vinyl-project`.
- Stage: initial scaffold. Stack (Node.js / Python / other) is still being chosen.
- Primary OS for development: Windows 10 (bash via Git for Windows).

## Golden rules

1. **Never commit secrets.** `.env` is git-ignored; only edit `.env.example` with placeholders.
2. **Keep `.env.example` in sync.** Every new variable used in code must be added there with a safe placeholder.
3. **Prefer small, focused commits** with clear messages. Avoid mixing refactors with feature work.
4. **Don't add features, frameworks, or dependencies that were not requested.** Ask first.
5. **No speculative abstractions.** Write the simple, direct version; refactor only when a second use case actually appears.

## Code style

- Match the style of surrounding code. If a file/folder is empty, use community defaults (Prettier/ESLint for JS/TS, Black/Ruff for Python).
- Default to writing **no comments**. Only add a comment when the *why* is non-obvious.
- Do not write multi-paragraph docstrings for trivial functions.

## Git workflow

- Default branch: `main`.
- Never force-push to `main`.
- Never run destructive git commands (`reset --hard`, `clean -fd`, `branch -D`, force push) without explicit confirmation.
- Create a new commit rather than amending a pushed one.

## Tooling

- Use `gh` CLI for GitHub operations (issues, PRs, repo creation).
- Prefer the dedicated Claude Code tools (Read/Edit/Write/Glob/Grep) over raw shell commands for file operations.

## Things to ask before doing

- Installing a new runtime, framework, or heavy dependency.
- Changing the default branch, remote URL, or repository visibility.
- Touching CI/CD configuration.
- Running any command that deletes files, branches, or database rows.

## Out of scope

- Do not generate marketing copy, logos, or landing-page content unless explicitly asked.
- Do not auto-generate README sections ("Features", "Roadmap", etc.) beyond what is documented in code.
