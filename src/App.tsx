import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import styles from "./App.module.css";
import { AcceptFriend } from "./components/AcceptFriend";
import { Game } from "./components/Game";
import { Swatches } from "./components/Swatches";
import { Lobby } from "./components/Lobby";
import { Menu } from "./components/Menu";
import { MiniBoard } from "./components/MiniBoard";
import { RulesDialog } from "./components/Rules";
import { authClient } from "./lib/auth-client";
import { navigate, useRoute } from "./router";

/*
 * The colour reference, kept out of the router on purpose.
 *
 * Read once at load: anything that navigates — the sign-in gate resolving, a
 * redirect — would otherwise take the page away mid-look, which is exactly
 * what it did when this was a route.
 */
const SHOWING_SWATCHES = window.location.pathname.startsWith("/swatches");

export default function App() {
  const route = useRoute();

  // Before the router and before the sign-in gate: nothing to steer it away.
  if (SHOWING_SWATCHES) return <Swatches />;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        {/* Left: the way back, and nothing else. Signed out there is no lobby
            to go to, and the route is about to be irrelevant anyway. */}
        <div className={styles.side}>
          <Authenticated>
            {route.name === "game" && (
              <button
                type="button"
                className={styles.link}
                onClick={() => navigate({ name: "lobby" })}
              >
                Lobby
              </button>
            )}
          </Authenticated>
        </div>

        <button
          type="button"
          className={styles.brandButton}
          onClick={() => navigate({ name: "lobby" })}
        >
          {/* Two tiles, in the colours seats 2 and 1 play in: the mark is made
              of the same pieces the game is. */}
          <h1 className={styles.brand} aria-label="kraftwerd">
            <span className={styles.markTile} data-seat="2" data-face="brand" aria-hidden="true">
              K
            </span>
            <span className={styles.markTile} data-seat="1" data-face="brand" aria-hidden="true">
              W
            </span>
          </h1>
        </button>

        <div className={[styles.side, styles.sideEnd].join(" ")}>
          {/* Beside the menu rather than beside the mark: the mark's centring
              was hard won, and a badge next to it would take that away. */}
          <span className={styles.beta} title="The rules are still changing">
            beta
          </span>
          <Menu />
        </div>
      </header>

      <main className={styles.main}>
        <Authenticated>
          {route.name === "game" ? (
            <Game
              gameId={route.gameId as Id<"games">}
              onLeave={() => navigate({ name: "lobby" })}
            />
          ) : route.name === "friend" ? (
            <AcceptFriend
              token={route.token}
              onDone={() => navigate({ name: "lobby" })}
            />
          ) : (
            <Lobby onOpen={(gameId) => navigate({ name: "game", gameId })} />
          )}
        </Authenticated>
        <Unauthenticated>
          <SignInForm />
        </Unauthenticated>
      </main>
    </div>
  );
}

/*
 * A position part-way through a game, for the sign-in page.
 *
 * Chosen to show the two things that make this game its own: a tile laid over
 * another (the O closing a square, lit rather than faced) and a solid block
 * that scores again for being solid.
 */
const DEMO_ROWS = [
  "CAT..",
  "ARE..",
  "TENS.",
  "...I.",
  "...T.",
];
/** The last play: SIT, hung off the S. */
const DEMO_PLAYED = ["3,2", "3,3", "3,4"];
/** A square somebody has already closed by playing over it. */
const DEMO_FULL = ["1,1"];

function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const status = useQuery(api.users.authStatus);
  const configured = status?.googleConfigured ?? true;

  return (
    <div className={styles.auth}>
      {showRules && <RulesDialog onClose={() => setShowRules(false)} />}

      <div className={styles.hero}>
        <MiniBoard
          rows={DEMO_ROWS}
          seat={1}
          played={DEMO_PLAYED}
          full={DEMO_FULL}
          size={34}
        />
      </div>

      <p className={styles.tagline}>
        Build words on a crossword grid, and score again for every solid square
        of tiles you complete.
      </p>
      <p className={styles.betaNote}>
        Still in beta: the rules change from week to week, and scores from
        games played under older ones may be cleared. Play it for the games,
        not for the numbers.
      </p>
      <button
        type="button"
        className={styles.google}
        disabled={!configured}
        onClick={() => {
          setError(null);
          void authClient
            .signIn
            .social({
              provider: "google",
              // Back to the page they were on, not the root: someone opening
              // an invite link signs in first, and sending them to the lobby
              // afterwards loses the game they were invited to.
              callbackURL: window.location.href,
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
        }}
      >
        <GoogleMark />
        Continue with Google
      </button>
      {!configured && (
        <div className={styles.error}>
          Google sign-in is not configured on this deployment yet. Set
          GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET with{" "}
          <code>npx convex env set</code> — see <code>docs/auth-setup.md</code>.
        </div>
      )}
      {error && <div className={styles.error}>Could not sign in: {error}</div>}

      <button
        type="button"
        className={styles.howTo}
        onClick={() => setShowRules(true)}
      >
        How to play
      </button>
    </div>
  );
}

/** Google's brand mark, inlined so the page makes no third-party requests. */
function GoogleMark() {
  return (
    <svg className={styles.googleMark} viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
