let pollTimer = null;
let lastSignature = "";
let hasLoadedOnce = false;
let isInitialRender = true;
let latestData = null;
let currentUser = null;
let filterQuery = "";

const PRIZE_BY_RANK = {
  1: 2000,
  2: 1000,
  3: 600,
  4: 500,
  5: 300,
  6: 200,
  7: 100,
  8: 100,
  9: 100,
  10: 100,
};

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function formatPlace(rank) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

function getPrizeForRank(rank) {
  return PRIZE_BY_RANK[rank] ?? null;
}

function formatPrize(rank) {
  const amount = getPrizeForRank(rank);
  if (!amount) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function maskUsername(username) {
  const name = String(username || "").trim();
  if (!name) {
    return "—";
  }

  if (name.length <= 6) {
    if (name.length <= 2) {
      return "*".repeat(name.length);
    }

    const head = name.slice(0, 1);
    const tail = name.slice(-1);
    return `${head}${"*".repeat(name.length - 2)}${tail}`;
  }

  const head = name.slice(0, 3);
  const tail = name.slice(-3);
  return `${head}${"*".repeat(name.length - 6)}${tail}`;
}

function parseSheetDate(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})/);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(2000 + Number(match[3]), month, Number(match[1]));
}

function formatPeriod(start, end) {
  const from = parseSheetDate(start);
  const to = parseSheetDate(end);
  if (!from || !to) {
    return start && end ? `${start} – ${end}` : "—";
  }
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `${day.format(from)} – ${day.format(to)}`;
}

function formatUpdated(iso) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "Live";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  return "Earlier";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isCurrentUser(username) {
  const name = String(username || "").trim().toLowerCase();
  if (!name || !currentUser) return false;
  const stake = String(currentUser.stakeUsername || "").trim().toLowerCase();
  const kick = String(currentUser.username || "").trim().toLowerCase();
  return Boolean(name && (name === stake || name === kick));
}

function shareOfLeader(entry, leader) {
  if (!leader || leader.wagered <= 0) return 0;
  return (Number(entry.wagered) / leader.wagered) * 100;
}

function gapLabel(entry, leader) {
  if (!leader) return "";
  if (entry.rank === leader.rank) return "Leading the board";
  const share = shareOfLeader(entry, leader);
  const shareText = share < 1 ? "<1% of 1st" : `${Math.round(share)}% of 1st`;
  const gap = Math.max(0, leader.wagered - Number(entry.wagered));
  return `${shareText} · ${formatCurrency(gap)} behind`;
}

function setLeaderboardStatus(message, tone = "") {
  const status = document.getElementById("leaderboard-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
}

function paintAmount(el, value) {
  const amount = Number(value) || 0;
  if (!isInitialRender || prefersReducedMotion()) {
    el.textContent = formatCurrency(amount);
    return;
  }

  const start = performance.now();
  const duration = 720;
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    el.textContent = formatCurrency(amount * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function fillBar(bar, share) {
  const fill = bar.querySelector("span");
  if (!fill) return;
  const width = share > 0 ? Math.max(share, 3) : 0;
  if (!isInitialRender || prefersReducedMotion()) {
    fill.style.width = `${width}%`;
    return;
  }
  fill.style.width = "0%";
  requestAnimationFrame(() => {
    fill.style.width = `${width}%`;
  });
}

function focusStanding(rank) {
  const item = document.getElementById(`lb-rank-${rank}`);
  const row = item?.querySelector(".lb-row");
  if (!item || !row) return;
  item.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  document.querySelectorAll(".lb-row[aria-expanded='true']").forEach((open) => {
    open.setAttribute("aria-expanded", "false");
  });
  row.setAttribute("aria-expanded", "true");
  row.focus();
}

function createPodiumCard(place, entry, leader) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `lb-podium-card place-${place}`;
  if (!entry) card.classList.add("is-vacant");
  if (entry && isCurrentUser(entry.username)) card.classList.add("is-you");
  card.disabled = !entry;
  card.setAttribute("aria-label", entry ? `Show ${formatPlace(place)} on the board` : formatPlace(place));

  const placeEl = document.createElement("span");
  placeEl.className = "lb-place";
  placeEl.textContent = String(place);

  const name = document.createElement("span");
  name.className = "lb-podium-name";
  name.textContent = entry ? maskUsername(entry.username) : "—";

  const wager = document.createElement("span");
  wager.className = "lb-podium-wager";
  if (entry) paintAmount(wager, entry.wagered);
  else wager.textContent = "";

  const prize = document.createElement("span");
  prize.className = "lb-podium-prize";
  prize.textContent = formatPrize(entry?.rank ?? place);

  const bar = document.createElement("span");
  bar.className = "lb-bar";
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  bar.append(fill);

  card.append(placeEl, name, wager, prize, bar);
  if (entry) {
    fillBar(bar, shareOfLeader(entry, leader));
    card.addEventListener("click", () => focusStanding(entry.rank));
  }
  return card;
}

function renderPodium(entries, leader) {
  const panel = document.getElementById("leaderboard-podium-panel");
  const stage = document.getElementById("leaderboard-podium-stage");
  if (!panel || !stage) return;

  const topThree = entries.slice(0, 3);
  panel.classList.toggle("is-hidden", topThree.length === 0);
  stage.replaceChildren();
  if (!topThree.length) return;

  const byRank = new Map(topThree.map((entry) => [entry.rank, entry]));
  [2, 1, 3].forEach((place) => {
    stage.append(createPodiumCard(place, byRank.get(place) || null, leader));
  });
}

function createStanding(entry, leader, index) {
  const item = document.createElement("li");
  item.className = `lb-item place-${Math.min(entry.rank, 4)}`;
  item.id = `lb-rank-${entry.rank}`;
  item.dataset.name = maskUsername(entry.username).toLowerCase();
  if (isInitialRender) {
    item.classList.add("is-entering");
    item.style.setProperty("--enter-delay", `${Math.min(index, 9) * 40}ms`);
  }
  if (isCurrentUser(entry.username)) item.classList.add("is-you");

  const row = document.createElement("button");
  row.type = "button";
  row.className = "lb-row";
  row.setAttribute("aria-expanded", "false");

  const rank = document.createElement("span");
  rank.className = "lb-rank";
  rank.textContent = String(entry.rank).padStart(2, "0");

  const player = document.createElement("span");
  player.className = "lb-player";

  const name = document.createElement("span");
  name.className = "lb-name";
  name.textContent = maskUsername(entry.username);
  if (isCurrentUser(entry.username)) {
    const you = document.createElement("span");
    you.className = "lb-you";
    you.textContent = "You";
    name.append(you);
  }

  const bar = document.createElement("span");
  bar.className = "lb-bar";
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  bar.append(fill);

  const gap = document.createElement("span");
  gap.className = "lb-gap";
  gap.textContent = gapLabel(entry, leader);

  player.append(name, bar, gap);

  const wager = document.createElement("span");
  wager.className = "lb-wager";
  paintAmount(wager, entry.wagered);

  const prize = document.createElement("span");
  prize.className = "lb-prize";
  prize.textContent = formatPrize(entry.rank);

  row.append(rank, player, wager, prize);
  row.addEventListener("click", () => {
    const open = row.getAttribute("aria-expanded") === "true";
    document.querySelectorAll(".lb-row[aria-expanded='true']").forEach((other) => {
      if (other !== row) other.setAttribute("aria-expanded", "false");
    });
    row.setAttribute("aria-expanded", open ? "false" : "true");
  });

  item.append(row);
  fillBar(bar, shareOfLeader(entry, leader));
  return item;
}

function renderLeaderboardList(entries, leader) {
  const list = document.getElementById("leaderboard-list");
  const tableHead = document.getElementById("leaderboard-table-head");
  if (!list) return;

  list.replaceChildren();
  const hasEntries = entries.length > 0;
  tableHead?.classList.toggle("is-hidden", !hasEntries);
  list.classList.toggle("is-hidden", !hasEntries);
  entries.forEach((entry, index) => {
    list.append(createStanding(entry, leader, index));
  });
  applyFilter();
}

function applyFilter() {
  const query = filterQuery.trim().toLowerCase();
  const items = [...document.querySelectorAll(".lb-item")];
  let shown = 0;
  items.forEach((item) => {
    const match = !query || String(item.dataset.name || "").includes(query);
    item.classList.toggle("is-filtered-out", !match);
    if (match) shown += 1;
  });
  const empty = document.getElementById("leaderboard-filter-empty");
  empty?.classList.toggle("is-hidden", !query || shown > 0 || items.length === 0);
}

function leaderboardSignature(data) {
  return JSON.stringify({
    entries: data.entries,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
  });
}

function renderLeaderboard(data) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const empty = document.getElementById("leaderboard-empty");
  const period = document.getElementById("leaderboard-period");
  const updated = document.getElementById("leaderboard-updated");
  const board = document.querySelector(".lb-board");
  if (!empty) return;

  empty.classList.toggle("is-hidden", entries.length > 0);
  board?.classList.toggle("is-empty", entries.length === 0);
  if (period) period.textContent = formatPeriod(data.periodStart, data.periodEnd);
  if (updated) updated.textContent = formatUpdated(data.updatedAt);

  const leader = entries[0] || null;
  renderPodium(entries, leader);
  renderLeaderboardList(entries, leader);
  isInitialRender = false;
}

async function loadLeaderboard({ quiet = false } = {}) {
  if (!quiet) {
    setLeaderboardStatus("Loading leaderboard...");
  }

  try {
    const response = await fetch("/api/leaderboard", {
      credentials: "same-origin",
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not load leaderboard.");
    }

    latestData = data;
    const signature = leaderboardSignature(data);
    if (signature !== lastSignature) {
      lastSignature = signature;
      renderLeaderboard(data);
    } else {
      const updated = document.getElementById("leaderboard-updated");
      if (updated) updated.textContent = formatUpdated(data.updatedAt);
    }

    hasLoadedOnce = true;
    setLeaderboardStatus("");
  } catch (error) {
    if (!hasLoadedOnce) {
      renderLeaderboard({ entries: [], periodStart: null, periodEnd: null });
    }
    if (!quiet || !hasLoadedOnce) {
      setLeaderboardStatus(error.message || "Could not load leaderboard.", "error");
    }
  }
}

function scheduleLeaderboardPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(() => {
    if (document.hidden) return;
    void loadLeaderboard({ quiet: true });
  }, 15000);
}

document.getElementById("leaderboard-rules-toggle")?.addEventListener("click", () => {
  const panel = document.getElementById("leaderboard-rules");
  const button = document.getElementById("leaderboard-rules-toggle");
  if (!panel || !button) return;
  const open = panel.classList.toggle("is-hidden") === false;
  button.setAttribute("aria-expanded", open ? "true" : "false");
});

document.getElementById("leaderboard-filter")?.addEventListener("input", (event) => {
  filterQuery = event.target.value || "";
  applyFilter();
});

window.addEventListener("auth:change", (event) => {
  currentUser = event.detail?.user || null;
  if (latestData) renderLeaderboard(latestData);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void loadLeaderboard({ quiet: true });
  }
});

loadLeaderboard();
scheduleLeaderboardPolling();
