import { describe, expect, test } from "vitest";

import { createInMemoryRuntimeRepositories, createRuntimeApp } from "../src/runtime-app.js";
import type { DownloadTemplate, DownloadTemplateRepository } from "../src/domain/download-service.js";
import type { CosGetObjectUrlParams } from "../src/infrastructure/cos-object-signer.js";

class InjectedTemplateRepository implements DownloadTemplateRepository {
  calls: string[] = [];

  async findByPublicId(publicId: string): Promise<DownloadTemplate | null> {
    this.calls.push(publicId);
    return {
      publicId,
      accessTier: "free",
      objectKey: "templates/from-document-store.xlsx",
      sha256: "f".repeat(64),
      status: "active",
    };
  }
}

describe("runtime template repository injection", () => {
  test("uses an injected template repository for download metadata and object keys", async () => {
    const templateRepository = new InjectedTemplateRepository();
    const repositories = createInMemoryRuntimeRepositories();
    repositories.templates = templateRepository;
    const signedParams: CosGetObjectUrlParams[] = [];

    const app = await createRuntimeApp({
      devicePepper: "device-pepper",
      codePepper: "code-pepper",
      recoveryPepper: "recovery-pepper",
      repositories,
      cos: {
        secretId: "secret-id",
        secretKey: "secret-key",
        bucket: "bucket",
        region: "ap-guangzhou",
        client: {
          getObjectUrl(params, callback) {
            signedParams.push(params);
            callback(null, { Url: "https://example.test/signed" });
          },
        },
      },
    });

    const register = await app.inject({
      method: "POST",
      url: "/api/device/register",
      headers: { "idempotency-key": "template-repo-register" },
    });
    const credentials = register.json() as { device_id: string; device_secret: string };

    const download = await app.inject({
      method: "POST",
      url: "/api/download",
      headers: {
        "idempotency-key": "template-repo-download",
        authorization: `Bearer ${credentials.device_secret}`,
      },
      payload: {
        device_id: credentials.device_id,
        public_id: "tpl_injected",
      },
    });

    expect(download.statusCode).toBe(200);
    expect(download.json()).toMatchObject({
      public_id: "tpl_injected",
      sha256: "f".repeat(64),
    });
    expect(templateRepository.calls).toEqual(["tpl_injected"]);
    expect(signedParams[0]?.Key).toBe("templates/from-document-store.xlsx");
  });
});
