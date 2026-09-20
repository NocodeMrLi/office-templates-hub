export function parseNamedArguments(
  argv: readonly string[],
  allowed: readonly string[],
  required: readonly string[],
): ReadonlyMap<string, string> {
  if (argv.length % 2 !== 0) {
    throw new Error("every option must have a value");
  }
  const allowedSet = new Set(allowed);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !value || !name.startsWith("--")) {
      throw new Error("options must use --name value pairs");
    }
    if (!allowedSet.has(name)) throw new Error(`unknown option: ${name}`);
    if (values.has(name)) throw new Error(`duplicate option: ${name}`);
    values.set(name, value);
  }
  for (const name of required) {
    if (!values.get(name)) throw new Error(`missing required option: ${name}`);
  }
  return values;
}
