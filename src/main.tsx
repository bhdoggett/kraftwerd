import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { authClient } from "./lib/auth-client";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string, {
  expectAuth: true,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/*
      The cast works around an upstream typing bug in
      @convex-dev/better-auth 0.12.5: its exported `AuthClient` type
      constrains createAuthClient's options generic to
      `BetterAuthClientPlugin & { plugins }`, which real options
      ({ baseURL, plugins }) cannot satisfy. Runtime shape is correct.
    */}
    <ConvexBetterAuthProvider
      client={convex}
      authClient={authClient as unknown as AuthClient}
    >
      <App />
    </ConvexBetterAuthProvider>
  </StrictMode>,
);
