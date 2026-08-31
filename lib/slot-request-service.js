import {
  findAllowedSlot,
  findAllowedSlotByQuery,
  getAllowedSlotCatalog,
} from "./stake-slots.js";
import { saveSlotRequest } from "./slot-requests.js";

export async function submitSlotRequest({
  kickUserId,
  username,
  slotSlug,
  slotName,
  slotQuery,
}) {
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

  if (!slot) {
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
