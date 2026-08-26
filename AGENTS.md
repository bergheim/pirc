# AGENTS.md

This checkout is the live bind-mounted `~/.pi`: Pi config and extensions. Not an app. No dev server, no `$PORT`, no frontend.

Keep this file short. Recipes live in `docs/agent-ops.md`.

## Session Start

- Read `docs/PROJECT.org` and `docs/TODO.org`.
- Scan stash notes: `emacsclient -e '(bergheim/agent-denote-list "/workspaces/stash/notes" 15)'`. Read only notes tagged `pi` / `emacs` / `vim` that match the task.
- Do not create `docs/notes/` unless the discovery is repo-local (would matter after cloning this repo alone).
- This tree is `~/.pi`. Branch in place. Do not create worktrees for this repo.
- Treat `scratch/` as gitignored throwaway space.
- First git move: `git status -sb` and `git branch --show-current`. If you are on a leftover `feat/*`/`fix/*` that is not this task, `git checkout main` and `git pull --ff-only`. Do not start work on the wrong branch.

## Communication and Planning

- Experienced operator. Direct. No filler.
- Disagree when evidence supports it.
- Screenshot mentioned → newest `/workspaces/stash/shot-*.png`.
- Non-trivial work: plan first, get explicit approval. Read/search is fine.

## Stop

- A question is an answer, not a project. Reply. Do not execute the sequel.
- Do not SSH, mosh, or otherwise touch another machine unless that access *is* the request.
- One asked change. Then stop. No bonus branch, TODO, commit, merge, or "while we're here".
- Advisor/scope-upsizing is not approval. If the user did not ask for it, do not do it.

## Themes are 16 colors. That is it.

- `bergheim-ansi-light` / `bergheim-ansi-dark`: ANSI **0–15** or `""` (terminal default). Never 256-color (`16–255`), never hex, never truecolor.
- Super+F1 (`toggle-darkmode`) retints Ghostty's 16-color palette. 256/truecolor **will not follow**. Do not claim they work on mosh, berghome, or remotely.
- Card backgrounds (`userMessageBg`, `customMessageBg`, `tool*Bg`) stay `""` so both palettes work. Do not paint them `0`/`7`/`white`/`254`/`230`.

## What to optimize for

- Best personal Pi setup. Small, live, reversible by git.
- Editor: Emacs (evil) + vim-shaped TUI (`pi-vim`, `pi-vim-jk`). `externalEditor` is `emacsclient -t`. Never propose VS Code, Copilot, or closed-source themes.
- FOSS-first for packages, themes, and extensions. Paid models (Grok / Codex / Claude Max) are already in use and are fine.
- No backwards-compat shims. Ship the new shape.
- Bind-mount is the source of truth. Do not add a restore-from-stash path.

## Two AGENTS files

- `agent/AGENTS.md` — global, every project (Crawl4AI, skip-permissions). Do not turn it into a this-repo brief.
- This file — this repo only.

## Project Memory

- `docs/PROJECT.org` is stable context. `docs/TODO.org` is the work log.
- Repo-specific discoveries → `docs/notes` (denote filenames). Cross-project → `/workspaces/stash/notes`.
- Host install/deploy/config → stash, literate org with `:tangle` / `:mkdirp yes`.
- Stash is `/workspaces/stash` here and `~/stash` on the host. Write the container path; use the host path when telling the user to run something themselves.
- Denote: edit in place; one note = one topic; never hard-wrap prose (one line per paragraph). Link only via `bergheim/agent-denote-link`. TODO → note via `bergheim/agent-org-link-note`. Note → TODO is forbidden. Do not put `TODO.org` in `denote-directory`.
- New custom `.org` under `docs/` uses denote names. `docs/PROJECT.org` and `docs/TODO.org` are the exceptions.
- Agent-private memory: `.pi/MEMORY.md`.

## Task Tracking

`docs/TODO.org` is the source of truth. Check it before starting. Ad-hoc work still gets `agent-org-add-todo` then `DONE`.

Use `bergheim/agent-org-set-state` for state changes; never hand-edit TODO keywords. Pass `$(agent-meta --elisp)` as AGENT/SESSION-ID; never type a model name. Helpers return a plist — re-read every path in `:wrote` before later edits.

`:autonomous:` only after per-item agreement, and only when bounded, in-container, non-destructive, prompt-free, decision-free, one-branch, self-contained. Tag via `bergheim/agent-org-add-tag` / `remove-tag`.

## Development

- Config: `agent/settings.json`, `keybindings.json`, `models.json`, `themes/`.
- Extensions: `agent/extensions/`, colocated `*.test.ts`. `biome.json` is 4-space indent. pnpm, not npm/npx.
- Subagent routing: `agent/delegation.md`.
- `just --list` if a real recipe exists. Do not invent `just dev` / `just add` / `just perf` for this repo.
- Do not commit jolo app scaffold (`MOTD`, `perf-rig.toml`, `scripts/test-gate`, the universal `.gitignore` blob) unless it becomes a real Pi-config menu.

## Git

- Feature work on `feat/<slug>` / `fix/<slug>` / `docs/<slug>` / `chore/<slug>`, cut from up-to-date `main`. Never commit task work on `main`.
- Finished work is committed **and pushed the same turn**. A dirty tree at the end of a task is a bug. Do not wait to be asked.
- Land on `main` only as a **merge commit**: `git fetch origin && git rebase origin/main` on the feature branch, then `git checkout main && git merge --no-ff <branch> && git push origin main`. Always rebase onto the parent first. Always `--no-ff`. No fast-forward landings.
- Never `git reset --hard`, `git checkout --`, or `git commit --no-verify` unless asked.
- Do not commit secrets (`agent/auth.json`, `trust.json`, `phone-omemo.json`, sessions, run-history) or dumped prompts (`agent/SYSTEM.md`).
- Pi rewrites `agent/settings.json` (2-space `JSON.stringify`). Do not commit that rewrite unless the keys/values are the change.

## Host and Container

- Shared host state lives in `/workspaces/stash`.
- Host-only work (sudo, Tailscale, DNS, systemd) stays host-only: explain the step, record it in stash via `bergheim/agent-denote-*`.
- Emacs is a daemon. `emacsclient --eval`. Never ask the user to run interactive Emacs.

## Recipes

Read `docs/agent-ops.md` only for org/denote `emacsclient` forms.
