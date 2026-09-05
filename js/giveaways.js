let currentUser = null;
let giveawaysOpen = false;
let giveawayKeyword = "";
let giveawayAffiliatesOnly = false;
let giveawaySubscribersOnly = false;
let giveawayEntries = [];
let giveawayWinner = null;
let viewerIsWinner = false;
let pollTimer = null;
let isRolling = false;
let lastAnimatedWinnerId = null;

const CASE_ITEM_GAP = 10;
const CASE_ROLL_DURATION_MS = 8200;
const CASE_SETTLE_DURATION_MS = 520;
const KICK_CHAT_POPOUT_URL = "https://kick.com/popout/blakjac21/chat";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutQuint(t) {
  return 1 - (1 - t) ** 5;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function animateTransform(el, fromX, toX, duration, ease) {
  return new Promise((resolve) => {
    if (duration <= 0 || prefersReducedMotion()) {
      el.style.transform = `translateX(${toX}px)`;
      resolve();
      return;
    }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const x = fromX + (toX - fromX) * ease(t);
      el.style.transform = `translateX(${x}px)`;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };

    requestAnimationFrame(tick);
  });
}

function clearReelBurst() {
  const burst = document.getElementById("case-reel-burst");
  if (!burst) return;
  burst.replaceChildren();
  burst.classList.remove("is-active");
}

function spawnReelBurst() {
  const burst = document.getElementById("case-reel-burst");
  if (!burst || prefersReducedMotion()) return;

  burst.replaceChildren();
  burst.classList.add("is-active");

  const colors = ["#f0c98e", "#7ed8ff", "#58c9f3", "#ffe7b5", "#ffffff"];
  for (let i = 0; i < 28; i += 1) {
    const speck = document.createElement("span");
    speck.className = "case-reel-speck";
    const angle = (Math.PI * 2 * i) / 28 + (Math.random() - 0.5) * 0.35;
    const distance = 56 + Math.random() * 110;
    speck.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    speck.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    speck.style.setProperty("--speck-color", colors[i % colors.length]);
    speck.style.setProperty("--speck-delay", `${Math.random() * 80}ms`);
    speck.style.setProperty("--speck-size", `${4 + Math.random() * 5}px`);
    burst.append(speck);
  }

  window.setTimeout(() => {
    clearReelBurst();
  }, 1400);
}

function celebrateWinnerLand(reel, track) {
  reel?.classList.remove("is-spinning");
  reel?.classList.add("is-landed");
  track
    ?.querySelector(".case-reel-item.is-winner")
    ?.classList.add("is-celebrate");
  spawnReelBurst();

  window.setTimeout(() => {
    reel?.classList.remove("is-landed");
  }, 1600);
}

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

function accessModeLabel() {
  if (giveawayAffiliatesOnly && giveawaySubscribersOnly) {
    return "AFF/SUB";
  }
  if (giveawayAffiliatesOnly) {
    return "AFF";
  }
  if (giveawaySubscribersOnly) {
    return "SUB";
  }
  return "";
}

function accessModeNoteText() {
  if (giveawayAffiliatesOnly && giveawaySubscribersOnly) {
    return "AFF/SUB only — verified BLAKJAC21 affiliates and active Kick subscribers can enter.";
  }
  if (giveawayAffiliatesOnly) {
    return "AFF only — entrants must be verified on code BLAKJAC21.";
  }
  if (giveawaySubscribersOnly) {
    return "SUB only — entrants must be active Kick subscribers.";
  }
  return "";
}

function updateAffiliatesOnlyLabel() {
  const label = document.getElementById("giveaways-aff-toggle-status");
  const toggle = document.getElementById("giveaways-aff-toggle");

  if (label) {
    label.textContent = giveawayAffiliatesOnly
      ? "Only AFF users (verified on code BLAKJAC21) can enter"
      : "Affiliate restriction off";
  }

  if (toggle && currentUser?.isAdmin) {
    toggle.checked = giveawayAffiliatesOnly;
  }
}

function updateSubscribersOnlyLabel() {
  const label = document.getElementById("giveaways-sub-toggle-status");
  const toggle = document.getElementById("giveaways-sub-toggle");

  if (label) {
    label.textContent = giveawaySubscribersOnly
      ? "Only Kick subscribers can enter"
      : "Subscriber restriction off";
  }

  if (toggle && currentUser?.isAdmin) {
    toggle.checked = giveawaySubscribersOnly;
  }
}

function updateHeroStatus() {
  const status = document.getElementById("giveaways-hero-status");
  const value = document.getElementById("giveaways-status-value");
  if (!status || !value) return;

  const mode = accessModeLabel();

  if (giveawayWinner) {
    status.dataset.state = "winner";
    value.textContent = `Winner · ${giveawayWinner.username}`;
  } else if (giveawaysOpen) {
    status.dataset.state = "open";
    value.textContent = mode ? `Open · ${mode} only` : "Open";
  } else {
    status.dataset.state = "closed";
    value.textContent = mode ? `Closed · ${mode} only` : "Closed";
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
  const duration = Math.max(10, uniqueCount * 1.25);
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

  const accessNote = document.getElementById("giveaways-access-note");
  const openCopy = document.getElementById("giveaways-open-copy");
  const modeNote = accessModeNoteText();
  if (accessNote) {
    accessNote.textContent = modeNote;
    accessNote.classList.toggle("is-hidden", !giveawaysOpen || !modeNote);
  }
  if (openCopy) {
    openCopy.textContent = modeNote
      ? `One entry per ${accessModeLabel()} viewer. Exact match only.`
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
  const reel = document.getElementById("case-reel");
  if (!track) return;

  clearReelBurst();
  reel?.classList.remove("is-spinning", "is-landed");
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
  updateWinnerChat(winner, { celebrate: animated });
}

function clearWinnerResult() {
  const result = document.getElementById("case-reel-result");
  if (!result) return;
  result.classList.add("is-hidden");
  result.classList.remove("is-pop");
  result.textContent = "";
  updateWinnerChat(null);
}

function updateWinnerChat(winner, { celebrate = false } = {}) {
  const panel = document.getElementById("giveaways-winner-chat");
  const iframe = document.getElementById("giveaways-kick-chat");
  const nameEl = document.getElementById("giveaways-chat-winner-name");
  const openLink = document.getElementById("giveaways-kick-chat-open");
  if (!panel) return;

  const show = Boolean(winner) && viewerIsWinner;
  const wasHidden = panel.classList.contains("is-hidden");
  panel.classList.toggle("is-hidden", !show);

  if (!show) {
    panel.classList.remove("is-pop");
    if (iframe) {
      iframe.removeAttribute("src");
      delete iframe.dataset.loaded;
    }
    return;
  }

  if (nameEl) {
    nameEl.textContent = winner.username || "you";
  }

  if (openLink) {
    openLink.href = KICK_CHAT_POPOUT_URL;
  }

  if (iframe && iframe.dataset.loaded !== "1") {
    iframe.src = KICK_CHAT_POPOUT_URL;
    iframe.dataset.loaded = "1";
  }

  if (celebrate || wasHidden) {
    panel.classList.remove("is-pop");
    void panel.offsetWidth;
    panel.classList.add("is-pop");
  }

  if (celebrate) {
    window.requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
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
  const settleX = -(winnerIndex * stride) + centerOffset;
  const jitter = (Math.random() - 0.5) * (itemWidth * 0.28);
  const spinX = settleX + jitter;

  isRolling = true;
  clearReelBurst();
  reel.classList.remove("is-landed");
  reel.classList.add("is-spinning");
  updateRevealPanel();
  clearWinnerResult();

  track.style.transition = "none";
  track.style.transform = "translateX(0px)";
  void track.offsetWidth;

  return (async () => {
    await animateTransform(track, 0, spinX, CASE_ROLL_DURATION_MS, easeOutQuint);
    await animateTransform(
      track,
      spinX,
      settleX,
      CASE_SETTLE_DURATION_MS,
      easeOutBack
    );

    celebrateWinnerLand(reel, track);
    isRolling = false;
    lastAnimatedWinnerId = winner.id;
    showWinnerResult(winner, true);
    updateRevealPanel();
  })();
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
  updateSubscribersOnlyLabel();
  updateHeroStatus();
  renderEntries();
  updateRevealPanel();
}

function applyStatusData(data) {
  const previousWinnerId = giveawayWinner?.id || null;

  giveawaysOpen = Boolean(data.open);
  giveawayKeyword = String(data.keyword || "");
  giveawayAffiliatesOnly = Boolean(data.affiliatesOnly);
  giveawaySubscribersOnly = Boolean(data.subscribersOnly);
  giveawayEntries = Array.isArray(data.entries) ? data.entries : [];
  giveawayWinner = data.winner || null;
  viewerIsWinner = Boolean(data.viewerIsWinner);

  if (!giveawayWinner) {
    lastAnimatedWinnerId = null;
    viewerIsWinner = false;
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
    giveawayAffiliatesOnly
      ? giveawaySubscribersOnly
        ? "AFF and SUB modes on. Affiliates or Kick subs can enter."
        : "AFF-only mode on. Only verified BLAKJAC21 affiliates can enter."
      : giveawaySubscribersOnly
        ? "AFF-only off. SUB-only still active."
        : "AFF-only mode off. Anyone can enter with the keyword.",
    "success"
  );
  updatePanels();
}

async function setSubscribersOnly(subscribersOnly) {
  const response = await fetch("/api/giveaways/subscribers-only", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscribersOnly }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not update SUB-only setting.");
  }

  applyStatusData(data);
  setAdminStatus(
    giveawaySubscribersOnly
      ? giveawayAffiliatesOnly
        ? "AFF and SUB modes on. Affiliates or Kick subs can enter."
        : "SUB-only mode on. Only Kick subscribers can enter."
      : giveawayAffiliatesOnly
        ? "SUB-only off. AFF-only still active."
        : "SUB-only mode off. Anyone can enter with the keyword.",
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
  if ("subscribersOnly" in data) {
    giveawaySubscribersOnly = Boolean(data.subscribersOnly);
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

  applyStatusData(data);
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

function initSubscribersOnlyToggle() {
  const toggle = document.getElementById("giveaways-sub-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    const nextValue = toggle.checked;
    toggle.disabled = true;

    try {
      await setSubscribersOnly(nextValue);
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
initSubscribersOnlyToggle();
initKeywordForm();
initClearEntries();
initRevealWinner();
loadGiveawayStatus();
schedulePolling();
