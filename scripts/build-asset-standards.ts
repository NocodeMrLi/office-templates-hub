import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AssetStandardEngine } from "../backend/src/domain/asset-standard-engine.js";
import { parseNamedArguments } from "./standard-cli-options.js";

const args = parseNamedArguments(
  process.argv.slice(2).filter((argument) => argument !== "--"),
  ["--catalog", "--version", "--output", "--active"],
  ["--version", "--output"],
);
const catalogPath = resolve(args.get("--catalog") ?? "data/catalog.public.json");
const outputPath = resolve(args.get("--output") as string);
const activePath = resolve(args.get("--active") ?? "data/standards.public.json");
const version = args.get("--version") as string;
if (outputPath === activePath) {
  throw new Error("candidate output must not overwrite the active standard snapshot");
}
const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { items?: unknown[] };
if (!Array.isArray(catalog.items)) throw new Error("catalog items are missing");

const snapshot = AssetStandardEngine.fromAssets(catalog.items, version).snapshot();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`Wrote ${snapshot.standards.length} standards from ${snapshot.source_asset_count} public assets.\n`);
