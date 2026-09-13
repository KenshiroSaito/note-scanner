# note-scanner

Web app that converts photos of class notes into structured Markdown.
See `docs/spec.md` for the full specification.

## Stack
- Backend: Node / TypeScript
- Frontend: static HTML/JS (no build step for now)
- Extraction: Ollama (local, default) — Claude API as an alternative

## Conventions
- All code, comments, commit messages, and README in English
- Commit format: Conventional Commits (feat / fix / docs / test / chore)
- `docs/spec.md` may be in Japanese (design notes)

## Rules
- Work on one task at a time. Do not implement beyond what was asked.
- Explain the reason before adding a new dependency, and wait for approval.
- Never write API keys or secrets into source files. Use environment variables.
- Do not push to `main`. Always work on a branch.
- Write tests alongside the implementation.

## Phase workflow

When moving to a new phase:
1. Confirm the previous phase is merged into `main`
2. Branch off `main`
3. Plan first; do not write code until the plan is approved
4. One phase per pull request