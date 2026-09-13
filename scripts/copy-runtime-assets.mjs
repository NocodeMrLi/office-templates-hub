import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/data", { recursive: true });
copyFileSync("data/catalog.public.json", "dist/data/catalog.public.json");
