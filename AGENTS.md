# AGENTS.md

This checkout is the live bind-mounted `~/.pi`: Pi config and extensions. Not an app. No dev server, no `$PORT`, no frontend.

Keep this file short. Recipes live in `docs/agent-ops.md`.

## Session Start

- Read `docs/PROJECT.org` and `docs/TODO.org`.
- Scan stash notes: `emacsclient -e '(bergheim/agent-denote-list "/workspaces/stash/notes" 15)'`. Read only notes tagged `pi` / `emacs` / `vim` that match the task.
- Do not create `docs/notes/` unless the discovery is repo-local (would matter after cloning this repo alone).
- This tree is `~/.pi`. Branch in place. Do not create worktrees for this repo.
- Treat `scratch/` as gitignored throwaway space.

## Communication and Planning

- Experienced operator. Direct. No filler.
- Disagree when evidence supports it.
- Screenshot mentioned → newest `/workspaces/stash/shot-*.png`.
- Non-trivial work: plan first, get explicit approval. Read/search is fine.

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

- Branch in this checkout: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
- Linear history. Merge into `main`, not into other features. Multi-commit → merge commit; single commit → fast-forward.
- Never `git reset --hard`, `git checkout --`, or `git commit --no-verify` unless asked.
- Do not commit secrets (`agent/auth.json`, `trust.json`, `phone-omemo.json`, sessions, run-history).

## Host and Container

- Shared host state lives in `/workspaces/stash`.
- Host-only work (sudo, Tailscale, DNS, systemd) stays host-only: explain the step, record it in stash via `bergheim/agent-denote-*`.
- Emacs is a daemon. `emacsclient --eval`. Never ask the user to run interactive Emacs.

## Recipes

Read `docs/agent-ops.md` only for org/denote `emacsclient` forms.
