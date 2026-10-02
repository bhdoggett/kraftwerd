import { useEffect, useState } from "react";

/**
 * Four routes ("/", "/game/:id", "/friend/:token", "/account") do not justify a router
 * dependency, so this is the History API directly. Vite's dev server and any
 * static host with SPA fallback will serve index.html for those paths.
 */
type Route =
  | { name: "lobby" }
  | { name: "game"; gameId: string }
  | { name: "friend"; token: string }
  | { name: "account" };

function parseRoute(pathname: string): Route {
  const game = /^\/game\/([^/]+)\/?$/.exec(pathname);
  if (game) return { name: "game", gameId: game[1] };

  const friend = /^\/friend\/([^/]+)\/?$/.exec(pathname);
  if (friend) return { name: "friend", token: friend[1] };

  if (/^\/account\/?$/.test(pathname)) return { name: "account" };

  return { name: "lobby" };
}

function routeToPath(route: Route): string {
  if (route.name === "game") return `/game/${route.gameId}`;
  if (route.name === "friend") return `/friend/${route.token}`;
  if (route.name === "account") return "/account";
  return "/";
}

export function navigate(route: Route) {
  const path = routeToPath(route);
  if (path !== window.location.pathname) {
    window.history.pushState(null, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return route;
}
