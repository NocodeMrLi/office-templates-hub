import { resolve } from "node:path";

import { FileStandardReleaseStore } from "../backend/src/infrastructure/standard-release-store.js";
import { parseNamedArguments } from "./standard-cli-options.js";

const args = parseNamedArguments(
  process.argv.slice(2).filter((argument) => argument !== "--"),
  ["--active", "--history", "--target-version", "--approved-by", "--reason"],
  ["--active", "--history", "--target-version", "--approved-by", "--reason"],
);
const store = new FileStandardReleaseStore({
  activePath: resolve(args.get("--active") as string),
  historyDirectory: resolve(args.get("--history") as string),
});
const result = await store.rollback(args.get("--target-version") as string, {
  approvedBy: args.get("--approved-by") as string,
  reason: args.get("--reason") as string,
});
process.stdout.write(`Rolled back standard snapshot ${result.from_version} -> ${result.to_version}.\n`);
