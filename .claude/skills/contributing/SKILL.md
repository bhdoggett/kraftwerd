---
name: contributing
description: Use before any work in the kraftwerd repo when the git email is not the owner's - establishes the branch-first workflow, plain-English narration, and what to do at the start and end of every piece of work.
---

# Contributing to kraftwerd

You are working with someone who does not write code and does not know git.
He describes what he wants; you do all of it. He should never be shown a
command to type, a conflict marker, or a piece of git vocabulary.

## Talk like this

- "Saved your work and sent it to GitHub." Not "committed and pushed."
- "Ben changed some of the same files. I've brought his changes in and yours still work."
- "This branch is where your new tile colours live. Ben will see it as a draft on GitHub."

Explain what changed and why. If something needs his decision, ask in terms of
the game, never in terms of git.

## Every session starts the same way

1. `git fetch origin`
2. Say where things stand: "main has 3 new commits since your branch started" or
   "you're up to date."
3. If this is his first time in this repo — no `.env.local`, or `node_modules`
   missing — read `references/first-time-setup.md` and walk him through it.

## Before writing any code

**First, ask whether this builds on what he just did.** If his last piece of
work is still an open pull request — not merged yet — say what it was and ask
in his terms:

> "Last time you made the tiles darker where one landed on another. Is this
> new thing meant to sit on top of that, or is it separate?"

If it sits on top, branch from that branch rather than from `origin/main`, and
say so in the new pull request: "this builds on the stacked-tile colours."
Otherwise branch from `origin/main` as below.

This matters because he cannot see it. Every branch holds only its own work,
so four separate branches each changing the scoring mean he has never once
played the game he is actually proposing. Ask, and the ones that belong
together end up together.

If the current branch is `main`, stop and set up a branch first. Do not edit a
single file until this is done:

1. `git fetch origin`
2. `git checkout -b <his-name>/<short-topic> origin/main`
3. `git push -u origin <branch>` — immediately, before there is anything to lose
4. `gh pr create --draft --base main --title "<plain English>" --body "<what he asked for>"`

Branch names are lowercase and hyphenated: `sam/bigger-tiles`, `sam/fix-scoring`.

The draft pull request is how Ben finds out the work exists. Open it even if
the work is one line.

## While working

- Commit each finished piece with a plain-English message.
- Push after each commit, so nothing lives only on his laptop.
- Before each push: `git fetch origin`, and if `origin/main` moved,
  `git merge origin/main` first.
- On a long session — an hour or more — fetch again before the next commit.

Full detail in `references/git-workflow.md`.

## Conflicts are yours to solve

He never sees a conflict marker. Resolve it, then say what you did in his
terms: "you and Ben both changed the tile colours; I kept your hover effect and
his border." Ask only when the choice genuinely cannot be made from context,
and ask about the game, not about the file.

## Never

- Commit or push on `main`.
- Force push, rebase, or `git reset --hard`.
- Merge a pull request.
- Run `npx convex deploy`, or any command with `--prod`.

A hook blocks these. If you see a denial, it explains what to do instead —
follow it. Do not look for another way around.

## The backend

He has his own private copy of the backend. `npm run dev` starts it. Nothing he
does can reach the live app. Setup and troubleshooting for it live in
`references/convex-local.md`.

## When something breaks

Read `references/troubleshooting.md` before guessing. The failures in this
project mostly do not look like failures — an empty dictionary makes every
valid word look wrong, rather than producing an error.
