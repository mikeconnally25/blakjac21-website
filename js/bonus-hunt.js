let currentUser = null;
let pollTimer = null;
let slotPollTimer = null;
let slotCatalog = [];
let slotGroups = [];
let slotCatalogUpdatedAt = null;
let acceptingRequests = false;
let stakeSyncPollTimer = null;
let stakeSyncInProgress = false;
let huntMeta = {
  title: "Live Hunt",
  startBalance: 0,
  status: "collecting",
};

const HUNT_STATUS_LABELS = {
  collecting: "Collecting",
  opening: "Opening",
  complete: "Complete",
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

function buildStakeBookmarkletHref(token) {
  const origin = window.location.origin;
  const scriptUrl = `${origin}/js/stake-sync-bookmarklet.js?token=${encodeURIComponent(token)}&origin=${encodeURIComponent(origin)}`;
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
    bookmarklet.href = buildStakeBookmarkletHref(token);
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
      ? "Slot list is empty. A stake.com tab will open — click the BJ21 Stake Sync bookmark once to load New Releases and Only on Stake."
      : "Stake tab opened. Click the BJ21 Stake Sync bookmark on stake.com to finish.";

    updateStakeSyncHelp({
      token: data.token,
      stakeUrl: data.stakeUrl,
      message,
    });

    if (!auto) {
      setStatus(message);
    }

    window.open(data.stakeUrl, "_blank", "noopener,noreferrer");
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
  const status = document.getElementById("hunt-status");
  const titleInput = document.getElementById("hunt-title-input");
  const startInput = document.getElementById("hunt-start-input");

  if (title) {
    title.textContent = hunt?.title || "Live Hunt";
  }

  if (status) {
    const huntStatus = hunt?.status || "collecting";
    status.textContent = HUNT_STATUS_LABELS[huntStatus] || "Collecting";
    status.className = `hunt-status hunt-status--${huntStatus}`;
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
  const progress = document.getElementById("hunt-progress");

  if (!totalBonuses || !startBalance || !profit) return;

  totalBonuses.textContent = String(summary.totalBonuses);
  startBalance.textContent = formatCurrency(hunt?.startBalance || 0);

  profit.textContent = formatCurrency(summary.profit);
  profit.classList.toggle("is-positive", summary.profit > 0);
  profit.classList.toggle("is-negative", summary.profit < 0);

  if (progress) {
    if (!summary.totalBonuses) {
      progress.textContent = "No bonuses yet.";
    } else if (summary.pendingCount > 0) {
      progress.textContent = `Opened ${summary.openedCount} of ${summary.totalBonuses} bonuses · ${formatCurrency(summary.totalWon)} won`;
    } else {
      progress.textContent = `All ${summary.totalBonuses} bonuses opened · ${formatCurrency(summary.totalWon)} won`;
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

    if (bonus.id === openingId) {
      item.classList.add("is-opening");
    }

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

    item.append(avatar, main, result);

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

function renderKickBotStatus(status) {
  const meta = document.getElementById("kick-bot-status");
  if (!meta) return;

  if (!status?.connected) {
    meta.textContent =
      "Kick chat bot is not configured. Set KICK_CLIENT_ID, KICK_CLIENT_SECRET, and KICK_BROADCASTER_USER_ID in Vercel.";
    return;
  }

  const label =
    status.source === "env"
      ? "Kick chat bot ready (KICK_BOT_ACCESS_TOKEN)."
      : status.source === "env-refresh"
        ? "Kick chat bot ready (KICK_BOT_REFRESH_TOKEN)."
        : status.source === "app"
          ? "Kick chat bot ready."
          : status.username
            ? `Kick chat bot ready as ${status.username}.`
            : "Kick chat bot ready.";

  meta.textContent = label;
}

async function loadKickBotStatus() {
  if (!currentUser?.isAdmin) return;

  try {
    const response = await fetch("/api/kick/bot/status", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const status = await response.json();
    renderKickBotStatus(status);
  } catch {
    // Keep the last known state.
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
}

function updateRequestPanels() {
  const closedPanel = document.getElementById("slot-request-closed");
  const requestPanel = document.getElementById("slot-request-panel");
  const guestPanel = document.getElementById("slot-request-guest");
  const isAdmin = Boolean(currentUser?.isAdmin);
  const isSignedIn = Boolean(currentUser);
  const open = acceptingRequests;

  closedPanel?.classList.toggle("is-hidden", open || isAdmin);
  requestPanel?.classList.toggle("is-hidden", !open || isAdmin || !isSignedIn);
  guestPanel?.classList.toggle("is-hidden", !open || isSignedIn);

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

function updatePanels() {
  const adminPanel = document.getElementById("bonus-hunt-admin");
  const settingsForm = document.getElementById("hunt-settings-form");

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  settingsForm?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  updateRequestPanels();
  updateToggleLabel();
}

function renderSlotCatalogSelect(selectedSlug = "") {
  const select = document.getElementById("slot-request-select");
  const count = document.getElementById("slot-catalog-count");
  const meta = document.getElementById("slot-catalog-meta");

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

  if (meta) {
    if (!slotCatalog.length) {
      meta.textContent =
        "No slots loaded yet. Click Refresh slot list in the admin panel.";
    } else {
      meta.textContent = slotCatalogUpdatedAt
        ? `Slot list updated ${new Date(slotCatalogUpdatedAt).toLocaleString()}`
        : "";
    }
  }
}

function renderSlotRequests(requests) {
  const list = document.getElementById("slot-requests-list");
  const empty = document.getElementById("slot-requests-empty");
  const count = document.getElementById("slot-requests-count");

  if (!list || !empty) return;

  const total = requests.length;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

  if (count) {
    count.textContent = total === 1 ? "1 request" : `${total} requests`;
  }

  if (!total) {
    empty.textContent = acceptingRequests
      ? "No slot requests yet."
      : "Slot requests are closed. Turn on Accept requests in the admin panel.";
  }

  requests.forEach((request) => {
    const item = document.createElement("li");
    item.className = "slot-request-entry";

    const main = document.createElement("div");
    main.className = "slot-request-entry-main";

    const user = document.createElement("span");
    user.className = "slot-request-user";
    user.textContent = request.username;

    const slot = document.createElement("span");
    slot.className = "slot-request-slot";
    slot.textContent = request.slotName;

    const group = document.createElement("span");
    group.className = "slot-request-group";
    group.textContent = request.groupLabel;

    main.append(user, slot, group);
    item.append(main);

    if (currentUser?.isAdmin) {
      const actions = document.createElement("div");
      actions.className = "slot-request-actions";

      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "btn btn-sm btn-primary";
      useBtn.textContent = "Use";
      useBtn.addEventListener("click", () => {
        const slotInput = document.getElementById("bonus-slot");
        if (slotInput) {
          slotInput.value = request.slotName;
          slotInput.focus();
        }
        setStatus(`Loaded ${request.slotName} into the add bonus form.`, "success");
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-sm btn-outline";
      removeBtn.textContent = "Dismiss";
      removeBtn.addEventListener("click", () =>
        removeSlotRequestEntry(request.id, removeBtn)
      );

      actions.append(useBtn, removeBtn);
      item.append(actions);
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

async function loadSlotRequests() {
  try {
    const response = await fetch("/api/bonus-hunt/requests", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    acceptingRequests = Boolean(data.acceptingRequests);
    renderSlotRequests(data.requests || []);
    updateRequestPanels();
    updateToggleLabel();

    const select = document.getElementById("slot-request-select");
    if (!select?.value && data.myRequest?.slotSlug) {
      renderSlotCatalogSelect(data.myRequest.slotSlug);
    }
  } catch {
    // Keep the last known state.
  }
}

async function removeSlotRequestEntry(id, button) {
  button.disabled = true;
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
      setStatus(data.error || "Could not remove slot request.", "error");
      return;
    }

    setStatus("Slot request dismissed.", "success");
    await loadSlotRequests();
  } catch {
    setStatus("Could not remove slot request. Try again.", "error");
  } finally {
    button.disabled = false;
  }
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

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const slotInput = document.getElementById("bonus-slot");
    const betInput = document.getElementById("bonus-bet");
    const submitBtn = document.getElementById("bonus-add-submit");
    const slot = slotInput?.value.trim();
    const bet = Number(betInput?.value);

    if (!slot) {
      setStatus("Enter a slot name.", "error");
      return;
    }

    if (!Number.isFinite(bet) || bet < 0) {
      setStatus("Enter a valid bet amount.", "error");
      return;
    }

    submitBtn.disabled = true;
    setStatus("Adding bonus...");

    try {
      const response = await fetch("/api/bonus-hunt/add", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, bet }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not add bonus.", "error");
        return;
      }

      form.reset();
      setStatus("Bonus added.", "success");
      await loadBonusHunt();
    } catch {
      setStatus("Could not add bonus. Try again.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  clearBtn?.addEventListener("click", async () => {
    if (!window.confirm("Clear the entire bonus hunt?")) {
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

  document.getElementById("kick-chat-subscribe")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus("Enabling !slot in Kick chat...");

    try {
      const response = await fetch("/api/kick/subscribe", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not enable !slot in chat.", "error");
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
          ? `Kick chat !slot enabled. ${refreshedCount} slots loaded.`
          : "Kick chat !slot enabled. Finish Stake sync to load slots.";
      setStatus(slotMessage, refreshedCount > 0 ? "success" : "error");
    } catch {
      setStatus("Could not enable !slot in chat. Try again.", "error");
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

  document.getElementById("slot-requests-toggle")?.addEventListener("change", async (event) => {
    const toggle = event.currentTarget;
    const nextAccepting = toggle.checked;

    toggle.disabled = true;
    setStatus(nextAccepting ? "Opening slot requests..." : "Closing slot requests...");

    try {
      const response = await fetch("/api/bonus-hunt/requests/toggle", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepting: nextAccepting }),
      });

      const data = await response.json();
      if (!response.ok) {
        toggle.checked = !nextAccepting;
        setStatus(data.error || "Could not update slot request setting.", "error");
        return;
      }

      acceptingRequests = Boolean(data.acceptingRequests);
      updateRequestPanels();
      updateToggleLabel();
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
  await Promise.all([loadBonusHunt(), loadSlotCatalog(), loadSlotRequests(), loadKickBotStatus()]);
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
  await Promise.all([loadCurrentUser(), loadBonusHunt(), loadSlotCatalog(), loadSlotRequests()]);
  updatePanels();
  await loadKickBotStatus();
  schedulePolling();
}

initAdminForm();
initSlotRequestForm();
bootstrapBonusHuntPage();
