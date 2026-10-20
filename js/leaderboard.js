let pollTimer = null;
let lastSignature = "";
let hasLoadedOnce = false;
let isInitialRender = true;
let latestData = null;
let currentUser = null;
let filterQuery = "";
let activeTab = "stake";

let uncLeaders = [];
let uncYou = null;
let uncTotal = 0;
let uncRace = null;
let uncFilterQuery = "";
let uncFirstPaint = true;
let uncLoadedOnce = false;
let uncLastSignature = "";

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

const UNC_PRIZE_BY_RANK = {
  1: "$100",
  2: "$50",
  3: "$25",
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

function formatUncPrize(rank) {
  return UNC_PRIZE_BY_RANK[rank] || "—";
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

function fillBar(bar, share, animate) {
  const fill = bar.querySelector("span");
  if (!fill) return;
  const width = share > 0 ? Math.max(share, 3) : 0;
  if (!animate || prefersReducedMotion()) {
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
  document
    .querySelectorAll("#leaderboard-list .lb-row[aria-expanded='true']")
    .forEach((open) => {
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
    fillBar(bar, shareOfLeader(entry, leader), isInitialRender);
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
    document
      .querySelectorAll("#leaderboard-list .lb-row[aria-expanded='true']")
      .forEach((other) => {
        if (other !== row) other.setAttribute("aria-expanded", "false");
      });
    row.setAttribute("aria-expanded", open ? "false" : "true");
  });

  item.append(row);
  fillBar(bar, shareOfLeader(entry, leader), isInitialRender);
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
  const items = [...document.querySelectorAll("#leaderboard-list .lb-item")];
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
  const board = document.querySelector("#lb-panel-stake .lb-board");
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
  if (!quiet && activeTab === "stake") {
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
    if (activeTab === "stake") setLeaderboardStatus("");
  } catch (error) {
    if (!hasLoadedOnce) {
      renderLeaderboard({ entries: [], periodStart: null, periodEnd: null });
    }
    if (activeTab === "stake" && (!quiet || !hasLoadedOnce)) {
      setLeaderboardStatus(error.message || "Could not load leaderboard.", "error");
    }
  }
}

function uncEntries() {
  const entries = uncLeaders.slice();
  if (uncYou && !entries.some((entry) => entry.rank === uncYou.rank)) {
    entries.push(uncYou);
  }
  return entries;
}

function uncLeader() {
  return uncLeaders[0] || null;
}

function uncIsYou(entry) {
  return Boolean(uncYou && entry?.rank === uncYou.rank);
}

function uncShare(entry, leader) {
  const top = Number(leader?.points) || 0;
  if (top <= 0) return 0;
  return ((Number(entry?.points) || 0) / top) * 100;
}

function uncGap(entry, leader) {
  if (!leader) return "";
  if (entry.rank === leader.rank) return "Leading the board";
  const share = uncShare(entry, leader);
  const shareText = share < 1 ? "<1% of 1st" : `${Math.round(share)}% of 1st`;
  const gap = Math.max(0, Number(leader.points) - Number(entry.points));
  return `${shareText} · ${gap.toLocaleString()} behind`;
}

function paintUncPoints(el, value) {
  const amount = Number(value) || 0;
  if (!uncFirstPaint || prefersReducedMotion()) {
    el.textContent = amount.toLocaleString();
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / 720);
    const eased = 1 - (1 - progress) ** 3;
    el.textContent = Math.round(amount * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function focusUncStanding(rank) {
  const item = document.getElementById(`unc-rank-${rank}`);
  const row = item?.querySelector(".lb-row");
  if (!item || !row) return;
  item.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  document.querySelectorAll("#unc-list .lb-row[aria-expanded='true']").forEach((open) => {
    open.setAttribute("aria-expanded", "false");
  });
  row.setAttribute("aria-expanded", "true");
  row.focus();
}

function createUncPodiumCard(place, entry, leader) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `lb-podium-card place-${place}`;
  if (!entry) card.disabled = true;
  if (entry && uncIsYou(entry)) card.classList.add("is-you");
  card.setAttribute(
    "aria-label",
    entry ? `Show ${formatPlace(place)} on the board` : formatPlace(place)
  );

  const placeEl = document.createElement("span");
  placeEl.className = "lb-place";
  placeEl.textContent = String(place);

  const name = document.createElement("span");
  name.className = "lb-podium-name";
  name.textContent = entry?.username || "—";

  const points = document.createElement("span");
  points.className = "lb-podium-wager";
  if (entry) paintUncPoints(points, entry.points);

  const prize = document.createElement("span");
  prize.className = "lb-podium-prize";
  prize.textContent = formatUncPrize(place);

  const bar = document.createElement("span");
  bar.className = "lb-bar";
  bar.setAttribute("aria-hidden", "true");
  bar.append(document.createElement("span"));

  card.append(placeEl, name, points, prize, bar);
  if (entry) {
    fillBar(bar, uncShare(entry, leader), uncFirstPaint);
    card.addEventListener("click", () => focusUncStanding(entry.rank));
  }
  return card;
}

function renderUncPodium(entries, leader) {
  const panel = document.getElementById("unc-podium-panel");
  const stage = document.getElementById("unc-podium-stage");
  if (!panel || !stage) return;
  const top = entries.filter((entry) => entry.rank <= 3).slice(0, 3);
  panel.classList.toggle("is-hidden", top.length === 0);
  stage.replaceChildren();
  if (!top.length) return;
  const byRank = new Map(top.map((entry) => [entry.rank, entry]));
  [2, 1, 3].forEach((place) => {
    stage.append(createUncPodiumCard(place, byRank.get(place) || null, leader));
  });
}

function createUncStanding(entry, leader, index) {
  const item = document.createElement("li");
  item.className = `lb-item place-${Math.min(entry.rank, 4)}`;
  item.id = `unc-rank-${entry.rank}`;
  item.dataset.name = String(entry.username || "").toLowerCase();
  if (uncFirstPaint) {
    item.classList.add("is-entering");
    item.style.setProperty("--enter-delay", `${Math.min(index, 9) * 40}ms`);
  }
  if (uncIsYou(entry)) item.classList.add("is-you");

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
  name.textContent = entry.username || "viewer";
  if (uncIsYou(entry)) {
    const you = document.createElement("span");
    you.className = "lb-you";
    you.textContent = "You";
    name.append(you);
  }

  const bar = document.createElement("span");
  bar.className = "lb-bar";
  bar.setAttribute("aria-hidden", "true");
  bar.append(document.createElement("span"));

  const gap = document.createElement("span");
  gap.className = "lb-gap";
  gap.textContent = uncGap(entry, leader);
  player.append(name, bar, gap);

  const points = document.createElement("span");
  points.className = "lb-wager";
  paintUncPoints(points, entry.points);

  const prize = document.createElement("span");
  prize.className = "lb-prize";
  prize.textContent = formatUncPrize(entry.rank);

  row.append(rank, player, points, prize);
  row.addEventListener("click", () => {
    const open = row.getAttribute("aria-expanded") === "true";
    document.querySelectorAll("#unc-list .lb-row[aria-expanded='true']").forEach((other) => {
      if (other !== row) other.setAttribute("aria-expanded", "false");
    });
    row.setAttribute("aria-expanded", open ? "false" : "true");
  });

  item.append(row);
  fillBar(bar, uncShare(entry, leader), uncFirstPaint);
  return item;
}

function applyUncFilter() {
  const query = uncFilterQuery.trim().toLowerCase();
  const items = [...document.querySelectorAll("#unc-list .lb-item")];
  let shown = 0;
  items.forEach((item) => {
    const match = !query || String(item.dataset.name || "").includes(query);
    item.classList.toggle("is-filtered-out", !match);
    if (match) shown += 1;
  });
  document
    .getElementById("unc-filter-empty")
    ?.classList.toggle("is-hidden", !query || shown > 0 || items.length === 0);
}

function paintUncRace() {
  const ends = document.getElementById("unc-ends");
  const label = document.getElementById("unc-ends-label");
  const players = document.getElementById("unc-players");
  if (players) players.textContent = uncTotal ? String(uncTotal) : "—";
  if (!ends) return;
  const end = Date.parse(uncRace?.endsAt || "");
  if (!Number.isFinite(end)) {
    if (label) label.textContent = "Ends in";
    ends.textContent = "—";
    return;
  }
  const ms = end - Date.now();
  if (ms <= 0) {
    if (label) label.textContent = "Period";
    ends.textContent = "Ended";
    return;
  }
  if (label) label.textContent = "Ends in";
  const days = Math.ceil(ms / 86400000);
  ends.textContent = days === 1 ? "1 day" : `${days} days`;
}

function renderUncLeaderboard() {
  const list = document.getElementById("unc-list");
  const empty = document.getElementById("unc-empty");
  const head = document.getElementById("unc-table-head");
  if (!list || !empty) return;

  const entries = uncEntries();
  const leader = uncLeader();
  paintUncRace();
  renderUncPodium(uncLeaders, leader);
  list.replaceChildren();

  const hasEntries = entries.length > 0;
  empty.classList.toggle("is-hidden", hasEntries);
  head?.classList.toggle("is-hidden", !hasEntries);
  list.classList.toggle("is-hidden", !hasEntries);
  entries.forEach((entry, index) => {
    list.append(createUncStanding(entry, leader, index));
  });
  applyUncFilter();
  if (hasEntries) uncFirstPaint = false;
}

function uncSignature(data) {
  return JSON.stringify({
    leaders: data.leaders,
    you: data.you,
    total: data.total,
    race: data.race,
  });
}

async function loadUncLeaderboard({ quiet = false } = {}) {
  if (!quiet && activeTab === "unc") {
    setLeaderboardStatus("Loading UncCoins leaderboard...");
  }

  try {
    const response = await fetch("/api/points/leaderboard", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not load the UncCoins leaderboard.");
    }

    const signature = uncSignature(data);
    uncLeaders = Array.isArray(data.leaders) ? data.leaders : [];
    uncYou = data.you && Number(data.you.points) > 0 ? data.you : null;
    uncTotal = Number(data.total) || uncLeaders.length;
    uncRace = data.race || null;

    if (signature !== uncLastSignature) {
      uncLastSignature = signature;
      uncFirstPaint = !uncLoadedOnce;
      renderUncLeaderboard();
    } else {
      paintUncRace();
    }

    uncLoadedOnce = true;
    if (activeTab === "unc") setLeaderboardStatus("");
  } catch (error) {
    if (!uncLoadedOnce) {
      uncLeaders = [];
      uncYou = null;
      uncTotal = 0;
      uncRace = null;
      renderUncLeaderboard();
    }
    if (activeTab === "unc" && (!quiet || !uncLoadedOnce)) {
      setLeaderboardStatus(
        error.message || "Could not load the UncCoins leaderboard.",
        "error"
      );
    }
  }
}

function switchTab(tab) {
  const next = tab === "unc" ? "unc" : "stake";
  activeTab = next;

  document.querySelectorAll("[data-lb-tab]").forEach((button) => {
    const on = button.dataset.lbTab === next;
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
  });

  document.querySelectorAll("[data-lb-panel]").forEach((panel) => {
    const on = panel.dataset.lbPanel === next;
    panel.classList.toggle("is-active", on);
    panel.classList.toggle("is-hidden", !on);
    panel.hidden = !on;
  });

  document.getElementById("lb-meta-stake")?.classList.toggle("is-hidden", next !== "stake");
  document.getElementById("lb-meta-unc")?.classList.toggle("is-hidden", next !== "unc");

  const lede = document.getElementById("lb-lede");
  if (lede) {
    lede.innerHTML =
      next === "unc"
        ? 'When the monthly leaderboard ends, 1st gets a <strong>$100 tip</strong>, 2nd gets <strong>$50</strong>, and 3rd gets <strong>$25</strong>.'
        : 'Top 10 wagered on code <strong>BLAKJAC21</strong>.';
  }

  const rulesBtn = document.getElementById("leaderboard-rules-toggle");
  const rules = document.getElementById("leaderboard-rules");
  if (next !== "stake") {
    rules?.classList.add("is-hidden");
    rulesBtn?.setAttribute("aria-expanded", "false");
  }
  rulesBtn?.classList.toggle("is-hidden", next !== "stake");

  try {
    const url = new URL(window.location.href);
    if (next === "unc") url.hash = "unccoins";
    else url.hash = "";
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }

  setLeaderboardStatus("");
  if (next === "unc") {
    void loadUncLeaderboard();
  }
}

function scheduleLeaderboardPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(() => {
    if (document.hidden) return;
    void loadLeaderboard({ quiet: true });
    if (activeTab === "unc" || uncLoadedOnce) {
      void loadUncLeaderboard({ quiet: true });
    }
  }, 15000);
}

document.querySelectorAll("[data-lb-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.lbTab);
  });
});

document.getElementById("leaderboard-rules-toggle")?.addEventListener("click", () => {
  const panel = document.getElementById("leaderboard-rules");
  const button = document.getElementById("leaderboard-rules-toggle");
  if (!panel || !button || activeTab !== "stake") return;
  const open = panel.classList.toggle("is-hidden") === false;
  button.setAttribute("aria-expanded", open ? "true" : "false");
});

document.getElementById("leaderboard-filter")?.addEventListener("input", (event) => {
  filterQuery = event.target.value || "";
  applyFilter();
});

document.getElementById("unc-filter")?.addEventListener("input", (event) => {
  uncFilterQuery = event.target.value || "";
  applyUncFilter();
});

window.addEventListener("auth:change", (event) => {
  currentUser = event.detail?.user || null;
  if (latestData) renderLeaderboard(latestData);
  if (uncLoadedOnce) renderUncLeaderboard();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void loadLeaderboard({ quiet: true });
    if (activeTab === "unc" || uncLoadedOnce) {
      void loadUncLeaderboard({ quiet: true });
    }
  }
});

window.setInterval(() => {
  if (activeTab === "unc") paintUncRace();
}, 60000);

const initialHash = String(window.location.hash || "")
  .replace(/^#/, "")
  .toLowerCase();
if (initialHash === "unccoins" || initialHash === "unc") {
  switchTab("unc");
} else {
  switchTab("stake");
}

void loadLeaderboard();
if (activeTab === "unc") {
  void loadUncLeaderboard();
}
scheduleLeaderboardPolling();
