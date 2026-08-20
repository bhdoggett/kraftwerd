# First-time setup

Run these for him, one at a time, saying what each one is for. Stop at the
first failure and read `troubleshooting.md` rather than improvising.

Before starting, confirm Ben has already: added him as a collaborator on the
GitHub repo, and invited him to the Convex team. Without the second one, step 4
silently sets up a project Ben cannot see.

## 1. Install Node

```bash
nvm use              # Node 24. If nvm is missing, he needs Node 24 installed.
```

## 2. Install dependencies

```bash
npm install
```

## 3. Install the Convex skills

```bash
npx convex ai-files install   # the Convex skills, pinned by skills-lock.json
```

## 4. Connect to the backend

```bash
npx convex login
npx convex dev
```

`convex dev` will ask which project to use. **Choose Ben's team, then the
existing `word-craft` project.** Do not create a new project — that is the one
mistake here that produces no error message and leaves him working somewhere
nobody else can see. If it already happened, delete the stray project from the
Convex dashboard and run `npx convex dev` again.

This gives him his own private backend. Ben has one too. They cannot affect
each other.

Stop `convex dev` once it reports it is ready.

## 5. Set up sign-in

Four settings, on his own backend. Ben supplies the last two privately; they
are the same Google credentials the project already uses.

```bash
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set SITE_URL http://localhost:5175
npx convex env set GOOGLE_CLIENT_ID <from Ben>
npx convex env set GOOGLE_CLIENT_SECRET <from Ben>
```

Then tell him to send Ben this line, which Ben adds to the Google sign-in
settings:

```
https://<his-deployment>.convex.site/api/auth/callback/google
```

His deployment name is in `.env.local` as `CONVEX_DEPLOYMENT`. Until Ben adds
it, signing in fails with `redirect_uri_mismatch`. Everything else works.

## 6. Fill the dictionary

```bash
npm run build:dictionary
npx convex import -y --table words --replace shared/data/words.jsonl
```

Not optional. Skipping it does not produce an error — the game loads, tiles
place, and then every word is rejected as invalid, including obvious ones.

## 7. Run it

```bash
npm run dev
```

The app opens at `http://localhost:5175`.

## 8. Check the tests still pass

```bash
npm test
```

This is how he will know later whether a change broke something.
