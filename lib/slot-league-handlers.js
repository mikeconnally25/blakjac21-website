import { getSession } from "./session.js";
import { getAllowedSlotCatalog } from "./stake-slots.js";
import {
  addSlotLeagueBotEntries,
  addSlotLeagueEntry,
  clearSlotLeagueEntries,
  countSlotLeagueEntries,
  listSlotLeagueEntries,
  removeSlotLeagueEntry,
} from "./slot-league-entries.js";
import {
  assignEntryToSpot,
  claimLeagueSpotForEntry,
  clearLeagueSpotAssignments,
  generateLeagueGroups,
  generateLeagueKnockout,
  getSlotLeagueState,
  LEAGUE_CAPACITY,
  releaseLeagueSpotForEntry,
  resetSlotLeagueSeason,
  setLeagueMatchScore,
  setSlotLeagueOpen,
  setSlotLeaguePhase,
  setSlotLeagueSettings,
  setSpotSlot,
  toPublicLeagueState,
} from "./slot-league-state.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  return JSON.parse(raw);
}

function requireAdmin(session, res) {
  if (!session?.isAdmin) {
    sendJson(res, 403, { error: "Admin access required." });
    return false;
  }
  return true;
}

function resolveCatalogSlot(catalog, { slotSlug, slotName, slot } = {}) {
  if (slot && typeof slot === "object" && (slot.name || slot.slug)) {
    return {
      id: String(slot.id || "").trim() || undefined,
      name: String(slot.name || "").trim(),
      slug: String(slot.slug || "").trim() || null,
      thumbnailUrl: String(slot.thumbnailUrl || "").trim() || null,
    };
  }
  const slug = String(slotSlug || "").trim().toLowerCase();
  const name = String(slotName || "").trim().toLowerCase();
  const list = Array.isArray(catalog) ? catalog : [];
  const found =
    list.find(
      (item) =>
        (slug && String(item.slug || "").toLowerCase() === slug) ||
        (name && String(item.name || "").toLowerCase() === name)
    ) || null;
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    slug: found.slug || null,
    thumbnailUrl: found.thumbnailUrl || null,
  };
}

async function buildStatusPayload(session) {
  const state = await getSlotLeagueState();
  const isAdmin = Boolean(session?.isAdmin);
  const allEntries = await listSlotLeagueEntries({ includePrivate: true });
  const entriesById = new Map(allEntries.map((e) => [e.id, e]));
  const publicState = toPublicLeagueState(state, { entriesById });
  const entries = isAdmin
    ? allEntries
    : allEntries.map((e) => ({
        id: e.id,
        username: e.username,
        enteredAt: e.enteredAt,
        isBot: Boolean(e.isBot),
      }));

  const viewerKickId = String(session?.kickUserId || "").trim();
  const viewerEntry = viewerKickId
    ? allEntries.find((e) => e.kickUserId === viewerKickId) || null
    : null;

  let catalog = [];
  try {
    catalog = await getAllowedSlotCatalog();
  } catch {
    catalog = [];
  }

  return {
    ok: true,
    isAdmin,
    viewerEntered: Boolean(viewerEntry),
    viewerEntryId: viewerEntry?.id || null,
    league: publicState,
    entries,
    catalog: (catalog || []).slice(0, 800).map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.slug || null,
      thumbnailUrl: item.thumbnailUrl || null,
    })),
  };
}

export async function handleSlotLeagueStatus(req, res) {
  try {
    const session = await getSession(req);
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not load league.",
    });
  }
}

export async function handleSlotLeagueToggle(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req);
    if (typeof body.open !== "boolean") {
      sendJson(res, 400, { error: "Provide open as true or false." });
      return;
    }
    if (body.open) {
      await clearSlotLeagueEntries();
    }
    await setSlotLeagueOpen(body.open);
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not update league signups.",
    });
  }
}

export async function handleSlotLeagueSettings(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req);
    await setSlotLeagueSettings({
      title: body.title,
      buyIn: body.buyIn,
    });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not save league settings.",
    });
  }
}

export async function handleSlotLeaguePhase(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req);
    await setSlotLeaguePhase(body.phase);
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not set league phase.",
    });
  }
}

export async function handleSlotLeagueJoin(req, res) {
  const session = await getSession(req);
  if (!session?.kickUserId) {
    sendJson(res, 401, { error: "Sign in with Kick first." });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const state = await getSlotLeagueState();
    if (!state.open || state.phase !== "signup") {
      sendJson(res, 400, { error: "League signups are closed." });
      return;
    }
    const count = await countSlotLeagueEntries();
    if (count >= LEAGUE_CAPACITY) {
      sendJson(res, 400, { error: "League is full (16/16)." });
      return;
    }

    const catalog = await getAllowedSlotCatalog();
    const slot = resolveCatalogSlot(catalog, body);
    if (!slot) {
      sendJson(res, 400, { error: "Pick a valid Stake slot from the catalog." });
      return;
    }

    const result = await addSlotLeagueEntry({
      kickUserId: session.kickUserId,
      username: session.username,
    });
    await claimLeagueSpotForEntry({
      entryId: result.entry.id,
      slot,
    });

    sendJson(res, 200, {
      ...(await buildStatusPayload(session)),
      alreadyEntered: result.alreadyEntered,
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not join the league.",
    });
  }
}

export async function handleSlotLeagueEntriesBots(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req);
    const count = Math.floor(Number(body.count) || 0);
    const state = await getSlotLeagueState();
    const current = await countSlotLeagueEntries();
    const room = Math.max(0, LEAGUE_CAPACITY - current);
    const toAdd = Math.min(count, room);
    if (toAdd < 1) {
      sendJson(res, 400, { error: "League is full." });
      return;
    }

    const { added } = await addSlotLeagueBotEntries(toAdd);
    const catalog = await getAllowedSlotCatalog();
    let catalogIndex = 0;
    const usedSlugs = new Set(
      state.spots.map((s) => s.slot?.slug).filter(Boolean)
    );

    for (const entry of added) {
      let pick = null;
      while (catalogIndex < catalog.length) {
        const candidate = catalog[catalogIndex];
        catalogIndex += 1;
        const slug = candidate.slug || null;
        if (slug && usedSlugs.has(slug)) continue;
        pick = candidate;
        if (slug) usedSlugs.add(slug);
        break;
      }
      if (!pick) {
        pick = {
          name: `Bot Slot ${entry.username}`,
          slug: `bot-slot-${entry.id}`,
          thumbnailUrl: null,
        };
      }
      await claimLeagueSpotForEntry({
        entryId: entry.id,
        slot: {
          id: pick.id,
          name: pick.name,
          slug: pick.slug || null,
          thumbnailUrl: pick.thumbnailUrl || null,
        },
        allowWhenClosed: true,
      });
    }

    const filled = await countSlotLeagueEntries();
    if (filled >= LEAGUE_CAPACITY) {
      await setSlotLeagueOpen(false);
    }

    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not add bots.",
    });
  }
}

export async function handleSlotLeagueEntryRemove(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req);
    await releaseLeagueSpotForEntry(body.entryId);
    await removeSlotLeagueEntry(body.entryId);
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not remove entrant.",
    });
  }
}

export async function handleSlotLeagueEntriesClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    await clearSlotLeagueEntries();
    await clearLeagueSpotAssignments();
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not clear entries.",
    });
  }
}

export async function handleSlotLeagueSpotAssign(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req);
    let slot = undefined;
    if (body.slot || body.slotSlug || body.slotName) {
      const catalog = await getAllowedSlotCatalog();
      slot = resolveCatalogSlot(catalog, body);
      if (!slot && body.clearSlot) {
        slot = null;
      } else if (!slot) {
        sendJson(res, 400, { error: "Pick a valid Stake slot." });
        return;
      }
    }
    if (body.clearSlot) slot = null;
    await assignEntryToSpot({
      spotId: body.spotId,
      entryId: body.entryId,
      slot,
    });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not update spot.",
    });
  }
}

export async function handleSlotLeagueSpotSlot(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req);
    const catalog = await getAllowedSlotCatalog();
    const slot = body.clearSlot
      ? null
      : resolveCatalogSlot(catalog, body);
    if (!body.clearSlot && !slot) {
      sendJson(res, 400, { error: "Pick a valid Stake slot." });
      return;
    }
    await setSpotSlot({ spotId: body.spotId, slot });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not set spot slot.",
    });
  }
}

export async function handleSlotLeagueGenerateGroups(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req).catch(() => ({}));
    await generateLeagueGroups({ force: Boolean(body.force) });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not generate groups.",
    });
  }
}

export async function handleSlotLeagueGenerateKnockout(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req).catch(() => ({}));
    await generateLeagueKnockout({ force: Boolean(body.force) });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not generate knockout.",
    });
  }
}

export async function handleSlotLeagueMatchScore(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    const body = await readJsonBody(req);
    await setLeagueMatchScore({
      matchId: body.matchId,
      scoreA: body.scoreA,
      scoreB: body.scoreB,
    });
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not save match score.",
    });
  }
}

export async function handleSlotLeagueReset(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  try {
    await clearSlotLeagueEntries();
    await resetSlotLeagueSeason();
    sendJson(res, 200, await buildStatusPayload(session));
  } catch (error) {
    sendJson(res, 400, {
      error: error.message || "Could not reset league.",
    });
  }
}
