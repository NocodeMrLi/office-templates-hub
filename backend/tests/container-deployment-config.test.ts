import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("container deployment config", () => {
  test("Dockerfile builds the production server without using tsx at runtime", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain("FROM node:22-alpine AS build");
    expect(dockerfile).toContain("corepack enable");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm build");
    expect(dockerfile).toContain("FROM node:22-alpine AS runtime");
    expect(dockerfile).toContain("CMD [\"node\", \"dist/backend/src/server.js\"]");
    expect(dockerfile).not.toContain("tsx");
  });

  test("dockerignore excludes local secrets and private generated artifacts", () => {
    const dockerignore = readFileSync(".dockerignore", "utf8").split(/\r?\n/);

    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain(".env.*");
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain("dist");
    expect(dockerignore).toContain("*.private.json");
    expect(dockerignore).toContain("*.private.txt");
  });
});
