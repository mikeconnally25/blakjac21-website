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

function renderLeaderboard({ entries, periodStart, periodEnd }) {
  const list = document.getElementById("leaderboard-list");
  const empty = document.getElementById("leaderboard-empty");
  const count = document.getElementById("leaderboard-count");
  const period = document.getElementById("leaderboard-period");

  if (!list || !empty) return;

  const total = entries.length;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

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

async function loadLeaderboard() {
  setLeaderboardStatus("Loading leaderboard...");

  try {
    const response = await fetch("/api/leaderboard", {
      credentials: "same-origin",
      cache: "no-store",
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not load leaderboard.");
    }

    renderLeaderboard(data);
    setLeaderboardStatus("");
  } catch (error) {
    renderLeaderboard({ entries: [], periodStart: null, periodEnd: null });
    setLeaderboardStatus(error.message || "Could not load leaderboard.", "error");
  }
}

loadLeaderboard();
