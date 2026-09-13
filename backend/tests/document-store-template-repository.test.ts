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
      objectKey: "templates/tpl_001.xlsx",
      sha256: "a".repeat(64),
      status: "active",
    });
    expect(collection.lastFilter).toEqual({ public_id: "tpl_001" });
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
