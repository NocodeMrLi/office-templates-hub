import { describe, expect, test } from "vitest";

import {
  createRuntimeApp,
  type CloudBaseDatabase,
  type RuntimeRepositories,
} from "../src/runtime-app.js";
import {
  DocumentStoreRegistrationResultStore,
  type DocumentStoreRegistrationResultCollection,
} from "../src/infrastructure/document-store-registration-result-store.js";
import { createInMemoryRuntimeRepositories } from "../src/runtime-app.js";

class CollectionStub {
  constructor(public result: unknown = null) {}
  async findOne() { return this.result; }
  async insertIfAbsent() { return { inserted: true }; }
  async insertOne() {}
  async findActive() { return null; }
  async consumeOne() { return { allowed: true, used: 1 }; }
  async updateOne() { return { modifiedCount: 1 }; }
}

class MinimalCloudBaseDatabase implements CloudBaseDatabase {
  readonly command = {
    gt: (value: unknown) => ({ $gt: value }),
    lte: (value: unknown) => ({ $lte: value }),
    lt: (value: unknown) => ({ $lt: value }),
    inc: (value: number) => ({ $inc: value }),
  };
  collection(): unknown { return new CollectionStub(); }
}

describe("runtime CloudBase app wiring", () => {
  test("uses the CloudBase registration result store when injected", async () => {
    const repositories: RuntimeRepositories = createInMemoryRuntimeRepositories();
    repositories.registrationResults = new DocumentStoreRegistrationResultStore(
      new CollectionStub() as unknown as DocumentStoreRegistrationResultCollection,
    );

    const app = await createRuntimeApp({
      devicePepper: "device-pepper",
      codePepper: "code-pepper",
      recoveryPepper: "recovery-pepper",
      cloudbase: { envId: "test-env", client: { database: () => new MinimalCloudBaseDatabase() } },
      repositories,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/device/register",
      headers: { "idempotency-key": "cloudbase-register-key" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { device_id: string; device_secret: string };
    expect(body.device_id).not.toBe("");
    expect(body.device_secret.length).toBeGreaterThan(0);
  });

  test("builds the full CloudBase repository set when no repositories are injected", async () => {
    const app = await createRuntimeApp({
      devicePepper: "device-pepper",
      codePepper: "code-pepper",
      recoveryPepper: "recovery-pepper",
      cloudbase: { envId: "test-env", client: { database: () => new MinimalCloudBaseDatabase() } },
    });

    expect(app).toBeDefined();
  });
});
