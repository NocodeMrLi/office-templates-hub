import { z } from "zod";

import type { DownloadTemplate, DownloadTemplateRepository } from "../domain/download-service.js";

export interface DocumentStoreTemplateCollection {
  findOne(filter: Record<string, unknown>): Promise<unknown | null>;
}

const DownloadTemplateDocumentSchema = z.object({
  public_id: z.string().min(1),
  access_tier: z.enum(["free", "paid"]),
  asset_scope: z.enum(["public", "enterprise_private"]).optional(),
  object_key: z.string().min(1),
  object_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  status: z.literal("active"),
});

export class DocumentStoreDownloadTemplateRepository implements DownloadTemplateRepository {
  constructor(private readonly collection: DocumentStoreTemplateCollection) {}

  async findByPublicId(publicId: string): Promise<DownloadTemplate | null> {
    const document = await this.collection.findOne({ public_id: publicId });
    const parsed = DownloadTemplateDocumentSchema.safeParse(document);
    if (!parsed.success) {
      return null;
    }
    return {
      publicId: parsed.data.public_id,
      accessTier: parsed.data.access_tier,
      assetScope: parsed.data.asset_scope ?? "public",
      objectKey: parsed.data.object_key,
      sha256: parsed.data.object_sha256,
      status: parsed.data.status,
    };
  }
}
