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
          name: "hooks",
          environment: "node",
          include: [".claude/hooks/**/*.test.mjs"],
        },
      },
    ],
  },
});
