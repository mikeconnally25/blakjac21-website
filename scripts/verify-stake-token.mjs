import { fileURLToPath } from "url";
import path from "path";
import { cleanEnv } from "../lib/config.js";
import {
  loadProjectEnv,
  readEnvKeyFromFiles,
} from "../lib/load-dotenv.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loadedFiles = loadProjectEnv(rootDir);

const QUERY = `
  query SlugKuratorGroup($slug: String!, $limit: Int!, $offset: Int!) {
    slugKuratorGroup(slug: $slug) {
      name
      groupGamesList(limit: $limit, offset: $offset) {
        game {
          name
          slug
        }
      }
    }
  }
`;

const ENDPOINTS = [
  { url: "https://stake.com/_api/graphql", site: "stake.com" },
  { url: "https://stake.bet/_api/graphql", site: "stake.bet" },
];

async function testEndpoint({ url, site }, token) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "x-language": "en",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: `https://${site}`,
    Referer: `https://${site}/casino/group/new-releases`,
  };

  if (token) {
    headers["x-access-token"] = token;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      operationName: "SlugKuratorGroup",
      query: QUERY,
      variables: {
        slug: "new-releases",
        limit: 5,
        offset: 0,
      },
    }),
  });

  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { parseError: text.slice(0, 200) };
  }

  const games =
    data.data?.slugKuratorGroup?.groupGamesList
      ?.map((entry) => entry?.game?.name)
      .filter(Boolean) || [];

  return { response, data, games, site };
}

function finish(code) {
  setTimeout(() => process.exit(code), 0);
}

async function main() {
  let token = cleanEnv(process.env.STAKE_ACCESS_TOKEN);

  if (loadedFiles.length) {
    console.log("Loaded env files:");
    for (const file of loadedFiles) {
      console.log(`- ${file}`);
    }
    console.log("");
  } else {
    console.log("No .env or .env.local file was found.");
    console.log(`Checked from: ${rootDir}`);
    console.log(`Current folder: ${process.cwd()}`);
    console.log("");
  }

  if (!token) {
    const fromFile = readEnvKeyFromFiles(rootDir, "STAKE_ACCESS_TOKEN");
    if (fromFile) {
      process.env.STAKE_ACCESS_TOKEN = fromFile.value;
      token = cleanEnv(fromFile.value);
      console.log(`Found STAKE_ACCESS_TOKEN in ${fromFile.envPath}`);
      console.log("");
    }
  }

  console.log(
    token
      ? `Testing with STAKE_ACCESS_TOKEN (${token.length} characters)`
      : "STAKE_ACCESS_TOKEN is missing from .env"
  );
  console.log("");

  if (!token) {
    console.error("Add this line to .env and save the file (Ctrl+S):");
    console.error("STAKE_ACCESS_TOKEN=your_token_from_stake.com");
    console.error("");
    console.error("If the line is already in the editor, it may not be saved to disk yet.");
    finish(1);
    return;
  }

  let lastStatus = null;

  for (const endpoint of ENDPOINTS) {
    const { response, data, games, site } = await testEndpoint(endpoint, token);
    lastStatus = response.status;

    console.log(`${endpoint.url}: HTTP ${response.status}`);

    if (response.ok && games.length) {
      console.log(`SUCCESS on ${site} - sample slots: ${games.join(", ")}`);
      console.log("");
      console.log("Next steps:");
      console.log("1. npm run refresh:slots");
      console.log("2. Add the same STAKE_ACCESS_TOKEN to Vercel");
      console.log("3. Commit catalog/stake-allowed-slots.json and push");
      finish(0);
      return;
    }

    if (data.errors?.length) {
      console.log("GraphQL errors:");
      console.log(JSON.stringify(data.errors, null, 2));
    } else if (data.parseError) {
      console.log("Non-JSON response (often Cloudflare):");
      console.log(data.parseError);
    } else if (!response.ok) {
      console.log(`Stake blocked this request on ${site}.`);
    } else {
      console.log("Request succeeded but returned no games for new-releases.");
      console.log(
        JSON.stringify(
          {
            groupName: data.data?.slugKuratorGroup?.name ?? null,
            gameCount: data.data?.slugKuratorGroup?.groupGamesList?.length ?? 0,
          },
          null,
          2
        )
      );
    }

    console.log("");
  }

  console.error("FAILED - Stake catalog requests did not return games.");
  console.error("");
  if (lastStatus === 403) {
    console.error("HTTP 403 usually means:");
    console.error("- Token was created on a different site (stake.com vs stake.bet)");
    console.error("- Stake/Cloudflare blocked the request from this network");
    console.error("");
    console.error("Try creating the token on the same site you use in the browser.");
  }
  console.error("Token path: Settings → Security → API Tokens on stake.com");
  console.error("Then run: npm run refresh:slots");
  finish(1);
}

main().catch((error) => {
  console.error(error.message);
  finish(1);
});
