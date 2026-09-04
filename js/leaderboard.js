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

const TROPHY_METALS = {
  1: {
    light: "#fff6c8",
    mid: "#ffd24a",
    deep: "#c79212",
    dark: "#8a6408",
    shine: "#fffef5",
  },
  2: {
    light: "#ffffff",
    mid: "#d5dde6",
    deep: "#8e9aab",
    dark: "#5d6a7a",
    shine: "#ffffff",
  },
  3: {
    light: "#f3c08a",
    mid: "#cd7f32",
    deep: "#935318",
    dark: "#63340e",
    shine: "#ffe0b8",
  },
};

function createPodiumTrophy(place) {
  const metal = TROPHY_METALS[place] || TROPHY_METALS[3];
  const uid = `trophy-${place}-${Math.random().toString(36).slice(2, 8)}`;
  const trophy = document.createElement("span");
  trophy.className = `podium-trophy podium-trophy--${place}`;
  trophy.setAttribute("aria-label", formatPlace(place));

  trophy.innerHTML = `
    <svg class="podium-trophy-icon" viewBox="0 0 88 108" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${uid}-cup" x1="18" y1="8" x2="70" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${metal.shine}"/>
          <stop offset="28%" stop-color="${metal.light}"/>
          <stop offset="55%" stop-color="${metal.mid}"/>
          <stop offset="82%" stop-color="${metal.deep}"/>
          <stop offset="100%" stop-color="${metal.dark}"/>
        </linearGradient>
        <linearGradient id="${uid}-rim" x1="18" y1="8" x2="70" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${metal.shine}"/>
          <stop offset="45%" stop-color="${metal.light}"/>
          <stop offset="100%" stop-color="${metal.deep}"/>
        </linearGradient>
        <linearGradient id="${uid}-handle" x1="0" y1="20" x2="1" y2="55" gradientUnits="objectBoundingBox">
          <stop offset="0%" stop-color="${metal.light}"/>
          <stop offset="50%" stop-color="${metal.mid}"/>
          <stop offset="100%" stop-color="${metal.dark}"/>
        </linearGradient>
        <linearGradient id="${uid}-stem" x1="40" y1="58" x2="48" y2="78" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${metal.light}"/>
          <stop offset="55%" stop-color="${metal.mid}"/>
          <stop offset="100%" stop-color="${metal.dark}"/>
        </linearGradient>
        <linearGradient id="${uid}-base" x1="20" y1="78" x2="68" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${metal.light}"/>
          <stop offset="40%" stop-color="${metal.mid}"/>
          <stop offset="100%" stop-color="${metal.dark}"/>
        </linearGradient>
        <radialGradient id="${uid}-glow" cx="44" cy="30" r="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${metal.shine}" stop-opacity="0.55"/>
          <stop offset="70%" stop-color="${metal.shine}" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <ellipse cx="44" cy="100" rx="22" ry="3.5" fill="rgba(0,0,0,0.28)"/>

      <path
        d="M22 26c-11 1-18 9-18 19 0 12 8 20 19 21"
        fill="none"
        stroke="url(#${uid}-handle)"
        stroke-width="5.5"
        stroke-linecap="round"
      />
      <path
        d="M66 26c11 1 18 9 18 19 0 12-8 20-19 21"
        fill="none"
        stroke="url(#${uid}-handle)"
        stroke-width="5.5"
        stroke-linecap="round"
      />
      <path
        d="M22 26c-11 1-18 9-18 19 0 12 8 20 19 21"
        fill="none"
        stroke="${metal.shine}"
        stroke-width="1.6"
        stroke-linecap="round"
        opacity="0.45"
        transform="translate(1.2 -0.8)"
      />
      <path
        d="M66 26c11 1 18 9 18 19 0 12-8 20-19 21"
        fill="none"
        stroke="${metal.shine}"
        stroke-width="1.6"
        stroke-linecap="round"
        opacity="0.45"
        transform="translate(-1.2 -0.8)"
      />

      <path
        d="M26 18h36c1.4 0 2.5 1.1 2.5 2.5V30c0 16.5-9 29.5-20.5 34.5C32.5 59.5 23.5 46.5 23.5 30V20.5c0-1.4 1.1-2.5 2.5-2.5Z"
        fill="url(#${uid}-cup)"
      />
      <path
        d="M29 21h10c0.8 0 1.4 0.7 1.3 1.5-0.6 7.5-2.8 14.2-6.2 19.2-0.5 0.7-1.6 0.4-1.6-0.4V21.8c0-0.4 0.4-0.8 0.8-0.8Z"
        fill="${metal.shine}"
        opacity="0.38"
      />
      <ellipse cx="44" cy="30" rx="14" ry="10" fill="url(#${uid}-glow)"/>

      <rect x="21" y="11" width="46" height="10" rx="3.5" fill="url(#${uid}-rim)"/>
      <rect x="24" y="12.5" width="40" height="3" rx="1.5" fill="${metal.shine}" opacity="0.55"/>
      <rect x="23" y="18.5" width="42" height="2" rx="1" fill="${metal.dark}" opacity="0.35"/>

      <rect x="41" y="62" width="6" height="16" rx="2" fill="url(#${uid}-stem)"/>
      <rect x="42.2" y="63" width="1.6" height="13" rx="0.8" fill="${metal.shine}" opacity="0.45"/>

      <path d="M31 76h26l6 9H25l6-9Z" fill="url(#${uid}-base)"/>
      <path d="M33 77.5h22l1.8 2.8H31.2l1.8-2.8Z" fill="${metal.shine}" opacity="0.28"/>
      <rect x="20" y="85" width="48" height="8" rx="3" fill="url(#${uid}-base)"/>
      <rect x="23" y="86.5" width="42" height="2.4" rx="1.2" fill="${metal.shine}" opacity="0.4"/>
      <rect x="22" y="90.5" width="44" height="1.8" rx="0.9" fill="${metal.dark}" opacity="0.35"/>
    </svg>
    <span class="podium-trophy-place">${place}</span>
  `;

  return trophy;
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

  const trophy = createPodiumTrophy(place);

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

  block.append(trophy, user, wagered, prize);
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
  }, 5000);
}

loadLeaderboard();
scheduleLeaderboardPolling();
