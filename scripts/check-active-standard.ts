import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseStandardSnapshot } from "../backend/src/domain/asset-standard-engine.js";
import { OfficeSpreadsheetEngine } from "../backend/src/domain/office-spreadsheet-engine.js";
import { parseNamedArguments } from "./standard-cli-options.js";

const args = parseNamedArguments(
  process.argv.slice(2).filter((argument) => argument !== "--"),
  ["--catalog", "--snapshot"],
  [],
);
const catalogPath = resolve(args.get("--catalog") ?? "data/catalog.public.json");
const snapshotPath = resolve(args.get("--snapshot") ?? "data/standards.public.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { items?: unknown[] };
if (!Array.isArray(catalog.items)) throw new Error("catalog items are missing");
const snapshot = parseStandardSnapshot(JSON.parse(await readFile(snapshotPath, "utf8")) as unknown);
OfficeSpreadsheetEngine.fromSnapshot(catalog.items, snapshot);
process.stdout.write(
  `Active standard snapshot ${snapshot.version} matches ${snapshot.source_asset_count} catalog assets across ${snapshot.standards.length} standards.\n`,
);
