import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { AssetStandardEngine, type StandardSnapshot } from "../src/domain/asset-standard-engine.js";
import { PUBLIC_STANDARD_VERSION } from "../src/domain/office-spreadsheet-engine.js";

describe("committed public standard snapshot", () => {
  test("is a deterministic projection of the current 1319-asset public catalog", () => {
    const catalog = JSON.parse(readFileSync("data/catalog.public.json", "utf8")) as { items: unknown[] };
    const committed = JSON.parse(readFileSync("data/standards.public.json", "utf8")) as StandardSnapshot;
    const rebuilt = AssetStandardEngine.fromAssets(catalog.items, PUBLIC_STANDARD_VERSION).snapshot();

    expect(committed).toEqual(rebuilt);
    expect(committed.source_asset_count).toBe(1319);
    expect(committed.standards).toHaveLength(263);
  });
});
