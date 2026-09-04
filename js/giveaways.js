let currentUser = null;
let giveawaysOpen = false;
let giveawayKeyword = "";
let giveawayAffiliatesOnly = false;
let giveawayEntries = [];
let giveawayWinner = null;
let pollTimer = null;
let isRolling = false;
let lastAnimatedWinnerId = null;

const CASE_ITEM_GAP = 10;
const CASE_ROLL_DURATION_MS = 6500;

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

function updateAffiliatesOnlyLabel() {
  const label = document.getElementById("giveaways-aff-toggle-status");
  const toggle = document.getElementById("giveaways-aff-toggle");

  if (label) {
    label.textContent = giveawayAffiliatesOnly
      ? "Only AFF users (verified on code BLAKJAC21) can enter"
      : "Open to everyone who types the keyword";
  }

  if (toggle && currentUser?.isAdmin) {
    toggle.checked = giveawayAffiliatesOnly;
  }
}

function updateHeroStatus() {
  const status = document.getElementById("giveaways-hero-status");
  const value = document.getElementById("giveaways-status-value");
  if (!status || !value) return;

  if (giveawayWinner) {
    status.dataset.state = "winner";
    value.textContent = `Winner · ${giveawayWinner.username}`;
  } else if (giveawaysOpen) {
    status.dataset.state = "open";
    value.textContent = giveawayAffiliatesOnly ? "Open · AFF only" : "Open";
  } else {
    status.dataset.state = "closed";
    value.textContent = giveawayAffiliatesOnly ? "Closed · AFF only" : "Closed";
  }
}

function buildEntryItem(entry, index) {
  const item = document.createElement("li");
  item.className = "giveaways-entry";

  const rank = document.createElement("span");
  rank.className = "giveaways-entry-rank";
  rank.textContent = String(index + 1).padStart(2, "0");

  const user = document.createElement("span");
  user.className = "giveaways-entry-user";
  user.textContent = entry.username || "viewer";

  item.append(rank, user);
  return item;
}

function updateRollingAnimation() {
  const viewport = document.getElementById("giveaways-rolling-viewport");
  const track = document.getElementById("giveaways-list");
  if (!viewport || !track) return;

  const uniqueCount = giveawayEntries.length;
  const shouldRoll = uniqueCount > 3;

  track.classList.toggle("is-rolling", shouldRoll);
  viewport.classList.toggle("is-rolling", shouldRoll);

  if (!shouldRoll) {
    track.style.removeProperty("--roll-duration");
    track.style.transform = "";
    return;
  }

  const halfHeight = track.scrollHeight / 2;
  const duration = Math.max(12, uniqueCount * 1.8);
  track.style.setProperty("--roll-distance", `${halfHeight}px`);
  track.style.setProperty("--roll-duration", `${duration}s`);
}

function renderEntries() {
  const list = document.getElementById("giveaways-list");
  const viewport = document.getElementById("giveaways-rolling-viewport");
  const entrantsEmpty = document.getElementById("giveaways-entrants-empty");
  const count = document.getElementById("giveaways-count");
  const empty = document.getElementById("giveaways-empty");
  const openPanel = document.getElementById("giveaways-open");
  const keywordDisplay = document.getElementById("giveaways-keyword-display");

  if (count) {
    count.textContent = String(giveawayEntries.length);
  }

  if (keywordDisplay) {
    keywordDisplay.textContent = giveawayKeyword || "keyword";
  }

  empty?.classList.toggle("is-hidden", giveawaysOpen || giveawayEntries.length > 0);
  openPanel?.classList.toggle("is-hidden", !giveawaysOpen);

  const affNote = document.getElementById("giveaways-aff-note");
  const openCopy = document.getElementById("giveaways-open-copy");
  affNote?.classList.toggle("is-hidden", !giveawaysOpen || !giveawayAffiliatesOnly);
  if (openCopy) {
    openCopy.textContent = giveawayAffiliatesOnly
      ? "One entry per AFF viewer. Exact match only."
      : "One entry per viewer. Exact match only.";
  }

  const hasEntries = giveawayEntries.length > 0;
  entrantsEmpty?.classList.toggle("is-hidden", hasEntries);
  viewport?.classList.toggle("is-hidden", !hasEntries);

  if (!list) return;

  list.innerHTML = "";

  if (!hasEntries) {
    return;
  }

  giveawayEntries.forEach((entry, index) => {
    list.appendChild(buildEntryItem(entry, index));
  });

  if (giveawayEntries.length > 3) {
    giveawayEntries.forEach((entry, index) => {
      list.appendChild(buildEntryItem(entry, index));
    });
  }

  requestAnimationFrame(updateRollingAnimation);
}

function createCaseItem(entry, isWinner = false) {
  const item = document.createElement("div");
  item.className = `case-reel-item${isWinner ? " is-winner" : ""}`;
  item.dataset.entryId = entry.id || "";

  const label = document.createElement("span");
  label.className = "case-reel-item-label";
  label.textContent = "Entrant";

  const name = document.createElement("span");
  name.className = "case-reel-item-name";
  name.textContent = entry.username || "viewer";

  item.append(label, name);
  return item;
}

function shuffleCopy(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function buildReelSequence(entries, winner) {
  const pool = entries.length ? entries : [winner];
  const sequence = [];
  const loops = Math.max(18, Math.ceil(40 / Math.max(pool.length, 1)));

  for (let i = 0; i < loops; i += 1) {
    sequence.push(...shuffleCopy(pool));
  }

  const winnerIndex = Math.max(28, sequence.length - Math.floor(pool.length / 2) - 4);
  sequence[winnerIndex] = winner;

  return { sequence, winnerIndex };
}

function setReelIdle(entries) {
  const track = document.getElementById("case-reel-track");
  if (!track) return;

  track.style.transition = "none";
  track.style.transform = "translateX(0px)";

  const preview = (entries.length ? entries : []).slice(0, 12);
  track.innerHTML = "";
  preview.forEach((entry) => {
    track.appendChild(createCaseItem(entry));
  });
}

function showWinnerResult(winner, animated = false) {
  const result = document.getElementById("case-reel-result");
  if (!result || !winner) return;

  result.classList.remove("is-hidden");
  result.classList.toggle("is-pop", animated);
  result.innerHTML = `Winner: <strong>${winner.username}</strong>`;
}

function clearWinnerResult() {
  const result = document.getElementById("case-reel-result");
  if (!result) return;
  result.classList.add("is-hidden");
  result.classList.remove("is-pop");
  result.textContent = "";
}

function updateRevealPanel() {
  const empty = document.getElementById("giveaways-reveal-empty");
  const reel = document.getElementById("case-reel");
  const actions = document.getElementById("giveaways-reveal-actions");
  const revealBtn = document.getElementById("giveaways-reveal-btn");
  const count = document.getElementById("giveaways-reveal-count");
  const hasEntries = giveawayEntries.length > 0;

  if (count) {
    if (giveawayWinner) {
      count.textContent = "Winner locked";
    } else if (hasEntries) {
      count.textContent = `${giveawayEntries.length} eligible`;
    } else {
      count.textContent = "Need entrants";
    }
  }

  empty?.classList.toggle("is-hidden", hasEntries || Boolean(giveawayWinner));
  reel?.classList.toggle("is-hidden", !hasEntries && !giveawayWinner);
  actions?.classList.toggle(
    "is-hidden",
    !currentUser?.isAdmin || !hasEntries
  );

  if (revealBtn) {
    revealBtn.disabled = isRolling || !hasEntries;
    revealBtn.textContent = giveawayWinner ? "Reveal Again" : "Reveal Winner";
  }

  if (!isRolling) {
    if (giveawayWinner && lastAnimatedWinnerId === giveawayWinner.id) {
      showWinnerResult(giveawayWinner, false);
    } else if (!giveawayWinner) {
      clearWinnerResult();
      if (hasEntries) {
        setReelIdle(giveawayEntries);
      }
    }
  }
}

function playCaseReveal(winner, entries) {
  const track = document.getElementById("case-reel-track");
  const reel = document.getElementById("case-reel");
  const windowEl = reel?.querySelector(".case-reel-window");

  if (!track || !windowEl || !winner) {
    return Promise.resolve();
  }

  const { sequence, winnerIndex } = buildReelSequence(entries, winner);

  track.innerHTML = "";
  sequence.forEach((entry, index) => {
    track.appendChild(createCaseItem(entry, index === winnerIndex));
  });

  const firstItem = track.querySelector(".case-reel-item");
  const itemWidth = firstItem?.getBoundingClientRect().width || 148;
  const stride = itemWidth + CASE_ITEM_GAP;
  const windowWidth = windowEl.clientWidth || 320;
  const centerOffset = windowWidth / 2 - itemWidth / 2;
  const jitter = (Math.random() - 0.5) * (itemWidth * 0.35);
  const targetX = -(winnerIndex * stride) + centerOffset + jitter;

  isRolling = true;
  updateRevealPanel();
  clearWinnerResult();

  track.style.transition = "none";
  track.style.transform = "translateX(0px)";
  // Force layout so the transition starts from 0.
  void track.offsetWidth;

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      track.style.transition = `transform ${CASE_ROLL_DURATION_MS}ms cubic-bezier(0.12, 0.75, 0.12, 1)`;
      track.style.transform = `translateX(${targetX}px)`;

      window.setTimeout(() => {
        isRolling = false;
        lastAnimatedWinnerId = winner.id;
        showWinnerResult(winner, true);
        updateRevealPanel();
        resolve();
      }, CASE_ROLL_DURATION_MS + 80);
    });
  });
}

async function maybeAnimateWinner(winner, entries, { force = false } = {}) {
  if (!winner) return;
  if (isRolling) return;
  if (!force && lastAnimatedWinnerId === winner.id) {
    showWinnerResult(winner, false);
    return;
  }

  await playCaseReveal(winner, entries.length ? entries : [winner]);
}

function updatePanels() {
  const adminPanel = document.getElementById("giveaways-admin-panel");
  const keywordInput = document.getElementById("giveaways-keyword");

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);

  if (keywordInput && currentUser?.isAdmin && document.activeElement !== keywordInput) {
    keywordInput.value = giveawayKeyword;
  }

  updateToggleLabel();
  updateAffiliatesOnlyLabel();
  updateHeroStatus();
  renderEntries();
  updateRevealPanel();
}

function applyStatusData(data) {
  const previousWinnerId = giveawayWinner?.id || null;

  giveawaysOpen = Boolean(data.open);
  giveawayKeyword = String(data.keyword || "");
  giveawayAffiliatesOnly = Boolean(data.affiliatesOnly);
  giveawayEntries = Array.isArray(data.entries) ? data.entries : [];
  giveawayWinner = data.winner || null;

  if (!giveawayWinner) {
    lastAnimatedWinnerId = null;
  }

  return {
    winnerChanged:
      Boolean(giveawayWinner) && giveawayWinner.id !== previousWinnerId,
  };
}

function schedulePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  const interval = 5000;
  pollTimer = setInterval(loadGiveawayStatus, interval);
}

async function loadGiveawayStatus() {
  if (isRolling) return;

  try {
    const response = await fetch("/api/giveaways/status", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    const { winnerChanged } = applyStatusData(data);
    updatePanels();

    if (winnerChanged) {
      await maybeAnimateWinner(giveawayWinner, giveawayEntries);
    } else if (giveawayWinner && lastAnimatedWinnerId !== giveawayWinner.id) {
      // Page load with an already-revealed winner: show result, skip long roll.
      lastAnimatedWinnerId = giveawayWinner.id;
      showWinnerResult(giveawayWinner, false);
      setReelIdle([giveawayWinner, ...giveawayEntries].slice(0, 12));
    }

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

async function setAffiliatesOnly(affiliatesOnly) {
  const response = await fetch("/api/giveaways/affiliates-only", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ affiliatesOnly }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not update AFF-only setting.");
  }

  applyStatusData(data);
  setAdminStatus(
    affiliatesOnly
      ? "AFF-only mode on. Only verified BLAKJAC21 affiliates can enter."
      : "AFF-only mode off. Anyone can enter with the keyword.",
    "success"
  );
  updatePanels();
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
  if ("affiliatesOnly" in data) {
    giveawayAffiliatesOnly = Boolean(data.affiliatesOnly);
  }
  if ("winner" in data) {
    giveawayWinner = data.winner || null;
  }
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
  giveawayWinner = null;
  lastAnimatedWinnerId = null;
  clearWinnerResult();
  updatePanels();
  setAdminStatus("Entries cleared.", "success");
}

async function revealWinner() {
  const response = await fetch("/api/giveaways/reveal", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not reveal a winner.");
  }

  applyStatusData(data);
  updatePanels();
  await maybeAnimateWinner(giveawayWinner, giveawayEntries, { force: true });
  setAdminStatus(
    giveawayWinner
      ? `Winner revealed: ${giveawayWinner.username}`
      : "Winner revealed.",
    "success"
  );
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

function initAffiliatesOnlyToggle() {
  const toggle = document.getElementById("giveaways-aff-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    const nextValue = toggle.checked;
    toggle.disabled = true;

    try {
      await setAffiliatesOnly(nextValue);
    } catch (error) {
      toggle.checked = !nextValue;
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

function initRevealWinner() {
  const button = document.getElementById("giveaways-reveal-btn");
  if (!button) return;

  button.addEventListener("click", async () => {
    if (isRolling) return;

    button.disabled = true;

    try {
      await revealWinner();
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      if (!isRolling) {
        button.disabled = false;
      }
      updateRevealPanel();
    }
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  updatePanels();
  await loadGiveawayStatus();
  schedulePolling();
});

window.addEventListener("resize", () => {
  updateRollingAnimation();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadGiveawayStatus();
  }
});

initAdminToggle();
initAffiliatesOnlyToggle();
initKeywordForm();
initClearEntries();
initRevealWinner();
loadGiveawayStatus();
schedulePolling();
