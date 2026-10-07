const slotStatsState = {
  group: "all",
  matches: [],
  selectedSlug: "",
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function slotStatsRoot() {
  return document.getElementById("slot-stats");
}

function formatBet(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? ""
    : ` (${money.format(value)})`;
}

function formatWin(value, bet) {
  return value === null || value === undefined ? "—" : `${money.format(value)}${formatBet(bet)}`;
}

function formatX(value, bet) {
  return value === null || value === undefined
    ? "—"
    : `${Number(value).toLocaleString("en-US")}x${formatBet(bet)}`;
}

function renderSlotStatsDetail(match) {
  const detail = document.getElementById("slot-stats-detail");
  const empty = document.getElementById("slot-stats-detail-empty");
  if (!detail || !empty) return;

  if (!match) {
    detail.classList.add("is-hidden");
    empty.classList.remove("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  detail.classList.remove("is-hidden");
  const name = document.getElementById("slot-stats-name");
  const meta = document.getElementById("slot-stats-meta");
  const win = document.getElementById("slot-stats-win");
  const multi = document.getElementById("slot-stats-x");
  const average = document.getElementById("slot-stats-average");
  const count = document.getElementById("slot-stats-count");
  if (name) name.textContent = match.name;
  if (meta) {
    meta.textContent = [match.groupLabel, match.provider].filter(Boolean).join(" · ");
  }
  if (win) win.textContent = formatWin(match.biggestWin, match.biggestWinBet);
  if (multi) multi.textContent = formatX(match.biggestX, match.biggestXBet);
  if (average) average.textContent = formatX(match.averageX);
  if (count) count.textContent = String(match.bonusCount || 0);
}

function renderSlotStatsMatches() {
  const list = document.getElementById("slot-stats-results");
  const empty = document.getElementById("slot-stats-empty");
  if (!list || !empty) return;

  list.replaceChildren();
  const matches = slotStatsState.matches;
  if (!matches.length) {
    list.classList.add("is-hidden");
    empty.classList.remove("is-hidden");
    renderSlotStatsDetail(null);
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");
  if (matches.length === 1) {
    slotStatsState.selectedSlug = matches[0].slug;
  }

  for (const match of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hunt-add-slot-option";
    if (match.slug === slotStatsState.selectedSlug) {
      button.classList.add("is-selected");
    }
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", match.slug === slotStatsState.selectedSlug ? "true" : "false");

    const thumb = document.createElement("span");
    thumb.className = "hunt-add-slot-thumb";
    if (match.thumbnailUrl) {
      const image = document.createElement("img");
      image.className = "hunt-add-slot-thumb-image";
      image.alt = "";
      image.src = match.thumbnailUrl;
      thumb.appendChild(image);
    } else {
      thumb.textContent = match.name.slice(0, 1).toUpperCase();
    }

    const copy = document.createElement("span");
    copy.className = "hunt-add-slot-option-copy";
    const title = document.createElement("span");
    title.className = "hunt-add-slot-option-name";
    title.textContent = match.name;
    const note = document.createElement("span");
    note.className = "hunt-add-slot-option-provider";
    note.textContent = [match.groupLabel, `${match.bonusCount || 0} bonuses`].filter(Boolean).join(" · ");
    copy.append(title, note);
    button.append(thumb, copy);
    button.addEventListener("click", () => {
      slotStatsState.selectedSlug = match.slug;
      renderSlotStatsMatches();
      renderSlotStatsDetail(match);
    });
    list.appendChild(button);
  }

  const selected = matches.find((match) => match.slug === slotStatsState.selectedSlug) || null;
  renderSlotStatsDetail(selected);
}

async function loadSlotStats() {
  const input = document.getElementById("slot-stats-search");
  const status = document.getElementById("slot-stats-status");
  const empty = document.getElementById("slot-stats-empty");
  const query = input?.value.trim() || "";

  if (!query) {
    slotStatsState.matches = [];
    slotStatsState.selectedSlug = "";
    document.getElementById("slot-stats-results")?.classList.add("is-hidden");
    document.getElementById("slot-stats-results")?.replaceChildren();
    if (empty) {
      empty.textContent = "Type a slot name from New Releases or Only on Stake.";
      empty.classList.remove("is-hidden");
    }
    renderSlotStatsDetail(null);
    status?.classList.add("is-hidden");
    return;
  }

  try {
    const params = new URLSearchParams({ q: query, group: slotStatsState.group });
    const response = await fetch(`/api/slot-stats?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load slot stats.");

    slotStatsState.matches = Array.isArray(data.matches) ? data.matches : [];
    if (
      slotStatsState.selectedSlug &&
      !slotStatsState.matches.some((match) => match.slug === slotStatsState.selectedSlug)
    ) {
      slotStatsState.selectedSlug = "";
    }
    if (empty) {
      empty.textContent = data.catalogEmpty
        ? "No slots loaded yet. Sync New Releases and Only on Stake from Bonus Hunt."
        : "No matching slots.";
    }
    renderSlotStatsMatches();
    status?.classList.add("is-hidden");
  } catch (error) {
    if (status) {
      status.textContent = error.message || "Could not load slot stats.";
      status.classList.remove("is-hidden");
    }
  }
}

function bindSlotStats() {
  const root = slotStatsRoot();
  if (!root || root.dataset.bound === "true") return;
  root.dataset.bound = "true";

  let timer = 0;
  document.getElementById("slot-stats-search")?.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(loadSlotStats, 180);
  });

  root.querySelectorAll("[data-slot-stats-group]").forEach((button) => {
    button.addEventListener("click", () => {
      slotStatsState.group = button.getAttribute("data-slot-stats-group") || "all";
      root.querySelectorAll("[data-slot-stats-group]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      loadSlotStats();
    });
  });
}

bindSlotStats();
