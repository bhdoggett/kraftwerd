import { useEffect, useState } from "react";

/**
 * Two routes ("/" and "/game/:id") do not justify a router dependency, so this
 * is the History API directly. Vite's dev server and any static host with SPA
 * fallback will serve index.html for /game/... paths.
 */
export type Route = { name: "lobby" } | { name: "game"; gameId: string };

export function parseRoute(pathname: string): Route {
  const match = /^\/game\/([^/]+)\/?$/.exec(pathname);
  return match ? { name: "game", gameId: match[1]! } : { name: "lobby" };
}

export function routeToPath(route: Route): string {
  return route.name === "game" ? `/game/${route.gameId}` : "/";
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
