import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe(".env.example", () => {
  test("documents required runtime variables without real secrets", () => {
    const content = readFileSync(".env.example", "utf8");

    for (const name of [
      "HOST",
      "PORT",
      "DEVICE_SECRET_PEPPER",
      "CODE_SECRET_PEPPER",
      "RECOVERY_SECRET_PEPPER",
      "COS_SECRET_ID",
      "COS_SECRET_KEY",
      "COS_BUCKET",
      "COS_REGION",
      "COS_OBJECT_PREFIX",
      "COS_SIGN_EXPIRES_SECONDS",
    ]) {
      expect(content).toContain(`${name}=`);
    }
    expect(content).not.toMatch(/AKID[A-Za-z0-9]{13,}/);
    expect(content).not.toContain("office-templates-assets-1455917634");
    expect(content).not.toContain("1455917634");
  });
});
