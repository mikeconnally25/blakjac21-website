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
import {
  averageXTeamList,
  defaultRanges,
  defaultSpinRanges,
  placeAverageXBet,
  placeHeadBet,
  placeSpinBet,
  publicAverageX,
  rangeForBonusCount,
  rangeForTeam,
} from "./average-x.js";

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

  const averageXMatch = await matchTrigger(content, "averageX");
  if (averageXMatch) {
    let ranges = defaultRanges();
    let spinRanges = defaultSpinRanges();
    let closed = " Bets are closed right now.";
    try {
      const state = await publicAverageX(null);
      if (state.ranges?.length) ranges = state.ranges;
      if (state.spins?.ranges?.length) spinRanges = state.spins.ranges;
      if (state.status === "open" || state.spins?.status === "open") closed = "";
    } catch {
      // The default team list still tells chat how to bet.
    }
    const args = String(averageXMatch.args || "").trim();
    const teamBet = args.match(/^(\d+)\s+team\s*(\d+)$/i);
    const bonusBet = args.match(/^(\d+)\s+bonuses?\s+(\d+\+?)$/i);
    if (!teamBet && !bonusBet) {
      await replyToChat(
        username,
        await botReply("averageXHelp", {
          teams: averageXTeamList(ranges),
          closed,
        })
      );
      return { handled: true, reason: "average-x-help" };
    }
    if (!sender?.user_id) {
      await replyToChat(username, "Sign in on blakjac21.com to bet.");
      return { handled: true, reason: "average-x-signin" };
    }
    try {
      if (teamBet) {
        const range = rangeForTeam(ranges, Number(teamBet[2]));
        if (!range) throw new Error("Pick a team from 1 to 9.");
        await placeAverageXBet({
          kickUserId: sender.user_id,
          username,
          rangeId: range.id,
          amount: Number(teamBet[1]),
        });
        await replyToChat(username, `You're in for ${teamBet[1]} UncCoins on team ${teamBet[2]} (${range.label}).`);
        return { handled: true, reason: "average-x-bet" };
      }
      const range = rangeForBonusCount(spinRanges, bonusBet[2]);
      if (!range) throw new Error("Bet a bonus count from 0 to 7, or 8+.");
      await placeSpinBet({
        kickUserId: sender.user_id,
        username,
        rangeId: range.id,
        amount: Number(bonusBet[1]),
      });
      await replyToChat(username, `You're in for ${bonusBet[1]} UncCoins on ${range.label} bonuses.`);
      return { handled: true, reason: "average-x-bonus-bet" };
    } catch (error) {
      await replyToChat(username, error.message || "Could not place that bet.");
      return { handled: true, reason: "average-x-bet-error" };
    }
  }

  const headMatch = await matchTrigger(content, "headToHead");
  if (headMatch) {
    let leftName = "slot 1";
    let rightName = "slot 2";
    let closed = " Bets are closed right now.";
    try {
      const state = await publicAverageX(null);
      leftName = state.head?.left?.slot?.name || leftName;
      rightName = state.head?.right?.slot?.name || rightName;
      if (state.head?.status === "open") closed = "";
    } catch {
      // The help line still explains the command.
    }
    const bet = String(headMatch.args || "").match(/^(\d+)\s+([12])$/);
    if (!bet) {
      await replyToChat(
        username,
        await botReply("headToHeadHelp", { left: leftName, right: rightName, closed })
      );
      return { handled: true, reason: "head-help" };
    }
    if (!sender?.user_id) {
      await replyToChat(username, "Sign in on blakjac21.com to bet.");
      return { handled: true, reason: "head-signin" };
    }
    try {
      await placeHeadBet({
        kickUserId: sender.user_id,
        username,
        side: bet[2] === "1" ? "left" : "right",
        amount: Number(bet[1]),
      });
      const picked = bet[2] === "1" ? leftName : rightName;
      await replyToChat(username, `You're in for ${bet[1]} UncCoins on ${picked}.`);
      return { handled: true, reason: "head-bet" };
    } catch (error) {
      await replyToChat(username, error.message || "Could not place that bet.");
      return { handled: true, reason: "head-bet-error" };
    }
  }

  let spinsMatch = await matchTrigger(content, "hundredSpins");
  if (!spinsMatch) {
    const cleaned = String(content || "")
      .replace(/\[emote:\d+:[^\]]+\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const literal = cleaned.match(/^!bonuses(?:\s+([\s\S]*))?$/i);
    if (literal) spinsMatch = { trigger: "!bonuses", args: String(literal[1] || "").trim() };
  }
  if (spinsMatch) {
    let slotName = "the slot up top";
    let ranges = defaultSpinRanges();
    let closed = " Bets are closed right now.";
    try {
      const state = await publicAverageX(null);
      slotName = state.spins?.slot?.name || state.slot?.name || slotName;
      if (state.spins?.ranges?.length) ranges = state.spins.ranges;
      if (state.spins?.status === "open") closed = "";
    } catch {
      // The help line still explains the command.
    }
    const args = String(spinsMatch.args || "").trim();
    const teamBet = args.match(/^(\d+)\s+team\s*(\d+)$/i);
    const boxBet = args.match(/^(\d+)\s+(\d+\+?)$/i);
    const bet = teamBet || boxBet;
    if (!bet) {
      await replyToChat(
        username,
        await botReply("hundredSpinsHelp", {
          slot: slotName,
          teams: averageXTeamList(ranges),
          closed,
        })
      );
      return { handled: true, reason: "spins-help" };
    }
    if (!sender?.user_id) {
      await replyToChat(username, "Sign in on blakjac21.com to bet.");
      return { handled: true, reason: "spins-signin" };
    }
    const range = teamBet
      ? rangeForTeam(ranges, Number(teamBet[2]))
      : rangeForBonusCount(ranges, boxBet[2]);
    if (!range) {
      await replyToChat(
        username,
        await botReply("hundredSpinsHelp", { slot: slotName, teams: averageXTeamList(ranges), closed })
      );
      return { handled: true, reason: "spins-usage" };
    }
    try {
      await placeSpinBet({
        kickUserId: sender.user_id,
        username,
        rangeId: range.id,
        amount: Number(bet[1]),
      });
      await replyToChat(username, `You're in for ${bet[1]} UncCoins on ${range.label} bonuses.`);
      return { handled: true, reason: "spins-bet" };
    } catch (error) {
      await replyToChat(username, error.message || "Could not place that bet.");
      return { handled: true, reason: "spins-bet-error" };
    }
  }

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
