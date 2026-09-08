import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const CATALOG_FILE = path.join(DATA_DIR, "stake-slot-catalog.json");
const FALLBACK_CATALOG_FILE = path.resolve("catalog/stake-allowed-slots.json");
const THUMBNAIL_INDEX_FILE = path.resolve("catalog/stake-slot-thumbs.json");
const CATALOG_KEY = "bh:slot-catalog";
const THUMBNAIL_INDEX_KEY = "bh:slot-thumbs";

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

export function stripProviderFromSlotName(slotName, provider) {
  let name = String(slotName || "")
    .trim()
    .replace(/\s+/g, " ");
  const prov = String(provider || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!name || !prov) {
    return name;
  }

  const lower = name.toLowerCase();
  const provLower = prov.toLowerCase();
  if (lower === provLower) {
    return name;
  }

  if (lower.endsWith(` ${provLower}`)) {
    return name.slice(0, -(prov.length + 1)).trim();
  }

  return name;
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

  const slug = String(raw.slug || "").trim().toLowerCase();
  const provider =
    String(raw.provider || "").trim() || extractSlotProvider(raw) || null;
  let name = stripProviderFromSlotName(raw.name, provider);
  if (!name) {
    name = String(raw.name || "").trim();
  }

  if (!name || !slug) {
    return null;
  }

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

export function formatStakeCatalogError(error) {
  return error?.message || "Could not load Stake slot catalog.";
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

  const value = JSON.stringify({
    updatedAt: new Date().toISOString(),
    thumbs,
  });

  // Official Upstash REST form (same as users.js) — KV-style { value } bodies do not persist.
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", THUMBNAIL_INDEX_KEY, value]),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      "Redis thumbnail index save failed:",
      response.status,
      detail.slice(0, 300)
    );
    return false;
  }

  const data = await response.json().catch(() => ({}));
  return data.result === "OK";
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

  const value = JSON.stringify(catalog);

  // Official Upstash REST form for large values (same as users.js).
  // Path /set/key with { value } is Vercel KV-only and silently fails on Upstash.
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", CATALOG_KEY, value]),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(
      "Redis catalog save failed:",
      response.status,
      detail.slice(0, 300)
    );
    return false;
  }

  const data = await response.json().catch(() => ({}));
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

export async function getAllowedSlotCatalog() {
  const cached = await getCachedCatalog();
  if (cached?.slots?.length) {
    return cached;
  }

  const fallback = await readFallbackCatalog();
  if (fallback?.slots?.length) {
    return saveCatalog(fallback);
  }

  return cached || buildEmptyCatalog();
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

  const redisConfigured = Boolean(getRedisConfig());
  const redisOk = await writeRedisCatalog(enriched).catch((error) => {
    console.error("Redis catalog save error:", error?.message || error);
    return false;
  });

  if (redisConfigured && !redisOk) {
    throw new Error(
      "Could not save slot catalog to Redis. Check Upstash connection or quota, then sync again."
    );
  }

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
      "No valid slots found. Use the stake.com console script from Bonus Hunt admin, then paste the copied JSON."
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

  return saveCatalog(catalog);
}
