import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

describe("production build configuration", () => {
  test("defines build and start scripts for cloud deployment", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(pkg.scripts.build).toBe("tsc -p tsconfig.build.json && node scripts/copy-runtime-assets.mjs");
    expect(pkg.scripts.start).toBe("node dist/backend/src/server.js");
    expect(pkg.scripts.verify).toContain("pnpm build");
    expect(pkg.scripts.start).not.toContain("tsx");
  });

  test("production tsconfig emits only runtime backend code", () => {
    const config = JSON.parse(readFileSync("tsconfig.build.json", "utf8")) as {
      extends: string;
      compilerOptions: Record<string, unknown>;
      include: string[];
      exclude: string[];
    };

    expect(config.extends).toBe("./tsconfig.json");
    expect(config.compilerOptions).toMatchObject({
      noEmit: false,
      outDir: "dist",
      rootDir: ".",
      types: ["node"],
    });
    expect(config.include).toEqual(["backend/src/**/*.ts"]);
    expect(config.exclude).toContain("backend/tests/**/*.ts");
    expect(config.exclude).toContain("scripts/**/*.ts");
  });
});
