# Contributor workflow design

Date: 2026-08-19
Status: approved design, not yet implemented

## Problem

A second person — a non-coder — needs to work on this repo from his own
machine, driving Claude Code rather than writing code by hand. He has no git
vocabulary, no Convex account, and no way to tell a safe command from a
destructive one. The repo currently has no branch protection, a single
collaborator, and `.claude/` is gitignored, so nothing that would guide his
agent survives a clone.

Three things have to be true:

1. He can go from `git clone` to a running app without knowing what any of the
   steps mean.
2. His work never lands on `main` directly, and never diverges so far from
   `main` that reconciling it becomes a project of its own.
3. Nothing he or his agent does can reach production, rewrite history, or
   destroy committed work.

## Mode detection

`git config user.email` decides the mode:

- `bdoggett@gmail.com` — **owner mode**. Nothing changes. No guardrails, no
  injected context, no behaviour difference from today.
- anything else, including unset — **contributor mode**. Full workflow and
  guardrails apply.

Unknown email resolves to contributor mode. A stranger with a misconfigured
git install gets the safe path, not the privileged one.

This is identification, not authentication. It stops accidents, not a
determined bypass. The GitHub ruleset is the layer that holds regardless.

## Enforcement layers

Three layers, deliberately redundant, because each fails differently.

| Layer | File | Fails when |
|---|---|---|
| SessionStart hook | `.claude/hooks/contributor-mode.mjs` | trust prompt declined |
| PreToolUse hook | `.claude/hooks/guardrails.mjs` | trust prompt declined |
| Skill | `.claude/skills/contributing/SKILL.md` | agent doesn't load it |
| Instructions | `CLAUDE.md`, `AGENTS.md` | never — always loaded |
| GitHub ruleset | server-side | never — outside his machine |

### SessionStart hook

Runs on every session start. In owner mode it exits silently. In contributor
mode it injects context announcing contributor mode and instructing the agent
to load the `contributing` skill before any other work.

### PreToolUse hook

Intercepts every Bash tool call. Owner mode allows everything. Contributor
mode denies the following, each with a plain-English reason and the correct
alternative, so the agent self-corrects instead of retrying variants:

- `git push` targeting `main`
- any force push (`--force`, `--force-with-lease`, `+refs` refspec)
- `git reset --hard`
- `git rebase`
- `git branch -D` (`-d`, the safe delete, is allowed)
- `gh pr merge`
- `gh api` with `-X DELETE`
- `npx convex deploy`
- any command carrying `--prod`
- `npx convex env set --prod`, `npx convex import --prod`

Denials return *why* and *what to do instead*. A bare refusal makes an agent
flail; a refusal with a next step makes it comply.

### Skill

`.claude/skills/contributing/SKILL.md` plus on-demand references:

- `references/first-time-setup.md` — clone to running app
- `references/git-workflow.md` — branch, commit, push, sync, PR
- `references/convex-local.md` — his own dev deployment, seeding, OAuth
- `references/troubleshooting.md` — the failures that don't look like failures

References load on demand. The skill body stays short enough to be read every
session.

## Branch workflow

**Local `main` is never checked out and never modified.** `origin/main` is the
reference; `git fetch` keeps it current without touching the working tree.
This removes the entire class of "your local main has diverged" problems.

When a prompt would produce a code change and the current branch is `main`,
the agent — before writing anything:

1. `git fetch origin`
2. creates a branch off `origin/main`, named `<his-name-slug>/<topic>`
3. `git push -u origin <branch>` immediately, so the remote branch and
   tracking exist before there is anything to lose
4. opens a **draft** PR against `main` with a plain-English summary

Work then proceeds on that branch. Each logical chunk is committed with a
plain-English message and pushed, so his work is never only on his laptop.
The draft PR accumulates commits as he goes.

The draft PR is the notification channel. It emails the owner on open, shows
the full diff, and supports line-by-line comments without anyone cloning the
branch. Draft status means it cannot be merged until deliberately marked
ready.

## Staying synced with main

Sync points, all automatic, all cheap:

1. **Session start** — `git fetch origin`, then report in plain English:
   "main has 3 new commits since your branch started", or "you're up to date".
2. **Before creating a branch** — branch off freshly fetched `origin/main`,
   never a stale local ref.
3. **Before every push** — fetch; if `origin/main` moved, merge it into his
   branch before pushing, so the draft PR stays mergeable-clean.
4. **Long sessions** — after roughly an hour, re-fetch before the next
   commit-and-push cycle rather than waiting for session end.
5. **After his PR merges** — retire the branch with `git branch -d`, start the
   next task from a fresh branch off current `origin/main`.

**Merge, not rebase.** Rebase rewrites history and needs a force push to
recover from — both blocked. `git merge origin/main` is additive: the worst
outcome is a conflict, and it never destroys committed work.

**Conflicts are the agent's job.** He never sees a conflict marker. The agent
resolves and then explains the resolution in his terms — "you and Ben both
changed the tile colours; I kept your hover state and his border" — and asks,
in plain English, only when the choice is genuinely ambiguous.

## Convex

He gets **his own dev deployment** under the same Convex project: isolated
schema and data, no possibility of clobbering the owner's dev deployment.

First-time setup, walked by the agent, nothing typed by him:

```
nvm use                     # Node 24, pinned in .nvmrc
npm install
npx convex ai-files install # vendored convex skills, from tracked skills-lock.json
npx convex login            # his own Convex account
npm run dev                 # provisions his dev deployment
npm run build:dictionary
npx convex import -y --table words --replace shared/data/words.jsonl
```

The dictionary import is non-negotiable and non-obvious. An empty `words`
table is not a visible failure: the game loads, tiles place, and then every
word — including obvious ones — is rejected as invalid.

The one place this can go wrong is the configure prompt. His clone has no
`.env.local` — it is gitignored — so `convex dev` asks which project to use.
Choosing "create a new project" instead of the existing `word-craft` leaves
him working alone in a project the owner cannot see, with no visible error.
The setup reference therefore runs bare `npx convex dev` first, has him pick
the owner's team and the existing `word-craft` project, and only then runs
`npm run dev`.

### His deployment's environment variables

A fresh deployment starts with an empty environment — nothing carries over
from the owner's. Four variables are set on his dev deployment before sign-in
works:

```bash
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set SITE_URL http://localhost:5175
npx convex env set GOOGLE_CLIENT_ID <id>
npx convex env set GOOGLE_CLIENT_SECRET <secret>
```

`SITE_URL` is `5175` — the port `vite.config.ts` pins deliberately, so that a
port collision fails loudly instead of silently breaking the OAuth callback.
(`docs/auth-setup.md` says `5173` in its example; that line is stale and
should be corrected separately — it is not part of this work.)

`BETTER_AUTH_SECRET` he generates himself. The two Google values are the
owner's, sent over a private channel, and reused rather than duplicated: one
OAuth client, two callback URIs. The owner adds his deployment's
`https://<his-deployment>.convex.site/api/auth/callback/google` alongside the
existing one.

The trade accepted here is that a development OAuth client secret lives on his
machine and in his shell history. It grants sign-in against a dev deployment
holding no real users, and it is not the production credential. If that stops
being acceptable, the fallback is a second OAuth client he owns, which costs
him a Google Cloud Console walkthrough and costs the owner the ability to fix
it remotely.

Missing Google credentials degrade gracefully rather than crashing:
`convex/auth.ts` omits the provider and `api.users.authStatus` drives a
disabled sign-in button that explains itself. So an incomplete setup is
visible and recoverable, not a blank screen.

Production is unreachable from his machine: `convex deploy`, `--prod`, and the
prod env/import commands are all blocked by the PreToolUse hook.

### Owner-side prerequisites

Two steps only the owner can do:

- invite him as a **repo collaborator** (today the only collaborator is
  `bhdoggett`) so he can push branches
- invite him to the **Convex team** so `npx convex dev` provisions under the
  same project

And two after his deployment exists: each Convex deployment has its own
`.convex.site` host, so the owner adds
`https://<his-deployment>.convex.site/api/auth/callback/google` as an
additional redirect URI on the existing Google OAuth client — without it
sign-in fails with `redirect_uri_mismatch` — and sends him the client ID and
secret over a private channel.

The team invite must land **before** he runs `npm run dev`. Otherwise his
deployment provisions under a personal team of his own, isolated from the
project.

## GitHub ruleset on main

The repo is public, so rulesets are free. None exist today.

- require a pull request before merging, with 1 approving review
- block force pushes (non-fast-forward)
- block branch deletion
- bypass actor: repository **admin**, so the owner keeps merging directly

Applied with `gh api repos/bhdoggett/word-craft/rulesets -X POST`.

This is the layer that does not depend on his machine. Even with every local
guardrail bypassed, `main` moves only through a PR the owner approves.

## Delivery

`.claude/` is currently gitignored, so nothing above would reach his clone.
`.gitignore` gains a carve-out:

```
.claude/*
!.claude/hooks/
!.claude/settings.json
!.claude/skills/
.claude/skills/*
!.claude/skills/contributing/
```

Tracked because hand-written with no other source: `.claude/hooks/`,
`.claude/settings.json`, `.claude/skills/contributing/`.

Not tracked, because generated: the vendored `convex-*` skills in
`.claude/skills/` and `.agents/skills/` (368K each). `skills-lock.json` is
already tracked and pins every one by source and hash, so
`npx convex ai-files install` reproduces the exact set. Committing them would
add merge conflicts on every convex skills update — the specific kind of mess
he cannot unpick. If a skill version must move in lockstep, that is a
`skills-lock.json` change, already versioned and reviewable.

Never tracked: `.fallow/` (binary caches), `.cursor/rules` (empty).

`.claude/settings.json` is a new file — the repo has no project settings today.
It exists solely to register the two hooks.

### Instruction wiring

A short block is appended to both `CLAUDE.md` and `AGENTS.md` — he may use
Cursor, and `.cursor/` exists — placed *outside* the
`<!-- convex-ai-start -->` / `<!-- convex-ai-end -->` markers so
`npx convex ai-files install` cannot overwrite it:

> If `git config user.email` is not `bdoggett@gmail.com`, load the
> `contributing` skill before any other work in this repo.

Redundant with the SessionStart hook by design: `CLAUDE.md` always loads,
whereas hooks can be declined at the trust prompt.

## Voice

Everything he reads is plain English. No git vocabulary in any user-facing
sentence. Commands are run for him, never handed to him to type. Actions are
narrated as what changed and why — "saved your work and sent it to GitHub",
not "committed and pushed". Errors are explained as a situation with a next
step, never as a stack trace or a command that failed.

## Out of scope

- CI on pull requests. Worth adding later; not required for him to work.
- Convex preview deployments per branch. His own dev deployment covers
  development; previews only matter once someone else needs to review a
  running build.
- Auto-merge of any kind. The owner merges, always.
