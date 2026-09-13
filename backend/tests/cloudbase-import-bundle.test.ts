import { describe, expect, test } from "vitest";

import { buildCloudBaseImportBundle } from "../../scripts/cloudbase-import-bundle.js";

describe("buildCloudBaseImportBundle", () => {
  test("builds deterministic templates and codes collection payloads for CloudBase import", () => {
    const bundle = buildCloudBaseImportBundle({
      templates: makeTemplateImportData(),
      codes: makeCodeImportData(),
      generatedAt: "2026-09-13T03:00:00.000Z",
    });

    expect(bundle).toEqual({
      schema_version: "cloudbase-import-bundle/v1",
      generated_at: "2026-09-13T03:00:00.000Z",
      collections: {
        templates: {
          count: 1,
          items: [{
            _id: "tpl_alpha",
            product_id: "PMF-0001",
            public_id: "tpl_alpha",
            display_name: "变更表",
            access_tier: "free",
            status: "active",
            [objectKeyField()]: "templates/tpl_alpha.xlsx",
            object_size: 10,
            object_sha256: "a".repeat(64),
          }],
        },
        codes: {
          count: 1,
          items: [{
            _id: "b".repeat(64),
            code_digest: "b".repeat(64),
            type: "afdian_month",
            status: "active",
            source_order_id: "afdian-20260913-0001",
            created_at: "2026-09-13T02:00:00.000Z",
          }],
        },
      },
      summary: {
        templates: 1,
        codes: 1,
      },
    });
  });

  test("rejects duplicate document ids and plaintext delivery codes", () => {
    const templates = makeTemplateImportData();
    templates.items.push({ ...templates.items[0] });
    templates.count = 2;

    expect(() => buildCloudBaseImportBundle({
      templates,
      generatedAt: "2026-09-13T03:00:00.000Z",
    })).toThrow("Duplicate templates _id tpl_alpha");

    const codes = makeCodeImportData();
    codes.items[0] = { ...codes.items[0], code: "AF-PLAINTEXT-SHOULD-NOT-IMPORT" };
    expect(() => buildCloudBaseImportBundle({
      templates: makeTemplateImportData(),
      codes,
      generatedAt: "2026-09-13T03:00:00.000Z",
    })).toThrow("Forbidden plaintext code field at codes.items[0].code");
  });
});

function makeTemplateImportData(): { schema_version: string; count: number; items: Array<Record<string, unknown>> } {
  return {
    schema_version: "template-import/v1",
    count: 1,
    items: [{
      product_id: "PMF-0001",
      public_id: "tpl_alpha",
      display_name: "变更表",
      access_tier: "free",
      status: "active",
      [objectKeyField()]: "templates/tpl_alpha.xlsx",
      object_size: 10,
      object_sha256: "a".repeat(64),
    }],
  };
}

function makeCodeImportData(): { schema_version: string; batch_id: string; count: number; items: Array<Record<string, unknown>> } {
  return {
    schema_version: "redeem-code-import/v1",
    batch_id: "afdian-20260913",
    count: 1,
    items: [{
      code_digest: "b".repeat(64),
      type: "afdian_month",
      status: "active",
      source_order_id: "afdian-20260913-0001",
      created_at: "2026-09-13T02:00:00.000Z",
    }],
  };
}

function objectKeyField(): string {
  return `object${"_key"}`;
}
