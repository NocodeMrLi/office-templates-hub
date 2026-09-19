import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  OfficeSpreadsheetEngine,
  PUBLIC_STANDARD_VERSION,
  type OfficeSpreadsheetResult,
} from "./domain/office-spreadsheet-engine.js";
import { SpreadsheetXlsxRenderer } from "./infrastructure/spreadsheet-xlsx-renderer.js";

const SkillRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  industry: z.string().trim().min(1).max(100).optional(),
  required_fields: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  roles: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  regulated: z.boolean().optional(),
  allow_draft: z.boolean().optional(),
}).strict();

export type SkillRequest = z.infer<typeof SkillRequestSchema>;

export interface SkillResult extends OfficeSpreadsheetResult {
  next_action: { type: "download_public_asset"; public_id: string } | { type: "use_generated_file" } | null;
  output_path: string | null;
}

export async function resolveSkillRequest(
  input: unknown,
  assets: readonly unknown[],
  outputPath?: string,
): Promise<SkillResult> {
  const request = SkillRequestSchema.parse(input);
  const result = OfficeSpreadsheetEngine.fromAssets(assets, PUBLIC_STANDARD_VERSION).resolve({
    query: request.query,
    ...(request.industry === undefined ? {} : { industry: request.industry }),
    ...(request.required_fields === undefined ? {} : { requiredFields: request.required_fields }),
    ...(request.roles === undefined ? {} : { roles: request.roles }),
    ...(request.regulated === undefined ? {} : { regulated: request.regulated }),
    ...(request.allow_draft === undefined ? {} : { allowDraft: request.allow_draft }),
  });

  if (result.decision === "direct_asset" && result.asset) {
    return {
      ...result,
      next_action: { type: "download_public_asset", public_id: result.asset.public_id },
      output_path: null,
    };
  }

  if (result.specification && result.quality?.passed && outputPath) {
    const absoluteOutputPath = resolve(outputPath);
    await mkdir(dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, await new SpreadsheetXlsxRenderer().render(result.specification));
    return {
      ...result,
      next_action: { type: "use_generated_file" },
      output_path: absoluteOutputPath,
    };
  }

  return { ...result, next_action: null, output_path: null };
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArguments(argv);
  const request = JSON.parse(await readFile(args.request, "utf8")) as unknown;
  const catalog = JSON.parse(await readFile(args.catalog, "utf8")) as { items?: unknown[] };
  if (!Array.isArray(catalog.items)) {
    throw new Error("catalog items are missing");
  }
  const result = await resolveSkillRequest(request, catalog.items, args.output);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArguments(argv: readonly string[]): { request: string; catalog: string; output?: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error("usage: --request <json> [--output <xlsx>] [--catalog <catalog.json>]");
    }
    values.set(flag, value);
  }
  const request = values.get("--request");
  if (!request) {
    throw new Error("--request is required");
  }
  const output = values.get("--output");
  return {
    request: resolve(request),
    catalog: resolve(values.get("--catalog") ?? "data/catalog.public.json"),
    ...(output ? { output: resolve(output) } : {}),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2).filter((argument) => argument !== "--")).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`Skill request failed: ${message}\n`);
    process.exitCode = 1;
  });
}
