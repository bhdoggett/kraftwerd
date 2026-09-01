import { defineConfig } from "vitest/config";

// Two environments: the pure engine runs in plain node, while convex-test
// requires the edge runtime that Convex functions execute in.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "engine",
          environment: "node",
          include: ["shared/**/*.test.ts", "src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        test: {
          // Components, in a DOM. The interactions here are pointer sequences
          // -- press, move, release -- and the flags they set survive between
          // gestures, which is not something reading the code catches.
          name: "ui",
          environment: "happy-dom",
          include: ["src/**/*.test.tsx"],
        },
      },
      {
        test: {
          name: "hooks",
          environment: "node",
          include: [".claude/hooks/**/*.test.mjs"],
        },
      },
    ],
  },
});
