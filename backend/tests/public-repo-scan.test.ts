import { describe, expect, test } from "vitest";

import { findPublicRepoViolations } from "../../scripts/public-repo-scan.js";

describe("findPublicRepoViolations", () => {
  test("rejects spreadsheet binaries, local paths, secrets and private object keys", () => {
    const violations = findPublicRepoViolations([
      { path: "assets/template.xlsx", content: Buffer.alloc(0) },
      { path: "notes.txt", content: Buffer.from("/" + "Users/example/private") },
      { path: "config.txt", content: Buffer.from("AK" + "IDEXAMPLESECRET123456") },
      { path: "catalog.json", content: Buffer.from('{"object' + '_key":"templates/private.xlsx"}') },
    ]);

    expect(violations.map((item) => item.rule)).toEqual([
      "spreadsheet_binary",
      "local_absolute_path",
      "tencent_secret_id",
      "private_catalog_field",
    ]);
  });

  test("accepts source code and an environment variable template without values", () => {
    expect(findPublicRepoViolations([
      { path: "backend/src/app.ts", content: Buffer.from("export const status = 'ok';") },
      { path: ".env.example", content: Buffer.from("COS_BUCKET=\nDEVICE_SECRET_PEPPER=\n") },
    ])).toEqual([]);
  });
});
