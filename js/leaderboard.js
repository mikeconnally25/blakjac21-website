let pollTimer = null;
let lastSignature = "";
let hasLoadedOnce = false;

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function setLeaderboardStatus(message, tone = "") {
  const status = document.getElementById("leaderboard-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
}

function createLeaderboardPodiumSlot(place, entry) {
  const slot = document.createElement("div");
  slot.className = `podium-slot place-${place}`;

  const block = document.createElement("div");
  block.className = "podium-block";

  const medal = document.createElement("span");
  medal.className = "podium-medal";
  medal.textContent = place === 1 ? "1st" : place === 2 ? "2nd" : "3rd";

  const user = document.createElement("span");
  user.className = "podium-user";
  user.textContent = entry?.username ?? "—";

  block.append(medal, user);

  if (entry) {
    const wagered = document.createElement("span");
    wagered.className = "podium-guess";
    wagered.textContent = entry.wageredLabel || formatCurrency(entry.wagered);
    block.append(wagered);
  }

  slot.append(block);
  return slot;
}

function renderPodium(topThree) {
  const panel = document.getElementById("leaderboard-podium-panel");
  const stage = document.getElementById("leaderboard-podium-stage");

  if (!panel || !stage) return;

  const hasPodium = topThree.length > 0;
  panel.classList.toggle("is-hidden", !hasPodium);

  if (!hasPodium) {
    stage.replaceChildren();
    return;
  }

  stage.replaceChildren();

  const byRank = new Map(topThree.map((entry) => [entry.rank, entry]));

  [2, 1, 3].forEach((place) => {
    const entry = byRank.get(place) ?? topThree[place - 1] ?? null;
    stage.append(createLeaderboardPodiumSlot(place, entry));
  });
}

function renderLeaderboardList(entries) {
  const list = document.getElementById("leaderboard-list");
  const tableHead = document.getElementById("leaderboard-table-head");

  if (!list) return;

  list.replaceChildren();
  tableHead?.classList.toggle("is-hidden", entries.length === 0);
  list.classList.toggle("is-hidden", entries.length === 0);

  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "leaderboard-entry";

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = `#${entry.rank}`;

    const user = document.createElement("span");
    user.className = "leaderboard-user";
    user.textContent = entry.username;

    const score = document.createElement("span");
    score.className = "leaderboard-score";
    score.textContent = entry.wageredLabel || formatCurrency(entry.wagered);

    item.append(rank, user, score);
    list.append(item);
  });
}

function leaderboardSignature(data) {
  if (data.signature) {
    return String(data.signature);
  }

  return JSON.stringify({
    entries: data.entries,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
  });
}

function renderLeaderboard({ entries, periodStart, periodEnd }) {
  const empty = document.getElementById("leaderboard-empty");
  const count = document.getElementById("leaderboard-count");
  const period = document.getElementById("leaderboard-period");

  if (!empty) return;

  const total = entries.length;
  empty.classList.toggle("is-hidden", total > 0);

  if (count) {
    count.textContent = total ? "Top 10" : "0 players";
  }

  if (period) {
    if (periodStart && periodEnd) {
      period.textContent = `${periodStart} to ${periodEnd}`;
      period.classList.remove("is-hidden");
    } else {
      period.textContent = "";
      period.classList.add("is-hidden");
    }
  }

  renderPodium(entries.slice(0, 3));
  renderLeaderboardList(entries.slice(3));
}

async function loadLeaderboard({ quiet = false } = {}) {
  if (!quiet) {
    setLeaderboardStatus("Loading leaderboard...");
  }

  try {
    const response = await fetch("/api/leaderboard", {
      credentials: "same-origin",
      cache: "no-store",
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not load leaderboard.");
    }

    const signature = leaderboardSignature(data);
    if (signature !== lastSignature) {
      lastSignature = signature;
      renderLeaderboard(data);
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
    void loadLeaderboard({ quiet: true });
  }, 1000);
}

loadLeaderboard();
scheduleLeaderboardPolling();
