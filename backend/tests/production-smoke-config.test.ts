import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("production smoke script config", () => {
  test("package scripts run a production health smoke after build", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(pkg.scripts["smoke:prod"]).toBe("tsx scripts/production-smoke.ts");
    expect(pkg.scripts.verify).toContain("pnpm smoke:prod");
  });
});
