let currentUser = null;
let pollTimer = null;
let state = {
  title: "",
  slotName: "",
  buyIn: "",
  entryCount: 0,
  entries: [],
  slots: [],
  bracket: { generatedAt: null, entrantIds: [], matches: [] },
};

function setBanner(message, tone = "") {
  const banner = document.getElementById("st-bracket-banner");
  if (!banner) return;
  banner.textContent = message || "";
  banner.classList.toggle("is-hidden", !message);
  banner.classList.toggle("is-error", tone === "error");
  banner.classList.toggle("is-success", tone === "success");
}

function entryById(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  return state.entries.find((entry) => entry.id === key) || null;
}

function assignedSlotForEntry(entryId) {
  const id = String(entryId || "").trim();
  if (!id) return null;
  return (
    (state.slots || []).find((slot) => String(slot.entryId || "").trim() === id) ||
    null
  );
}

function entryLabel(id) {
  if (!id) return "TBD";
  return entryById(id)?.username || "Unknown";
}

function roundLabel(round, maxRound) {
  const remaining = maxRound - round;
  if (remaining === 0) return "Final";
  if (remaining === 1) return "Semifinals";
  if (remaining === 2) return "Quarterfinals";
  return `Round ${round}`;
}

function applyState(data) {
  state = {
    title: data.title || "",
    slotName: data.slotName || "",
    buyIn: data.buyIn || "",
    entryCount: Number(data.entryCount) || 0,
    entries: Array.isArray(data.entries) ? data.entries : [],
    slots: Array.isArray(data.slots) ? data.slots : [],
    bracket: data.bracket || { generatedAt: null, entrantIds: [], matches: [] },
  };
  renderAll();
}

async function refreshStatus() {
  const response = await fetch("/api/slot-tournaments/status", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load bracket.");
  }
  applyState(await response.json());
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  applyState(data);
  return data;
}

function renderHeader() {
  const title = document.getElementById("st-bracket-title");
  const meta = document.getElementById("st-bracket-meta");
  const admin = document.getElementById("st-bracket-admin");
  const isAdmin = Boolean(currentUser?.isAdmin);

  if (title) title.textContent = state.title || "Slot Tournament";

  const bits = [];
  if (state.slotName) bits.push(state.slotName);
  if (state.buyIn) bits.push(`Buy-in ${state.buyIn}`);
  bits.push(
    state.bracket?.matches?.length
      ? `${state.bracket.matches.length} matches`
      : `${state.entryCount} entrant${state.entryCount === 1 ? "" : "s"}`
  );
  if (meta) meta.textContent = bits.join(" · ");

  admin?.classList.toggle("is-hidden", !isAdmin);
}

function renderRoundColumn(round, roundMatches, maxRound, isAdmin, side) {
  const column = document.createElement("div");
  column.className = "st-bracket-round";
  if (side) column.classList.add(`is-${side}`);

  const heading = document.createElement("p");
  heading.className = "st-bracket-round-label";
  heading.textContent = roundLabel(round, maxRound);
  column.append(heading);

  const stack = document.createElement("div");
  stack.className = "st-bracket-round-stack";
  roundMatches.forEach((match) => {
    stack.append(renderMatchCard(match, isAdmin));
  });
  column.append(stack);
  return column;
}

function renderBracket() {
  const board = document.getElementById("st-bracket-board");
  const empty = document.getElementById("st-bracket-empty");
  if (!board || !empty) return;

  const matches = Array.isArray(state.bracket?.matches) ? state.bracket.matches : [];
  const isAdmin = Boolean(currentUser?.isAdmin);

  if (!matches.length) {
    empty.classList.remove("is-hidden");
    board.classList.add("is-hidden");
    empty.textContent = isAdmin
      ? state.entryCount >= 2
        ? "No bracket yet. Click Generate bracket to seed from signups."
        : "Need at least 2 signups before generating a bracket."
      : "Bracket appears here once an admin generates it.";
    board.replaceChildren();
    return;
  }

  empty.classList.add("is-hidden");
  board.classList.remove("is-hidden");
  board.replaceChildren();

  const maxRound = matches.reduce((max, match) => Math.max(max, match.round), 1);
  const active = document.activeElement;
  const activeMatchId = active?.closest?.("[data-match-id]")?.getAttribute("data-match-id");
  const activeEntryId = active?.dataset?.entryId || null;
  const roundOneMatches = matches
    .filter((match) => match.round === 1)
    .sort((a, b) => a.index - b.index);

  // Split bracket when there are enough round-1 matches for left/right wings.
  if (roundOneMatches.length >= 2 && maxRound >= 2) {
    board.classList.add("is-split");

    const leftWing = document.createElement("div");
    leftWing.className = "st-bracket-wing is-left";
    const center = document.createElement("div");
    center.className = "st-bracket-center";
    const rightWing = document.createElement("div");
    rightWing.className = "st-bracket-wing is-right";

    for (let round = 1; round < maxRound; round += 1) {
      const roundMatches = matches
        .filter((match) => match.round === round)
        .sort((a, b) => a.index - b.index);
      const mid = Math.ceil(roundMatches.length / 2);
      leftWing.append(
        renderRoundColumn(round, roundMatches.slice(0, mid), maxRound, isAdmin, "left")
      );
      rightWing.append(
        renderRoundColumn(round, roundMatches.slice(mid), maxRound, isAdmin, "right")
      );
    }

    const finals = matches
      .filter((match) => match.round === maxRound)
      .sort((a, b) => a.index - b.index);
    center.append(renderRoundColumn(maxRound, finals, maxRound, isAdmin, "center"));

    board.append(leftWing, center, rightWing);
  } else {
    board.classList.remove("is-split");
    for (let round = 1; round <= maxRound; round += 1) {
      const roundMatches = matches
        .filter((match) => match.round === round)
        .sort((a, b) => a.index - b.index);
      board.append(renderRoundColumn(round, roundMatches, maxRound, isAdmin));
    }
  }

  if (activeMatchId && activeEntryId && isAdmin) {
    const next = board.querySelector(
      `[data-match-id="${activeMatchId}"] [data-entry-id="${activeEntryId}"]`
    );
    next?.focus();
  }
}

function renderMatchCard(match, isAdmin) {
  const card = document.createElement("article");
  card.className = "st-bracket-match bj21-panel theme-surface";
  card.dataset.matchId = match.id;
  if (match.winnerEntryId) {
    card.classList.add("is-decided");
  }

  const glow = document.createElement("span");
  glow.className = "bj21-panel-glow";
  glow.setAttribute("aria-hidden", "true");
  card.append(glow);

  const label = document.createElement("p");
  label.className = "slot-tournaments-panel-label";
  label.textContent = `Match ${match.index + 1}`;
  card.append(label);

  card.append(renderPlayerRow(match, "A", isAdmin));
  card.append(renderPlayerRow(match, "B", isAdmin));

  const canPick = Boolean(match.entryAId && match.entryBId);
  if (!canPick) {
    const note = document.createElement("p");
    note.className = "st-bracket-match-note";
    if (match.round === 1 && (match.entryAId || match.entryBId) && !(match.entryAId && match.entryBId)) {
      note.textContent = "Bye — auto advance";
    } else if (isAdmin) {
      note.textContent = "Waiting for players";
    } else {
      note.textContent = "Waiting for players";
    }
    card.append(note);
  } else if (isAdmin && !match.winnerEntryId) {
    const note = document.createElement("p");
    note.className = "st-bracket-match-note";
    note.textContent = "Click a player to advance";
    card.append(note);
  }

  return card;
}

function renderPlayerRow(match, side, isAdmin) {
  const entryId = side === "A" ? match.entryAId : match.entryBId;
  const assigned = assignedSlotForEntry(entryId);
  const canPick = Boolean(isAdmin && match.entryAId && match.entryBId && entryId);
  const row = document.createElement(canPick ? "button" : "div");
  row.className = "st-bracket-player";
  if (canPick) {
    row.type = "button";
    row.classList.add("is-pickable");
    row.dataset.matchId = match.id;
    row.dataset.entryId = entryId;
  }
  if (match.winnerEntryId && entryId && match.winnerEntryId === entryId) {
    row.classList.add("is-winner");
  }

  const copy = document.createElement("div");
  copy.className = "st-bracket-player-copy";

  if (entryId && assigned?.name) {
    const slot = document.createElement("span");
    slot.className = "st-bracket-player-name";
    slot.textContent = assigned.name;
    slot.title = assigned.name;

    const user = document.createElement("span");
    user.className = "st-bracket-player-user";
    user.textContent = entryLabel(entryId);

    copy.append(slot, user);
  } else {
    const name = document.createElement("span");
    name.className = "st-bracket-player-name";
    name.textContent = entryId
      ? entryLabel(entryId)
      : side === "A" || side === "B"
        ? "Bye / TBD"
        : "TBD";
    if (!entryId) name.classList.add("is-empty");
    copy.append(name);
  }

  row.append(copy);
  return row;
}

function renderAll() {
  renderHeader();
  renderBracket();
}

function initAdmin() {
  document.getElementById("st-bracket-generate")?.addEventListener("click", async () => {
    setBanner("Generating bracket...");
    try {
      await postJson("/api/slot-tournaments/bracket/generate", { force: false });
      setBanner("Bracket generated.", "success");
    } catch (error) {
      if (/already has scores/i.test(error.message || "")) {
        const ok = window.confirm(
          "Bracket already has results. Regenerate anyway and wipe them?"
        );
        if (!ok) {
          setBanner("");
          return;
        }
        try {
          await postJson("/api/slot-tournaments/bracket/generate", { force: true });
          setBanner("Bracket regenerated.", "success");
          return;
        } catch (forceError) {
          setBanner(forceError.message || "Could not regenerate.", "error");
          return;
        }
      }
      setBanner(error.message || "Could not generate bracket.", "error");
    }
  });

  document.getElementById("st-bracket-reset")?.addEventListener("click", async () => {
    const ok = window.confirm("Clear the entire bracket?");
    if (!ok) return;
    setBanner("Clearing bracket...");
    try {
      await postJson("/api/slot-tournaments/bracket/clear", {});
      setBanner("Bracket cleared.", "success");
    } catch (error) {
      setBanner(error.message || "Could not clear bracket.", "error");
    }
  });

  document.getElementById("st-bracket-board")?.addEventListener("click", async (event) => {
    const pick = event.target.closest(".st-bracket-player.is-pickable");
    if (!pick) return;
    const matchId = pick.dataset.matchId;
    const winnerEntryId = pick.dataset.entryId;
    const match = (state.bracket?.matches || []).find((entry) => entry.id === matchId);
    if (!match || !winnerEntryId) return;

    const scoreA = winnerEntryId === match.entryAId ? "1" : "0";
    const scoreB = winnerEntryId === match.entryBId ? "1" : "0";

    setBanner("Advancing winner...");
    try {
      await postJson("/api/slot-tournaments/bracket/score", {
        matchId,
        scoreA,
        scoreB,
      });
      setBanner("Winner advanced.", "success");
    } catch (error) {
      setBanner(error.message || "Could not advance winner.", "error");
    }
  });
}

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    refreshStatus().catch(() => {});
  }, 5000);
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  try {
    await refreshStatus();
  } catch (error) {
    setBanner(error.message || "Could not load bracket.", "error");
  }
});

initAdmin();
refreshStatus()
  .then(() => startPolling())
  .catch((error) => {
    setBanner(error.message || "Could not load bracket.", "error");
    startPolling();
  });
