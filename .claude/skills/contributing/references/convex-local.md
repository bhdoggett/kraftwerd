# His backend

Every person on this project gets their own private copy of the backend — own
database, own data, own settings. His cannot affect Ben's, and neither can
reach the live app.

`npm run dev` starts his backend and the website together. That is the only
command he needs day to day.

## What lives where

- `convex/` — backend code: the database shape, the game rules, sign-in.
- `src/` — the website: what he sees and clicks.
- `shared/` — game logic used by both.

Changes to `convex/` upload to his private backend automatically while
`npm run dev` is running.

## His settings

```bash
npx convex env list          # what is set
npx convex env set NAME value
```

Four are needed: `BETTER_AUTH_SECRET`, `SITE_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. See `first-time-setup.md`.

Never add `--prod` to any of these. `--prod` means the live app, and it is
blocked.

## The dictionary

His database starts with an empty word list, and an empty word list rejects
every word. Refill it any time with:

```bash
npm run build:dictionary
npx convex import -y --table words --replace shared/data/words.jsonl
```

## Changing the database shape

Editing `convex/schema.ts` can fail if his existing data does not fit the new
shape. That is normal and it is safe — nothing is lost. Either adjust the
change so old data still fits, or clear the affected table from the Convex
dashboard and re-seed. Explain which one you did and why.

## What he must never run

`npx convex deploy`, or any command with `--prod`. Both reach the live app that
real people are using. Both are blocked by a hook; if you see the denial, it is
working correctly.
