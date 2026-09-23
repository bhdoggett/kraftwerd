/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { RULES_VERSION } from "../shared/config";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

describe("rules seen", () => {
  test("a row from before tracking reads as having seen version 9", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { authId: "auth|a", name: "Ana" }));
    const asAna = t.withIdentity({ subject: "auth|a" });

    expect((await asAna.query(api.users.viewer))?.rulesSeen).toBe(9);
  });

  test("acknowledging brings it up to the current version", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("users", { authId: "auth|a", name: "Ana", rulesSeen: 9 }));
    const asAna = t.withIdentity({ subject: "auth|a" });

    await asAna.mutation(api.users.acknowledgeRules, {});

    expect((await asAna.query(api.users.viewer))?.rulesSeen).toBe(RULES_VERSION);
  });
});
