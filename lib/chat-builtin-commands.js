import { isKickAdmin } from "./admins.js";
import {
  botReply,
  getBotConfig,
  matchCommandTrigger,
  addCustomCommand,
  deleteCustomCommand,
  editCustomCommand,
  normalizeCommandTrigger,
} from "./bot-replies.js";
import {
  getEngagement,
  findEngagementByUsername,
  summarizeEngagement,
} from "./chat-engagement.js";
import { formatDuration, formatWatchMinutes } from "./format-duration.js";
import { getFollow, findFollowByUsername } from "./kick-follows.js";
import {
  getPointsBalance,
  findPointsBalanceByUsername,
} from "./points.js";
import { getStreamStatus } from "./stream-status.js";
import { findUserByUsername, getUserByKickId } from "./users.js";

function isAdminSender(sender) {
  return isKickAdmin({
    username: sender?.username,
    name: sender?.username,
    user_id: sender?.user_id,
  });
}

function cleanTargetUsername(raw) {
  return String(raw || "")
    .replace(/^@/, "")
    .trim();
}

async function matchTrigger(content, triggerKey) {
  const config = await getBotConfig();
  const triggers = config.triggers?.[triggerKey] || [];
  return matchCommandTrigger(content, triggers);
}

async function resolveTargetUser(sender, args) {
  const targetName = cleanTargetUsername(args.split(/\s+/)[0] || "");
  if (!targetName) {
    return {
      kickUserId: sender?.user_id ? String(sender.user_id) : "",
      username: sender?.username || "viewer",
      self: true,
    };
  }

  const found = await findUserByUsername(targetName);
  if (found?.kickUserId) {
    return {
      kickUserId: String(found.kickUserId),
      username: found.username || targetName,
      self: false,
    };
  }

  return {
    kickUserId: "",
    username: targetName,
    self: false,
  };
}

export async function tryHandleBuiltinChatCommand({
  sender,
  content,
  replyToChat,
}) {
  const username = sender?.username || "viewer";

  const commandsMatch = await matchTrigger(content, "commandsList");
  if (commandsMatch) {
    await replyToChat(
      username,
      await botReply("commandsList", { username, url: "https://blakjac21.com/commands/" })
    );
    return { handled: true, reason: "commands-list" };
  }

  const shopMatch = await matchTrigger(content, "shop");
  if (shopMatch) {
    await replyToChat(
      null,
      await botReply("shopReply", {
        username,
        url: "https://blakjac21.com/store/",
      })
    );
    return { handled: true, reason: "shop" };
  }

  const topMatch = await matchTrigger(content, "top");
  if (topMatch) {
    await replyToChat(
      username,
      await botReply("topReply", {
        username,
        url: "https://blakjac21.com/leaderboard/",
      })
    );
    return { handled: true, reason: "top" };
  }

  const shoutoutMatch = await matchTrigger(content, "shoutout");
  if (shoutoutMatch) {
    if (!isAdminSender(sender)) {
      await replyToChat(username, await botReply("shoutoutAdminOnly"));
      return { handled: true, reason: "shoutout-denied" };
    }
    const name = cleanTargetUsername(shoutoutMatch.args);
    if (!name) {
      await replyToChat(username, await botReply("shoutoutUsage"));
      return { handled: true, reason: "shoutout-usage" };
    }
    const slug = name.toLowerCase();
    await replyToChat(
      null,
      await botReply("shoutoutReply", {
        name: slug,
        url: `https://kick.com/${slug}`,
      })
    );
    return { handled: true, reason: "shoutout" };
  }

  const uptimeMatch = await matchTrigger(content, "uptime");
  if (uptimeMatch) {
    const status = await getStreamStatus({ refresh: true });
    if (!status.isLive || !status.startedAt) {
      await replyToChat(username, await botReply("uptimeOffline"));
    } else {
      await replyToChat(
        username,
        await botReply("uptimeLive", {
          time: formatDuration(Date.now() - status.startedAt),
        })
      );
    }
    return { handled: true, reason: "uptime" };
  }

  const followageMatch = await matchTrigger(content, "followage");
  if (followageMatch) {
    const target = await resolveTargetUser(sender, followageMatch.args);
    let follow = target.kickUserId
      ? await getFollow(target.kickUserId)
      : null;
    if (!follow) {
      follow = await findFollowByUsername(target.username);
    }
    if (!follow?.followedAt) {
      await replyToChat(
        null,
        await botReply("followageNo", { username: target.username })
      );
    } else {
      await replyToChat(
        null,
        await botReply("followageYes", {
          username: follow.username || target.username,
          time: formatDuration(Date.now() - follow.followedAt),
        })
      );
    }
    return { handled: true, reason: "followage" };
  }

  const watchtimeMatch = await matchTrigger(content, "watchtime");
  if (watchtimeMatch) {
    const target = await resolveTargetUser(sender, watchtimeMatch.args);
    let entry = target.kickUserId
      ? await getEngagement(target.kickUserId)
      : null;
    if ((!entry || !entry.watchMinutes) && target.username) {
      entry = (await findEngagementByUsername(target.username)) || entry;
    }
    const summary = summarizeEngagement(
      entry || { username: target.username, watchMinutes: 0, xp: 0 }
    );
    await replyToChat(
      null,
      await botReply("watchtimeReply", {
        username: summary.username || target.username,
        time: formatWatchMinutes(summary.watchMinutes),
      })
    );
    return { handled: true, reason: "watchtime" };
  }

  const levelMatch = await matchTrigger(content, "level");
  if (levelMatch) {
    const target = await resolveTargetUser(sender, levelMatch.args);
    let entry = target.kickUserId
      ? await getEngagement(target.kickUserId)
      : null;
    if ((!entry || !entry.xp) && target.username) {
      entry = (await findEngagementByUsername(target.username)) || entry;
    }
    const summary = summarizeEngagement(
      entry || { username: target.username, watchMinutes: 0, xp: 0 }
    );
    if (!summary.hasProgress) {
      await replyToChat(
        null,
        await botReply("levelNone", { username: summary.username || target.username })
      );
    } else {
      await replyToChat(
        null,
        await botReply("levelReply", {
          username: summary.username || target.username,
          level: summary.level,
        })
      );
    }
    return { handled: true, reason: "level" };
  }

  const xpMatch = await matchTrigger(content, "xp");
  if (xpMatch) {
    const target = await resolveTargetUser(sender, xpMatch.args);
    let entry = target.kickUserId
      ? await getEngagement(target.kickUserId)
      : null;
    if ((!entry || !entry.xp) && target.username) {
      entry = (await findEngagementByUsername(target.username)) || entry;
    }
    const summary = summarizeEngagement(
      entry || { username: target.username, watchMinutes: 0, xp: 0 }
    );
    if (!summary.hasProgress) {
      await replyToChat(
        null,
        await botReply("xpNone", { username: summary.username || target.username })
      );
    } else {
      await replyToChat(
        null,
        await botReply("xpReply", {
          username: summary.username || target.username,
          xp: summary.xp,
          nextlvl: summary.nextLevelXp,
        })
      );
    }
    return { handled: true, reason: "xp" };
  }

  const addcomMatch = await matchTrigger(content, "addcom");
  if (addcomMatch) {
    if (!isAdminSender(sender)) {
      await replyToChat(username, await botReply("commandAdminOnly"));
      return { handled: true, reason: "addcom-denied" };
    }
    const parts = addcomMatch.args.trim().match(/^(\S+)\s+(.+)$/s);
    if (!parts) {
      await replyToChat(username, await botReply("addcomUsage"));
      return { handled: true, reason: "addcom-usage" };
    }
    try {
      const trigger = await addCustomCommand({
        trigger: parts[1],
        reply: parts[2],
      });
      await replyToChat(
        username,
        await botReply("addcomSuccess", { trigger })
      );
    } catch (error) {
      if (error.code === "exists") {
        await replyToChat(
          username,
          await botReply("addcomExists", {
            trigger: error.trigger || normalizeCommandTrigger(parts[1]),
          })
        );
      } else {
        await replyToChat(username, error.message || (await botReply("addcomUsage")));
      }
    }
    return { handled: true, reason: "addcom" };
  }

  const delcomMatch = await matchTrigger(content, "delcom");
  if (delcomMatch) {
    if (!isAdminSender(sender)) {
      await replyToChat(username, await botReply("commandAdminOnly"));
      return { handled: true, reason: "delcom-denied" };
    }
    const triggerArg = delcomMatch.args.trim().split(/\s+/)[0];
    if (!triggerArg) {
      await replyToChat(username, await botReply("delcomUsage"));
      return { handled: true, reason: "delcom-usage" };
    }
    try {
      const trigger = await deleteCustomCommand(triggerArg);
      await replyToChat(
        username,
        await botReply("delcomSuccess", { trigger })
      );
    } catch (error) {
      if (error.code === "missing") {
        await replyToChat(
          username,
          await botReply("delcomMissing", {
            trigger: error.trigger || normalizeCommandTrigger(triggerArg),
          })
        );
      } else {
        await replyToChat(username, error.message || (await botReply("delcomUsage")));
      }
    }
    return { handled: true, reason: "delcom" };
  }

  const editcomMatch = await matchTrigger(content, "editcom");
  if (editcomMatch) {
    if (!isAdminSender(sender)) {
      await replyToChat(username, await botReply("commandAdminOnly"));
      return { handled: true, reason: "editcom-denied" };
    }
    const parts = editcomMatch.args.trim().match(/^(\S+)\s+(.+)$/s);
    if (!parts) {
      await replyToChat(username, await botReply("editcomUsage"));
      return { handled: true, reason: "editcom-usage" };
    }
    try {
      const trigger = await editCustomCommand({
        trigger: parts[1],
        reply: parts[2],
      });
      await replyToChat(
        username,
        await botReply("editcomSuccess", { trigger })
      );
    } catch (error) {
      if (error.code === "missing") {
        await replyToChat(
          username,
          await botReply("editcomMissing", {
            trigger: error.trigger || normalizeCommandTrigger(parts[1]),
          })
        );
      } else {
        await replyToChat(username, error.message || (await botReply("editcomUsage")));
      }
    }
    return { handled: true, reason: "editcom" };
  }

  return { handled: false };
}

/**
 * Viewer balance lookup for !points without an amount.
 */
export async function handlePointsBalanceLookup({
  sender,
  targetUsername,
  replyToChat,
}) {
  const selfName = sender?.username || "viewer";
  const selfId = sender?.user_id ? String(sender.user_id) : "";
  const requested = cleanTargetUsername(targetUsername);

  let kickUserId = selfId;
  let displayName = selfName;

  if (requested) {
    displayName = requested;
    const found = await findUserByUsername(requested);
    if (found?.kickUserId) {
      kickUserId = String(found.kickUserId);
      displayName = found.username || requested;
    } else {
      const byPoints = await findPointsBalanceByUsername(requested);
      if (byPoints?.kickUserId) {
        kickUserId = String(byPoints.kickUserId);
        displayName = byPoints.username || requested;
        await replyToChat(
          null,
          await botReply("pointsBalance", {
            username: displayName,
            points: byPoints.points,
          })
        );
        return;
      }
      // Fall through with empty id → 0 points under requested name
      kickUserId = "";
    }
  }

  let balance = kickUserId
    ? await getPointsBalance(kickUserId)
    : { points: 0, username: displayName };

  if (!kickUserId && requested) {
    // Try chat-only balances already covered; show 0 for unknown users
    balance = { points: 0, username: displayName };
  } else if (kickUserId) {
    const stored = await getUserByKickId(kickUserId);
    displayName = stored?.username || balance.username || displayName;
  }

  await replyToChat(
    null,
    await botReply("pointsBalance", {
      username: displayName,
      points: balance.points || 0,
    })
  );
}
