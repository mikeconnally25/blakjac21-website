import {
  findAllowedSlot,
  findAllowedSlotByQuery,
  getAllowedSlotCatalog,
  isAllowedSlot,
} from "./stake-slots.js";
import { saveSlotRequest } from "./slot-requests.js";
import {
  areSlotRequestsOpen,
  getSlotRequestState,
} from "./slot-request-state.js";
import { getUserByKickId, withLiveUserBadges } from "./users.js";
import { isActiveKickSubscriber } from "./kick-subscribers.js";
import { botReply } from "./bot-replies.js";

async function restrictionMessage({ affiliatesOnly, subscribersOnly }) {
  if (affiliatesOnly && subscribersOnly) {
    return botReply("slotAffSubOnly");
  }
  if (affiliatesOnly) {
    return botReply("slotAffOnly");
  }
  return botReply("slotSubOnly");
}

function slugFromSlotQuery(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function savePendingSlotRequest({ kickUserId, username, slotQuery }) {
  const query = String(slotQuery || "").trim();
  if (!query) {
    throw new Error(await botReply("slotEnterName"));
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

export function senderHasSubscriberBadge(sender) {
  const badges = sender?.identity?.badges;
  if (!Array.isArray(badges)) {
    return false;
  }

  return badges.some(
    (badge) => String(badge?.type || "").toLowerCase() === "subscriber"
  );
}

export async function assertSlotRequestEligibility({
  kickUserId,
  username,
  knownSubscriber = false,
}) {
  const state = await getSlotRequestState();
  const affiliatesOnly = Boolean(state.affiliatesOnly);
  const subscribersOnly = Boolean(state.subscribersOnly);

  if (!affiliatesOnly && !subscribersOnly) {
    return;
  }

  const storedUser = await getUserByKickId(kickUserId);
  const user = await withLiveUserBadges({
    kickUserId,
    username: storedUser?.username || username || null,
    stakeUsername: storedUser?.stakeUsername ?? null,
    stakeLinkedAt: storedUser?.stakeLinkedAt ?? null,
    stakeCodeVerified: storedUser?.stakeCodeVerified ?? false,
    stakeCodeVerifiedAt: storedUser?.stakeCodeVerifiedAt ?? null,
    affGranted: Boolean(storedUser?.affGranted),
  });

  const isAffiliate = Boolean(user.stakeCodeVerified);
  const isSubscriber =
    Boolean(knownSubscriber) ||
    Boolean(user.kickSubActive) ||
    (await isActiveKickSubscriber(kickUserId, username));

  if (affiliatesOnly && subscribersOnly) {
    if (isAffiliate || isSubscriber) {
      return;
    }
  } else if (affiliatesOnly) {
    if (isAffiliate) {
      return;
    }
  } else if (subscribersOnly) {
    if (isSubscriber) {
      return;
    }
  }

  throw new Error(await restrictionMessage({ affiliatesOnly, subscribersOnly }));
}

export async function submitSlotRequest({
  kickUserId,
  username,
  slotSlug,
  slotName,
  slotQuery,
  knownSubscriber = false,
}) {
  if (!(await areSlotRequestsOpen())) {
    throw new Error(await botReply("slotClosed"));
  }

  await assertSlotRequestEligibility({
    kickUserId,
    username,
    knownSubscriber,
  });

  const catalog = await getAllowedSlotCatalog();
  const hasCatalog = Boolean(catalog.slots?.length);
  let slot = null;

  if (slotSlug || slotName) {
    if (!hasCatalog) {
      throw new Error(await botReply("slotCatalogMissing"));
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
      throw new Error(await botReply("slotMultiple", { names }));
    }
    slot = result.slot;
  }

  if (!slot || !isAllowedSlot(slot)) {
    if (slotQuery && !hasCatalog) {
      return savePendingSlotRequest({ kickUserId, username, slotQuery });
    }

    throw new Error(await botReply("slotUnknown"));
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
