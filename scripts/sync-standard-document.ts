import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseStandardSnapshot } from "../backend/src/domain/asset-standard-engine.js";
import { synchronizeStandardDocument } from "../backend/src/domain/standard-document-synchronizer.js";
import { parseNamedArguments } from "./standard-cli-options.js";

const args = parseNamedArguments(
  process.argv.slice(2).filter((argument) => argument !== "--"),
  ["--snapshot", "--document", "--mode"],
  ["--snapshot", "--document", "--mode"],
);
const snapshotPath = resolve(args.get("--snapshot") as string);
const documentPath = resolve(args.get("--document") as string);
const mode = args.get("--mode");
if (mode !== "sync" && mode !== "check") {
  throw new Error("--mode must be sync or check");
}
const snapshot = parseStandardSnapshot(JSON.parse(await readFile(snapshotPath, "utf8")) as unknown);
const current = await readFile(documentPath, "utf8");
const synchronized = synchronizeStandardDocument(current, snapshot);

if (mode === "check") {
  if (current !== synchronized) {
    throw new Error("standard document is out of sync with the active snapshot");
  }
  process.stdout.write(`Standard document matches active snapshot ${snapshot.version}.\n`);
} else {
  if (current !== synchronized) await writeAtomically(documentPath, synchronized);
  process.stdout.write(`Synchronized standard document to snapshot ${snapshot.version}.\n`);
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
