import { useEffect, useState } from "react";

/**
 * A handful of routes ("/", "/game/:id", "/friend/:token", "/account", "/tutorial") do not justify a router
 * dependency, so this is the History API directly. Vite's dev server and any
 * static host with SPA fallback will serve index.html for those paths.
 */
type Route =
  /** `newGame`: open the New game dialog on arrival ("/?new=1"). */
  | { name: "lobby"; newGame?: boolean }
  | { name: "game"; gameId: string }
  | { name: "friend"; token: string }
  | { name: "account" }
  | { name: "tutorial" };

function parseRoute(pathname: string, search: string): Route {
  const game = /^\/game\/([^/]+)\/?$/.exec(pathname);
  if (game) return { name: "game", gameId: game[1] };

  const friend = /^\/friend\/([^/]+)\/?$/.exec(pathname);
  if (friend) return { name: "friend", token: friend[1] };

  if (/^\/account\/?$/.test(pathname)) return { name: "account" };
  if (/^\/tutorial\/?$/.test(pathname)) return { name: "tutorial" };

  if (new URLSearchParams(search).get("new") === "1") return { name: "lobby", newGame: true };
  return { name: "lobby" };
}

function routeToPath(route: Route): string {
  if (route.name === "game") return `/game/${route.gameId}`;
  if (route.name === "friend") return `/friend/${route.token}`;
  if (route.name === "account") return "/account";
  if (route.name === "tutorial") return "/tutorial";
  if (route.newGame === true) return "/?new=1";
  return "/";
}

export function navigate(route: Route) {
  const path = routeToPath(route);
  // Only a path that carries a query is compared with one: any other query
  // on the page (an auth hand-off, say) is not this router's to throw away.
  const here = path.includes("?") ? window.location.pathname + window.location.search : window.location.pathname;
  if (path !== here) {
    window.history.pushState({ inApp: true }, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Back to where the player came from: one step back when this entry was
 * pushed by `navigate` (so there is an in-app entry before it), otherwise
 * (a direct load or reload into a fresh tab) to `fallback`.
 */
export function goBackOr(fallback: Route) {
  const state: unknown = window.history.state;
  const inApp = typeof state === "object" && state !== null && "inApp" in state;
  if (inApp) {
    window.history.back();
    return;
  }
  navigate(fallback);
}

/**
 * Takes "?new=1" back out of the address once the lobby has opened the
 * dialog, so a reload or Back does not open it again. No popstate: the route
 * on screen has already been acted on.
 */
export function forgetNewGame() {
  if (new URLSearchParams(window.location.search).get("new") !== "1") return;
  window.history.replaceState(null, "", window.location.pathname);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname, window.location.search),
  );

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname, window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return route;
}
