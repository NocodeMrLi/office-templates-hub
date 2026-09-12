import { describe, expect, test } from "vitest";

import {
  CosObjectSigner,
  ObjectStorageSignError,
  type CosGetObjectUrlClient,
} from "../src/infrastructure/cos-object-signer.js";

describe("CosObjectSigner", () => {
  test("signs a short-lived COS object URL with the configured bucket and region", async () => {
    const calls: unknown[] = [];
    const client: CosGetObjectUrlClient = {
      getObjectUrl: (params, callback) => {
        calls.push(params);
        callback(null, { Url: "https://signed.example/private.xlsx" });
      },
    };
    const signer = new CosObjectSigner(client, {
      bucket: "office-templates-1250000000",
      region: "ap-shanghai",
      expiresSeconds: 300,
    }, () => new Date("2026-09-12T02:00:00.000Z"));

    const result = await signer.sign("templates/tpl_a2c994bc09c89d37.xlsx");

    expect(calls).toEqual([{
      Bucket: "office-templates-1250000000",
      Region: "ap-shanghai",
      Key: "templates/tpl_a2c994bc09c89d37.xlsx",
      Sign: true,
      Expires: 300,
    }]);
    expect(result).toEqual({
      url: "https://signed.example/private.xlsx",
      expiresAt: new Date("2026-09-12T02:05:00.000Z"),
    });
  });

  test("maps signer failures to a dependency error without leaking the object key", async () => {
    const client: CosGetObjectUrlClient = {
      getObjectUrl: (_params, callback) => {
        callback(new Error("permission denied for templates/private.xlsx"));
      },
    };
    const signer = new CosObjectSigner(client, {
      bucket: "office-templates-1250000000",
      region: "ap-shanghai",
      expiresSeconds: 300,
    });

    await expect(signer.sign("templates/private.xlsx")).rejects.toEqual(new ObjectStorageSignError());
  });
});
