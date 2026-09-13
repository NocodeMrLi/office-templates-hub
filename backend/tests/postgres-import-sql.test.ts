import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { buildPostgresImportSql } from "../../scripts/postgres-import-sql.js";

describe("buildPostgresImportSql", () => {
  test("converts JSON Lines documents into transaction-wrapped insert SQL", () => {
    const dir = mkdtempSync(join(tmpdir(), "postgres-import-"));
    try {
      const path = join(dir, "templates.json");
      writeFileSync(path, [
        JSON.stringify({ _id: "tpl_1", display_name: "变更表" }),
        JSON.stringify({ _id: "tpl_2", display_name: "owner's plan" }),
      ].join("\n") + "\n");

      const result = buildPostgresImportSql({ collection: "templates", jsonLinesPath: path });

      expect(result.count).toBe(2);
      expect(result.sql).toContain("BEGIN;");
      expect(result.sql).toContain("INSERT INTO \"templates\" (doc) VALUES");
      expect(result.sql).toContain("ON CONFLICT DO NOTHING;");
      expect(result.sql).toContain("owner''s plan");
      expect(result.sql.endsWith("COMMIT;\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("can split JSON Lines documents into small transaction chunks", () => {
    const dir = mkdtempSync(join(tmpdir(), "postgres-import-chunks-"));
    try {
      const path = join(dir, "templates.json");
      writeFileSync(path, [
        JSON.stringify({ _id: "tpl_1" }),
        JSON.stringify({ _id: "tpl_2" }),
        JSON.stringify({ _id: "tpl_3" }),
      ].join("\n") + "\n");

      const result = buildPostgresImportSql({ collection: "templates", jsonLinesPath: path, chunkSize: 2 });

      expect(result.count).toBe(3);
      expect(result.chunks).toHaveLength(2);
      expect(result.chunks?.[0]?.count).toBe(2);
      expect(result.chunks?.[1]?.count).toBe(1);
      expect(result.chunks?.[0]?.sql).toContain("BEGIN;");
      expect(result.chunks?.[0]?.sql.endsWith("COMMIT;\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects non-object JSON Lines records", () => {
    const dir = mkdtempSync(join(tmpdir(), "postgres-import-bad-"));
    try {
      const path = join(dir, "templates.json");
      writeFileSync(path, "[]\n");
      expect(() => buildPostgresImportSql({ collection: "templates", jsonLinesPath: path }))
        .toThrow("Line 1 is not a JSON object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
