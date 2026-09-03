let pollTimer = null;
let lastSignature = "";
let hasLoadedOnce = false;

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

let isInitialRender = true;

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
  if (!entry) {
    slot.classList.add("is-vacant");
  }
  if (isInitialRender) {
    slot.classList.add("is-entering");
  }

  const block = document.createElement("div");
  block.className = "podium-block";

  const medal = document.createElement("span");
  medal.className = "podium-medal";
  medal.textContent = formatPlace(place);

  const user = document.createElement("span");
  user.className = "podium-user";
  user.textContent = entry ? maskUsername(entry.username) : "—";

  const wagered = document.createElement("span");
  wagered.className = "podium-guess";
  wagered.textContent = entry
    ? entry.wageredLabel || formatCurrency(entry.wagered)
    : "";

  const prize = document.createElement("span");
  prize.className = "podium-prize";
  prize.textContent = formatPrize(entry?.rank ?? place);

  block.append(medal, user, wagered, prize);
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

  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-entry";
    item.dataset.rank = String(entry.rank);
    if (isInitialRender) {
      item.classList.add("is-entering");
      item.style.setProperty("--enter-delay", `${index * 60}ms`);
    }

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(entry.rank).padStart(2, "0");

    const user = document.createElement("span");
    user.className = "leaderboard-user";
    user.textContent = maskUsername(entry.username);

    const score = document.createElement("span");
    score.className = "leaderboard-score";
    score.textContent = entry.wageredLabel || formatCurrency(entry.wagered);

    const prize = document.createElement("span");
    prize.className = "leaderboard-prize";
    prize.textContent = formatPrize(entry.rank);

    item.append(rank, user, score, prize);
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
  const period = document.getElementById("leaderboard-period");
  const board = document.querySelector(".leaderboard-board");

  if (!empty) return;

  const total = entries.length;
  empty.classList.toggle("is-hidden", total > 0);
  board?.classList.toggle("is-empty", total === 0);

  if (period) {
    if (periodStart && periodEnd) {
      period.textContent = `${periodStart} – ${periodEnd}`;
      period.classList.remove("is-hidden");
    } else {
      period.textContent = "";
      period.classList.add("is-hidden");
    }
  }

  renderPodium(entries.slice(0, 3));
  renderLeaderboardList(entries.slice(3));
  isInitialRender = false;
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
