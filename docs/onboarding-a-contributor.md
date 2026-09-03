# Onboarding a contributor

Everything here is done by the repo owner, once per person. The contributor's
own steps are handled by the `contributing` skill on his machine — he does not
read this file.

## Before he starts

1. **GitHub access** — add him as a collaborator:
   `gh api repos/bhdoggett/kraftwerd/collaborators/<his-github-username> -X PUT -f permission=push`
   Push access lets him create branches. `main` stays protected by the
   `protect-main` ruleset regardless.

2. **Convex team** — dashboard.convex.dev → Team Settings → Members → invite by
   email, role **Developer** (not Admin — Developer cannot touch billing or
   membership). The free plan covers up to 6 developers.

   This must land **before** he runs `npm run dev`, or his backend provisions
   under a personal team of his own and you cannot see it.

3. **Set the Google credentials on his backend yourself.** Once he is on the
   Convex team and has run `npm run dev` once, his deployment appears in your
   dashboard: pick it, then Settings → Environment Variables, and add
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — the same pair the project
   already uses.

   Better than sending them: the secret never leaves the console, so there is
   no copy of it in a chat log. Sending them privately also works if you would
   rather he set his own, and either way they never enter the repo.

   He still sets the two that are his alone, and cannot be shared:

   ```bash
   npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
   npx convex env set SITE_URL http://localhost:5175
   ```

   Sign-in fails without all four, and the failure looks the same each time.

4. **Nothing else to do for GitHub auth** — his first-time setup has him run
   `gh auth login` himself, which also configures git's credential helper. You
   do not need to send him a token or a password.

## Once his backend exists

He sends you a `CONVEX_DEPLOYMENT` name. Add its callback address to the
existing Google OAuth client in the Google Cloud Console, alongside the ones
already there:

```
https://<his-deployment>.convex.site/api/auth/callback/google
```

Leave Authorised JavaScript origins empty — see `auth-setup.md` for why. Until
you do this, his sign-in fails with `redirect_uri_mismatch` and nothing on his
side can fix it.

## Day to day

His work arrives as draft pull requests. GitHub emails you when one opens.
Review the diff, comment inline, and merge when you are happy. He cannot merge,
and the ruleset means neither can anything running on his machine.

## The checks

`.github/workflows/checks.yml` runs on every pull request and every push to
main: types, the whole test suite, then lint. Three things about it are worth
knowing before you are surprised by one.

**Lint is not `npm run lint`.** That script is red on an untouched tree — 58
errors, most of them `no-unnecessary-type-assertion` under `src/`, plus a
parser error on `vitest.config.ts` that no source change fixes. A check that is
red before you start cannot tell you whether you broke something. What runs
instead is `npm run lint:scoped`, which lints `shared`, `convex` and `scripts`
and fails only if the count goes **up**. The ceiling lives in
`scripts/lint-scoped.sh` and may only ever be lowered. Getting the real script
to zero and deleting the scoped one is the right end state; most of its errors
are `--fix`-able.

**`npm run typecheck` is `tsc6 -b`, and the `6` matters.** `package.json`
declares typescript as `npm:@typescript/typescript6`, which installs only a
`tsc6` binary. The script said `tsc -b` for most of this project's life, found
no `tsc` in `node_modules/.bin`, and silently fell through to whatever `tsc`
was on the machine's PATH — so the type check passed for months while running a
compiler the project does not declare, hiding three real errors. If you ever
see a type error locally that CI does not, or the reverse, suspect this first.

**CI is not the only gate, and it is not the strictest.** Coolify's build
command is `npm run build`, which is `npm run typecheck && vite build`, so a
type error fails the production deploy whether or not anything else caught it.

## Revoking access

Remove the repo collaborator, remove him from the Convex team, and delete the
extra redirect URI from the Google OAuth client. His local clone keeps working
against a backend he no longer has access to, which fails on its own.
