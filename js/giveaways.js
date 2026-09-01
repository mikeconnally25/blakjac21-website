let currentUser = null;
let giveawaysOpen = false;
let giveawayKeyword = "";
let giveawayEntries = [];
let pollTimer = null;

function setAdminStatus(message, type = "") {
  const status = document.getElementById("giveaways-admin-status");
  if (!status) return;

  status.textContent = message || "";
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", type === "error");
  status.classList.toggle("is-success", type === "success");
}

function updateToggleLabel() {
  const label = document.getElementById("giveaways-toggle-status");
  const toggle = document.getElementById("giveaways-toggle");

  if (label) {
    if (giveawaysOpen) {
      label.textContent = giveawayKeyword
        ? `Open — keyword: ${giveawayKeyword}`
        : "Giveaways are open";
    } else {
      label.textContent = giveawayKeyword
        ? `Closed — keyword ready: ${giveawayKeyword}`
        : "Set a keyword, then open the giveaway";
    }
  }

  if (toggle && currentUser?.isAdmin) {
    toggle.checked = giveawaysOpen;
  }
}

function renderEntries() {
  const list = document.getElementById("giveaways-list");
  const count = document.getElementById("giveaways-count");
  const empty = document.getElementById("giveaways-empty");
  const openPanel = document.getElementById("giveaways-open");
  const keywordDisplay = document.getElementById("giveaways-keyword-display");

  if (count) {
    const total = giveawayEntries.length;
    count.textContent = `${total} ${total === 1 ? "entry" : "entries"}`;
  }

  if (keywordDisplay) {
    keywordDisplay.textContent = giveawayKeyword || "keyword";
  }

  empty?.classList.toggle("is-hidden", giveawaysOpen);
  openPanel?.classList.toggle("is-hidden", !giveawaysOpen);

  if (!list) return;

  list.innerHTML = "";

  if (!giveawaysOpen || giveawayEntries.length === 0) {
    list.classList.add("is-hidden");
    return;
  }

  list.classList.remove("is-hidden");

  giveawayEntries.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "giveaways-entry";

    const rank = document.createElement("span");
    rank.className = "giveaways-entry-rank";
    rank.textContent = String(index + 1);

    const user = document.createElement("span");
    user.className = "giveaways-entry-user";
    user.textContent = entry.username || "viewer";

    item.append(rank, user);
    list.appendChild(item);
  });
}

function updatePanels() {
  const adminPanel = document.getElementById("giveaways-admin-panel");
  const keywordInput = document.getElementById("giveaways-keyword");

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);

  if (keywordInput && currentUser?.isAdmin && document.activeElement !== keywordInput) {
    keywordInput.value = giveawayKeyword;
  }

  updateToggleLabel();
  renderEntries();
}

function applyStatusData(data) {
  giveawaysOpen = Boolean(data.open);
  giveawayKeyword = String(data.keyword || "");
  giveawayEntries = Array.isArray(data.entries) ? data.entries : [];
}

function schedulePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  const interval = giveawaysOpen ? 2000 : 5000;
  pollTimer = setInterval(loadGiveawayStatus, interval);
}

async function loadGiveawayStatus() {
  try {
    const response = await fetch("/api/giveaways/status", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    applyStatusData(data);
    updatePanels();
    schedulePolling();
  } catch {
    // Keep the last known state.
  }
}

async function setGiveawaysOpen(open) {
  const response = await fetch("/api/giveaways/toggle", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ open }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not update giveaway status.");
  }

  applyStatusData(data);

  if (data.kickChatError) {
    setAdminStatus(
      `Giveaway updated, but Kick chat may not be subscribed: ${data.kickChatError}`,
      "error"
    );
  } else if (open && data.kickChatSubscribed === false) {
    setAdminStatus(
      "Giveaway is open, but Kick chat is not subscribed yet. Check Kick setup.",
      "error"
    );
  } else if (open) {
    setAdminStatus(
      `Giveaway open. Viewers type "${giveawayKeyword}" in Kick chat to enter.`,
      "success"
    );
  } else {
    setAdminStatus("Giveaway closed.", "success");
  }

  updatePanels();
  schedulePolling();
}

async function saveKeyword(keyword) {
  const response = await fetch("/api/giveaways/keyword", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not save keyword.");
  }

  giveawaysOpen = Boolean(data.open);
  giveawayKeyword = String(data.keyword || "");
  updatePanels();
  setAdminStatus(
    giveawayKeyword
      ? `Keyword saved: ${giveawayKeyword}`
      : "Keyword cleared.",
    "success"
  );
}

async function clearEntries() {
  const response = await fetch("/api/giveaways/entries/clear", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not clear entries.");
  }

  giveawayEntries = [];
  updatePanels();
  setAdminStatus("Entries cleared.", "success");
}

function initAdminToggle() {
  const toggle = document.getElementById("giveaways-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    const nextOpen = toggle.checked;

    if (nextOpen && !giveawayKeyword.trim()) {
      toggle.checked = false;
      setAdminStatus("Set a keyword before opening the giveaway.", "error");
      return;
    }

    toggle.disabled = true;

    try {
      await setGiveawaysOpen(nextOpen);
    } catch (error) {
      toggle.checked = !nextOpen;
      setAdminStatus(error.message, "error");
    } finally {
      toggle.disabled = false;
    }
  });
}

function initKeywordForm() {
  const form = document.getElementById("giveaways-keyword-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = document.getElementById("giveaways-keyword");
    const saveBtn = document.getElementById("giveaways-keyword-save");
    const keyword = input?.value?.trim() || "";

    if (saveBtn) saveBtn.disabled = true;

    try {
      await saveKeyword(keyword);
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function initClearEntries() {
  const button = document.getElementById("giveaways-clear-entries");
  if (!button) return;

  button.addEventListener("click", async () => {
    if (!window.confirm("Clear all giveaway entries?")) {
      return;
    }

    button.disabled = true;

    try {
      await clearEntries();
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  updatePanels();
  await loadGiveawayStatus();
  schedulePolling();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadGiveawayStatus();
  }
});

initAdminToggle();
initKeywordForm();
initClearEntries();
loadGiveawayStatus();
schedulePolling();
