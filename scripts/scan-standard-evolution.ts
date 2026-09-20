import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parseStandardSnapshot } from "../backend/src/domain/asset-standard-engine.js";
import { StandardEvolutionService } from "../backend/src/domain/standard-evolution-service.js";

const positional = process.argv.slice(2).filter((argument) => argument !== "--");
const basePath = positional[0];
const newAssetsPath = positional[1];
const outputPath = positional[2];
if (!basePath || !newAssetsPath || !outputPath) {
  throw new Error("usage: <standards.json> <new-assets.json> <evolution-report.json>");
}
const snapshot = parseStandardSnapshot(JSON.parse(await readFile(resolve(basePath), "utf8")) as unknown);
const input = JSON.parse(await readFile(resolve(newAssetsPath), "utf8")) as unknown;
const assets = Array.isArray(input) ? input : (input as { items?: unknown[] }).items;
if (!Array.isArray(assets)) throw new Error("new asset items are missing");

const report = new StandardEvolutionService().scan(snapshot, assets);
const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`Scanned ${report.scanned_asset_count} assets: ${report.candidates.length} candidates, ${report.no_change.length} no-change records.\n`);
