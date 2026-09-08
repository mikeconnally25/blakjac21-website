import fs from "fs/promises";
import path from "path";
import { cleanEnv } from "./config.js";

const DATA_DIR = path.resolve("data");
const CATALOG_FILE = path.join(DATA_DIR, "stake-slot-catalog.json");
const FALLBACK_CATALOG_FILE = path.resolve("catalog/stake-allowed-slots.json");
const THUMBNAIL_INDEX_FILE = path.resolve("catalog/stake-slot-thumbs.json");
const CATALOG_KEY = "bh:slot-catalog";
const THUMBNAIL_INDEX_KEY = "bh:slot-thumbs";
const CATALOG_SYNC_KEY = "bh:slot-catalog-sync";
const CATALOG_SYNC_HEALTH_KEY = "bh:slot-catalog-sync-health";
const INCREMENTAL_PAGE_LIMIT = 50;
const INCREMENTAL_PAGES_PER_TICK = 4;

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

export function normalizeSlotThumbnailUrl(url) {
  const value = String(url || "").trim();
  if (!value) {
    return null;
  }

  const normalized = value.startsWith("//") ? `https:${value}` : value;
  const base = normalized.split("?")[0];
  return `${base}?w=150&h=200&fit=min&auto=format`;
}

export function getSlotCatalogThumbnailStats(slots) {
  const list = filterAllowedSlots(slots);
  const withThumbnails = list.filter((slot) => slot.thumbnailUrl).length;
  return {
    total: list.length,
    withThumbnails,
    missingThumbnails: Math.max(0, list.length - withThumbnails),
  };
}

function normalizeSlotNameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mergeSlotRecords(existing, incoming) {
  if (!existing) {
    return { ...incoming };
  }

  return {
    ...existing,
    ...incoming,
    name: incoming.name || existing.name,
    slug: incoming.slug || existing.slug,
    groupSlug: incoming.groupSlug || existing.groupSlug,
    groupLabel: incoming.groupLabel || existing.groupLabel,
    groupUrl: incoming.groupUrl || existing.groupUrl,
    provider: incoming.provider || existing.provider || null,
    thumbnailUrl:
      normalizeSlotThumbnailUrl(incoming.thumbnailUrl) ||
      normalizeSlotThumbnailUrl(existing.thumbnailUrl),
  };
}

export function mergeSlotCatalogs(existingCatalog, incomingSlots) {
  const existingSlots = filterAllowedSlots(existingCatalog?.slots);
  const incoming = filterAllowedSlots(incomingSlots);
  const mergedBySlug = new Map();
  const nameIndex = new Map();

  for (const slot of existingSlots) {
    mergedBySlug.set(slot.slug, { ...slot });
    nameIndex.set(normalizeSlotNameKey(slot.name), slot.slug);
  }

  for (const slot of incoming) {
    const nameKey = normalizeSlotNameKey(slot.name);
    const existingSlug = mergedBySlug.has(slot.slug)
      ? slot.slug
      : nameIndex.get(nameKey);
    const existing = existingSlug ? mergedBySlug.get(existingSlug) : null;
    const next = mergeSlotRecords(existing, slot);

    if (existingSlug && existingSlug !== slot.slug) {
      mergedBySlug.delete(existingSlug);
      nameIndex.delete(normalizeSlotNameKey(existing?.name));
    }

    mergedBySlug.set(next.slug, next);
    nameIndex.set(nameKey, next.slug);
  }

  return sanitizeCatalog({
    updatedAt: new Date().toISOString(),
    source: existingCatalog?.source || "import",
    slots: dedupeSlots([...mergedBySlug.values()]),
    groups: existingCatalog?.groups,
  });
}

const GROUP_GAMES_QUERY = `
  query SlugKuratorGroup($slug: String!, $limit: Int!, $offset: Int!) {
    slugKuratorGroup(slug: $slug) {
      name
      groupGamesList(limit: $limit, offset: $offset) {
        game {
          name
          slug
          thumbnailUrl
          groupGames {
            group {
              translation
              type
            }
          }
        }
      }
    }
  }
`;

let memoryCatalog = null;
let memoryThumbnailIndex = null;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function extractSlotProvider(raw) {
  for (const entry of raw?.groupGames || []) {
    const group = entry?.group;
    const type = String(group?.type || "").toLowerCase();
    if (type === "provider" || type === "gameprovider") {
      const label = String(group.translation || "").trim();
      if (label) {
        return label;
      }
    }
  }

  return "";
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

  const provider =
    String(raw.provider || "").trim() || extractSlotProvider(raw) || null;
  const thumbnailUrl = normalizeSlotThumbnailUrl(raw.thumbnailUrl);

  return {
    name,
    slug,
    groupSlug: group.slug,
    groupLabel: group.label,
    groupUrl: group.url,
    provider,
    thumbnailUrl,
  };
}

function dedupeSlots(slots) {
  const bySlug = new Map();

  for (const slot of slots) {
    if (!slot?.slug) {
      continue;
    }

    const existing = bySlug.get(slot.slug);
    if (!existing) {
      bySlug.set(slot.slug, {
        ...slot,
        groupSlugs: [slot.groupSlug].filter(Boolean),
      });
      continue;
    }

    const groupSlugs = [
      ...new Set(
        [...(existing.groupSlugs || [existing.groupSlug]), slot.groupSlug].filter(
          Boolean
        )
      ),
    ];
    const merged = mergeSlotRecords(existing, slot);
    bySlug.set(slot.slug, {
      ...merged,
      groupSlugs,
      // Prefer Only on Stake when a game appears in both sections.
      groupSlug: groupSlugs.includes("only-on-stake")
        ? "only-on-stake"
        : merged.groupSlug || existing.groupSlug,
      groupLabel: groupSlugs.includes("only-on-stake")
        ? "Only on Stake"
        : merged.groupLabel || existing.groupLabel,
    });
  }

  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function slotBelongsToGroup(slot, groupSlug) {
  if (!slot || !groupSlug) {
    return false;
  }

  if (slot.groupSlug === groupSlug) {
    return true;
  }

  return Array.isArray(slot.groupSlugs) && slot.groupSlugs.includes(groupSlug);
}

const STAKE_SITE_URL = "https://stake.com";
const STAKE_GRAPHQL_URL = `${STAKE_SITE_URL}/_api/graphql`;

function getStakeAccessToken() {
  return cleanEnv(process.env.STAKE_ACCESS_TOKEN);
}

export function isStakeSyncConfigured() {
  return Boolean(getStakeAccessToken());
}

function getStakeCookieHeader() {
  const fullCookie = cleanEnv(process.env.STAKE_COOKIE);
  if (fullCookie) {
    return fullCookie;
  }

  const cfClearance = cleanEnv(process.env.STAKE_CF_CLEARANCE);
  if (!cfClearance) {
    return "";
  }

  // Allow either raw cookie value or a full "cf_clearance=..." pair.
  return cfClearance.includes("=")
    ? cfClearance
    : `cf_clearance=${cfClearance}`;
}

export function isStakeCookieConfigured() {
  return Boolean(getStakeCookieHeader());
}

function buildGraphqlHeaders(group) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "x-language": "en",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: STAKE_SITE_URL,
    Referer: `${STAKE_SITE_URL}/casino/group/${group.slug}`,
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };

  const accessToken = getStakeAccessToken();
  if (accessToken) {
    headers["x-access-token"] = accessToken;
  }

  const cookie = getStakeCookieHeader();
  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

export function formatStakeCatalogError(error) {
  const message = error?.message || "Could not load Stake slot catalog.";
  if (/403|cloudflare|just a moment|attention required/i.test(message)) {
    if (!isStakeCookieConfigured()) {
      return `${message} Cloudflare is blocking Vercel. Add STAKE_COOKIE (full Cookie header from stake.com) or STAKE_CF_CLEARANCE in Vercel, then redeploy.`;
    }
    return `${message} Cloudflare is still blocking Vercel IPs. Refresh STAKE_COOKIE from a logged-in stake.com tab, or run npm run refresh:slots locally and commit the catalog.`;
  }

  if (!getStakeAccessToken()) {
    return `${message} Add STAKE_ACCESS_TOKEN in Vercel (and STAKE_COOKIE if Cloudflare still blocks), then redeploy.`;
  }

  return message;
}

let memorySyncHealth = null;

async function readRedisSyncHealth() {
  const config = getRedisConfig();
  if (!config) {
    return null;
  }

  try {
    const response = await fetch(`${config.url}/get/${CATALOG_SYNC_HEALTH_KEY}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const raw = payload?.result;
    if (!raw) {
      return null;
    }
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function writeRedisSyncHealth(health) {
  const config = getRedisConfig();
  if (!config) {
    return;
  }

  await fetch(`${config.url}/set/${CATALOG_SYNC_HEALTH_KEY}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: JSON.stringify(health),
    }),
  });
}

async function writeSyncHealth(health) {
  memorySyncHealth = health;
  try {
    await writeRedisSyncHealth(health);
  } catch {
    // Memory health is enough for this process.
  }
  return health;
}

export async function getStakeSyncHealth() {
  const configured = isStakeSyncConfigured();
  const cookieConfigured = isStakeCookieConfigured();
  const stored = memorySyncHealth || (await readRedisSyncHealth()) || null;
  const syncError = configured ? String(stored?.error || "") : "STAKE_ACCESS_TOKEN is not configured.";

  return {
    syncConfigured: configured,
    cookieConfigured,
    syncError,
    syncOk: configured && !syncError,
    lastAttemptAt: stored?.at || null,
  };
}

export async function recordStakeSyncSuccess() {
  return writeSyncHealth({
    ok: true,
    error: "",
    at: new Date().toISOString(),
  });
}

export async function recordStakeSyncFailure(error) {
  return writeSyncHealth({
    ok: false,
    error: formatStakeCatalogError(error),
    at: new Date().toISOString(),
  });
}

function getGraphqlUrls() {
  const configured = process.env.STAKE_GRAPHQL_URL;
  if (configured) {
    return [configured.replace(/\/$/, "")];
  }

  return [STAKE_GRAPHQL_URL];
}

async function fetchGroupSlotsPage(
  group,
  offset,
  limit = INCREMENTAL_PAGE_LIMIT,
  graphqlUrl = STAKE_GRAPHQL_URL
) {
  const headers = buildGraphqlHeaders(group);
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

  const contentType = String(response.headers.get("content-type") || "");
  const rawText = await response.text();
  const looksLikeCloudflare =
    /just a moment|attention required|cf-browser-verification|cloudflare/i.test(
      rawText.slice(0, 2000)
    ) || /text\/html/i.test(contentType);

  if (!response.ok) {
    if (response.status === 403 || looksLikeCloudflare) {
      throw new Error(
        `Stake catalog request failed (${response.status}) — Cloudflare challenge.`
      );
    }
    throw new Error(`Stake catalog request failed (${response.status}).`);
  }

  if (looksLikeCloudflare) {
    throw new Error("Stake catalog request failed (403) — Cloudflare challenge.");
  }

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error("Stake catalog request failed (403) — Cloudflare challenge.");
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message || "Stake catalog query failed.");
  }

  const entries = payload.data?.slugKuratorGroup?.groupGamesList || [];
  const slots = [];
  for (const entry of entries) {
    const slot = normalizeSlot(entry?.game, group);
    if (slot) {
      slots.push(slot);
    }
  }

  return slots;
}

async function fetchGroupSlotsFromGraphql(group, graphqlUrl = STAKE_GRAPHQL_URL) {
  const slots = [];
  const limit = INCREMENTAL_PAGE_LIMIT;
  let offset = 0;
  let pages = 0;
  const maxPages = 400; // safety cap (~20k games per section)

  while (pages < maxPages) {
    const pageSlots = await fetchGroupSlotsPage(group, offset, limit, graphqlUrl);
    if (!pageSlots.length) {
      break;
    }

    slots.push(...pageSlots);

    if (pageSlots.length < limit) {
      break;
    }

    offset += limit;
    pages += 1;
  }

  return slots;
}

function defaultSyncCursor() {
  return {
    groupIndex: 0,
    offset: 0,
    cycle: 0,
    updatedAt: null,
  };
}

async function readRedisSyncCursor() {
  const config = getRedisConfig();
  if (!config) {
    return null;
  }

  try {
    const response = await fetch(`${config.url}/get/${CATALOG_SYNC_KEY}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const raw = payload?.result;
    if (!raw) {
      return null;
    }
    return typeof raw === "string" ? JSON.parse(decodeURIComponent(raw)) : raw;
  } catch {
    return null;
  }
}

async function writeRedisSyncCursor(cursor) {
  const config = getRedisConfig();
  if (!config) {
    return;
  }

  await fetch(`${config.url}/set/${CATALOG_SYNC_KEY}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: JSON.stringify(cursor),
    }),
  });
}

let memorySyncCursor = null;

async function readSyncCursor() {
  if (memorySyncCursor) {
    return { ...defaultSyncCursor(), ...memorySyncCursor };
  }

  const redisCursor = await readRedisSyncCursor();
  if (redisCursor && typeof redisCursor === "object") {
    memorySyncCursor = { ...defaultSyncCursor(), ...redisCursor };
    return { ...memorySyncCursor };
  }

  return defaultSyncCursor();
}

async function writeSyncCursor(cursor) {
  memorySyncCursor = { ...defaultSyncCursor(), ...cursor, updatedAt: new Date().toISOString() };
  await writeRedisSyncCursor(memorySyncCursor).catch(() => {});
  return memorySyncCursor;
}

export function getCatalogSectionCounts(catalog) {
  const slots = filterAllowedSlots(catalog?.slots);
  const unique = new Set(slots.map((slot) => slot.slug).filter(Boolean)).size;
  const sections = ALLOWED_SLOT_GROUPS.map((group) => ({
    slug: group.slug,
    label: group.label,
    count: slots.filter((slot) => slotBelongsToGroup(slot, group.slug)).length,
  }));

  return { sections, unique, total: slots.length };
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

async function readFileThumbnailIndex() {
  try {
    const raw = await fs.readFile(THUMBNAIL_INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.thumbs && typeof parsed.thumbs === "object" ? parsed.thumbs : {};
  } catch {
    return {};
  }
}

async function readRedisThumbnailIndex() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${THUMBNAIL_INDEX_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (!data.result) return null;

  try {
    const parsed = JSON.parse(data.result);
    return parsed?.thumbs && typeof parsed.thumbs === "object" ? parsed.thumbs : null;
  } catch {
    return null;
  }
}

async function readThumbnailIndex() {
  if (memoryThumbnailIndex) {
    return memoryThumbnailIndex;
  }

  const fileIndex = await readFileThumbnailIndex();
  const redisIndex = (await readRedisThumbnailIndex()) || {};
  memoryThumbnailIndex = { ...fileIndex, ...redisIndex };
  return memoryThumbnailIndex;
}

async function writeRedisThumbnailIndex(thumbs) {
  const config = getRedisConfig();
  if (!config || !thumbs || !Object.keys(thumbs).length) {
    return false;
  }

  const response = await fetch(`${config.url}/set/${THUMBNAIL_INDEX_KEY}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: JSON.stringify({
        updatedAt: new Date().toISOString(),
        thumbs,
      }),
    }),
    cache: "no-store",
  });

  if (!response.ok) return false;

  const data = await response.json().catch(() => ({}));
  return data.result === "OK" || response.ok;
}

function enrichSlotsWithThumbnailIndex(slots, index) {
  if (!index || !Object.keys(index).length) {
    return slots;
  }

  return slots.map((slot) => {
    if (slot.thumbnailUrl) {
      return slot;
    }

    const thumbnailUrl = normalizeSlotThumbnailUrl(index[slot.slug]);
    if (!thumbnailUrl) {
      return slot;
    }

    return { ...slot, thumbnailUrl };
  });
}

export async function resolveSlotThumbnail(slug) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  const index = await readThumbnailIndex();
  return normalizeSlotThumbnailUrl(index[normalizedSlug]);
}

async function enrichCatalogWithThumbnails(catalog) {
  if (!catalog?.slots?.length) {
    return catalog;
  }

  const stats = getSlotCatalogThumbnailStats(catalog.slots);
  if (stats.withThumbnails >= stats.total) {
    return catalog;
  }

  let slots = catalog.slots;

  if (stats.withThumbnails === 0) {
    const fallback = await readFallbackCatalog();
    if (fallback?.slots?.length) {
      slots = mergeSlotCatalogs(catalog, fallback.slots).slots;
    }
  }

  const afterFallback = getSlotCatalogThumbnailStats(slots);
  if (afterFallback.withThumbnails < afterFallback.total) {
    const index = await readThumbnailIndex();
    slots = enrichSlotsWithThumbnailIndex(slots, index);
  }

  return sanitizeCatalog({ ...catalog, slots });
}

async function updateThumbnailIndexFromSlots(slots) {
  const index = await readThumbnailIndex();
  let changed = false;

  for (const slot of filterAllowedSlots(slots)) {
    if (!slot.thumbnailUrl) {
      continue;
    }

    const thumbnailUrl = normalizeSlotThumbnailUrl(slot.thumbnailUrl);
    if (!thumbnailUrl || index[slot.slug] === thumbnailUrl) {
      continue;
    }

    index[slot.slug] = thumbnailUrl;
    changed = true;
  }

  if (!changed) {
    return;
  }

  memoryThumbnailIndex = index;
  await writeRedisThumbnailIndex(index).catch(() => {});
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
        slots: catalog.slots.map((slot) => ({
          name: slot.name,
          slug: slot.slug,
          groupSlug: slot.groupSlug,
          groupLabel: slot.groupLabel,
          groupUrl: slot.groupUrl,
          provider: slot.provider || null,
          thumbnailUrl: slot.thumbnailUrl || null,
        })),
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
    const raw = data.result;
    if (typeof raw !== "string") {
      return raw;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return JSON.parse(decodeURIComponent(raw));
    }
  } catch {
    return null;
  }
}

async function writeRedisCatalog(catalog) {
  const config = getRedisConfig();
  if (!config) return false;

  const response = await fetch(`${config.url}/set/${CATALOG_KEY}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: JSON.stringify(catalog),
    }),
    cache: "no-store",
  });

  if (!response.ok) return false;

  const data = await response.json().catch(() => ({}));
  return data.result === "OK" || response.ok;
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

  const slots = filterAllowedSlots(dedupeSlots(catalog.slots));
  const groups = ALLOWED_SLOT_GROUPS.map((group) => {
    const existing = catalog.groups?.find((entry) => entry.slug === group.slug);
    const fromFlat = slots.filter((slot) => slotBelongsToGroup(slot, group.slug));
    const fromGroup = filterAllowedSlots(existing?.slots || []);
    const groupSlots = fromFlat.length
      ? fromFlat
      : dedupeSlots(fromGroup).map((slot) => ({
          ...slot,
          groupSlug: group.slug,
          groupLabel: group.label,
          groupUrl: group.url,
          groupSlugs: [group.slug],
        }));

    return {
      ...group,
      slots: groupSlots,
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
  let catalog = null;

  if (memoryCatalog?.slots?.length) {
    catalog = sanitizeCatalog(memoryCatalog);
  } else {
    const redisCatalog = await readRedisCatalog();
    if (redisCatalog?.slots?.length) {
      catalog = sanitizeCatalog(redisCatalog);
    } else {
      const fileCatalog = await readFileCatalog();
      if (fileCatalog?.slots?.length) {
        catalog = sanitizeCatalog(fileCatalog);
      } else {
        const fallbackCatalog = await readFallbackCatalog();
        if (fallbackCatalog?.slots?.length) {
          catalog = fallbackCatalog;
        }
      }
    }
  }

  if (!catalog?.slots?.length) {
    return null;
  }

  const enriched = await enrichCatalogWithThumbnails(catalog);
  memoryCatalog = enriched;
  return enriched;
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
    return saveCatalog(catalog);
  } catch {
    const fallback = await readFallbackCatalog();
    if (fallback?.slots?.length) {
      return saveCatalog(fallback);
    }

    return cached || buildEmptyCatalog();
  }
}

export async function refreshAllowedSlotCatalog() {
  if (!isStakeSyncConfigured()) {
    const error = new Error("STAKE_ACCESS_TOKEN is not configured.");
    await recordStakeSyncFailure(error);
    throw error;
  }

  try {
    const catalog = sanitizeCatalog(await fetchCatalogFromStake());
    const saved = await saveCatalog(catalog);
    await recordStakeSyncSuccess();
    return saved;
  } catch (error) {
    await recordStakeSyncFailure(error);
    throw error;
  }
}

export async function refreshAllowedSlotCatalogIncremental({
  pages = INCREMENTAL_PAGES_PER_TICK,
} = {}) {
  if (!isStakeSyncConfigured()) {
    const error = new Error("STAKE_ACCESS_TOKEN is not configured.");
    await recordStakeSyncFailure(error);
    throw error;
  }

  try {
    const pageCount = Math.max(1, Math.min(Number(pages) || INCREMENTAL_PAGES_PER_TICK, 8));
    const limit = INCREMENTAL_PAGE_LIMIT;
    let cursor = await readSyncCursor();
    let catalog = (await getCachedCatalog()) || buildEmptyCatalog();
    let fetched = 0;
    let pagesFetched = 0;
    const graphqlUrls = getGraphqlUrls();
    const graphqlUrl = graphqlUrls[0] || STAKE_GRAPHQL_URL;

    for (let i = 0; i < pageCount; i += 1) {
      const group = ALLOWED_SLOT_GROUPS[cursor.groupIndex % ALLOWED_SLOT_GROUPS.length];
      const pageSlots = await fetchGroupSlotsPage(
        group,
        cursor.offset,
        limit,
        graphqlUrl
      );
      pagesFetched += 1;

      if (!pageSlots.length) {
        cursor.groupIndex = (cursor.groupIndex + 1) % ALLOWED_SLOT_GROUPS.length;
        cursor.offset = 0;
        if (cursor.groupIndex === 0) {
          cursor.cycle = Number(cursor.cycle || 0) + 1;
        }
        break;
      }

      catalog = mergeSlotCatalogs(catalog, pageSlots);
      fetched += pageSlots.length;

      if (pageSlots.length < limit) {
        cursor.groupIndex = (cursor.groupIndex + 1) % ALLOWED_SLOT_GROUPS.length;
        cursor.offset = 0;
        if (cursor.groupIndex === 0) {
          cursor.cycle = Number(cursor.cycle || 0) + 1;
        }
        break;
      }

      cursor.offset += limit;
    }

    catalog = sanitizeCatalog({
      ...catalog,
      updatedAt: new Date().toISOString(),
      source: "incremental-refresh",
    });
    const saved = await saveCatalog(catalog);
    const savedCursor = await writeSyncCursor(cursor);
    const activeGroup =
      ALLOWED_SLOT_GROUPS[savedCursor.groupIndex % ALLOWED_SLOT_GROUPS.length];

    await recordStakeSyncSuccess();

    return {
      catalog: saved,
      sync: {
        groupSlug: activeGroup.slug,
        groupLabel: activeGroup.label,
        offset: savedCursor.offset,
        cycle: savedCursor.cycle,
        fetched,
        pagesFetched,
        updatedAt: saved.updatedAt,
      },
      ...getCatalogSectionCounts(saved),
    };
  } catch (error) {
    await recordStakeSyncFailure(error);
    throw error;
  }
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
  const enriched = await enrichCatalogWithThumbnails(catalog);
  memoryCatalog = enriched;
  await writeRedisCatalog(enriched).catch(() => {});
  await writeFileCatalog(enriched).catch(() => {});
  await writeFallbackCatalog(enriched).catch(() => {});
  await updateThumbnailIndexFromSlots(enriched.slots).catch(() => {});
  return enriched;
}

export async function persistSlotCatalog(catalog) {
  return saveCatalog(sanitizeCatalog(catalog || buildEmptyCatalog()));
}

export async function importAllowedSlotCatalog(payload, { light = false } = {}) {
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

  const existing = (await getCachedCatalog()) || buildEmptyCatalog();
  const catalog = mergeSlotCatalogs(existing, slots);

  if (!catalog.slots.length) {
    throw new Error(
      "Imported slots must be from New Releases or Only on Stake on stake.com."
    );
  }

  catalog.updatedAt = new Date().toISOString();
  catalog.source = "import";

  if (light) {
    const sanitized = sanitizeCatalog(catalog);
    memoryCatalog = sanitized;
    await writeRedisCatalog(sanitized).catch(() => {});
    return sanitized;
  }

  return saveCatalog(catalog);
}
