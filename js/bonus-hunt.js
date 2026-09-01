let currentUser = null;
let pollTimer = null;
let slotPollTimer = null;
let slotCatalog = [];
let slotGroups = [];
let slotCatalogUpdatedAt = null;
let acceptingRequests = false;
let slotRequests = [];
const pendingSlotRequestRemovals = new Set();
let slotBetDrafts = new Map();
let stakeSyncPollTimer = null;
let stakeSyncInProgress = false;
let huntMeta = {
  title: "Live Hunt",
  startBalance: 0,
  status: "collecting",
};
let pastHunts = [];

const REQUEST_STATUS_LABELS = {
  open: "Collecting",
  closed: "Check back later",
};

function slotInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "?";
}

function avatarColor(name) {
  let hash = 0;
  for (const char of String(name || "")) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 42%)`;
}

function formatMultiplier(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}x`;
}

function buildStakeBookmarkletHref() {
  const origin = window.location.origin;
  const scriptUrl = `${origin}/js/stake-sync-bookmarklet.js?origin=${encodeURIComponent(origin)}`;
  const code = `javascript:(function(){var s=document.createElement('script');s.src=${JSON.stringify(scriptUrl)};document.head.appendChild(s);})();`;
  return code;
}

function updateStakeSyncHelp({ token, stakeUrl, message }) {
  const section = document.getElementById("slot-sync-help");
  const helpText = document.getElementById("slot-sync-help-text");
  const bookmarklet = document.getElementById("slot-sync-bookmarklet");
  const openStake = document.getElementById("slot-sync-open-stake");

  if (!section || !token) {
    section?.classList.add("is-hidden");
    return;
  }

  section.classList.remove("is-hidden");
  if (helpText && message) {
    helpText.textContent = message;
  }
  if (bookmarklet) {
    bookmarklet.href = buildStakeBookmarkletHref();
  }
  if (openStake && stakeUrl) {
    openStake.href = stakeUrl;
  }
}

function stopStakeSyncPolling() {
  if (stakeSyncPollTimer) {
    clearInterval(stakeSyncPollTimer);
    stakeSyncPollTimer = null;
  }
  stakeSyncInProgress = false;
}

function startStakeSyncPolling(token) {
  stopStakeSyncPolling();
  stakeSyncInProgress = true;

  stakeSyncPollTimer = setInterval(async () => {
    try {
      const response = await fetch(
        `/api/bonus-hunt/slots/sync-status?token=${encodeURIComponent(token)}`,
        { credentials: "same-origin", cache: "no-store" }
      );
      if (!response.ok) {
        return;
      }

      const status = await response.json();
      if (!status.complete) {
        return;
      }

      stopStakeSyncPolling();
      updateStakeSyncHelp({ token: null });

      if (status.count > 0) {
        setStatus(`Loaded ${status.count} slots from New Releases and Only on Stake.`, "success");
        await loadSlotCatalog();
        return;
      }

      setStatus(status.error || "Stake sync finished but no slots were imported.", "error");
    } catch {
      // Keep polling until token expires.
    }
  }, 2000);
}

async function tryServerSlotRefresh({ silent = false } = {}) {
  try {
    const response = await fetch("/api/bonus-hunt/slots/refresh", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) {
      if (!silent) {
        setStatus(data.error || "Could not refresh slot list.", "error");
      }
      return 0;
    }

    if (!silent) {
      setStatus(`Slot list refreshed (${data.count} slots).`, "success");
    }
    await loadSlotCatalog();
    return data.count || 0;
  } catch {
    if (!silent) {
      setStatus("Could not refresh slot list. Try again.", "error");
    }
    return 0;
  }
}

async function syncSlotsFromStake({ auto = false } = {}) {
  if (!currentUser?.isAdmin) {
    return 0;
  }

  if (stakeSyncInProgress) {
    return slotCatalog.length;
  }

  if (!auto) {
    setStatus("Syncing slots from Stake...");
  }

  const serverCount = await tryServerSlotRefresh({ silent: true });
  if (serverCount > 0) {
    if (!auto) {
      setStatus(`Loaded ${serverCount} slots from Stake.`, "success");
    }
    updateStakeSyncHelp({ token: null });
    return serverCount;
  }

  try {
    const response = await fetch("/api/bonus-hunt/slots/sync-token", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) {
      if (!auto) {
        setStatus(data.error || "Could not start Stake sync.", "error");
      }
      return 0;
    }

    const message = auto
      ? "Follow the setup steps on the sync page, then click BJ21 Stake Sync on stake.com."
      : "Follow the setup steps on the sync page, then click BJ21 Stake Sync on stake.com.";

    updateStakeSyncHelp({
      token: data.token,
      stakeUrl: data.stakeUrl,
      message,
    });

    if (!auto) {
      setStatus(message);
    }

    const syncPageUrl = data.syncPageUrl || `/stake-sync.html?token=${encodeURIComponent(data.token)}`;
    window.open(syncPageUrl, "_blank", "noopener,noreferrer");
    startStakeSyncPolling(data.token);
    return 0;
  } catch {
    if (!auto) {
      setStatus("Could not start Stake sync. Try again.", "error");
    }
    return 0;
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function setStatus(message, tone = "") {
  const status = document.getElementById("bonus-hunt-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
}

function setRequestStatus(message, tone = "") {
  const status = document.getElementById("slot-request-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
}

function renderHuntHeader(hunt) {
  const title = document.getElementById("hunt-title");
  const titleInput = document.getElementById("hunt-title-input");
  const startInput = document.getElementById("hunt-start-input");

  if (title) {
    title.textContent = hunt?.title || "Live Hunt";
  }

  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = hunt?.title || "Live Hunt";
  }

  if (startInput && document.activeElement !== startInput) {
    startInput.value = Number(hunt?.startBalance || 0).toFixed(2);
  }
}

function renderSummary(summary, hunt) {
  const totalBonuses = document.getElementById("summary-total");
  const startBalance = document.getElementById("summary-start");
  const profit = document.getElementById("summary-profit");
  const breakeven = document.getElementById("summary-breakeven");
  const progress = document.getElementById("hunt-progress");
  const progressCount = document.getElementById("hunt-progress-count");
  const progressFill = document.getElementById("hunt-progress-fill");
  const bonusCount = document.getElementById("hunt-bonus-count");

  if (!totalBonuses || !startBalance || !profit) return;

  totalBonuses.textContent = String(summary.totalBonuses);
  startBalance.textContent = formatCurrency(hunt?.startBalance || 0);

  profit.textContent = formatCurrency(summary.profit);
  profit.classList.toggle("is-positive", summary.profit > 0);
  profit.classList.toggle("is-negative", summary.profit < 0);

  if (breakeven) {
    if (summary.breakevenX === null || summary.breakevenX === undefined) {
      breakeven.textContent = "—";
      breakeven.classList.remove("is-positive", "is-negative", "is-target");
    } else if (summary.breakevenX <= 0) {
      breakeven.textContent = "0.00x";
      breakeven.classList.add("is-positive");
      breakeven.classList.remove("is-negative", "is-target");
    } else {
      breakeven.textContent = formatMultiplier(summary.breakevenX);
      breakeven.classList.remove("is-positive", "is-negative");
      breakeven.classList.toggle("is-target", summary.breakevenX >= 1);
      breakeven.classList.toggle("is-negative", summary.breakevenX > 100);
    }
  }

  if (bonusCount) {
    bonusCount.textContent =
      summary.totalBonuses === 1 ? "1 total" : `${summary.totalBonuses} total`;
  }

  const progressPercent =
    summary.totalBonuses > 0
      ? Math.round((summary.openedCount / summary.totalBonuses) * 100)
      : 0;

  if (progressFill) {
    progressFill.style.width = `${progressPercent}%`;
  }

  if (progressCount) {
    progressCount.textContent = summary.totalBonuses
      ? `${progressPercent}% opened`
      : "";
  }

  if (progress) {
    if (!summary.totalBonuses) {
      progress.textContent = "Waiting for the first bonus buy.";
    } else if (summary.pendingCount > 0) {
      progress.textContent = `Opened ${summary.openedCount} of ${summary.totalBonuses} · ${formatCurrency(summary.totalWon)} won`;
    } else {
      progress.textContent = `Hunt complete · ${formatCurrency(summary.totalWon)} won`;
    }
  }
}

function renderBonusList(bonuses) {
  const list = document.getElementById("bonus-list");
  const empty = document.getElementById("bonus-empty");

  if (!list || !empty) return;

  const total = bonuses.length;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

  const openingId = bonuses.find((bonus) => bonus.status === "pending")?.id;

  bonuses.forEach((bonus) => {
    const item = document.createElement("li");
    item.className = "hunt-bonus-card";
    item.dataset.id = bonus.id;
    item.style.animationDelay = `${Math.min(bonus.number, 8) * 40}ms`;

    if (bonus.id === openingId) {
      item.classList.add("is-opening");
    }

    const index = document.createElement("span");
    index.className = "hunt-bonus-index";
    index.textContent = `#${bonus.number}`;

    const avatar = document.createElement("div");
    avatar.className = "hunt-bonus-avatar";
    avatar.textContent = slotInitials(bonus.slot);
    avatar.style.background = avatarColor(bonus.slot);

    const main = document.createElement("div");
    main.className = "hunt-bonus-main";

    const slot = document.createElement("p");
    slot.className = "hunt-bonus-slot";
    slot.textContent = bonus.slot;

    const provider = document.createElement("p");
    provider.className = "hunt-bonus-provider";
    provider.textContent = `Bet ${formatCurrency(bonus.bet)}`;

    main.append(slot, provider);

    const result = document.createElement("div");
    result.className = "hunt-bonus-result";

    if (bonus.status === "opened") {
      const payout = document.createElement("div");
      payout.className = "hunt-bonus-payout";
      if ((bonus.payout ?? 0) >= bonus.bet) {
        payout.classList.add("is-win");
      }
      payout.textContent = formatCurrency(bonus.payout ?? 0);

      const multiplier = document.createElement("div");
      multiplier.className = "hunt-bonus-multiplier";
      if ((bonus.multiplier ?? 0) >= 1) {
        multiplier.classList.add("is-win");
      }
      multiplier.textContent = formatMultiplier(bonus.multiplier);

      result.append(payout, multiplier);
    } else {
      const pending = document.createElement("div");
      pending.className = "hunt-bonus-pending";
      pending.textContent = bonus.id === openingId ? "Opening" : "—";
      result.append(pending);
    }

    item.append(index, avatar, main, result);

    if (currentUser?.isAdmin) {
      const actions = document.createElement("div");
      actions.className = "hunt-bonus-admin";

      if (bonus.status === "pending") {
        const payoutInput = document.createElement("input");
        payoutInput.className = "bonus-payout-input";
        payoutInput.type = "number";
        payoutInput.inputMode = "decimal";
        payoutInput.min = "0";
        payoutInput.step = "0.01";
        payoutInput.placeholder = "Payout";
        payoutInput.setAttribute("aria-label", `Payout for ${bonus.slot}`);

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "btn btn-sm btn-primary";
        openBtn.textContent = "Save payout";
        openBtn.addEventListener("click", () =>
          saveBonusPayout(bonus.id, payoutInput.value, openBtn)
        );

        actions.append(payoutInput, openBtn);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-sm btn-outline";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeBonusEntry(bonus.id, removeBtn));
      actions.append(removeBtn);
      item.append(actions);
    }

    list.append(item);
  });
}

function formatHuntDate(value) {
  if (!value) return "";

  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function huntStatusLabel(status) {
  switch (status) {
    case "complete":
      return "Complete";
    case "opening":
      return "Opening";
    case "collecting":
      return "Collecting";
    default:
      return "Ended";
  }
}

function renderPastHunts(hunts) {
  const list = document.getElementById("past-hunts-list");
  const empty = document.getElementById("past-hunts-empty");
  const count = document.getElementById("past-hunts-count");

  if (!list || !empty) return;

  const total = hunts.length;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

  if (count) {
    count.textContent = total === 1 ? "1 hunt" : `${total} hunts`;
  }

  hunts.forEach((hunt) => {
    const item = document.createElement("li");
    item.className = "past-hunt-entry";

    const summary = hunt.summary || {};
    const profit = Number(summary.profit || 0);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "past-hunt-entry-toggle";
    toggle.setAttribute("aria-expanded", "false");

    const top = document.createElement("div");
    top.className = "past-hunt-entry-top";

    const main = document.createElement("div");
    main.className = "past-hunt-entry-main";

    const title = document.createElement("h4");
    title.className = "past-hunt-entry-title";
    title.textContent = hunt.title || "Live Hunt";

    const meta = document.createElement("p");
    meta.className = "past-hunt-entry-meta";
    meta.textContent = `${formatHuntDate(hunt.endedAt)} · ${summary.totalBonuses || 0} bonuses`;

    main.append(title, meta);

    const stats = document.createElement("div");
    stats.className = "past-hunt-entry-stats";

    const profitValue = document.createElement("span");
    profitValue.className = "past-hunt-entry-profit";
    profitValue.textContent = formatCurrency(profit);
    profitValue.classList.toggle("is-positive", profit > 0);
    profitValue.classList.toggle("is-negative", profit < 0);

    const status = document.createElement("span");
    status.className = `past-hunt-entry-status past-hunt-entry-status--${hunt.status || "complete"}`;
    status.textContent = huntStatusLabel(hunt.status);

    stats.append(profitValue, status);
    top.append(main, stats);
    toggle.append(top);

    const details = document.createElement("div");
    details.className = "past-hunt-entry-details is-hidden";

    const detailStats = document.createElement("div");
    detailStats.className = "past-hunt-entry-detail-stats";

    const startStat = document.createElement("div");
    startStat.className = "past-hunt-detail-stat";
    startStat.innerHTML = `<span>Start</span><strong>${formatCurrency(hunt.startBalance || 0)}</strong>`;

    const wonStat = document.createElement("div");
    wonStat.className = "past-hunt-detail-stat";
    wonStat.innerHTML = `<span>Won</span><strong>${formatCurrency(summary.totalWon || 0)}</strong>`;

    const costStat = document.createElement("div");
    costStat.className = "past-hunt-detail-stat";
    costStat.innerHTML = `<span>Cost</span><strong>${formatCurrency(summary.totalCost || 0)}</strong>`;

    detailStats.append(startStat, wonStat, costStat);

    const bonusList = document.createElement("ul");
    bonusList.className = "past-hunt-bonus-list";

    (hunt.bonuses || []).forEach((bonus) => {
      const bonusItem = document.createElement("li");
      bonusItem.className = "past-hunt-bonus-item";

      const slot = document.createElement("span");
      slot.className = "past-hunt-bonus-slot";
      slot.textContent = bonus.slot;

      const result = document.createElement("span");
      result.className = "past-hunt-bonus-result";
      if (bonus.status === "opened") {
        result.textContent = `${formatCurrency(bonus.payout ?? 0)} · ${formatMultiplier(bonus.multiplier)}`;
        if ((bonus.payout ?? 0) >= bonus.bet) {
          result.classList.add("is-win");
        }
      } else {
        result.textContent = "Not opened";
      }

      bonusItem.append(slot, result);
      bonusList.append(bonusItem);
    });

    details.append(detailStats, bonusList);

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      details.classList.toggle("is-hidden", expanded);
      item.classList.toggle("is-expanded", !expanded);
    });

    item.append(toggle, details);
    list.append(item);
  });
}

async function loadPastHunts() {
  try {
    const response = await fetch("/api/bonus-hunt/history", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    pastHunts = data.pastHunts || [];
    renderPastHunts(pastHunts);
  } catch {
    // Keep the last known state.
  }
}

async function loadBonusHunt() {
  try {
    const response = await fetch("/api/bonus-hunt", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    huntMeta = data.hunt || huntMeta;
    renderHuntHeader(huntMeta);
    renderSummary(data.summary, huntMeta);
    renderBonusList(data.bonuses);
  } catch {
    // Keep the last known state.
  }
}

async function addBonusToHunt(slot, bet) {
  const slotName = slot?.trim();
  const betAmount = Number(bet);

  if (!slotName) {
    setStatus("Enter a slot name.", "error");
    return null;
  }

  if (!Number.isFinite(betAmount) || betAmount < 0) {
    setStatus("Enter a valid bet amount.", "error");
    return null;
  }

  setStatus("Adding bonus...");

  try {
    const response = await fetch("/api/bonus-hunt/add", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: slotName, bet: betAmount }),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not add bonus.", "error");
      return null;
    }

    setStatus("Bonus added.", "success");
    await loadBonusHunt();
    return data.bonus || null;
  } catch {
    setStatus("Could not add bonus. Try again.", "error");
    return null;
  }
}

function scrollToBonusCard(bonusId) {
  const card = bonusId
    ? document.querySelector(`.hunt-bonus-card[data-id="${bonusId}"]`)
    : null;
  const target = card || document.querySelector(".hunt-bonus-section");

  target?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
}

function resolveSlotRequestBet(request, betInput) {
  const typedBet = betInput?.value?.trim() || slotBetDrafts.get(request.id)?.trim() || "";
  if (typedBet) {
    return typedBet;
  }

  if (request.bet === null || request.bet === undefined) {
    return "";
  }

  return formatSlotBetValue(request.bet);
}

async function submitBonusAddForm({ button, slot, bet } = {}) {
  const form = document.getElementById("bonus-add-form");
  const slotInput = document.getElementById("bonus-slot");
  const betInput = document.getElementById("bonus-bet");
  const submitBtn = button || document.getElementById("bonus-add-submit");
  const slotName = slot ?? slotInput?.value.trim();
  const betValue = bet ?? betInput?.value;

  if (submitBtn) {
    submitBtn.disabled = true;
  }

  const bonus = await addBonusToHunt(slotName, betValue);
  if (bonus) {
    form?.reset();
    scrollToBonusCard(bonus.id);
  }

  if (submitBtn) {
    submitBtn.disabled = false;
  }

  return bonus;
}

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      currentUser = null;
      return;
    }

    const data = await response.json();
    currentUser = data.authenticated ? data.user : null;
  } catch {
    currentUser = null;
  }
}

function renderKickChatStatus(status) {
  const panel = document.getElementById("kick-chat-admin");
  const chatStatus = document.getElementById("kick-chat-status");
  const botMeta = document.getElementById("kick-bot-status");
  const webhookLog = document.getElementById("kick-webhook-log");
  const connectButton = document.getElementById("kick-bot-connect");
  const subscribeButton = document.getElementById("kick-chat-subscribe");

  if (!currentUser?.isAdmin) {
    panel?.classList.add("is-hidden");
    return;
  }

  panel?.classList.remove("is-hidden");

  if (!status) {
    if (chatStatus) {
      chatStatus.textContent = "Could not load Kick chat status.";
      chatStatus.className = "requests-hub-kick-status is-error";
    }
    return;
  }

  const lines = [];
  if (status.kickChatSubscribed) {
    lines.push("Chat listener is subscribed.");
  } else {
    lines.push("Chat listener is not subscribed. Click Enable !s in chat.");
  }

  if (status.chatRepliesReady) {
    lines.push("Bot replies are configured.");
  } else {
    lines.push("Connect chat bot if you want confirmation messages in Kick chat.");
  }

  if (status.subscriptionError) {
    lines.push(status.subscriptionError);
  }

  const latestWebhook = status.recentWebhookEvents?.[0];
  if (latestWebhook) {
    if (latestWebhook.ok && latestWebhook.handled) {
      lines.push(`Last chat event processed ${new Date(latestWebhook.at).toLocaleTimeString()}.`);
    } else if (latestWebhook.error) {
      lines.push(`Last webhook issue: ${latestWebhook.error}`);
    } else if (latestWebhook.reason === "not-command") {
      lines.push(`Last chat event received ${new Date(latestWebhook.at).toLocaleTimeString()} (not a !s command).`);
    }
  } else {
    lines.push("No chat webhook events received yet.");
  }

  if (chatStatus) {
    chatStatus.textContent = lines.join(" ");
    chatStatus.className = `requests-hub-kick-status ${
      status.kickChatSubscribed ? "is-success" : "is-error"
    }`;
  }

  if (botMeta) {
    botMeta.textContent = status.webhookUrl
      ? `Kick Developer Portal webhook URL: ${status.webhookUrl}`
      : "";
  }

  if (webhookLog) {
    const entries = status.recentWebhookEvents || [];
    if (entries.length) {
      webhookLog.textContent = entries
        .slice(0, 3)
        .map((entry) => {
          const time = new Date(entry.at).toLocaleTimeString();
          if (entry.error) return `${time}: ${entry.error}`;
          if (entry.handled) return `${time}: processed !s from ${entry.username || "viewer"}`;
          return `${time}: ${entry.reason || entry.stage || "event"}`;
        })
        .join(" | ");
      webhookLog.classList.remove("is-hidden");
    } else {
      webhookLog.textContent = "";
      webhookLog.classList.add("is-hidden");
    }
  }

  if (connectButton) {
    connectButton.classList.toggle("is-hidden", Boolean(status.chatRepliesReady));
  }

  if (subscribeButton) {
    subscribeButton.classList.toggle("is-hidden", Boolean(status.kickChatSubscribed));
  }
}

async function loadKickChatStatus() {
  if (!currentUser?.isAdmin) {
    renderKickChatStatus(null);
    return;
  }

  try {
    const response = await fetch("/api/kick/chat-status", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      renderKickChatStatus(null);
      return;
    }

    const status = await response.json();
    renderKickChatStatus(status);
  } catch {
    renderKickChatStatus(null);
  }
}

function handleKickBotRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const kickBot = params.get("kickBot");
  if (!kickBot) return;

  if (kickBot === "connected") {
    const username = params.get("username");
    setStatus(
      username
        ? `Kick chat bot ready as ${username}.`
        : "Kick chat bot ready.",
      "success"
    );
    void loadKickChatStatus();
  } else if (kickBot === "error") {
    const message = params.get("message");
    const text =
      message === "Client authentication failed"
        ? "Kick Client Secret is invalid on the server. Regenerate it in the Kick Developer Portal, update KICK_CLIENT_SECRET in Vercel, and redeploy."
        : message || "Could not connect Kick chat bot.";
    setStatus(text, "error");
  }

  params.delete("kickBot");
  params.delete("username");
  params.delete("message");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function updateCollectingStatus() {
  const status = document.getElementById("hunt-status");
  const panelStatus = document.getElementById("requests-panel-status");
  const isAdmin = Boolean(currentUser?.isAdmin);

  const label = acceptingRequests
    ? REQUEST_STATUS_LABELS.open
    : REQUEST_STATUS_LABELS.closed;
  const statusClass = acceptingRequests
    ? "hunt-status hunt-status--collecting hunt-status-toggle"
    : "hunt-status hunt-status--closed hunt-status-toggle";
  const panelClass = acceptingRequests
    ? "requests-hub-status requests-hub-status--open"
    : "requests-hub-status requests-hub-status--closed";

  if (status) {
    status.textContent = label;
    status.className = statusClass;
    status.setAttribute("aria-pressed", acceptingRequests ? "true" : "false");
    status.disabled = !isAdmin;
    status.title = isAdmin
      ? "Click to toggle slot request collection"
      : acceptingRequests
        ? "Collecting slot requests"
        : "Check back later for slot requests";
  }

  if (panelStatus) {
    panelStatus.textContent = label;
    panelStatus.className = panelClass;
  }
}

function updateToggleLabel() {
  const label = document.getElementById("slot-requests-toggle-status");
  const toggle = document.getElementById("slot-requests-toggle");

  if (label) {
    label.textContent = acceptingRequests
      ? "Accepting slot requests"
      : "Slot requests are closed";
  }

  if (toggle && currentUser?.isAdmin) {
    toggle.checked = acceptingRequests;
  }

  updateCollectingStatus();
}

async function setAcceptingRequests(nextAccepting) {
  const response = await fetch("/api/bonus-hunt/requests/toggle", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accepting: nextAccepting }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not update slot request setting.");
  }

  acceptingRequests = Boolean(data.acceptingRequests);
  updateRequestPanels();
  updateToggleLabel();
  renderSlotRequests(slotRequests);

  if (currentUser?.isAdmin && data.kickChatError) {
    setStatus(`Collecting is on, but Kick chat failed to connect: ${data.kickChatError}`, "error");
  } else if (currentUser?.isAdmin && data.acceptingRequests && data.kickChatSubscribed === false) {
    setStatus("Collecting is on, but chat is not subscribed. Click Enable !s in chat.", "error");
  }

  if (currentUser?.isAdmin) {
    await loadKickChatStatus();
  }

  return data;
}

function updateRequestPanels() {
  const closedPanel = document.getElementById("slot-request-closed");
  const requestPanel = document.getElementById("slot-request-panel");
  const guestPanel = document.getElementById("slot-request-guest");
  const adminActions = document.getElementById("slot-requests-admin");
  const isAdmin = Boolean(currentUser?.isAdmin);
  const isSignedIn = Boolean(currentUser);
  const open = acceptingRequests;

  closedPanel?.classList.toggle("is-hidden", open || isAdmin);
  requestPanel?.classList.toggle("is-hidden", !open || isAdmin || !isSignedIn);
  guestPanel?.classList.toggle("is-hidden", !open || isSignedIn);
  adminActions?.classList.toggle("is-hidden", !isAdmin);

  const select = document.getElementById("slot-request-select");
  const submitBtn = document.getElementById("slot-request-submit");
  const canSubmit = open && isSignedIn && !isAdmin;

  if (select) {
    select.disabled = !canSubmit;
  }

  if (submitBtn) {
    submitBtn.disabled = !canSubmit;
  }
}

function mountSlotQueuePanel() {
  const listWrap = document.querySelector(".hunt-admin-queue-list");
  const adminQueue = document.getElementById("hunt-admin-queue");
  const adminTools = document.getElementById("slot-requests-admin");
  const viewerMount = document.getElementById("slot-requests-viewer-mount");

  if (!listWrap || !viewerMount || !adminQueue) {
    return;
  }

  if (currentUser?.isAdmin) {
    adminQueue.append(listWrap);
    adminTools?.classList.remove("is-hidden");
  } else {
    viewerMount.append(listWrap);
    adminTools?.classList.add("is-hidden");
  }
}

function updatePanels() {
  const adminPanel = document.getElementById("bonus-hunt-admin");
  const settingsForm = document.getElementById("hunt-settings-form");
  const adminQueue = document.getElementById("hunt-admin-queue");

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  settingsForm?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  adminQueue?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  mountSlotQueuePanel();
  updateRequestPanels();
  updateToggleLabel();
}

function renderSlotCatalogSelect(selectedSlug = "") {
  const select = document.getElementById("slot-request-select");
  const count = document.getElementById("slot-catalog-count");

  if (!select) return;

  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = slotCatalog.length
    ? "Choose a slot..."
    : "No slots loaded yet";
  select.append(placeholder);

  const grouped = new Map();
  for (const slot of slotCatalog) {
    if (!grouped.has(slot.groupSlug)) {
      grouped.set(slot.groupSlug, []);
    }
    grouped.get(slot.groupSlug).push(slot);
  }

  for (const group of slotGroups) {
    const slots = grouped.get(group.slug) || [];
    if (!slots.length) continue;

    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;

    for (const slot of slots) {
      const option = document.createElement("option");
      option.value = slot.slug;
      option.textContent = slot.name;
      option.dataset.groupSlug = slot.groupSlug;
      if (slot.slug === selectedSlug) {
        option.selected = true;
      }
      optgroup.append(option);
    }

    select.append(optgroup);
  }

  if (count) {
    count.textContent =
      slotCatalog.length === 1
        ? "1 allowed slot"
        : `${slotCatalog.length} allowed slots`;
  }
}

function isEditingSlotRequestBet() {
  const active = document.activeElement;
  return active?.classList?.contains("slot-request-bet-input") ?? false;
}

function formatSlotBetValue(bet) {
  if (bet === null || bet === undefined || bet === "") {
    return "";
  }

  return Number(bet).toFixed(2);
}

function findCatalogSlot(request) {
  if (!request) {
    return null;
  }

  const slug = String(request.slotSlug || "").trim().toLowerCase();
  const name = String(request.slotName || "").trim().toLowerCase();

  return (
    slotCatalog.find((slot) => slug && slot.slug === slug) ||
    slotCatalog.find((slot) => slot.name.toLowerCase() === name) ||
    null
  );
}

function getSlotRequestProvider(request, catalogSlot) {
  if (catalogSlot?.provider) {
    return catalogSlot.provider;
  }

  if (request.groupSlug === "pending") {
    return "";
  }

  return "";
}

function createSlotRequestThumb(slotName, thumbnailUrl) {
  const thumb = document.createElement("div");
  thumb.className = "slot-request-thumb";

  if (thumbnailUrl) {
    const image = document.createElement("img");
    image.className = "slot-request-thumb-image";
    image.src = thumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      image.remove();
      thumb.textContent = slotInitials(slotName);
      thumb.classList.add("is-fallback");
      thumb.style.background = avatarColor(slotName);
    });
    thumb.append(image);
  } else {
    thumb.textContent = slotInitials(slotName);
    thumb.classList.add("is-fallback");
    thumb.style.background = avatarColor(slotName);
  }

  return thumb;
}

function renderSlotRequests(requests) {
  const list = document.getElementById("slot-requests-list");
  const empty = document.getElementById("slot-requests-empty");
  const count = document.getElementById("slot-requests-count");
  const tableHead = document.getElementById("slot-requests-table-head");

  if (!list || !empty) return;

  const total = requests.length;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  tableHead?.classList.add("is-hidden");
  list.replaceChildren();

  if (count) {
    count.textContent = total === 1 ? "1 request" : `${total} requests`;
  }

  if (!total) {
    const isAdmin = Boolean(currentUser?.isAdmin);
    if (acceptingRequests) {
      empty.textContent = "No requests yet. Viewers can type !s slot name in chat.";
    } else if (isAdmin) {
      empty.textContent =
        "No requests in the queue. Click Collecting in the hunt header to start accepting them.";
    } else {
      empty.textContent =
        "Nothing in the queue yet. Check back when the stream is Collecting.";
    }
  }

  requests.forEach((request) => {
    const catalogSlot = findCatalogSlot(request);
    const provider = getSlotRequestProvider(request, catalogSlot);
    const thumbnailUrl = catalogSlot?.thumbnailUrl || null;

    const item = document.createElement("li");
    item.className = "slot-request-entry";
    item.dataset.requestId = request.id;

    const thumb = createSlotRequestThumb(request.slotName, thumbnailUrl);

    const info = document.createElement("div");
    info.className = "slot-request-info";

    const titleRow = document.createElement("div");
    titleRow.className = "slot-request-title-row";

    const slot = document.createElement("span");
    slot.className = "slot-request-slot";
    slot.textContent = request.slotName;

    titleRow.append(slot);

    if (provider) {
      const providerEl = document.createElement("span");
      providerEl.className = "slot-request-provider";
      providerEl.textContent = provider;
      titleRow.append(providerEl);
    }

    const user = document.createElement("span");
    user.className = "slot-request-user";
    user.textContent = `by ${request.username}`;

    info.append(titleRow, user);
    item.append(thumb, info);

    if (currentUser?.isAdmin) {
      const controls = document.createElement("div");
      controls.className = "slot-request-controls";

      const betRow = document.createElement("div");
      betRow.className = "guess-input-row";

      const prefix = document.createElement("span");
      prefix.className = "guess-prefix";
      prefix.setAttribute("aria-hidden", "true");
      prefix.textContent = "$";

      const betInput = document.createElement("input");
      betInput.type = "number";
      betInput.className = "guess-input slot-request-bet-input";
      betInput.min = "0.01";
      betInput.max = "1000";
      betInput.step = "0.01";
      betInput.inputMode = "decimal";
      betInput.placeholder = "0.00";
      betInput.value = slotBetDrafts.has(request.id)
        ? slotBetDrafts.get(request.id)
        : formatSlotBetValue(request.bet);
      betInput.setAttribute("aria-label", `Bet size for ${request.slotName}`);

      betRow.append(prefix, betInput);

      betInput.addEventListener("input", () => {
        slotBetDrafts.set(request.id, betInput.value);
      });

      betInput.addEventListener("blur", () => {
        const value = betInput.value.trim();
        if (!value) {
          return;
        }

        if (value === formatSlotBetValue(request.bet)) {
          slotBetDrafts.delete(request.id);
          return;
        }

        void saveSlotRequestBet(request.id, value, { silent: true });
      });

      betInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void saveSlotRequestBet(request.id, betInput.value);
        }
      });

      const addBonusBtn = document.createElement("button");
      addBonusBtn.type = "button";
      addBonusBtn.className = "btn btn-sm btn-primary";
      addBonusBtn.textContent = "Add bonus";
      addBonusBtn.addEventListener("click", async () => {
        const betValue = resolveSlotRequestBet(request, betInput);
        const betAmount = Number(betValue);

        if (!betValue || !Number.isFinite(betAmount) || betAmount < 0.01) {
          setStatus("Enter a bet size before adding the bonus.", "error");
          betInput.focus();
          return;
        }

        if (betInput.value.trim()) {
          await saveSlotRequestBet(request.id, betInput.value, {
            silent: true,
            skipRender: true,
          });
        }

        const bonus = await submitBonusAddForm({
          button: addBonusBtn,
          slot: request.slotName,
          bet: betValue,
        });

        if (bonus) {
          slotBetDrafts.delete(request.id);
          renderSlotRequests(slotRequests);
        }
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "slot-request-remove";
      removeBtn.setAttribute("aria-label", `Remove ${request.slotName} request`);
      removeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM6 9h2v9H6V9Z"/></svg>';
      removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void removeSlotRequestEntry(request.id, removeBtn);
      });

      controls.append(betRow, addBonusBtn, removeBtn);
      item.append(controls);
    } else {
      const betCell = document.createElement("div");
      betCell.className = "slot-request-bet-cell";

      const bet = document.createElement("span");
      bet.className = "slot-request-bet";
      bet.textContent =
        request.bet === null || request.bet === undefined
          ? "—"
          : formatCurrency(request.bet);
      betCell.append(bet);
      item.append(betCell);
    }

    list.append(item);
  });
}

async function loadSlotCatalog() {
  try {
    const response = await fetch("/api/bonus-hunt/slots", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Could not load slot catalog.");
    }

    const data = await response.json();
    slotCatalog = data.slots || [];
    slotGroups = data.groups || [];
    slotCatalogUpdatedAt = data.updatedAt || null;

    const select = document.getElementById("slot-request-select");
    const selectedSlug = select?.value || "";
    renderSlotCatalogSelect(selectedSlug);
  } catch (error) {
    const count = document.getElementById("slot-catalog-count");
    if (count && !slotCatalog.length) {
      count.textContent = "Slot list unavailable";
      setRequestStatus(error.message, "error");
    }
  }
}

async function loadSlotRequests({ forceRender = false } = {}) {
  try {
    const response = await fetch("/api/bonus-hunt/requests", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    acceptingRequests = Boolean(data.acceptingRequests);
    let incoming = data.requests || [];
    if (pendingSlotRequestRemovals.size) {
      incoming = incoming.filter(
        (entry) => !pendingSlotRequestRemovals.has(entry.id)
      );
    }
    slotRequests = incoming;

    if (forceRender || !isEditingSlotRequestBet()) {
      renderSlotRequests(slotRequests);
    } else {
      const count = document.getElementById("slot-requests-count");
      if (count) {
        const total = slotRequests.length;
        count.textContent = total === 1 ? "1 request" : `${total} requests`;
      }
    }

    updateRequestPanels();
    updateToggleLabel();

    const catalogCount = document.getElementById("slot-catalog-count");
    if (catalogCount) {
      if (data.slotCatalogCount > 0) {
        catalogCount.textContent =
          data.slotCatalogCount === 1
            ? "1 allowed slot loaded"
            : `${data.slotCatalogCount} allowed slots loaded`;
      } else if (currentUser?.isAdmin) {
        catalogCount.textContent =
          "Slot list is empty. Click Sync slots from Stake so !s requests can be validated.";
      } else {
        catalogCount.textContent = "Slot list is loading...";
      }
    }

    if (currentUser?.isAdmin && data.kickChatSubscribed === false) {
      setStatus(
        "Kick chat is not subscribed yet. Use Enable !s in chat in the admin panel.",
        "error"
      );
    }

    if (currentUser?.isAdmin) {
      renderKickChatStatus({
        kickChatSubscribed: Boolean(data.kickChatSubscribed),
        chatRepliesReady: false,
        subscriptionError: data.kickChatSubscriptionError || null,
        webhookUrl: null,
      });
    }

    const select = document.getElementById("slot-request-select");
    if (!select?.value && data.myRequest?.slotSlug) {
      renderSlotCatalogSelect(data.myRequest.slotSlug);
    }
  } catch {
    // Keep the last known state.
  }
}

async function saveSlotRequestBet(id, betValue, { button, silent = false, skipRender = false } = {}) {
  if (button) {
    button.disabled = true;
  }

  if (!silent) {
    setStatus("Saving bet size...");
  }

  try {
    const response = await fetch("/api/bonus-hunt/requests/bet", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, bet: betValue }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (!silent) {
        setStatus(data.error || "Could not save bet size.", "error");
      }
      return false;
    }

    if (!silent) {
      setStatus("Bet size saved.", "success");
    }

    slotBetDrafts.delete(id);

    const savedRequest = data.request;
    if (savedRequest) {
      slotRequests = slotRequests.map((entry) =>
        entry.id === savedRequest.id ? savedRequest : entry
      );
    }

    if (!skipRender && !isEditingSlotRequestBet()) {
      renderSlotRequests(slotRequests);
    }

    return true;
  } catch {
    if (!silent) {
      setStatus("Could not save bet size. Try again.", "error");
    }
    return false;
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function removeSlotRequestEntry(id, button) {
  if (!id || pendingSlotRequestRemovals.has(id)) {
    return;
  }

  button.disabled = true;
  pendingSlotRequestRemovals.add(id);
  slotBetDrafts.delete(id);

  if (document.activeElement?.classList?.contains("slot-request-bet-input")) {
    document.activeElement.blur();
  }

  slotRequests = slotRequests.filter((entry) => entry.id !== id);
  renderSlotRequests(slotRequests);
  setStatus("Removing slot request...");

  try {
    const response = await fetch("/api/bonus-hunt/requests/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const data = await response.json();
    if (!response.ok) {
      pendingSlotRequestRemovals.delete(id);
      setStatus(data.error || "Could not remove slot request.", "error");
      await loadSlotRequests({ forceRender: true });
      return;
    }

    pendingSlotRequestRemovals.delete(id);
    setStatus("Slot request removed.", "success");
    await loadSlotRequests({ forceRender: true });
  } catch {
    pendingSlotRequestRemovals.delete(id);
    setStatus("Could not remove slot request. Try again.", "error");
    await loadSlotRequests({ forceRender: true });
  } finally {
    if (button.isConnected) {
      button.disabled = false;
    }
  }
}

function initSlotRequestListActions() {
  const list = document.getElementById("slot-requests-list");
  if (!list || list.dataset.actionsBound === "true") {
    return;
  }

  list.dataset.actionsBound = "true";
  list.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".slot-request-remove");
    if (!removeBtn || removeBtn.disabled) {
      return;
    }

    const entry = removeBtn.closest(".slot-request-entry");
    const id = entry?.dataset.requestId;
    if (!id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void removeSlotRequestEntry(id, removeBtn);
  });
}

function schedulePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  if (slotPollTimer) {
    clearInterval(slotPollTimer);
  }

  pollTimer = setInterval(loadBonusHunt, 2000);
  slotPollTimer = setInterval(() => {
    loadSlotCatalog();
    loadSlotRequests();
  }, 1000);
}

async function saveBonusPayout(id, rawPayout, button) {
  const payout = Number(rawPayout);
  if (!Number.isFinite(payout) || payout < 0) {
    setStatus("Enter a valid payout amount.", "error");
    return;
  }

  button.disabled = true;
  setStatus("Saving payout...");

  try {
    const response = await fetch("/api/bonus-hunt/update", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, payout }),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not save payout.", "error");
      return;
    }

    setStatus("Payout saved.", "success");
    await loadBonusHunt();
  } catch {
    setStatus("Could not save payout. Try again.", "error");
  } finally {
    button.disabled = false;
  }
}

async function removeBonusEntry(id, button) {
  button.disabled = true;
  setStatus("Removing bonus...");

  try {
    const response = await fetch("/api/bonus-hunt/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not remove bonus.", "error");
      return;
    }

    setStatus("Bonus removed.", "success");
    await loadBonusHunt();
  } catch {
    setStatus("Could not remove bonus. Try again.", "error");
  } finally {
    button.disabled = false;
  }
}

function initAdminForm() {
  const settingsForm = document.getElementById("hunt-settings-form");
  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = document.getElementById("hunt-title-input")?.value?.trim();
    const startBalance = document.getElementById("hunt-start-input")?.value;
    const saveBtn = document.getElementById("hunt-settings-save");

    saveBtn.disabled = true;
    setStatus("Saving hunt settings...");

    try {
      const response = await fetch("/api/bonus-hunt/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, startBalance }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not save hunt settings.", "error");
        return;
      }

      huntMeta = data.hunt || huntMeta;
      renderHuntHeader(huntMeta);
      renderSummary(data.summary, huntMeta);
      setStatus("Hunt settings saved.", "success");
    } catch {
      setStatus("Could not save hunt settings. Try again.", "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  const form = document.getElementById("bonus-add-form");
  const clearBtn = document.getElementById("bonus-clear-hunt");
  const endBtn = document.getElementById("bonus-end-hunt");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitBonusAddForm();
  });

  clearBtn?.addEventListener("click", async () => {
    if (!window.confirm("Clear the entire bonus hunt? This will not save it to past hunts.")) {
      return;
    }

    clearBtn.disabled = true;
    setStatus("Clearing bonus hunt...");

    try {
      const response = await fetch("/api/bonus-hunt/clear", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not clear bonus hunt.", "error");
        return;
      }

      setStatus("Bonus hunt cleared.", "success");
      await loadBonusHunt();
    } catch {
      setStatus("Could not clear bonus hunt. Try again.", "error");
    } finally {
      clearBtn.disabled = false;
    }
  });

  endBtn?.addEventListener("click", async () => {
    const bonusCount = Number(document.getElementById("summary-total")?.textContent || 0);
    const message = bonusCount
      ? "End this hunt and save it to past hunts? The live tracker will reset."
      : "End this hunt with no bonuses? It will still be saved to past hunts.";

    if (!window.confirm(message)) {
      return;
    }

    endBtn.disabled = true;
    setStatus("Ending hunt...");

    try {
      const response = await fetch("/api/bonus-hunt/end", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not end hunt.", "error");
        return;
      }

      huntMeta = data.hunt || huntMeta;
      renderHuntHeader(huntMeta);
      renderSummary(data.summary, huntMeta);
      renderBonusList(data.bonuses || []);
      setStatus("Hunt ended and saved to past hunts.", "success");
      await loadPastHunts();
    } catch {
      setStatus("Could not end hunt. Try again.", "error");
    } finally {
      endBtn.disabled = false;
    }
  });

  document.getElementById("kick-chat-subscribe")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus("Enabling !s in Kick chat...");

    try {
      const response = await fetch("/api/kick/subscribe", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not enable !s in chat.", "error");
        return;
      }

      acceptingRequests = Boolean(data.acceptingRequests);
      updateRequestPanels();
      updateToggleLabel();
      await Promise.all([loadSlotCatalog(), loadSlotRequests()]);

      if (!data.slotCount) {
        await syncSlotsFromStake({ auto: true });
        await loadSlotCatalog();
      }

      const refreshedCount = slotCatalog.length;
      const slotMessage =
        refreshedCount > 0
          ? `Kick chat !s enabled. ${refreshedCount} slots loaded.`
          : "Kick chat !s enabled. Finish Stake sync to load slots.";
      setStatus(slotMessage, refreshedCount > 0 ? "success" : "error");
      await loadKickChatStatus();
    } catch {
      setStatus("Could not enable !s in chat. Try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("kick-test-command")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus("Testing slot queue...");

    try {
      const response = await fetch("/api/kick/test-command", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotQuery: "gates of olympus" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Queue test failed.", "error");
        return;
      }

      await loadSlotRequests();
      setStatus(
        data.latestRequest
          ? `Queue test worked. Added ${data.latestRequest.slotName}.`
          : "Queue test ran but no request was saved.",
        data.latestRequest ? "success" : "error"
      );
      await loadKickChatStatus();
    } catch {
      setStatus("Queue test failed. Try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("slot-catalog-sync")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      await syncSlotsFromStake();
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("slot-catalog-refresh")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus("Refreshing slot list from Stake...");

    try {
      await tryServerSlotRefresh();
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("hunt-status")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!currentUser?.isAdmin || button.disabled) {
      return;
    }

    const nextAccepting = !acceptingRequests;
    button.disabled = true;
    setStatus(nextAccepting ? "Opening slot requests..." : "Closing slot requests...");

    try {
      await setAcceptingRequests(nextAccepting);
      setStatus(
        acceptingRequests ? "Now collecting slot requests." : "Slot requests closed for now.",
        "success"
      );
    } catch (error) {
      setStatus(error.message || "Could not update slot request setting.", "error");
    } finally {
      button.disabled = !currentUser?.isAdmin;
    }
  });

  document.getElementById("slot-requests-toggle")?.addEventListener("change", async (event) => {
    const toggle = event.currentTarget;
    const nextAccepting = toggle.checked;

    toggle.disabled = true;
    setStatus(nextAccepting ? "Opening slot requests..." : "Closing slot requests...");

    try {
      await setAcceptingRequests(nextAccepting);
      setStatus(
        acceptingRequests ? "Slot requests are now open." : "Slot requests are now closed.",
        "success"
      );
    } catch {
      toggle.checked = !nextAccepting;
      setStatus("Could not update slot request setting. Try again.", "error");
    } finally {
      toggle.disabled = false;
    }
  });

  document.getElementById("slot-requests-clear")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;

    if (!window.confirm("Clear all slot requests?")) {
      return;
    }

    button.disabled = true;
    setStatus("Clearing slot requests...");

    try {
      const response = await fetch("/api/bonus-hunt/requests/clear", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not clear slot requests.", "error");
        return;
      }

      setStatus("Slot requests cleared.", "success");
      await loadSlotRequests();
    } catch {
      setStatus("Could not clear slot requests. Try again.", "error");
    } finally {
      button.disabled = false;
    }
  });
}

function initSlotRequestForm() {
  const form = document.getElementById("slot-request-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      setRequestStatus("Sign in with Kick to request a slot.", "error");
      return;
    }

    if (!acceptingRequests) {
      setRequestStatus("Slot requests are closed right now.", "error");
      return;
    }

    const select = document.getElementById("slot-request-select");
    const submitBtn = document.getElementById("slot-request-submit");
    const slotSlug = select?.value;

    if (!slotCatalog.length) {
      setRequestStatus(
        "Slot list is empty. Ask the admin to refresh it from Stake.",
        "error"
      );
      return;
    }

    if (!slotSlug) {
      setRequestStatus("Choose a slot from the list.", "error");
      return;
    }

    submitBtn.disabled = true;
    setRequestStatus("Submitting your request...");

    try {
      const response = await fetch("/api/bonus-hunt/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotSlug }),
      });

      const data = await response.json();
      if (!response.ok) {
        setRequestStatus(data.error || "Could not submit request.", "error");
        return;
      }

      form.reset();
      setRequestStatus(`Requested ${data.request.slotName}.`, "success");
      await loadSlotRequests();
    } catch {
      setRequestStatus("Could not submit request. Try again.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  updatePanels();
  await Promise.all([loadBonusHunt(), loadSlotCatalog(), loadSlotRequests(), loadKickChatStatus()]);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadBonusHunt();
    loadSlotCatalog();
    loadSlotRequests();
  }
});

async function bootstrapBonusHuntPage() {
  handleKickBotRedirectParams();
  await Promise.all([loadCurrentUser(), loadBonusHunt(), loadPastHunts(), loadSlotCatalog(), loadSlotRequests()]);
  updatePanels();
  renderSlotRequests(slotRequests);
  await loadKickChatStatus();
  schedulePolling();
}

initAdminForm();
initSlotRequestForm();
initSlotRequestListActions();
bootstrapBonusHuntPage();
