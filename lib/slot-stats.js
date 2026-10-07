import { getBonusHunt, listPastHunts } from "./bonuses.js";
import { getAllowedSlotCatalog } from "./stake-slots.js";

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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
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
