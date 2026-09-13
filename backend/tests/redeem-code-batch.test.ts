import { describe, expect, test } from "vitest";

import { buildRedeemCodeBatch } from "../../scripts/redeem-code-batch.js";

describe("buildRedeemCodeBatch", () => {
  test("generates platform delivery codes and importable digests without storing plaintext in import data", () => {
    let counter = 0;
    const batch = buildRedeemCodeBatch({
      type: "afdian_month",
      count: 2,
      batchId: "afdian-20260913",
      pepper: "test-code-pepper",
      now: new Date("2026-09-13T02:00:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, counter += 1),
    });

    expect(batch.delivery_codes).toHaveLength(2);
    expect(batch.delivery_codes[0]?.code).toMatch(/^AF-[A-Za-z0-9_-]{27}$/);
    expect(batch.delivery_codes[1]?.code).toMatch(/^AF-[A-Za-z0-9_-]{27}$/);
    expect(batch.delivery_codes[0]?.code).not.toBe(batch.delivery_codes[1]?.code);
    expect(batch.import_data).toEqual({
      schema_version: "redeem-code-import/v1",
      batch_id: "afdian-20260913",
      count: 2,
      items: [
        {
          code_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
          type: "afdian_month",
          status: "active",
          source_order_id: "afdian-20260913-0001",
          created_at: "2026-09-13T02:00:00.000Z",
        },
        {
          code_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
          type: "afdian_month",
          status: "active",
          source_order_id: "afdian-20260913-0002",
          created_at: "2026-09-13T02:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(batch.import_data)).not.toContain(batch.delivery_codes[0]?.code);
    expect(JSON.stringify(batch.import_data)).not.toContain(batch.delivery_codes[1]?.code);
  });

  test("rejects invalid batch sizes before generating delivery material", () => {
    expect(() => buildRedeemCodeBatch({
      type: "afdian_month",
      count: 0,
      batchId: "afdian-20260913",
      pepper: "test-code-pepper",
      now: new Date("2026-09-13T02:00:00.000Z"),
      randomBytes: (size) => Buffer.alloc(size, 1),
    })).toThrow("count must be between 1 and 10000");
  });
});
