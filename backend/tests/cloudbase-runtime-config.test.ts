import { describe, expect, test } from "vitest";

import { readRuntimeConfigFromEnv } from "../src/runtime-config.js";

describe("cloudbase runtime config", () => {
  test("parses CloudBase env id and keeps it out of .env.example", () => {
    const config = readRuntimeConfigFromEnv({
      HOST: "127.0.0.1",
      PORT: "8787",
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
      CLOUDBASE_ENV_ID: "office-templates-dev",
    });

    expect(config.app.cloudbase).toEqual({ envId: "office-templates-dev" });
  });

  test("does not expose cloudbase when env id is missing", () => {
    const config = readRuntimeConfigFromEnv({
      HOST: "127.0.0.1",
      PORT: "8787",
      DEVICE_SECRET_PEPPER: "device-pepper",
      CODE_SECRET_PEPPER: "code-pepper",
      RECOVERY_SECRET_PEPPER: "recovery-pepper",
    });

    expect(config.app.cloudbase).toBeUndefined();
  });
});
