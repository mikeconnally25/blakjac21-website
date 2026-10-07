import crypto from "crypto";
import { getBonusHunt, listPastHunts } from "./bonuses.js";
import { getSession } from "./session.js";
import {
  findAllowedSlot,
  findAllowedSlotByQuery,
  getAllowedSlotCatalog,
} from "./stake-slots.js";

const GROUPS = new Set(["all", "new-releases", "only-on-stake"]);
const MAX_MATCHES = 40;

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function slotGroupSlugs(slot) {
  return new Set(
    [slot?.groupSlug, ...(Array.isArray(slot?.groupSlugs) ? slot.groupSlugs : [])]
      .map((slug) => String(slug || "").trim())
      .filter(Boolean)
  );
}

function inGroup(slot, group) {
  if (!group || group === "all") return true;
  return slotGroupSlugs(slot).has(group);
}

function summarize(bonuses) {
  let biggestWin = null;
  let biggestX = null;

  for (const bonus of bonuses) {
    const payout =
      bonus.payout === null || bonus.payout === undefined ? null : Number(bonus.payout);
    const bet = Number(bonus.bet);
    if (payout !== null && Number.isFinite(payout)) {
      if (biggestWin === null || payout > biggestWin) {
        biggestWin = payout;
      }
      if (bet > 0) {
        const multiplier = payout / bet;
        if (biggestX === null || multiplier > biggestX) {
          biggestX = multiplier;
        }
      }
    }
  }

  return {
    bonusCount: bonuses.length,
    biggestWin: biggestWin === null ? null : Number(biggestWin.toFixed(2)),
    biggestX: biggestX === null ? null : Number(biggestX.toFixed(2)),
  };
}

function bonusesForSlot(slot, bonuses) {
  const slug = String(slot.slug || "").trim().toLowerCase();
  const name = normalizeName(slot.name);
  const seen = new Set();
  const matched = [];

  for (const bonus of bonuses) {
    const bonusSlug = String(bonus.slotSlug || "").trim().toLowerCase();
    const bonusName = normalizeName(bonus.slot);
    const hit = (slug && bonusSlug === slug) || (name && bonusName === name);
    const id = String(bonus.id || `${bonusSlug}:${bonusName}:${bonus.addedAt || ""}`);
    if (!hit || seen.has(id)) continue;
    seen.add(id);
    matched.push(bonus);
  }

  return matched;
}

function toMatch(slot, bonuses) {
  return {
    name: slot.name,
    slug: slot.slug,
    groupSlug: slot.groupSlug || null,
    groupLabel: slot.groupLabel || null,
    provider: slot.provider || null,
    thumbnailUrl: slot.thumbnailUrl || null,
    ...summarize(bonusesForSlot(slot, bonuses)),
  };
}

export function matchSlotStats(slots, bonuses, { query = "", group = "all" } = {}) {
  const trimmed = String(query || "").trim();
  const groupSlug = GROUPS.has(String(group || "").trim()) ? String(group).trim() : "all";
  const list = Array.isArray(slots) ? slots : [];

  if (!trimmed) {
    return {
      query: "",
      group: groupSlug,
      catalogEmpty: list.length === 0,
      matches: [],
    };
  }

  const needle = trimmed.toLowerCase();
  const slugNeedle = needle.replace(/\s+/g, "-");
  const matches = list
    .filter((slot) => slot?.slug && slot?.name && inGroup(slot, groupSlug))
    .filter((slot) => {
      const name = slot.name.toLowerCase();
      return name.includes(needle) || String(slot.slug).toLowerCase().includes(slugNeedle);
    })
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aStarts = aName.startsWith(needle) ? 0 : 1;
      const bStarts = bName.startsWith(needle) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return aName.localeCompare(bName);
    })
    .slice(0, MAX_MATCHES)
    .map((slot) => toMatch(slot, Array.isArray(bonuses) ? bonuses : []));

  return {
    query: trimmed,
    group: groupSlug,
    catalogEmpty: list.length === 0,
    matches,
  };
}

export async function searchSlotStats({ query = "", group = "all" } = {}) {
  const catalog = await getAllowedSlotCatalog();
  const slots = Array.isArray(catalog?.slots) ? catalog.slots : [];
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return matchSlotStats(slots, [], { query: "", group });
  }

  const hunt = await getBonusHunt();
  const pastHunts = await listPastHunts();
  const bonuses = [
    ...(Array.isArray(hunt?.bonuses) ? hunt.bonuses : []),
    ...pastHunts.flatMap((record) => (Array.isArray(record?.bonuses) ? record.bonuses : [])),
  ];

  return matchSlotStats(slots, bonuses, { query, group });
}

const MAX_LIVE_SLOTS = 6;
const OPENING_KEY = "bh:now-opening";
const OPENING_ADMINS = new Set(["vzqie"]);
let memoryOpening = [];

function normalizeOpeningSlot(raw) {
  const name = String(raw?.name || "").trim();
  const slug = String(raw?.slug || "").trim().toLowerCase();
  if (!name || !slug) return null;
  return {
    id: String(raw.id || crypto.randomUUID()),
    name,
    slug,
    provider: String(raw.provider || "").trim() || null,
    thumbnailUrl: String(raw.thumbnailUrl || "").trim() || null,
    groupLabel: String(raw.groupLabel || "").trim() || null,
  };
}

export function nextOpeningList(current, slot) {
  const nextSlot = normalizeOpeningSlot(slot);
  if (!nextSlot) return Array.isArray(current) ? current.slice(0, MAX_LIVE_SLOTS) : [];
  const rest = (Array.isArray(current) ? current : []).filter(
    (item) => String(item?.slug || "").toLowerCase() !== nextSlot.slug
  );
  return [nextSlot, ...rest].slice(0, MAX_LIVE_SLOTS);
}

export function decorateOpeningSlots(opening, historyBonuses) {
  const history = Array.isArray(historyBonuses) ? historyBonuses : [];
  const slots = (Array.isArray(opening) ? opening : [])
    .map(normalizeOpeningSlot)
    .filter(Boolean)
    .slice(0, MAX_LIVE_SLOTS)
    .map((slot) => ({
      id: slot.id,
      ...toMatch(slot, history),
      pendingCount: 1,
    }));
  return { slots, hiddenCount: 0 };
}

function openingRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function readOpeningSlots() {
  const config = openingRedisConfig();
  if (!config) {
    if (process.env.VERCEL === "1") return [];
    return memoryOpening.map(normalizeOpeningSlot).filter(Boolean);
  }

  const response = await fetch(`${config.url}/get/${OPENING_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load the opening slots.");
  }

  const data = await response.json();
  if (data.result === null || data.result === undefined) return [];
  const parsed = JSON.parse(data.result);
  return (Array.isArray(parsed?.slots) ? parsed.slots : [])
    .map(normalizeOpeningSlot)
    .filter(Boolean);
}

async function writeOpeningSlots(slots) {
  const normalized = slots.map(normalizeOpeningSlot).filter(Boolean).slice(0, MAX_LIVE_SLOTS);
  const config = openingRedisConfig();
  if (!config) {
    if (process.env.VERCEL === "1") {
      throw new Error("Opening slots need shared storage.");
    }
    memoryOpening = normalized;
    return normalized;
  }

  const payload = encodeURIComponent(JSON.stringify({ slots: normalized }));
  const response = await fetch(`${config.url}/set/${OPENING_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not save the opening slots.");
  }
  const data = await response.json();
  if (data.result !== "OK") {
    throw new Error("Could not save the opening slots.");
  }
  return normalized;
}

async function historyBonuses() {
  const hunt = await getBonusHunt();
  const pastHunts = await listPastHunts();
  return [
    ...(Array.isArray(hunt?.bonuses) ? hunt.bonuses : []),
    ...pastHunts.flatMap((record) => (Array.isArray(record?.bonuses) ? record.bonuses : [])),
  ];
}

export async function liveSpinSlots() {
  const [opening, history] = await Promise.all([readOpeningSlots(), historyBonuses()]);
  return decorateOpeningSlots(opening, history);
}

function resolveCatalogSlot(catalog, { name, slug }) {
  const trimmedSlug = String(slug || "").trim().toLowerCase();
  if (trimmedSlug) {
    const direct = findAllowedSlot(catalog, { slug: trimmedSlug, name });
    if (direct) return direct;
  }

  const found = findAllowedSlotByQuery(catalog, name || trimmedSlug);
  if (found?.slot) return found.slot;
  if (found?.matches?.length > 1) {
    throw new Error("More than one slot matches. Pick the exact name.");
  }
  throw new Error("That slot is not in New Releases or Only on Stake.");
}

export async function addOpeningSlot({ name, slug }) {
  const catalog = await getAllowedSlotCatalog();
  const slot = resolveCatalogSlot(catalog, { name, slug });
  const current = await readOpeningSlots();
  const saved = await writeOpeningSlots(
    nextOpeningList(current, {
      name: slot.name,
      slug: slot.slug,
      provider: slot.provider,
      thumbnailUrl: slot.thumbnailUrl,
      groupLabel: slot.groupLabel,
    })
  );
  return decorateOpeningSlots(saved, await historyBonuses());
}

export async function removeOpeningSlot(id) {
  const openingId = String(id || "").trim();
  if (!openingId) throw new Error("Slot id is required.");
  const current = await readOpeningSlots();
  const saved = await writeOpeningSlots(current.filter((slot) => slot.id !== openingId));
  return decorateOpeningSlots(saved, await historyBonuses());
}

export async function clearOpeningSlots() {
  await writeOpeningSlots([]);
  return { slots: [], hiddenCount: 0 };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function isOpeningAdmin(session) {
  if (session?.isAdmin) return true;
  const username = String(session?.username || "").trim().toLowerCase();
  return Boolean(username && OPENING_ADMINS.has(username));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function handleSlotStatsLive(req, res) {
  try {
    sendJson(res, 200, await liveSpinSlots());
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load the spinning slots." });
  }
}

export async function handleOpeningUpdate(req, res) {
  const session = await getSession(req);
  if (!isOpeningAdmin(session)) {
    sendJson(res, 403, { error: "Admin access required." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  const action = String(body.action || "").trim();
  try {
    if (action === "add") {
      sendJson(res, 200, await addOpeningSlot({ name: body.name, slug: body.slug }));
      return;
    }
    if (action === "remove") {
      sendJson(res, 200, await removeOpeningSlot(body.id));
      return;
    }
    if (action === "clear") {
      sendJson(res, 200, await clearOpeningSlots());
      return;
    }
    sendJson(res, 400, { error: "Unknown action." });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not update the overlay." });
  }
}

export async function handleSlotStatsGet(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const query = url.searchParams.get("q") || req.query?.q || "";
  const group = url.searchParams.get("group") || req.query?.group || "all";

  try {
    sendJson(res, 200, await searchSlotStats({ query, group }));
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load slot stats." });
  }
}
