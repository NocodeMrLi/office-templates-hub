import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { CatalogService } from "../src/domain/catalog-service.js";

const catalogPath = fileURLToPath(new URL("../../data/catalog.public.json", import.meta.url));
const source = JSON.parse(readFileSync(catalogPath, "utf8")) as { items: Record<string, unknown>[] };

describe("published catalog", () => {
  test("loads all 1,319 released records as public-free assets regardless of the legacy split", () => {
    const service = CatalogService.fromUnknown(source);

    const all = service.list({ page: 1, pageSize: 1 });

    expect(all.pagination.total_items).toBe(1319);
    expect(all.items[0]).toMatchObject({ asset_scope: "public", availability: "public_free" });
    expect(JSON.stringify(all)).not.toContain("access_tier");
  });

  test("contains unique public IDs and no backend-only fields", () => {
    const publicIds = source.items.map((item) => item.public_id);
    const forbidden = [
      "asset" + "_id",
      "source" + "_group",
      "source" + "_path",
      "final" + "_path",
      "final" + "_rel",
      "final" + "_sha256",
      "object" + "_key",
    ];

    expect(new Set(publicIds).size).toBe(1319);
    expect(source.items.flatMap((item) => forbidden.filter((key) => key in item))).toEqual([]);
  });
});
