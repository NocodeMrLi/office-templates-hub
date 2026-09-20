import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseStandardEvolutionReport } from "../backend/src/domain/standard-evolution-service.js";
import { FileStandardReleaseStore } from "../backend/src/infrastructure/standard-release-store.js";
import { parseNamedArguments } from "./standard-cli-options.js";

const args = parseNamedArguments(
  process.argv.slice(2).filter((argument) => argument !== "--"),
  ["--active", "--history", "--report", "--approved-by", "--regression-passed", "--rollback-version"],
  ["--active", "--history", "--report", "--approved-by", "--regression-passed", "--rollback-version"],
);
const regressionPassed = args.get("--regression-passed");
if (regressionPassed !== "true") {
  throw new Error("--regression-passed must be true after the regression gate succeeds");
}
const report = parseStandardEvolutionReport(
  JSON.parse(await readFile(resolve(args.get("--report") as string), "utf8")) as unknown,
);
const store = new FileStandardReleaseStore({
  activePath: resolve(args.get("--active") as string),
  historyDirectory: resolve(args.get("--history") as string),
});
const result = await store.promote(report, {
  approvedBy: args.get("--approved-by") as string,
  regressionPassed: true,
  rollbackVersion: args.get("--rollback-version") as string,
});
process.stdout.write(
  `Promoted standard snapshot ${result.change_record.from_version} -> ${result.change_record.to_version}.\n`,
);
