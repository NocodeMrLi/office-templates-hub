import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { parseStandardSnapshot } from "../src/domain/asset-standard-engine.js";
import { OfficeSpreadsheetEngine } from "../src/domain/office-spreadsheet-engine.js";

describe("committed public standard snapshot", () => {
  test("is valid and matches every group in the current 1319-asset public catalog", () => {
    const catalog = JSON.parse(readFileSync("data/catalog.public.json", "utf8")) as { items: unknown[] };
    const committed = parseStandardSnapshot(JSON.parse(readFileSync("data/standards.public.json", "utf8")) as unknown);

    expect(() => OfficeSpreadsheetEngine.fromSnapshot(catalog.items, committed)).not.toThrow();
    expect(committed.source_asset_count).toBe(1319);
    expect(committed.standards).toHaveLength(263);
  });
});
