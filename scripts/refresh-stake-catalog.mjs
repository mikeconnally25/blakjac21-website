import { fileURLToPath } from "url";
import path from "path";
import { refreshAllowedSlotCatalog } from "../lib/stake-slots.js";
import { loadProjectEnv } from "../lib/load-dotenv.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadProjectEnv(rootDir);

async function main() {
  try {
    const catalog = await refreshAllowedSlotCatalog();
    console.log(`Loaded ${catalog.slots.length} allowed slots from ${catalog.source}.`);
    console.log("Saved to Redis (if configured), data/stake-slot-catalog.json, and catalog/stake-allowed-slots.json.");
    console.log("Commit catalog/stake-allowed-slots.json and push if Vercel cannot reach Stake directly.");
  } catch (error) {
    console.error(error.message);
    console.error("Run npm run verify:stake first and add STAKE_ACCESS_TOKEN to .env.");
    process.exit(1);
  }
}

main();
