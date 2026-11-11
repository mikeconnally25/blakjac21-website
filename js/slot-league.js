let leaguePayload = null;
let currentUser = null;
let slotCatalog = [];
let slotCatalogUpdatedAt = null;

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
    season: "Season in play",
    groups: "Season in play",
    knockout: "Season in play",
    results: "Season complete",
  };
  return map[phase] || phase || "Closed";
}

function formatMultiplier(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
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

function isMatchPlayed(match) {
  const a = String(match?.scoreA ?? "").trim();
  const b = String(match?.scoreB ?? "").trim();
  return Boolean(a) && Boolean(b);
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
    if (league.open) {
      meta.textContent = `${league.filled || 0} / ${league.capacity || 16} spots claimed`;
    } else if (league.championSpotId) {
      meta.textContent = "Champion crowned";
    } else if (league.matchCount) {
      meta.textContent = `${league.matchesPlayed || 0} / ${league.matchCount} fixtures played`;
    } else {
      meta.textContent = "Admin can open signups or generate the season.";
    }
  }
  if (toggleWrap) toggleWrap.classList.toggle("is-hidden", !isAdmin);
  if (toggle) toggle.checked = Boolean(league.open);

  $("league-title").textContent = league.title || "—";
  $("league-buyin").textContent = league.buyIn || "—";
  $("league-filled").textContent = `${league.filled || 0} / ${league.capacity || 16}`;
  $("league-phase").textContent = league.phase || "closed";
  $("league-info-title").textContent = league.title || "League";
  const fixturesMeta = $("league-fixtures-meta");
  if (fixturesMeta) {
    fixturesMeta.textContent = `${league.matchesPlayed || 0} / ${league.matchCount || 0}`;
  }

  const admin = $("league-admin");
  admin?.classList.toggle("is-hidden", !isAdmin);
  if (isAdmin) {
    $("league-admin-title-input").value = league.title || "";
    $("league-admin-buyin").value = league.buyIn || "";
  }
}

function applyCatalogFromPayload(payload) {
  if (Array.isArray(payload?.catalog)) {
    slotCatalog = payload.catalog;
    slotCatalogUpdatedAt = payload.catalogUpdatedAt || null;
    return;
  }
  if (Array.isArray(payload?.slots)) {
    slotCatalog = payload.slots;
    slotCatalogUpdatedAt = payload.updatedAt || null;
  }
}

function renderJoin() {
  const league = leaguePayload?.league;
  const form = $("league-join-form");
  const copy = $("league-join-copy");
  const btn = $("league-join-btn");
  const list = $("league-slot-catalog");
  if (!league || !form) return;

  if (list) {
    list.replaceChildren(
      ...slotCatalog.map((item) => {
        const opt = document.createElement("option");
        opt.value = item.name;
        return opt;
      })
    );
  }

  const signedIn = Boolean(currentUser);
  const entered = Boolean(leaguePayload.viewerEntered);
  const open = Boolean(league.open);
  const catalogNote = slotCatalog.length
    ? ` ${slotCatalog.length} synced slots available.`
    : " Sync Allowed slots on Bonus Hunt first.";

  if (!signedIn) {
    copy.textContent = "Sign in with Kick to claim a spot.";
    btn.disabled = true;
  } else if (entered) {
    copy.textContent = "You are already in this league.";
    btn.disabled = true;
  } else if (!open) {
    copy.textContent = "Signups are closed.";
    btn.disabled = true;
  } else if (!slotCatalog.length) {
    copy.textContent = `Pick a Stake slot after syncing the Allowed list on Bonus Hunt.`;
    btn.disabled = true;
  } else {
    copy.textContent = `Pick a Stake slot and claim one of the 16 spots.${catalogNote}`;
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

function renderGroupTableRows(rows, { winnerIds = new Set(), champId = null } = {}) {
  return rows
    .map((row) => {
      const spot = spotById(row.spotId);
      const isLeader = row.position === 1;
      const isChamp = champId && row.spotId === champId;
      const isWinner = winnerIds.has(row.spotId);
      return `<tr class="${isChamp ? "is-champion" : isLeader || isWinner ? "is-leader" : ""}">
        <td class="league-pos">${row.position}</td>
        <td class="league-club">
          <span class="league-club-name">${escapeHtml(spot?.username || "Player")}</span>
          <span class="league-club-slot">${escapeHtml(spot?.slot?.name || "—")}</span>
        </td>
        <td>${row.played}</td>
        <td>${row.wins}</td>
        <td>${row.draws}</td>
        <td>${row.losses}</td>
        <td>${formatMultiplier(row.pointsFor)}</td>
        <td>${formatMultiplier(row.pointsAgainst)}</td>
        <td>${formatMultiplier(row.diff)}</td>
        <td class="league-pts">${row.points}</td>
      </tr>`;
    })
    .join("");
}

function renderTable() {
  const root = $("league-groups");
  const champ = $("league-champion");
  const league = leaguePayload?.league;
  if (!root || !league) return;

  const standings = league.standings || {};
  const hasGroups = ["A", "B", "C", "D"].some(
    (id) => Array.isArray(standings[id]) && standings[id].length
  );
  if (!hasGroups) {
    root.innerHTML = `<p class="league-copy">Tables appear once groups are generated.</p>`;
    champ?.classList.add("is-hidden");
    return;
  }

  const winnerIds = new Set(league.groupWinners || []);
  root.replaceChildren();
  ["A", "B", "C", "D"].forEach((groupId) => {
    const rows = standings[groupId] || [];
    const panel = document.createElement("div");
    panel.className = "league-group";
    panel.innerHTML = `
      <h3 class="league-group-title">Group ${groupId}</h3>
      <div class="league-table-wrap">
        <table class="league-table league-prem-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>P</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>PF</th>
              <th>PA</th>
              <th>GD</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            ${renderGroupTableRows(rows, {
              winnerIds,
              champId: league.championSpotId,
            })}
          </tbody>
        </table>
      </div>
    `;
    root.append(panel);
  });

  if (league.championSpotId && champ) {
    const winner = spotById(league.championSpotId);
    champ.textContent = `Overall: ${winner?.username || "Unknown"} (${winner?.slot?.name || "slot"})`;
    champ.classList.remove("is-hidden");
  } else if ((league.groupWinners || []).length && champ) {
    const names = league.groupWinners
      .map((id) => spotById(id)?.username || "?")
      .join(", ");
    champ.textContent = `Group leaders: ${names}`;
    champ.classList.remove("is-hidden");
  } else {
    champ?.classList.add("is-hidden");
  }
}

function matchTitle(match) {
  const a = spotLabel(spotById(match.spotAId));
  const b = spotLabel(spotById(match.spotBId));
  const group = match.group ? `G${match.group} ` : "";
  return `${group}MD${match.round}: ${a} vs ${b}`;
}

function matchResultLabel(match) {
  if (!isMatchPlayed(match)) return "—";
  const scoreA = Number(String(match.scoreA).replace(/,/g, "").replace(/x$/i, ""));
  const scoreB = Number(String(match.scoreB).replace(/,/g, "").replace(/x$/i, ""));
  if (Number.isFinite(scoreA) && Number.isFinite(scoreB) && scoreA === scoreB) {
    return "Draw";
  }
  if (match.winnerSpotId) {
    return spotById(match.winnerSpotId)?.username || "Winner";
  }
  return "Draw";
}

function renderMatches() {
  const root = $("league-matches");
  const select = $("league-score-match");
  const league = leaguePayload?.league;
  if (!root || !league) return;
  const matches = league.matches || [];
  root.replaceChildren();

  if (!matches.length) {
    root.innerHTML = `<p class="league-copy">No fixtures yet. Generate groups when all 16 spots are filled.</p>`;
  } else {
    const byRound = new Map();
    matches.forEach((match) => {
      const round = match.round || 1;
      if (!byRound.has(round)) byRound.set(round, []);
      byRound.get(round).push(match);
    });

    [...byRound.keys()]
      .sort((a, b) => a - b)
      .forEach((round) => {
        const block = document.createElement("div");
        block.className = "league-matchday";
        block.innerHTML = `<h3 class="league-group-title">Matchday ${round}</h3>`;
        byRound.get(round).forEach((match) => {
          const row = document.createElement("div");
          const played = isMatchPlayed(match);
          row.className = `league-match${played ? " is-done" : ""}`;
          row.innerHTML = `
            <div class="league-match-main">
              <p class="league-match-stage">Group ${escapeHtml(match.group || "?")} · MD ${match.round}</p>
              <p class="league-match-names">${escapeHtml(spotLabel(spotById(match.spotAId)))} <span>vs</span> ${escapeHtml(
                spotLabel(spotById(match.spotBId))
              )}</p>
            </div>
            <div class="league-match-scores">
              <span>${escapeHtml(match.scoreA || "—")}</span>
              <span>${escapeHtml(match.scoreB || "—")}</span>
            </div>
            <p class="league-match-winner">${escapeHtml(matchResultLabel(match))}</p>
          `;
          block.append(row);
        });
        root.append(block);
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

function renderAll() {
  renderStatus();
  renderJoin();
  renderSpots();
  renderTable();
  renderMatches();
}

async function refreshSlotCatalog() {
  try {
    const response = await fetch("/api/bonus-hunt/slots", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const data = await response.json();
    const nextUpdatedAt = data.updatedAt || null;
    const nextSlots = Array.isArray(data.slots) ? data.slots : [];
    const changed =
      nextUpdatedAt !== slotCatalogUpdatedAt ||
      nextSlots.length !== slotCatalog.length;
    applyCatalogFromPayload(data);
    return changed;
  } catch {
    return false;
  }
}

async function refresh() {
  const [status] = await Promise.all([
    api("/api/slot-league/status"),
    refreshSlotCatalog(),
  ]);
  leaguePayload = status;
  // Prefer the live bonus-hunt catalog (same source as Sync slots).
  // Fall back to whatever the league status embedded if BH slots failed.
  if (!slotCatalog.length) {
    applyCatalogFromPayload(status);
  }
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

  $("league-admin-season")?.addEventListener("click", () =>
    postAdmin("/api/slot-league/season/generate")
  );
  $("league-admin-season-force")?.addEventListener("click", () =>
    postAdmin("/api/slot-league/season/generate", { force: true })
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
