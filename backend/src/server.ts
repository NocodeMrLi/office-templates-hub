import { readRuntimeConfigFromEnv } from "./runtime-config.js";
import { createRuntimeApp } from "./runtime-app.js";

const config = readRuntimeConfigFromEnv(process.env);
const app = await createRuntimeApp(config.app);

await app.listen({ host: config.host, port: config.port });
