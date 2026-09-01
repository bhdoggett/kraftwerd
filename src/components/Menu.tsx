import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useEffect, useRef, useState } from "react";
import { authClient } from "../lib/auth-client";
import { navigate } from "../router";
import { Friends } from "./Friends";
import { MoonIcon, MoreIcon, SunIcon, SystemIcon } from "./Icons";
import styles from "./Menu.module.css";
import { Modal } from "./Modal";
import { RulesDialog } from "./Rules";
import { THEME_CHOICES, useTheme } from "./Theme";

const THEME_ICON = { light: SunIcon, dark: MoonIcon, system: SystemIcon };
const THEME_LABEL = { light: "Light", dark: "Dark", system: "Follow the system" };

/**
 * Everything that is about the app rather than the game in progress.
 *
 * These three sat loose in the header, which cost three slots of a bar that
 * has to hold a game name and a player's turn on a phone. A menu is one slot,
 * and it can afford words where an icon had to carry the meaning alone.
 */
export function Menu() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState(false);
  const [friends, setFriends] = useState(false);
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewer);
  const [theme, setTheme] = useTheme();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Pointerdown rather than click, so the menu is gone by the time whatever
    // is underneath reacts to being pressed.
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || wrap.current?.contains(e.target) !== true) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        title="Menu"
        onClick={() => setOpen(!open)}
      >
        <MoreIcon size={21} />
      </button>

      {open && (
        <div className={styles.panel} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              setRules(true);
              setOpen(false);
            }}
          >
            How to play
          </button>

          {isAuthenticated && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                setFriends(true);
                setOpen(false);
              }}
            >
              Friends
            </button>
          )}

          <div className={styles.divider} />

          {/* A row of three rather than a button that cycles: a menu has the
              room to show what the choices are, and which one is on. */}
          <div className={styles.group}>
            <span className={styles.groupLabel}>Theme</span>
            <div className={styles.choices}>
              {THEME_CHOICES.map((choice) => {
                const Icon = THEME_ICON[choice];
                return (
                  <button
                    key={choice}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === choice}
                    className={[
                      styles.choice,
                      theme === choice ? styles.choiceOn : "",
                    ].join(" ")}
                    aria-label={THEME_LABEL[choice]}
                    title={THEME_LABEL[choice]}
                    onClick={() => setTheme(choice)}
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            </div>
          </div>

          {isAuthenticated && (
            <>
              <div className={styles.divider} />
              {viewer?.isGuest === true ? (
                /*
                 * A guest has nothing to sign back in to, so offering them the
                 * way out is offering them a locked door. What they want from
                 * this menu is the way in.
                 */
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={() => {
                    setOpen(false);
                    void authClient.signIn.social({
                      provider: "google",
                      callbackURL: window.location.href,
                    });
                  }}
                >
                  Create an account
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={() => {
                    setOpen(false);
                    // Leave the game route behind, so signing back in lands in
                    // the lobby rather than a game the next person may not be in.
                    void authClient.signOut().then(() => navigate({ name: "lobby" }));
                  }}
                >
                  Sign out
                </button>
              )}
            </>
          )}
        </div>
      )}

      {rules && <RulesDialog onClose={() => setRules(false)} />}

      {friends && (
        <Modal onDismiss={() => setFriends(false)}>
          <div className={styles.dialogHead}>
            <h2 className={styles.dialogTitle}>Friends</h2>
            <button
              type="button"
              className={styles.close}
              onClick={() => setFriends(false)}
            >
              Close
            </button>
          </div>
          <Friends
            onOpen={(gameId) => {
              setFriends(false);
              navigate({ name: "game", gameId });
            }}
          />
        </Modal>
      )}
    </div>
  );
}
