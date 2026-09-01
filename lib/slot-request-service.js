import {
  findAllowedSlot,
  findAllowedSlotByQuery,
  getAllowedSlotCatalog,
  isAllowedSlot,
} from "./stake-slots.js";
import { saveSlotRequest } from "./slot-requests.js";
import { areSlotRequestsOpen } from "./slot-request-state.js";

const REQUESTS_CLOSED_MESSAGE =
  "Slot requests are closed right now. Check back when the stream opens them.";

export function normalizeSlotRequestBet(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const bet = Number(String(raw).replace(/^\$/, "").trim());
  if (!Number.isFinite(bet) || bet <= 0) {
    return null;
  }

  return Number(bet.toFixed(2));
}

export async function submitSlotRequest({
  kickUserId,
  username,
  slotSlug,
  slotName,
  slotQuery,
  bet,
}) {
  if (!(await areSlotRequestsOpen())) {
    throw new Error(REQUESTS_CLOSED_MESSAGE);
  }

  const normalizedBet = normalizeSlotRequestBet(bet);
  if (normalizedBet === null) {
    throw new Error("Enter a valid bet amount greater than 0.");
  }

  const catalog = await getAllowedSlotCatalog();
  let slot = null;

  if (slotSlug || slotName) {
    slot = findAllowedSlot(catalog, { slug: slotSlug, name: slotName });
  } else if (slotQuery) {
    const result = findAllowedSlotByQuery(catalog, slotQuery);
    if (result.matches.length > 1) {
      const names = result.matches
        .slice(0, 3)
        .map((entry) => entry.name)
        .join(", ");
      throw new Error(
        `Multiple slots match that name (${names}). Be more specific.`
      );
    }
    slot = result.slot;
  }

  if (!slot || !isAllowedSlot(slot)) {
    throw new Error(
      "Choose a slot from New Releases or Only on Stake on stake.com."
    );
  }

  return saveSlotRequest({
    kickUserId,
    username,
    slotName: slot.name,
    slotSlug: slot.slug,
    groupSlug: slot.groupSlug,
    groupLabel: slot.groupLabel,
    bet: normalizedBet,
  });
}
