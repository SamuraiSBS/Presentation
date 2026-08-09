import { config } from "dotenv";
import { assertProductionConfiguration } from "@studydeck/shared";

const path = process.env.PRODUCTION_ENV_FILE || ".env.production";
const loaded = config({ path, override: true });
if (loaded.error) throw new Error(`Unable to load production environment file: ${path}`);

assertProductionConfiguration(process.env);
console.log("Production configuration is safe to start.");
