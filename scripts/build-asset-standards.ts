import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AssetStandardEngine } from "../backend/src/domain/asset-standard-engine.js";
import { PUBLIC_STANDARD_VERSION } from "../backend/src/domain/office-spreadsheet-engine.js";

const catalogPath = resolve(process.argv[2] ?? "data/catalog.public.json");
const outputPath = resolve(process.argv[3] ?? "data/standards.public.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { items?: unknown[] };
if (!Array.isArray(catalog.items)) throw new Error("catalog items are missing");

const snapshot = AssetStandardEngine.fromAssets(catalog.items, PUBLIC_STANDARD_VERSION).snapshot();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${snapshot.standards.length} standards from ${snapshot.source_asset_count} public assets.\n`);
