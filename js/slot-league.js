let leaguePayload = null;
let currentUser = null;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setBanner(message, tone = "") {
  const el = $("league-banner");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("is-hidden", !message);
  el.classList.toggle("is-error", tone === "error");
  el.classList.toggle("is-success", tone === "success");
}

function phaseLabel(phase, open) {
  if (open) return "Signups open";
  const map = {
    closed: "Closed",
    signup: "Signups closed",
    groups: "Group stage",
    knockout: "Knockout",
    results: "Results",
  };
  return map[phase] || phase || "Closed";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function spotLabel(spot) {
  if (!spot) return "TBD";
  const name = spot.username || "Open";
  const slot = spot.slot?.name ? ` · ${spot.slot.name}` : "";
  return `${name}${slot}`;
}

function spotById(id) {
  return (leaguePayload?.league?.spots || []).find((s) => s.id === id) || null;
}

function renderStatus() {
  const league = leaguePayload?.league;
  if (!league) return;
  const card = $("league-status-card");
  const value = $("league-status-value");
  const meta = $("league-status-meta");
  const toggle = $("league-status-toggle");
  const toggleWrap = $("league-status-toggle-wrap");
  const isAdmin = Boolean(leaguePayload.isAdmin);

  if (card) card.dataset.phase = league.phase || "closed";
  if (value) value.textContent = phaseLabel(league.phase, league.open);
  if (meta) {
    meta.textContent = league.open
      ? `${league.filled || 0} / ${league.capacity || 16} spots claimed`
      : league.championSpotId
        ? "Champion crowned"
        : "Admin can open signups or advance the bracket.";
  }
  if (toggleWrap) toggleWrap.classList.toggle("is-hidden", !isAdmin);
  if (toggle) toggle.checked = Boolean(league.open);

  $("league-title").textContent = league.title || "—";
  $("league-buyin").textContent = league.buyIn || "—";
  $("league-filled").textContent = `${league.filled || 0} / ${league.capacity || 16}`;
  $("league-phase").textContent = league.phase || "closed";
  $("league-info-title").textContent = league.title || "League";

  const admin = $("league-admin");
  admin?.classList.toggle("is-hidden", !isAdmin);
  if (isAdmin) {
    $("league-admin-title-input").value = league.title || "";
    $("league-admin-buyin").value = league.buyIn || "";
  }
}

function renderJoin() {
  const league = leaguePayload?.league;
  const form = $("league-join-form");
  const copy = $("league-join-copy");
  const btn = $("league-join-btn");
  const list = $("league-slot-catalog");
  if (!league || !form) return;

  const catalog = Array.isArray(leaguePayload.catalog) ? leaguePayload.catalog : [];
  if (list) {
    list.replaceChildren(
      ...catalog.map((item) => {
        const opt = document.createElement("option");
        opt.value = item.name;
        return opt;
      })
    );
  }

  const signedIn = Boolean(currentUser);
  const entered = Boolean(leaguePayload.viewerEntered);
  const open = Boolean(league.open);

  if (!signedIn) {
    copy.textContent = "Sign in with Kick to claim a spot.";
    btn.disabled = true;
  } else if (entered) {
    copy.textContent = "You are already in this league.";
    btn.disabled = true;
  } else if (!open) {
    copy.textContent = "Signups are closed.";
    btn.disabled = true;
  } else {
    copy.textContent = "Pick a Stake slot and claim one of the 16 spots.";
    btn.disabled = false;
  }
}

function renderSpots() {
  const grid = $("league-spots-grid");
  const league = leaguePayload?.league;
  if (!grid || !league) return;
  grid.replaceChildren();
  (league.spots || []).forEach((spot) => {
    const card = document.createElement("article");
    card.className = `league-spot${spot.entryId ? " is-filled" : ""}`;
    const thumb = spot.slot?.thumbnailUrl
      ? `<img class="league-spot-thumb" src="${escapeHtml(spot.slot.thumbnailUrl)}" alt="" width="48" height="48" loading="lazy" />`
      : `<div class="league-spot-thumb is-empty" aria-hidden="true"></div>`;
    card.innerHTML = `
      ${thumb}
      <div class="league-spot-copy">
        <p class="league-spot-index">Spot ${spot.index}</p>
        <p class="league-spot-name">${escapeHtml(spot.username || "Open")}</p>
        <p class="league-spot-slot">${escapeHtml(spot.slot?.name || "No slot yet")}</p>
      </div>
    `;
    grid.append(card);
  });
}

function renderGroups() {
  const root = $("league-groups");
  const league = leaguePayload?.league;
  if (!root || !league) return;
  root.replaceChildren();
  const standings = league.standings || {};
  ["A", "B", "C", "D"].forEach((groupId) => {
    const rows = standings[groupId] || [];
    const panel = document.createElement("div");
    panel.className = "league-group";
    const body =
      rows.length === 0
        ? `<p class="league-copy">Groups not generated yet.</p>`
        : `<table class="league-table">
            <thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>Diff</th></tr></thead>
            <tbody>
              ${rows
                .map((row, i) => {
                  const spot = spotById(row.spotId);
                  return `<tr>
                    <td>${i + 1}</td>
                    <td>${escapeHtml(spot?.username || row.spotId)}</td>
                    <td>${row.wins}</td>
                    <td>${row.losses}</td>
                    <td>${Number(row.diff).toFixed(1)}</td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>`;
    panel.innerHTML = `<h3 class="league-group-title">Group ${groupId}</h3>${body}`;
    root.append(panel);
  });
}

function matchTitle(match) {
  const a = spotLabel(spotById(match.spotAId));
  const b = spotLabel(spotById(match.spotBId));
  const stage =
    match.stage === "group"
      ? `Group ${match.group}`
      : match.stage === "qf"
        ? "QF"
        : match.stage === "sf"
          ? "SF"
          : "Final";
  return `${stage}: ${a} vs ${b}`;
}

function renderMatches() {
  const root = $("league-matches");
  const select = $("league-score-match");
  const league = leaguePayload?.league;
  if (!root || !league) return;
  const matches = league.matches || [];
  root.replaceChildren();

  if (!matches.length) {
    root.innerHTML = `<p class="league-copy">No matches yet. Generate groups when all 16 spots are filled.</p>`;
  } else {
    matches.forEach((match) => {
      const row = document.createElement("div");
      row.className = `league-match${match.winnerSpotId ? " is-done" : ""}`;
      const winner = match.winnerSpotId
        ? spotById(match.winnerSpotId)?.username || "Winner"
        : "—";
      row.innerHTML = `
        <div class="league-match-main">
          <p class="league-match-stage">${escapeHtml(
            match.stage === "group" ? `Group ${match.group}` : match.stage.toUpperCase()
          )}</p>
          <p class="league-match-names">${escapeHtml(spotLabel(spotById(match.spotAId)))} <span>vs</span> ${escapeHtml(
            spotLabel(spotById(match.spotBId))
          )}</p>
        </div>
        <div class="league-match-scores">
          <span>${escapeHtml(match.scoreA || "—")}</span>
          <span>${escapeHtml(match.scoreB || "—")}</span>
        </div>
        <p class="league-match-winner">${escapeHtml(winner)}</p>
      `;
      root.append(row);
    });
  }

  if (select) {
    select.replaceChildren();
    matches.forEach((match) => {
      const opt = document.createElement("option");
      opt.value = match.id;
      opt.textContent = matchTitle(match);
      select.append(opt);
    });
  }
}

function renderKnockout() {
  const root = $("league-knockout");
  const champ = $("league-champion");
  const league = leaguePayload?.league;
  if (!root || !league) return;
  const knockout = (league.matches || []).filter((m) =>
    ["qf", "sf", "final"].includes(m.stage)
  );
  root.replaceChildren();
  if (!knockout.length) {
    root.innerHTML = `<p class="league-copy">Knockout unlocks after group stage (4 winners + 4 wildcards).</p>`;
    champ?.classList.add("is-hidden");
    return;
  }

  ["qf", "sf", "final"].forEach((stage) => {
    const list = knockout.filter((m) => m.stage === stage);
    if (!list.length) return;
    const block = document.createElement("div");
    block.className = "league-knockout-round";
    const title =
      stage === "qf" ? "Quarterfinals" : stage === "sf" ? "Semifinals" : "Final";
    block.innerHTML = `<h3 class="league-group-title">${title}</h3>`;
    list.forEach((match) => {
      const item = document.createElement("div");
      item.className = "league-match";
      item.innerHTML = `
        <p class="league-match-names">${escapeHtml(spotLabel(spotById(match.spotAId)))} <span>vs</span> ${escapeHtml(
          spotLabel(spotById(match.spotBId))
        )}</p>
        <div class="league-match-scores">
          <span>${escapeHtml(match.scoreA || "—")}</span>
          <span>${escapeHtml(match.scoreB || "—")}</span>
        </div>
      `;
      block.append(item);
    });
    root.append(block);
  });

  if (league.championSpotId && champ) {
    const winner = spotById(league.championSpotId);
    champ.textContent = `Champion: ${winner?.username || "Unknown"} (${winner?.slot?.name || "slot"})`;
    champ.classList.remove("is-hidden");
  } else {
    champ?.classList.add("is-hidden");
  }
}

function renderAll() {
  renderStatus();
  renderJoin();
  renderSpots();
  renderGroups();
  renderMatches();
  renderKnockout();
}

async function refresh() {
  leaguePayload = await api("/api/slot-league/status");
  renderAll();
}

async function loadMe() {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      currentUser = null;
      return;
    }
    const data = await response.json();
    currentUser = data.user || null;
  } catch {
    currentUser = null;
  }
}

function bindEvents() {
  $("league-status-toggle")?.addEventListener("change", async (event) => {
    try {
      leaguePayload = await api("/api/slot-league/toggle", {
        method: "POST",
        body: JSON.stringify({ open: event.target.checked }),
      });
      setBanner(
        event.target.checked ? "League signups opened." : "League signups closed.",
        "success"
      );
      renderAll();
    } catch (error) {
      event.target.checked = !event.target.checked;
      setBanner(error.message, "error");
    }
  });

  $("league-join-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const slotName = $("league-join-slot")?.value?.trim();
    if (!slotName) return;
    try {
      leaguePayload = await api("/api/slot-league/join", {
        method: "POST",
        body: JSON.stringify({ slotName }),
      });
      setBanner("Joined the league.", "success");
      renderAll();
    } catch (error) {
      setBanner(error.message, "error");
    }
  });

  $("league-settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      leaguePayload = await api("/api/slot-league/settings", {
        method: "POST",
        body: JSON.stringify({
          title: $("league-admin-title-input")?.value,
          buyIn: $("league-admin-buyin")?.value,
        }),
      });
      setBanner("Settings saved.", "success");
      renderAll();
    } catch (error) {
      setBanner(error.message, "error");
    }
  });

  $("league-score-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      leaguePayload = await api("/api/slot-league/matches/score", {
        method: "POST",
        body: JSON.stringify({
          matchId: $("league-score-match")?.value,
          scoreA: $("league-score-a")?.value,
          scoreB: $("league-score-b")?.value,
        }),
      });
      setBanner("Match score saved.", "success");
      renderAll();
    } catch (error) {
      setBanner(error.message, "error");
    }
  });

  async function postAdmin(path, body = {}) {
    try {
      leaguePayload = await api(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setBanner("Updated.", "success");
      renderAll();
    } catch (error) {
      setBanner(error.message, "error");
    }
  }

  $("league-admin-groups")?.addEventListener("click", () =>
    postAdmin("/api/slot-league/groups/generate")
  );
  $("league-admin-groups-force")?.addEventListener("click", () =>
    postAdmin("/api/slot-league/groups/generate", { force: true })
  );
  $("league-admin-knockout")?.addEventListener("click", () =>
    postAdmin("/api/slot-league/knockout/generate")
  );
  $("league-admin-knockout-force")?.addEventListener("click", () =>
    postAdmin("/api/slot-league/knockout/generate", { force: true })
  );
  $("league-admin-bots")?.addEventListener("click", () => {
    const filled = leaguePayload?.league?.filled || 0;
    const need = Math.max(0, 16 - filled);
    if (need < 1) {
      setBanner("League is already full.", "error");
      return;
    }
    postAdmin("/api/slot-league/entries/bots", { count: need });
  });
  $("league-admin-clear")?.addEventListener("click", () =>
    postAdmin("/api/slot-league/entries/clear")
  );
  $("league-admin-reset")?.addEventListener("click", () => {
    if (!window.confirm("Reset the entire league season?")) return;
    postAdmin("/api/slot-league/reset");
  });
}

async function init() {
  bindEvents();
  await loadMe();
  try {
    await refresh();
  } catch (error) {
    setBanner(error.message || "Could not load league.", "error");
  }
  setInterval(() => {
    refresh().catch(() => {});
  }, 15000);
}

init();
