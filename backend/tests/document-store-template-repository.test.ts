import { describe, expect, test } from "vitest";

import { DocumentStoreDownloadTemplateRepository } from "../src/infrastructure/document-store-template-repository.js";

class FakeTemplateCollection {
  readonly documents = new Map<string, unknown>();
  lastFilter: Record<string, unknown> | null = null;

  async findOne(filter: Record<string, unknown>): Promise<unknown | null> {
    this.lastFilter = filter;
    return this.documents.get(String(filter.public_id)) ?? null;
  }
}

describe("DocumentStoreDownloadTemplateRepository", () => {
  test("maps active imported template documents to download templates", async () => {
    const collection = new FakeTemplateCollection();
    collection.documents.set("tpl_001", {
      public_id: "tpl_001",
      access_tier: "paid",
      object_key: "templates/tpl_001.xlsx",
      object_sha256: "a".repeat(64),
      status: "active",
    });

    const repository = new DocumentStoreDownloadTemplateRepository(collection);

    await expect(repository.findByPublicId("tpl_001")).resolves.toEqual({
      publicId: "tpl_001",
      accessTier: "paid",
      assetScope: "public",
      objectKey: "templates/tpl_001.xlsx",
      sha256: "a".repeat(64),
      status: "active",
    });
    expect(collection.lastFilter).toEqual({ public_id: "tpl_001" });
  });

  test("preserves an explicit enterprise-private scope instead of inferring it from the legacy tier", async () => {
    const collection = new FakeTemplateCollection();
    collection.documents.set("tpl_private", {
      public_id: "tpl_private",
      access_tier: "free",
      asset_scope: "enterprise_private",
      object_key: "templates/tpl_private.xlsx",
      object_sha256: "d".repeat(64),
      status: "active",
    });

    const repository = new DocumentStoreDownloadTemplateRepository(collection);

    await expect(repository.findByPublicId("tpl_private")).resolves.toMatchObject({
      publicId: "tpl_private",
      assetScope: "enterprise_private",
    });
  });

  test("returns null for missing, malformed, or unsupported template documents", async () => {
    const collection = new FakeTemplateCollection();
    collection.documents.set("missing_key", {
      public_id: "missing_key",
      access_tier: "free",
      object_sha256: "b".repeat(64),
      status: "active",
    });
    collection.documents.set("draft", {
      public_id: "draft",
      access_tier: "free",
      object_key: "templates/draft.xlsx",
      object_sha256: "c".repeat(64),
      status: "draft",
    });

    const repository = new DocumentStoreDownloadTemplateRepository(collection);

    await expect(repository.findByPublicId("unknown")).resolves.toBeNull();
    await expect(repository.findByPublicId("missing_key")).resolves.toBeNull();
    await expect(repository.findByPublicId("draft")).resolves.toBeNull();
  });
});
