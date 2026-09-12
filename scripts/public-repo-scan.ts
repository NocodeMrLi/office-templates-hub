export interface ScanFile {
  path: string;
  content: Buffer;
}

export interface ScanViolation {
  path: string;
  rule: string;
}

export function findPublicRepoViolations(files: readonly ScanFile[]): ScanViolation[] {
  const violations: ScanViolation[] = [];
  const localPathMarkers = ["/" + "Users/", "C:" + "\\Users\\"];
  const secretIdMarker = "AK" + "ID";
  const privateFields = ["object" + "_key", "asset" + "_id", "source" + "_path", "final" + "_rel"];

  for (const file of files) {
    if (/\.xlsx$/i.test(file.path)) {
      violations.push({ path: file.path, rule: "spreadsheet_binary" });
    }
    const text = file.content.toString("utf8");
    if (localPathMarkers.some((marker) => text.includes(marker))) {
      violations.push({ path: file.path, rule: "local_absolute_path" });
    }
    if (new RegExp(`${secretIdMarker}[A-Za-z0-9]{13,}`).test(text)) {
      violations.push({ path: file.path, rule: "tencent_secret_id" });
    }
    if (privateFields.some((field) => text.includes(`"${field}"`))) {
      violations.push({ path: file.path, rule: "private_catalog_field" });
    }
  }
  return violations;
}

function main(): void {
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const violations = findPublicRepoViolations(paths.map((path) => ({ path, content: readFileSync(path) })));
  if (violations.length > 0) {
    console.error(JSON.stringify({ passed: false, violations }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ passed: true, scanned_files: paths.length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
