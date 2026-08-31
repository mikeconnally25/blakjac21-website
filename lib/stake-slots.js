import fs from "fs/promises";
import path from "path";

const CATALOG_FILE = path.resolve("data/stake-slot-catalog.json");
const CATALOG_KEY = "bh:slot-catalog";

export const ALLOWED_SLOT_GROUPS = [
  {
    slug: "new-releases",
    label: "New Releases",
    url: "https://stake.bet/casino/group/new-releases",
  },
  {
    slug: "only-on-stake",
    label: "Only on Stake",
    url: "https://stake.bet/casino/group/only-on-stake",
  },
];

const GROUP_GAMES_QUERY = `
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

let memoryCatalog = null;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function normalizeSlot(raw, group) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const name = String(raw.name || "").trim();
  const slug = String(raw.slug || "").trim().toLowerCase();

  if (!name || !slug) {
    return null;
  }

  return {
    name,
    slug,
    groupSlug: group.slug,
    groupLabel: group.label,
    groupUrl: group.url,
  };
}

function dedupeSlots(slots) {
  const seen = new Set();
  const result = [];

  for (const slot of slots) {
    const key = `${slot.groupSlug}:${slot.slug}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(slot);
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function getGraphqlUrls() {
  const configured = process.env.STAKE_GRAPHQL_URL;
  if (configured) {
    return [configured.replace(/\/$/, "")];
  }

  return ["https://stake.com/_api/graphql", "https://stake.bet/_api/graphql"];
}

async function fetchGroupSlotsFromGraphql(group, graphqlUrl) {
  const slots = [];
  const limit = 50;
  let offset = 0;
  let pages = 0;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: "https://stake.com",
    Referer: group.url,
  };

  if (process.env.STAKE_ACCESS_TOKEN) {
    headers["x-access-token"] = process.env.STAKE_ACCESS_TOKEN;
  }

  while (pages < 20) {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: GROUP_GAMES_QUERY,
        variables: {
          slug: group.slug,
          limit,
          offset,
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Stake catalog request failed (${response.status}).`);
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors[0]?.message || "Stake catalog query failed.");
    }

    const entries = payload.data?.slugKuratorGroup?.groupGamesList || [];
    if (!entries.length) {
      break;
    }

    for (const entry of entries) {
      const slot = normalizeSlot(entry?.game, group);
      if (slot) {
        slots.push(slot);
      }
    }

    if (entries.length < limit) {
      break;
    }

    offset += limit;
    pages += 1;
  }

  return slots;
}

async function fetchCatalogFromStake() {
  const errors = [];

  for (const graphqlUrl of getGraphqlUrls()) {
    try {
      const groups = [];

      for (const group of ALLOWED_SLOT_GROUPS) {
        const slots = await fetchGroupSlotsFromGraphql(group, graphqlUrl);
        groups.push({
          ...group,
          slots,
        });
      }

      const slots = dedupeSlots(groups.flatMap((group) => group.slots));

      if (!slots.length) {
        throw new Error("Stake returned no slots for the allowed groups.");
      }

      return {
        updatedAt: new Date().toISOString(),
        source: graphqlUrl,
        groups,
        slots,
      };
    } catch (error) {
      errors.push(`${graphqlUrl}: ${error.message}`);
    }
  }

  throw new Error(errors.join(" | ") || "Could not load Stake slot catalog.");
}

async function readRedisCatalog() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${CATALOG_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (!data.result) return null;

  try {
    return JSON.parse(data.result);
  } catch {
    return null;
  }
}

async function writeRedisCatalog(catalog) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(catalog));
  const response = await fetch(`${config.url}/set/${CATALOG_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;

  const data = await response.json();
  return data.result === "OK";
}

async function readFileCatalog() {
  try {
    const raw = await fs.readFile(CATALOG_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return buildEmptyCatalog();
  }
}

function buildEmptyCatalog() {
  return {
    updatedAt: null,
    source: "empty",
    groups: ALLOWED_SLOT_GROUPS.map((group) => ({
      ...group,
      slots: [],
    })),
    slots: [],
  };
}

async function getCachedCatalog() {
  if (memoryCatalog) {
    return memoryCatalog;
  }

  const redisCatalog = await readRedisCatalog();
  if (redisCatalog) {
    memoryCatalog = redisCatalog;
    return redisCatalog;
  }

  const fileCatalog = await readFileCatalog();
  if (fileCatalog) {
    memoryCatalog = fileCatalog;
    return fileCatalog;
  }

  return null;
}

async function writeFileCatalog(catalog) {
  await fs.mkdir(path.dirname(CATALOG_FILE), { recursive: true });
  await fs.writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2));
}

export function findAllowedSlot(catalog, { slug, name }) {
  const slots = catalog?.slots || [];
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim().toLowerCase();

  return slots.find((slot) => {
    if (normalizedSlug && slot.slug === normalizedSlug) {
      return true;
    }

    return normalizedName && slot.name.toLowerCase() === normalizedName;
  });
}

export function findAllowedSlotByQuery(catalog, query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return { slot: null, matches: [] };
  }

  const direct = findAllowedSlot(catalog, { slug: trimmed, name: trimmed });
  if (direct) {
    return { slot: direct, matches: [direct] };
  }

  const normalized = trimmed.toLowerCase();
  const slugQuery = normalized.replace(/\s+/g, "-");
  const matches = (catalog?.slots || []).filter((slot) => {
    const slotName = slot.name.toLowerCase();
    return (
      slotName.includes(normalized) ||
      slot.slug.includes(slugQuery) ||
      slotName === normalized
    );
  });

  if (matches.length === 1) {
    return { slot: matches[0], matches };
  }

  return { slot: null, matches };
}

export async function getAllowedSlotCatalog({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    return refreshAllowedSlotCatalog();
  }

  const cached = await getCachedCatalog();
  if (cached?.slots?.length) {
    return cached;
  }

  if (cached && !cached.slots?.length) {
    return cached;
  }

  try {
    const catalog = await fetchCatalogFromStake();
    memoryCatalog = catalog;
    await writeRedisCatalog(catalog).catch(() => {});
    await writeFileCatalog(catalog).catch(() => {});
    return catalog;
  } catch {
    return cached || buildEmptyCatalog();
  }
}

export async function refreshAllowedSlotCatalog() {
  const catalog = await fetchCatalogFromStake();
  memoryCatalog = catalog;
  memoryCatalogLoadedAt = Date.now();
  await writeRedisCatalog(catalog).catch(() => {});
  await writeFileCatalog(catalog).catch(() => {});
  return catalog;
}
