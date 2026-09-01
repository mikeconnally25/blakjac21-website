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

function slugFromSlotQuery(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function savePendingSlotRequest({ kickUserId, username, slotQuery }) {
  const query = String(slotQuery || "").trim();
  if (!query) {
    throw new Error("Enter a slot name.");
  }

  return saveSlotRequest({
    kickUserId,
    username,
    slotName: query,
    slotSlug: slugFromSlotQuery(query) || "pending-slot",
    groupSlug: "pending",
    groupLabel: "Pending catalog",
  });
}

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
  const hasCatalog = Boolean(catalog.slots?.length);
  let slot = null;

  if (slotSlug || slotName) {
    if (!hasCatalog) {
      throw new Error(
        "Slot list is not loaded yet. Ask the streamer to sync slots from Stake."
      );
    }

    slot = findAllowedSlot(catalog, { slug: slotSlug, name: slotName });
  } else if (slotQuery) {
    if (!hasCatalog) {
      return savePendingSlotRequest({ kickUserId, username, slotQuery });
    }

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
    if (slotQuery && !hasCatalog) {
      return savePendingSlotRequest({ kickUserId, username, slotQuery });
    }

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
    provider: slot.provider || null,
    thumbnailUrl: slot.thumbnailUrl || null,
  });
}
