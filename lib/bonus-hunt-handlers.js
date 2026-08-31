import { getSession } from "./session.js";
import {
  addBonus,
  clearBonusHunt,
  getBonusHunt,
  removeBonus,
  updateBonusPayout,
} from "./bonuses.js";
import {
  clearSlotRequests,
  getSlotRequestForUser,
  listSlotRequests,
  removeSlotRequest,
  saveSlotRequest,
} from "./slot-requests.js";
import {
  findAllowedSlot,
  getAllowedSlotCatalog,
  refreshAllowedSlotCatalog,
} from "./stake-slots.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
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

export async function handleBonusHuntGet(req, res) {
  try {
    const hunt = await getBonusHunt();
    sendJson(res, 200, hunt);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntAdd(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const bonus = await addBonus(body);
    sendJson(res, 200, { ok: true, bonus });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntUpdate(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  if (!body.id) {
    sendJson(res, 400, { error: "Bonus id is required." });
    return;
  }

  try {
    const bonus = await updateBonusPayout(body);
    sendJson(res, 200, { ok: true, bonus });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntRemove(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  if (!body.id) {
    sendJson(res, 400, { error: "Bonus id is required." });
    return;
  }

  try {
    await removeBonus(body.id);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await clearBonusHunt();
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntSlots(req, res) {
  try {
    const catalog = await getAllowedSlotCatalog();
    sendJson(res, 200, {
      updatedAt: catalog.updatedAt,
      groups: catalog.groups.map((group) => ({
        slug: group.slug,
        label: group.label,
        url: group.url,
      })),
      slots: catalog.slots,
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntSlotsRefresh(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    const catalog = await refreshAllowedSlotCatalog();
    sendJson(res, 200, {
      ok: true,
      updatedAt: catalog.updatedAt,
      count: catalog.slots.length,
    });
  } catch (error) {
    const message = process.env.STAKE_ACCESS_TOKEN
      ? error.message
      : `${error.message} Add STAKE_ACCESS_TOKEN in Vercel to refresh from Stake.`;
    sendJson(res, 500, { error: message });
  }
}

export async function handleBonusHuntRequestsList(req, res) {
  try {
    const session = await getSession(req);
    const requests = await listSlotRequests();
    const payload = {
      requests: session?.isAdmin ? requests : [],
    };

    if (session) {
      payload.myRequest = await getSlotRequestForUser(session.kickUserId);
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

export async function handleBonusHuntRequestSubmit(req, res) {
  const session = await getSession(req);

  if (!session) {
    sendJson(res, 401, { error: "Sign in with Kick to request a slot." });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  try {
    const catalog = await getAllowedSlotCatalog();
    const slot = findAllowedSlot(catalog, {
      slug: body.slotSlug,
      name: body.slotName,
    });

    if (!slot) {
      sendJson(res, 400, {
        error:
          "Choose a slot from New Releases or Only on Stake on stake.bet.",
      });
      return;
    }

    const request = await saveSlotRequest({
      kickUserId: session.kickUserId,
      username: session.username,
      slotName: slot.name,
      slotSlug: slot.slug,
      groupSlug: slot.groupSlug,
      groupLabel: slot.groupLabel,
    });

    sendJson(res, 200, { ok: true, request });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntRequestRemove(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid request body." });
    return;
  }

  if (!body.id) {
    sendJson(res, 400, { error: "Request id is required." });
    return;
  }

  try {
    await removeSlotRequest(body.id);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

export async function handleBonusHuntRequestsClear(req, res) {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;

  try {
    await clearSlotRequests();
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
