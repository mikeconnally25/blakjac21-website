import fs from "fs/promises";
import path from "path";
import { cleanEnv } from "./config.js";

const DATA_DIR = path.resolve("data");
const CATALOG_FILE = path.join(DATA_DIR, "stake-slot-catalog.json");
const FALLBACK_CATALOG_FILE = path.resolve("catalog/stake-allowed-slots.json");
const CATALOG_KEY = "bh:slot-catalog";

export const ALLOWED_SLOT_GROUPS = [
  {
    slug: "new-releases",
    label: "New Releases",
    url: "https://stake.com/casino/group/new-releases",
  },
  {
    slug: "only-on-stake",
    label: "Only on Stake",
    url: "https://stake.com/casino/group/only-on-stake",
  },
];

const ALLOWED_GROUP_SLUGS = new Set(
  ALLOWED_SLOT_GROUPS.map((group) => group.slug)
);

export function isAllowedSlotGroup(groupSlug) {
  return ALLOWED_GROUP_SLUGS.has(String(groupSlug || "").trim());
}

export function isAllowedSlot(slot) {
  return Boolean(
    slot?.slug &&
      slot?.name &&
      isAllowedSlotGroup(slot.groupSlug) &&
      ALLOWED_SLOT_GROUPS.some((group) => group.slug === slot.groupSlug)
  );
}

function filterAllowedSlots(slots) {
  return (slots || []).filter(isAllowedSlot);
}

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

const STAKE_SITE_URL = "https://stake.com";
const STAKE_GRAPHQL_URL = `${STAKE_SITE_URL}/_api/graphql`;

function getStakeAccessToken() {
  return cleanEnv(process.env.STAKE_ACCESS_TOKEN);
}

function buildGraphqlHeaders(group) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "x-language": "en",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: STAKE_SITE_URL,
    Referer: `${STAKE_SITE_URL}/casino/group/${group.slug}`,
  };

  const accessToken = getStakeAccessToken();
  if (accessToken) {
    headers["x-access-token"] = accessToken;
  }

  const cfClearance = cleanEnv(process.env.STAKE_CF_CLEARANCE);
  if (cfClearance) {
    headers.Cookie = `cf_clearance=${cfClearance}`;
  }

  return headers;
}

export function formatStakeCatalogError(error) {
  const message = error?.message || "Could not load Stake slot catalog.";
  if (/403/.test(message)) {
    return `${message} Stake blocks automated requests from servers. Use Import slot list in the admin panel: open stake.com in your browser, copy the GraphQL response from the Network tab for New Releases and Only on Stake, then paste and import.`;
  }

  if (!getStakeAccessToken()) {
    return `${message} Add STAKE_ACCESS_TOKEN in Vercel, import slots from your browser, or run npm run refresh:slots locally and commit catalog/stake-allowed-slots.json.`;
  }

  return message;
}

function getGraphqlUrls() {
  const configured = process.env.STAKE_GRAPHQL_URL;
  if (configured) {
    return [configured.replace(/\/$/, "")];
  }

  return [STAKE_GRAPHQL_URL];
}

async function fetchGroupSlotsFromGraphql(group, graphqlUrl = STAKE_GRAPHQL_URL) {
  const slots = [];
  const limit = 50;
  let offset = 0;
  let pages = 0;
  const headers = buildGraphqlHeaders(group);

  while (pages < 20) {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operationName: "SlugKuratorGroup",
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

      const slots = filterAllowedSlots(dedupeSlots(groups.flatMap((group) => group.slots)));

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

  const fallback = await readFallbackCatalog();
  if (fallback?.slots?.length) {
    return fallback;
  }

  throw new Error(errors.join(" | ") || "Could not load Stake slot catalog.");
}

async function readFallbackCatalog() {
  try {
    const raw = await fs.readFile(FALLBACK_CATALOG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const catalog = sanitizeCatalog({
      updatedAt: parsed.updatedAt,
      source: parsed.source || "fallback",
      groups: parsed.groups,
      slots: parsed.slots,
    });

    return catalog.slots.length ? catalog : null;
  } catch {
    return null;
  }
}

async function writeFallbackCatalog(catalog) {
  if (!catalog?.slots?.length) {
    return;
  }

  await fs.mkdir(path.dirname(FALLBACK_CATALOG_FILE), { recursive: true });
  await fs.writeFile(
    FALLBACK_CATALOG_FILE,
    JSON.stringify(
      {
        updatedAt: catalog.updatedAt,
        source: catalog.source,
        slots: catalog.slots,
      },
      null,
      2
    )
  );
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

function sanitizeCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    return buildEmptyCatalog();
  }

  const slots = filterAllowedSlots(catalog.slots);
  const groups = ALLOWED_SLOT_GROUPS.map((group) => {
    const existing = catalog.groups?.find((entry) => entry.slug === group.slug);
    return {
      ...group,
      slots: filterAllowedSlots(
        existing?.slots?.length
          ? existing.slots
          : slots.filter((slot) => slot.groupSlug === group.slug)
      ),
    };
  });

  return {
    ...catalog,
    groups,
    slots,
  };
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
    return sanitizeCatalog(memoryCatalog);
  }

  const redisCatalog = await readRedisCatalog();
  if (redisCatalog) {
    memoryCatalog = sanitizeCatalog(redisCatalog);
    return memoryCatalog;
  }

  const fileCatalog = await readFileCatalog();
  if (fileCatalog) {
    memoryCatalog = sanitizeCatalog(fileCatalog);
    return memoryCatalog;
  }

  return null;
}

async function writeFileCatalog(catalog) {
  await fs.mkdir(path.dirname(CATALOG_FILE), { recursive: true });
  await fs.writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2));
}

export function findAllowedSlot(catalog, { slug, name }) {
  const slots = filterAllowedSlots(catalog?.slots);
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim().toLowerCase();

  return slots.find((slot) => {
    if (!isAllowedSlot(slot)) {
      return false;
    }

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
  const matches = filterAllowedSlots(catalog?.slots).filter((slot) => {
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

  try {
    const catalog = sanitizeCatalog(await fetchCatalogFromStake());
    memoryCatalog = catalog;
    await writeRedisCatalog(catalog).catch(() => {});
    await writeFileCatalog(catalog).catch(() => {});
    return catalog;
  } catch {
    const fallback = await readFallbackCatalog();
    if (fallback?.slots?.length) {
      memoryCatalog = fallback;
      return fallback;
    }

    return cached || buildEmptyCatalog();
  }
}

export async function refreshAllowedSlotCatalog() {
  const catalog = sanitizeCatalog(await fetchCatalogFromStake());
  return saveCatalog(catalog);
}

function slugFromName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slotsFromLineList(text) {
  const slots = [];
  let currentGroup = null;

  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed === "new-releases" || trimmed === "only-on-stake") {
      currentGroup = ALLOWED_SLOT_GROUPS.find((group) => group.slug === trimmed);
      continue;
    }

    if (!currentGroup) {
      continue;
    }

    const slot = normalizeSlot(
      { name: trimmed, slug: slugFromName(trimmed) },
      currentGroup
    );
    if (slot) {
      slots.push(slot);
    }
  }

  return slots;
}

function slotsFromSimpleObject(parsed) {
  const slots = [];

  for (const group of ALLOWED_SLOT_GROUPS) {
    const names = parsed[group.slug];
    if (!Array.isArray(names)) {
      continue;
    }

    for (const name of names) {
      const slot = normalizeSlot(
        { name: String(name).trim(), slug: slugFromName(name) },
        group
      );
      if (slot) {
        slots.push(slot);
      }
    }
  }

  return slots;
}

function resolveGroupFromLabel(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (normalized.includes("only on stake")) {
    return ALLOWED_SLOT_GROUPS.find((group) => group.slug === "only-on-stake");
  }
  if (normalized.includes("new release")) {
    return ALLOWED_SLOT_GROUPS.find((group) => group.slug === "new-releases");
  }
  return null;
}

function slotsFromGraphqlPayload(payload, fallbackGroupSlug) {
  const groupNode = payload?.data?.slugKuratorGroup;
  if (!groupNode) {
    return [];
  }

  const group =
    resolveGroupFromLabel(groupNode.name) ||
    ALLOWED_SLOT_GROUPS.find((entry) => entry.slug === fallbackGroupSlug);

  if (!group) {
    return [];
  }

  return (groupNode.groupGamesList || [])
    .map((entry) => normalizeSlot(entry?.game, group))
    .filter(Boolean);
}

function slotsFromRawList(list) {
  return list
    .map((raw) => {
      const group = ALLOWED_SLOT_GROUPS.find((entry) => entry.slug === raw.groupSlug);
      if (!group) {
        return null;
      }

      return normalizeSlot(raw, group);
    })
    .filter(Boolean);
}

export function extractSlotsFromImport(payload) {
  const slots = [];

  function addFromValue(value, fallbackGroupSlug) {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        addFromValue(item, fallbackGroupSlug);
      }
      return;
    }

    if (value?.data?.slugKuratorGroup) {
      slots.push(...slotsFromGraphqlPayload(value, fallbackGroupSlug));
      return;
    }

    if (Array.isArray(value.slots)) {
      slots.push(...slotsFromRawList(value.slots));
      return;
    }

    if (value.name && value.slug && value.groupSlug) {
      slots.push(...slotsFromRawList([value]));
    }
  }

  let parsed = payload;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      slots.push(...slotsFromLineList(parsed));
      return filterAllowedSlots(dedupeSlots(slots));
    }
  }

  if (parsed?.text) {
    slots.push(...slotsFromLineList(parsed.text));
  }

  if (parsed?.["new-releases"] || parsed?.["only-on-stake"]) {
    slots.push(...slotsFromSimpleObject(parsed));
  }

  if (parsed?.newReleases) {
    addFromValue(parsed.newReleases, "new-releases");
  }
  if (parsed?.onlyOnStake) {
    addFromValue(parsed.onlyOnStake, "only-on-stake");
  }
  if (parsed?.imports) {
    addFromValue(parsed.imports);
  }
  if (parsed?.graphql) {
    addFromValue(parsed.graphql);
  }

  addFromValue(parsed);

  return filterAllowedSlots(dedupeSlots(slots));
}

async function saveCatalog(catalog) {
  memoryCatalog = catalog;
  await writeRedisCatalog(catalog).catch(() => {});
  await writeFileCatalog(catalog).catch(() => {});
  await writeFallbackCatalog(catalog).catch(() => {});
  return catalog;
}

export async function importAllowedSlotCatalog(payload) {
  let parsed = payload;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = { text: payload };
    }
  }

  const slots = extractSlotsFromImport(parsed);
  if (!slots.length) {
    throw new Error(
      "No valid slots found. Use the stake.com console script, paste slot names, or paste GraphQL JSON."
    );
  }

  const catalog = sanitizeCatalog({
    updatedAt: new Date().toISOString(),
    source: "import",
    slots,
  });

  if (!catalog.slots.length) {
    throw new Error(
      "Imported slots must be from New Releases or Only on Stake on stake.com."
    );
  }

  return saveCatalog(catalog);
}
