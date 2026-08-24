# Git workflow

Everything here runs on his behalf. He types nothing.

## Local main is never touched

Never `git checkout main`. Never commit to it, never merge into it, never pull
it. `origin/main` is the reference, and `git fetch` keeps it current without
touching the working tree. This removes every "your local main has diverged"
problem before it can happen.

## Starting work

```bash
git fetch origin
git checkout -b <name>/<topic> origin/main
git push -u origin <name>/<topic>
gh pr create --draft --base main --title "..." --body "..."
```

Branch off `origin/main`, never off whatever happens to be checked out. Push
before any work exists — a branch that only lives on his laptop is a branch
that can be lost.

## Saving work

```bash
git add <specific files>
git commit -m "<plain English, present tense>"
git fetch origin
git merge origin/main      # only if origin/main moved
git push
```

Stage specific files. Never `git add -A` — it sweeps up stray files he did not
mean to share.

## Staying current

Fetch at these moments:

- session start
- before creating a branch
- before every push
- after about an hour of continuous work

If `git log HEAD..origin/main --oneline` is non-empty, `origin/main` moved.
Merge it in before pushing so the pull request stays clean.

## Merge, never rebase

`git merge origin/main` is additive: the worst case is a conflict, and it never
destroys a commit. Rebase rewrites history and needs a force push to recover
from — both are blocked, deliberately.

## Conflicts

1. Read both sides.
2. Resolve them yourself.
3. `git add <resolved files>` and commit with a message naming what you kept.
4. Tell him in plain English what the two versions were and which parts survived.

Only ask when the answer depends on what he wants the game to do — and then ask
about the game.

## Finishing

The draft pull request is already open and already has the work. Tell him it is
ready and that Ben will see it. Do not mark it ready for review, and do not
merge it — Ben does both.

## After Ben merges

```bash
git fetch origin --prune
git branch -d <name>/<topic>
```

The next piece of work starts a fresh branch from the updated `origin/main` —
unless he says it builds on something of his that is not merged yet, in which
case branch from that branch instead and mention it in the pull request. Ask
him; he has no way of knowing which of his branches contains what.
`-d` refuses to delete anything unmerged; `-D`, which does not, is blocked.

If Ben merged the pull request as a **squash merge**, `-d` will refuse anyway
— GitHub's squash commit is not the same commit object, so git does not
recognise the branch as merged. This is expected. Leave the branch alone and
tell him Ben will tidy it up; do not reach for `-D`.
