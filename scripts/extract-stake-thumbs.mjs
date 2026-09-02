import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cdpFile = process.argv[2];
const outFile = path.resolve(__dirname, "../catalog/stake-slot-thumbs.json");

if (!cdpFile) {
  console.error("Usage: node scripts/extract-stake-thumbs.mjs <cdp-response.json>");
  process.exit(1);
}

const raw = await fs.readFile(cdpFile, "utf8");
const parsed = JSON.parse(raw);
const mapJson = parsed?.result?.value;
if (!mapJson) {
  throw new Error("Could not find thumbnail map in CDP response.");
}

const thumbs = JSON.parse(mapJson);
const catalog = {
  updatedAt: new Date().toISOString(),
  source: "stake-browser-scrape",
  count: Object.keys(thumbs).length,
  thumbs,
};

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify(catalog, null, 2));
console.log(`Wrote ${catalog.count} thumbnails to ${outFile}`);
