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

export async function submitSlotRequest({
  kickUserId,
  username,
  slotSlug,
  slotName,
  slotQuery,
}) {
  if (!(await areSlotRequestsOpen())) {
    throw new Error(REQUESTS_CLOSED_MESSAGE);
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
      "Choose a slot from New Releases or Only on Stake on stake.bet."
    );
  }

  return saveSlotRequest({
    kickUserId,
    username,
    slotName: slot.name,
    slotSlug: slot.slug,
    groupSlug: slot.groupSlug,
    groupLabel: slot.groupLabel,
  });
}
