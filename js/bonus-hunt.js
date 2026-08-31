let currentUser = null;
let pollTimer = null;
let slotPollTimer = null;
let slotCatalog = [];
let slotGroups = [];
let slotCatalogUpdatedAt = null;
let acceptingRequests = false;

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

function renderSummary(summary) {
  const totalBonuses = document.getElementById("summary-total");
  const totalCost = document.getElementById("summary-cost");
  const totalWon = document.getElementById("summary-won");
  const profit = document.getElementById("summary-profit");

  if (!totalBonuses || !totalCost || !totalWon || !profit) return;

  totalBonuses.textContent = String(summary.totalBonuses);
  totalCost.textContent = formatCurrency(summary.totalCost);
  totalWon.textContent = formatCurrency(summary.totalWon);

  profit.textContent = formatCurrency(summary.profit);
  profit.classList.toggle("is-positive", summary.profit > 0);
  profit.classList.toggle("is-negative", summary.profit < 0);
}

function renderBonusList(bonuses) {
  const list = document.getElementById("bonus-list");
  const empty = document.getElementById("bonus-empty");
  const count = document.getElementById("bonus-count");

  if (!list || !empty || !count) return;

  const total = bonuses.length;
  count.textContent =
    total === 1 ? "1 bonus" : `${total} bonuses`;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

  bonuses.forEach((bonus) => {
    const item = document.createElement("li");
    item.className = "bonus-entry";
    item.dataset.id = bonus.id;

    const main = document.createElement("div");
    main.className = "bonus-entry-main";

    const number = document.createElement("span");
    number.className = "bonus-entry-number";
    number.textContent = `#${bonus.number}`;

    const slot = document.createElement("span");
    slot.className = "bonus-entry-slot";
    slot.textContent = bonus.slot;

    const meta = document.createElement("div");
    meta.className = "bonus-entry-meta";

    const bet = document.createElement("span");
    bet.className = "bonus-entry-bet";
    bet.textContent = formatCurrency(bonus.bet);

    const payout = document.createElement("span");
    payout.className = "bonus-entry-payout";
    payout.textContent =
      bonus.status === "opened"
        ? formatCurrency(bonus.payout ?? 0)
        : "Pending";

    const status = document.createElement("span");
    status.className = `bonus-entry-status bonus-entry-status--${bonus.status}`;
    status.textContent = bonus.status === "opened" ? "Opened" : "Pending";

    meta.append(bet, payout, status);
    main.append(number, slot, meta);
    item.append(main);

    if (currentUser?.isAdmin) {
      const actions = document.createElement("div");
      actions.className = "bonus-entry-actions";

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
        openBtn.textContent = "Save";
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
    renderSummary(data.summary);
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
  const connectBtn = document.getElementById("kick-bot-connect");
  if (!meta) return;

  if (!status?.connected) {
    meta.textContent =
      "Chat bot not connected. Connect your Kick account to send !slot replies in chat.";
    connectBtn?.classList.remove("is-hidden");
    return;
  }

  const label =
    status.source === "env"
      ? "Kick chat bot token is set in Vercel (KICK_BOT_ACCESS_TOKEN)."
      : status.source === "env-refresh"
        ? "Kick chat bot refresh token is set in Vercel (KICK_BOT_REFRESH_TOKEN)."
        : status.username
          ? `Kick chat bot connected as ${status.username}.`
          : "Kick chat bot connected.";

  meta.textContent = label;
  connectBtn?.classList.toggle("is-hidden", status.source === "env" || status.source === "env-refresh");
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
        ? `Kick chat bot connected as ${username}.`
        : "Kick chat bot connected.",
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

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);
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
    meta.textContent = slotCatalogUpdatedAt
      ? `Slot list updated ${new Date(slotCatalogUpdatedAt).toLocaleString()}`
      : "";
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

      setStatus("Kick chat !slot command enabled.", "success");
    } catch {
      setStatus("Could not enable !slot in chat. Try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("slot-catalog-refresh")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus("Refreshing slot list from Stake...");

    try {
      const response = await fetch("/api/bonus-hunt/slots/refresh", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not refresh slot list.", "error");
        return;
      }

      setStatus(`Slot list refreshed (${data.count} slots).`, "success");
      await loadSlotCatalog();
    } catch {
      setStatus("Could not refresh slot list. Try again.", "error");
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
