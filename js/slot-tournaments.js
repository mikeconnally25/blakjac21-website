let currentUser = null;
let pollTimer = null;
let slotCatalog = [];
let slotGroups = [];
let assignSaveTimer = null;
let assignDirty = false;
let pickerOpen = false;
let pickerFilter = "";
let claimPickerOpen = false;
let claimPickerFilter = "";
let claimBusy = false;
let predictionDraft = {};
let predictionDirty = false;
let state = {
  open: false,
  phase: "closed",
  title: "",
  slotName: "",
  buyIn: "",
  capacity: 0,
  spotsLeft: 0,
  affiliatesOnly: false,
  subscribersOnly: false,
  entryCount: 0,
  entries: [],
  slots: [],
  bracket: { generatedAt: null, entrantIds: [], matches: [] },
  results: [],
  predictionsOpen: false,
  viewerPrediction: null,
  predictionLeaderboard: [],
  predictionCount: 0,
  viewerEntered: false,
  viewerEntryId: null,
};

function setBanner(message, tone = "") {
  const banner = document.getElementById("st-banner");
  if (!banner) return;
  banner.textContent = message || "";
  banner.classList.toggle("is-hidden", !message);
  banner.classList.toggle("is-error", tone === "error");
  banner.classList.toggle("is-success", tone === "success");
}

function setAdminStatus(message, tone = "") {
  const status = document.getElementById("st-admin-status");
  if (!status) {
    setBanner(message, tone);
    return;
  }
  status.textContent = message || "";
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
}

function setAssignStatus(message, tone = "") {
  const status = document.getElementById("st-assign-status");
  if (!status) {
    setAdminStatus(message, tone);
    return;
  }
  status.textContent = message || "";
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
}

function phaseLabel(phase, open) {
  if (open || phase === "signup") return "Signups open";
  if (phase === "live") return "Live";
  if (phase === "results") return "Results";
  return "Closed";
}

function newSlotId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `slot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slotInitials(name) {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "?"
  );
}

function avatarColor(name) {
  let hash = 0;
  for (const char of String(name || "")) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 42%)`;
}

function normalizeSlotThumbnailUrl(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  const base = normalized.split("?")[0];
  return `${base}?w=150&h=200&fit=min&auto=format`;
}

function createSlotThumb(slotName, thumbnailUrl) {
  const thumb = document.createElement("div");
  thumb.className = "st-slot-thumb";
  const imageUrl = normalizeSlotThumbnailUrl(thumbnailUrl);

  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "st-slot-thumb-image";
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.remove();
      thumb.textContent = slotInitials(slotName);
      thumb.classList.add("is-fallback");
      thumb.style.background = avatarColor(slotName);
    });
    thumb.append(image);
  } else {
    thumb.textContent = slotInitials(slotName);
    thumb.classList.add("is-fallback");
    thumb.style.background = avatarColor(slotName);
  }

  return thumb;
}

function findCatalogSlotBySlug(slug) {
  const needle = String(slug || "").trim().toLowerCase();
  if (!needle) return null;
  return slotCatalog.find((slot) => String(slot.slug || "").toLowerCase() === needle) || null;
}

function findCatalogSlot(nameOrSlot) {
  if (nameOrSlot && typeof nameOrSlot === "object") {
    return (
      findCatalogSlotBySlug(nameOrSlot.slug) ||
      findCatalogSlot(nameOrSlot.name || nameOrSlot.slotName || "")
    );
  }
  const needle = String(nameOrSlot || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    slotCatalog.find((slot) => String(slot.name || "").toLowerCase() === needle) ||
    null
  );
}

const CLAIM_SLOT_GROUPS = [
  { slug: "new-releases", label: "New Releases" },
  { slug: "only-on-stake", label: "Only on Stake" },
];

function slotBelongsToGroup(slot, groupSlug) {
  if (!slot || !groupSlug) return false;
  if (String(slot.groupSlug || "") === groupSlug) return true;
  return (
    Array.isArray(slot.groupSlugs) && slot.groupSlugs.includes(groupSlug)
  );
}

function getPickerGroups() {
  const allowed = new Set(CLAIM_SLOT_GROUPS.map((group) => group.slug));
  const fromCatalog = (slotGroups || []).filter((group) =>
    allowed.has(String(group.slug || ""))
  );
  return fromCatalog.length ? fromCatalog : CLAIM_SLOT_GROUPS;
}

function catalogSlotsForGroup(group, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  return slotCatalog
    .filter((slot) => slotBelongsToGroup(slot, group.slug))
    .filter((slot) => {
      if (!needle) return true;
      const haystack = [slot.name, slot.provider, group.label]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        sensitivity: "base",
      })
    );
}

function assignedSlotForEntry(entryId) {
  const id = String(entryId || "").trim();
  if (!id) return null;
  return state.slots.find((slot) => slot.entryId === id) || null;
}

function viewerNeedsSlot() {
  if (!state.viewerEntered || !state.viewerEntryId) return false;
  return !assignedSlotForEntry(state.viewerEntryId);
}

function canOpenClaimPicker() {
  if (!state.open || !currentUser?.kickUserId) return false;
  if (viewerNeedsSlot()) return true;
  return !state.viewerEntered && state.spotsLeft > 0;
}

function slotTakenByEntrant(catalogSlot, exceptEntryId = null) {
  const except = String(exceptEntryId || "").trim();
  const nextSlug = String(catalogSlot?.slug || "")
    .trim()
    .toLowerCase();
  const nextName = String(catalogSlot?.name || "")
    .trim()
    .toLowerCase();
  if (!nextSlug && !nextName) return false;

  return state.slots.some((existing) => {
    const owner = String(existing.entryId || "").trim();
    if (!owner || (except && owner === except)) return false;
    const existingSlug = String(existing.slug || "")
      .trim()
      .toLowerCase();
    if (existingSlug && nextSlug && existingSlug === nextSlug) return true;
    return (
      String(existing.name || "")
        .trim()
        .toLowerCase() === nextName
    );
  });
}

function entryById(entryId) {
  const id = String(entryId || "").trim();
  if (!id) return null;
  return state.entries.find((entry) => entry.id === id) || null;
}

function entryLabel(entryId) {
  return entryById(entryId)?.username || "Unknown";
}

function predictionRoundLabel(round, maxRound) {
  if (round === maxRound) return "Final";
  if (maxRound > 1 && round === maxRound - 1) return "Semis";
  return `Round ${round}`;
}

function getBracketMatches() {
  return Array.isArray(state.bracket?.matches) ? state.bracket.matches : [];
}

function resolvePredictedSides(match, picks = predictionDraft) {
  let entryAId = match.entryAId || null;
  let entryBId = match.entryBId || null;

  if (match.round > 1) {
    const matches = getBracketMatches();
    const feederA = matches.find(
      (entry) => entry.round === match.round - 1 && entry.index === match.index * 2
    );
    const feederB = matches.find(
      (entry) =>
        entry.round === match.round - 1 && entry.index === match.index * 2 + 1
    );
    if (!entryAId && feederA) {
      entryAId = picks[feederA.id] || feederA.winnerEntryId || null;
    }
    if (!entryBId && feederB) {
      entryBId = picks[feederB.id] || feederB.winnerEntryId || null;
    }
  }

  return { entryAId, entryBId };
}

function pruneInvalidPredictionPicks(picks) {
  const matches = [...getBracketMatches()].sort(
    (a, b) => a.round - b.round || a.index - b.index
  );
  const next = { ...picks };

  for (const match of matches) {
    const { entryAId, entryBId } = resolvePredictedSides(match, next);
    if (entryAId && !entryBId) {
      next[match.id] = entryAId;
      continue;
    }
    if (!entryAId && entryBId) {
      next[match.id] = entryBId;
      continue;
    }
    const pick = next[match.id];
    if (pick && pick !== entryAId && pick !== entryBId) {
      delete next[match.id];
    }
  }

  return next;
}

function setPredictionStatus(message, tone = "") {
  const status = document.getElementById("st-predictions-banner");
  const modalStatus = document.getElementById("st-predict-modal-status");
  if (status) {
    status.textContent = message || "";
    status.classList.toggle("is-hidden", !message);
    status.classList.toggle("is-error", tone === "error");
    status.classList.toggle("is-success", tone === "success");
  }
  if (modalStatus) {
    modalStatus.textContent = message || "";
    modalStatus.classList.toggle("is-error", tone === "error");
    modalStatus.classList.toggle("is-success", tone === "success");
  }
  if (!status && message) {
    setBanner(message, tone);
  }
}

function renderPredictions() {
  const status = document.getElementById("st-predictions-status");
  const toggle = document.getElementById("st-predictions-toggle");
  const openBtn = document.getElementById("st-predict-open");
  const guest = document.getElementById("st-predictions-guest");
  const saveBtn = document.getElementById("st-predictions-save");
  const isAdmin = Boolean(currentUser?.isAdmin);
  const signedIn = Boolean(currentUser?.kickUserId);
  const matches = getBracketMatches();
  const hasBracket = matches.length > 0;
  const modalOpen = Boolean(
    document.getElementById("st-predict-modal") &&
      !document.getElementById("st-predict-modal").classList.contains("is-hidden")
  );

  if (status) {
    if (!hasBracket) {
      status.textContent = "Generate a bracket before predictions.";
    } else if (state.predictionsOpen) {
      status.textContent = isAdmin
        ? `Predictions open${
            state.predictionCount ? ` · ${state.predictionCount} sheets` : ""
          }`
        : "Predictions open — tap Predict to fill out the bracket.";
    } else {
      status.textContent = "Predictions closed";
    }
  }

  if (toggle) {
    toggle.classList.toggle("is-hidden", !isAdmin);
    toggle.textContent = state.predictionsOpen
      ? "Close predictions"
      : "Enable predictions";
    toggle.disabled = !hasBracket && !state.predictionsOpen;
  }

  const showPredict =
    hasBracket && signedIn && (state.predictionsOpen || state.viewerPrediction);
  openBtn?.classList.toggle("is-hidden", !showPredict);
  if (openBtn) {
    openBtn.textContent = state.predictionsOpen ? "Predict" : "View picks";
  }

  guest?.classList.toggle(
    "is-hidden",
    !hasBracket || signedIn || !state.predictionsOpen
  );

  if (saveBtn) {
    saveBtn.classList.toggle("is-hidden", !state.predictionsOpen || !signedIn);
    saveBtn.disabled = !state.predictionsOpen;
  }

  if (modalOpen) {
    renderPredictBracket();
  }
}

function openPredictModal() {
  const modal = document.getElementById("st-predict-modal");
  if (!modal) return;
  modal.hidden = false;
  modal.classList.remove("is-hidden");
  document.body.classList.add("st-predict-modal-open");
  const hint = document.getElementById("st-predict-modal-hint");
  if (hint) {
    hint.textContent = state.predictionsOpen
      ? "Tap a player in each matchup to choose a winner. Later rounds fill from your earlier picks."
      : "Predictions are closed — viewing your saved picks.";
  }
  renderPredictBracket();
}

function closePredictModal() {
  const modal = document.getElementById("st-predict-modal");
  if (!modal) return;
  modal.classList.add("is-hidden");
  modal.hidden = true;
  if (!claimPickerOpen) {
    document.body.classList.remove("st-predict-modal-open");
  }
}

function renderPredictPlayerRow(match, side, entryId, canEdit) {
  const assigned = assignedSlotForEntry(entryId);
  const canPick = Boolean(canEdit && entryId);
  const row = document.createElement(canPick ? "button" : "div");
  row.className = "st-bracket-player";
  if (canPick) {
    row.type = "button";
    row.classList.add("is-pickable");
    row.dataset.matchId = match.id;
    row.dataset.entryId = entryId;
  }
  if (entryId && predictionDraft[match.id] === entryId) {
    row.classList.add("is-predicted");
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
    name.textContent = entryId ? entryLabel(entryId) : "TBD";
    if (!entryId) name.classList.add("is-empty");
    copy.append(name);
  }

  row.append(copy);
  return row;
}

function renderPredictMatchCard(match, canEdit) {
  const { entryAId, entryBId } = resolvePredictedSides(match, predictionDraft);
  const card = document.createElement("article");
  card.className = "st-bracket-match bj21-panel theme-surface";
  card.dataset.matchId = match.id;
  if (predictionDraft[match.id]) {
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

  card.append(renderPredictPlayerRow(match, "A", entryAId, canEdit && entryAId && entryBId));
  card.append(renderPredictPlayerRow(match, "B", entryBId, canEdit && entryAId && entryBId));

  const note = document.createElement("p");
  note.className = "st-bracket-match-note";
  if (entryAId && !entryBId) {
    note.textContent = "Bye — auto advance";
  } else if (!entryAId && entryBId) {
    note.textContent = "Bye — auto advance";
  } else if (!entryAId || !entryBId) {
    note.textContent = "Pick earlier rounds first";
  } else if (canEdit) {
    note.textContent = "Tap a player to pick";
  } else {
    note.textContent = predictionDraft[match.id] ? "Your pick" : "No pick yet";
  }
  card.append(note);

  return card;
}

function renderPredictRoundColumn(round, roundMatches, maxRound, canEdit, side) {
  const column = document.createElement("div");
  column.className = "st-bracket-round";
  if (side) column.classList.add(`is-${side}`);

  const heading = document.createElement("p");
  heading.className = "st-bracket-round-label";
  heading.textContent = predictionRoundLabel(round, maxRound);
  column.append(heading);

  const stack = document.createElement("div");
  stack.className = "st-bracket-round-stack";
  roundMatches.forEach((match) => {
    stack.append(renderPredictMatchCard(match, canEdit));
  });
  column.append(stack);
  return column;
}

function renderPredictBracket() {
  const board = document.getElementById("st-predict-bracket");
  const empty = document.getElementById("st-predict-empty");
  if (!board || !empty) return;

  const matches = getBracketMatches();
  const canEdit = Boolean(state.predictionsOpen && currentUser?.kickUserId);

  if (!matches.length) {
    empty.classList.remove("is-hidden");
    board.classList.add("is-hidden");
    board.replaceChildren();
    return;
  }

  empty.classList.add("is-hidden");
  board.classList.remove("is-hidden");
  board.replaceChildren();

  const maxRound = matches.reduce((max, match) => Math.max(max, match.round || 1), 1);
  const useSplit = maxRound >= 2 && matches.filter((match) => match.round === 1).length >= 4;

  if (useSplit) {
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
        renderPredictRoundColumn(
          round,
          roundMatches.slice(0, mid),
          maxRound,
          canEdit,
          "left"
        )
      );
      rightWing.append(
        renderPredictRoundColumn(
          round,
          roundMatches.slice(mid),
          maxRound,
          canEdit,
          "right"
        )
      );
    }

    const finals = matches
      .filter((match) => match.round === maxRound)
      .sort((a, b) => a.index - b.index);
    center.append(
      renderPredictRoundColumn(maxRound, finals, maxRound, canEdit, "center")
    );
    board.append(leftWing, center, rightWing);
  } else {
    board.classList.remove("is-split");
    for (let round = 1; round <= maxRound; round += 1) {
      const roundMatches = matches
        .filter((match) => match.round === round)
        .sort((a, b) => a.index - b.index);
      board.append(
        renderPredictRoundColumn(round, roundMatches, maxRound, canEdit)
      );
    }
  }
}

function initPredictions() {
  document.getElementById("st-predictions-toggle")?.addEventListener(
    "click",
    async () => {
      const nextOpen = !state.predictionsOpen;
      setPredictionStatus(
        nextOpen ? "Enabling predictions..." : "Closing predictions..."
      );
      try {
        await postJson("/api/slot-tournaments/predictions/toggle", {
          open: nextOpen,
        });
        setPredictionStatus(
          nextOpen ? "Predictions enabled." : "Predictions closed.",
          "success"
        );
      } catch (error) {
        setPredictionStatus(
          error.message || "Could not update predictions.",
          "error"
        );
      }
    }
  );

  document.getElementById("st-predict-open")?.addEventListener("click", () => {
    openPredictModal();
  });

  document.getElementById("st-predict-modal")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-st-predict-close]")) {
      closePredictModal();
      return;
    }

    const pick = event.target.closest(".st-bracket-player.is-pickable");
    if (!pick || !state.predictionsOpen) return;
    const matchId = pick.dataset.matchId;
    const entryId = pick.dataset.entryId;
    if (!matchId || !entryId) return;

    predictionDraft = pruneInvalidPredictionPicks({
      ...predictionDraft,
      [matchId]: entryId,
    });
    predictionDirty = true;
    renderPredictBracket();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = document.getElementById("st-predict-modal");
    if (!modal || modal.classList.contains("is-hidden")) return;
    closePredictModal();
  });

  document.getElementById("st-predictions-save")?.addEventListener(
    "click",
    async () => {
      setPredictionStatus("Saving picks...");
      try {
        const picks = pruneInvalidPredictionPicks(predictionDraft);
        predictionDraft = picks;
        await postJson("/api/slot-tournaments/predictions/save", { picks });
        predictionDirty = false;
        setPredictionStatus("Picks saved.", "success");
      } catch (error) {
        setPredictionStatus(error.message || "Could not save picks.", "error");
      }
    }
  );
}

function resolveSlotThumbnail(slot) {
  return (
    normalizeSlotThumbnailUrl(slot?.thumbnailUrl) ||
    normalizeSlotThumbnailUrl(findCatalogSlot(slot)?.thumbnailUrl)
  );
}

function applyState(data) {
  if (assignDirty) {
    state = {
      ...state,
      open: Boolean(data.open),
      phase: data.phase || "closed",
      title: data.title || "",
      slotName: data.slotName || "",
      buyIn: data.buyIn || "",
      capacity: Number(data.capacity) || 0,
      spotsLeft: Number(data.spotsLeft) || 0,
      affiliatesOnly: Boolean(data.affiliatesOnly),
      subscribersOnly: Boolean(data.subscribersOnly),
      entryCount: Number(data.entryCount) || 0,
      entries: Array.isArray(data.entries) ? data.entries : [],
      bracket: data.bracket || state.bracket,
      results: Array.isArray(data.results) ? data.results : [],
      predictionsOpen: Boolean(data.predictionsOpen),
      viewerPrediction: data.viewerPrediction || null,
      predictionLeaderboard: Array.isArray(data.predictionLeaderboard)
        ? data.predictionLeaderboard
        : [],
      predictionCount: Number(data.predictionCount) || 0,
      viewerEntered: Boolean(data.viewerEntered),
      viewerEntryId: data.viewerEntryId || null,
    };
    if (!predictionDirty) {
      predictionDraft = pruneInvalidPredictionPicks({
        ...(state.viewerPrediction?.picks || {}),
      });
    }
    renderStatus();
    renderInfo();
    renderEntries();
    renderPredictionLeaderboard();
    renderResults();
    renderPredictions();
    renderAdminForm();
    return;
  }

  state = {
    open: Boolean(data.open),
    phase: data.phase || "closed",
    title: data.title || "",
    slotName: data.slotName || "",
    buyIn: data.buyIn || "",
    capacity: Number(data.capacity) || 0,
    spotsLeft: Number(data.spotsLeft) || 0,
    affiliatesOnly: Boolean(data.affiliatesOnly),
    subscribersOnly: Boolean(data.subscribersOnly),
    entryCount: Number(data.entryCount) || 0,
    entries: Array.isArray(data.entries) ? data.entries : [],
    slots: Array.isArray(data.slots) ? data.slots : [],
    bracket: data.bracket || { generatedAt: null, entrantIds: [], matches: [] },
    results: Array.isArray(data.results) ? data.results : [],
    predictionsOpen: Boolean(data.predictionsOpen),
    viewerPrediction: data.viewerPrediction || null,
    predictionLeaderboard: Array.isArray(data.predictionLeaderboard)
      ? data.predictionLeaderboard
      : [],
    predictionCount: Number(data.predictionCount) || 0,
    viewerEntered: Boolean(data.viewerEntered),
    viewerEntryId: data.viewerEntryId || null,
  };
  if (!predictionDirty) {
    predictionDraft = pruneInvalidPredictionPicks({
      ...(state.viewerPrediction?.picks || {}),
    });
  }
  renderAll();
}

function renderStatus() {
  const card = document.getElementById("st-status-card");
  const value = document.getElementById("st-status-value");
  const meta = document.getElementById("st-status-meta");
  const toggleWrap = document.getElementById("st-status-toggle-wrap");
  const toggle = document.getElementById("st-status-toggle");
  const isAdmin = Boolean(currentUser?.isAdmin);
  const phase = state.open ? "signup" : state.phase;
  card?.setAttribute("data-phase", phase);
  if (value) value.textContent = phaseLabel(state.phase, state.open);

  const bits = [];
  if (state.title) bits.push(state.title);
  if (state.slotName) bits.push(state.slotName);
  if (state.buyIn) bits.push(`Buy-in ${state.buyIn}`);
  if (meta) {
    meta.textContent = bits.length
      ? bits.join(" · ")
      : state.open
        ? "Signups are open."
        : "No active tournament.";
  }

  toggleWrap?.classList.toggle("is-hidden", !isAdmin);
  if (toggle && document.activeElement !== toggle) {
    toggle.checked = Boolean(state.open);
    toggle.disabled = false;
  }
}

async function toggleSignups(nextOpen) {
  const toggle = document.getElementById("st-status-toggle");
  if (toggle) toggle.disabled = true;
  setAdminStatus(nextOpen ? "Opening signups..." : "Closing signups...");
  setBanner(nextOpen ? "Opening signups..." : "Closing signups...");
  try {
    await postJson("/api/slot-tournaments/toggle", { open: nextOpen });
    setAdminStatus(
      state.open ? "Signups open." : "Signups closed.",
      "success"
    );
    setBanner(state.open ? "Signups open." : "Signups closed.", "success");
  } catch (error) {
    if (toggle) toggle.checked = Boolean(state.open);
    setAdminStatus(error.message || "Could not toggle signups.", "error");
    setBanner(error.message || "Could not toggle signups.", "error");
  } finally {
    if (toggle) toggle.disabled = false;
  }
}

function renderInfo() {
  const title = document.getElementById("st-title");
  const slot = document.getElementById("st-slot");
  const buyin = document.getElementById("st-buyin");
  const count = document.getElementById("st-entry-count");
  const hint = document.getElementById("st-join-hint");
  const joinBtn = document.getElementById("st-join-btn");
  const signInBtn = document.getElementById("st-signin-btn");
  const spotsDisplay = document.getElementById("st-spots-display");
  const viewBracket = document.getElementById("st-view-bracket");

  if (title) title.textContent = state.title || "—";
  if (slot) slot.textContent = state.slotName || "—";
  if (buyin) buyin.textContent = state.buyIn || "—";
  if (count) {
    count.textContent = state.capacity
      ? `${state.entryCount} / ${state.capacity}`
      : String(state.entryCount);
  }

  if (spotsDisplay) {
    if (state.capacity) {
      spotsDisplay.textContent = state.open
        ? `${state.spotsLeft} spot${state.spotsLeft === 1 ? "" : "s"} left`
        : `Capacity ${state.capacity}`;
    } else {
      spotsDisplay.textContent = "";
    }
  }

  viewBracket?.classList.toggle("is-hidden", state.entryCount < 2);

  const botsPanel = document.getElementById("st-bots");
  const botsFill = document.getElementById("st-bots-fill");
  const botsCount = document.getElementById("st-bots-count");
  const isAdmin = Boolean(currentUser?.isAdmin);
  botsPanel?.classList.toggle("is-hidden", !isAdmin);
  if (botsFill) {
    const canFill = Boolean(state.capacity) && state.spotsLeft > 0;
    botsFill.classList.toggle("is-hidden", !canFill);
    botsFill.textContent = canFill
      ? `Fill remaining (${state.spotsLeft})`
      : "Fill remaining";
  }
  if (botsCount && document.activeElement !== botsCount) {
    const max = state.capacity ? Math.max(1, state.spotsLeft || 1) : 100;
    botsCount.max = String(Math.min(100, max));
    if (Number(botsCount.value) > Number(botsCount.max)) {
      botsCount.value = botsCount.max;
    }
  }

  if (hint) {
    if (state.open) {
      if (state.viewerEntered && !viewerNeedsSlot()) {
        hint.textContent = "You're in. Good luck.";
      } else if (viewerNeedsSlot()) {
        hint.textContent = "Pick a slot to finish claiming your spot.";
      } else if (!currentUser?.kickUserId) {
        hint.textContent = "Sign in with Kick to claim a spot.";
      } else if (state.spotsLeft <= 0) {
        hint.textContent = "Tournament is full.";
      } else {
        hint.textContent = "Pick a slot to claim your spot.";
      }
    } else if (state.phase === "live") {
      hint.textContent = "Signups closed. Tournament is live.";
    } else if (state.phase === "results") {
      hint.textContent = "Tournament complete — see results below.";
    } else {
      hint.textContent =
        "When signups open, sign in with Kick and claim a spot on this page.";
    }
  }

  const needsSlot = viewerNeedsSlot();
  const canJoin = canOpenClaimPicker();
  const needsSignIn = state.open && !currentUser?.kickUserId;
  const showClaimed =
    state.viewerEntered && !needsSlot && Boolean(currentUser?.kickUserId);

  joinBtn?.classList.toggle("is-hidden", !canJoin && !showClaimed);
  if (joinBtn) {
    joinBtn.disabled = !canJoin || claimBusy;
    if (needsSlot) {
      joinBtn.textContent = "Pick slot";
    } else if (showClaimed) {
      joinBtn.textContent = "Spot claimed";
    } else {
      joinBtn.textContent = "Claim spot";
    }
  }

  signInBtn?.classList.toggle("is-hidden", !needsSignIn);

  if (canJoin && !slotCatalog.length) {
    loadSlotCatalog().catch(() => {});
  }
  if (claimPickerOpen) {
    renderClaimSlotPickerOptions();
  }
}

function renderEntries() {
  const list = document.getElementById("st-entries");
  const empty = document.getElementById("st-entries-empty");
  if (!list || !empty) return;

  list.replaceChildren();
  if (!state.entries.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  state.entries.forEach((entry, index) => {
    const row = document.createElement("li");
    row.className = "slot-tournaments-entry";

    const place = document.createElement("span");
    place.className = "slot-tournaments-entry-index";
    place.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("div");
    copy.className = "slot-tournaments-entry-copy";

    const assigned = assignedSlotForEntry(entry.id);

    if (assigned?.name) {
      const slotRow = document.createElement("span");
      slotRow.className = "slot-tournaments-entry-slot-row is-primary";
      slotRow.append(createSlotThumb(assigned.name, resolveSlotThumbnail(assigned)));
      const slot = document.createElement("span");
      slot.className = "slot-tournaments-entry-name";
      slot.textContent = assigned.name;
      slotRow.append(slot);
      copy.append(slotRow);

      const userRow = document.createElement("span");
      userRow.className = "slot-tournaments-entry-user-row";
      const name = document.createElement("span");
      name.className = "slot-tournaments-entry-slot";
      name.textContent = entry.username;
      userRow.append(name);
      if (entry.isBot) {
        const badge = document.createElement("span");
        badge.className = "slot-tournaments-entry-bot";
        badge.textContent = "Bot";
        userRow.append(badge);
      }
      copy.append(userRow);
    } else {
      const name = document.createElement("span");
      name.className = "slot-tournaments-entry-name";
      name.textContent = entry.username;
      copy.append(name);

      if (entry.isBot) {
        const badge = document.createElement("span");
        badge.className = "slot-tournaments-entry-bot";
        badge.textContent = "Bot";
        copy.append(badge);
      }
    }

    row.append(place, copy);
    list.append(row);
  });
}

function formatPredictionRoundBreakdown(correctByRound) {
  const rounds = Object.keys(correctByRound || {})
    .map((key) => Number(key))
    .filter((round) => Number.isFinite(round) && round > 0)
    .sort((a, b) => a - b);
  if (!rounds.length) return "No correct picks yet";
  return rounds
    .map((round) => `R${round}: ${correctByRound[round]}`)
    .join(" · ");
}

function renderPredictionLeaderboard() {
  const list = document.getElementById("st-prediction-board");
  const empty = document.getElementById("st-prediction-board-empty");
  const meta = document.getElementById("st-prediction-board-meta");
  if (!list || !empty) return;

  const rows = Array.isArray(state.predictionLeaderboard)
    ? state.predictionLeaderboard
    : [];
  const decidedCount = getBracketMatches().filter(
    (match) => match.winnerEntryId
  ).length;

  if (meta) {
    const sheetNote = rows.length
      ? `${rows.length} predictor${rows.length === 1 ? "" : "s"}`
      : "No sheets yet";
    const scoreNote = decidedCount
      ? `${decidedCount} match${decidedCount === 1 ? "" : "es"} scored`
      : "scores update as winners are set";
    meta.textContent = `R1 = 1 pt · R2 = 2 pts · R3 = 3 pts · ${sheetNote} · ${scoreNote}`;
  }

  list.replaceChildren();
  if (!rows.length) {
    empty.classList.remove("is-hidden");
    empty.textContent = "No prediction sheets yet.";
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  rows.forEach((row, index) => {
    const item = document.createElement("li");
    item.className = "st-prediction-board-row";
    if (index < 3) item.classList.add(`is-top-${index + 1}`);

    const place = document.createElement("span");
    place.className = "st-prediction-board-place";
    place.textContent = String(index + 1);

    const copy = document.createElement("div");
    copy.className = "st-prediction-board-copy";

    const name = document.createElement("p");
    name.className = "st-prediction-board-name";
    name.textContent = row.username || "viewer";

    const detail = document.createElement("p");
    detail.className = "st-prediction-board-detail";
    detail.textContent = formatPredictionRoundBreakdown(row.correctByRound);

    copy.append(name, detail);

    const points = document.createElement("span");
    points.className = "st-prediction-board-points";
    points.textContent = `${Number(row.points) || 0} pts`;

    item.append(place, copy, points);
    list.append(item);
  });
}

function renderResults() {
  const list = document.getElementById("st-results");
  const empty = document.getElementById("st-results-empty");
  if (!list || !empty) return;

  list.replaceChildren();
  if (!state.results.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  state.results.forEach((entry) => {
    const row = document.createElement("li");
    row.className = "slot-tournaments-result";

    const place = document.createElement("span");
    place.className = "slot-tournaments-result-place";
    place.textContent = `#${entry.place}`;

    const copy = document.createElement("div");
    copy.className = "slot-tournaments-result-copy";

    const name = document.createElement("p");
    name.className = "slot-tournaments-result-name";
    name.textContent = entry.username;

    const meta = document.createElement("p");
    meta.className = "slot-tournaments-result-meta";
    meta.textContent = [entry.score, entry.note].filter(Boolean).join(" · ");

    copy.append(name);
    if (meta.textContent) copy.append(meta);
    row.append(place, copy);
    list.append(row);
  });
}

function renderAssignPanel() {
  const panel = document.getElementById("st-assign");
  const isAdmin = Boolean(currentUser?.isAdmin);
  panel?.classList.toggle("is-hidden", !isAdmin);
  if (!isAdmin) return;

  if (!slotCatalog.length) {
    loadSlotCatalog().catch(() => {});
  }

  const list = document.getElementById("st-assign-list");
  const empty = document.getElementById("st-assign-empty");
  if (!list || !empty) return;

  const active = document.activeElement;
  const activeSlotId = active?.closest?.("[data-slot-id]")?.getAttribute("data-slot-id");
  const activeIsSelect = active?.classList?.contains("slot-tournaments-assign-select");

  list.replaceChildren();
  if (!state.slots.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  state.slots.forEach((slot, index) => {
    const row = document.createElement("li");
    row.className = "slot-tournaments-assign-row";
    row.dataset.slotId = slot.id;

    const indexEl = document.createElement("span");
    indexEl.className = "slot-tournaments-entry-index";
    indexEl.textContent = String(index + 1).padStart(2, "0");

    const identity = document.createElement("div");
    identity.className = "slot-tournaments-assign-identity";
    identity.append(createSlotThumb(slot.name, resolveSlotThumbnail(slot)));

    const name = document.createElement("p");
    name.className = "slot-tournaments-assign-name";
    name.textContent = slot.name;
    identity.append(name);

    const select = document.createElement("select");
    select.className = "guess-input slot-tournaments-assign-select";
    select.dataset.slotId = slot.id;

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Unassigned";
    select.append(blank);

    state.entries.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.username;
      const takenByOther = state.slots.some(
        (other) => other.id !== slot.id && other.entryId === entry.id
      );
      if (takenByOther) {
        option.disabled = true;
      }
      select.append(option);
    });

    select.value = slot.entryId || "";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-sm btn-outline";
    remove.dataset.removeSlotId = slot.id;
    remove.textContent = "Remove";

    row.append(indexEl, identity, select, remove);
    list.append(row);
  });

  if (activeIsSelect && activeSlotId) {
    const next = list.querySelector(
      `.slot-tournaments-assign-select[data-slot-id="${activeSlotId}"]`
    );
    next?.focus();
  }
}

function renderAdminForm() {
  const panel = document.getElementById("st-admin");
  const isAdmin = Boolean(currentUser?.isAdmin);
  panel?.classList.toggle("is-hidden", !isAdmin);
  if (!isAdmin) return;

  const title = document.getElementById("st-admin-title-input");
  const slot = document.getElementById("st-admin-slot");
  const buyin = document.getElementById("st-admin-buyin");
  const capacity = document.getElementById("st-admin-capacity");
  const aff = document.getElementById("st-aff-only");
  const sub = document.getElementById("st-sub-only");
  const toggle = document.getElementById("st-toggle-open");

  if (title && document.activeElement !== title) title.value = state.title;
  if (slot && document.activeElement !== slot) slot.value = state.slotName;
  if (buyin && document.activeElement !== buyin) buyin.value = state.buyIn;
  if (capacity && document.activeElement !== capacity) {
    capacity.value = state.capacity ? String(state.capacity) : "";
  }
  if (aff) aff.checked = state.affiliatesOnly;
  if (sub) sub.checked = state.subscribersOnly;
  if (toggle) {
    toggle.textContent = state.open ? "Close signups" : "Open signups";
  }
}

function renderAll() {
  renderStatus();
  renderInfo();
  renderEntries();
  renderPredictions();
  renderPredictionLeaderboard();
  renderResults();
  renderAssignPanel();
  renderAdminForm();
}

async function refreshStatus() {
  const response = await fetch("/api/slot-tournaments/status", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load tournament board.");
  }
  const data = await response.json();
  applyState(data);
}

async function postJson(url, body) {
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

async function saveSlots(nextSlots, { statusMessage } = {}) {
  assignDirty = false;
  if (assignSaveTimer) {
    window.clearTimeout(assignSaveTimer);
    assignSaveTimer = null;
  }
  setAssignStatus(statusMessage || "Saving slots...");
  try {
    await postJson("/api/slot-tournaments/slots", { slots: nextSlots });
    setAssignStatus("Slots saved.", "success");
  } catch (error) {
    setAssignStatus(error.message || "Could not save slots.", "error");
    await refreshStatus().catch(() => {});
  }
}

function queueSlotSave(nextSlots) {
  state.slots = nextSlots;
  assignDirty = true;
  renderAssignPanel();
  renderEntries();
  if (assignSaveTimer) window.clearTimeout(assignSaveTimer);
  assignSaveTimer = window.setTimeout(() => {
    saveSlots(state.slots);
  }, 350);
}

function shuffle(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function setPickerOpen(nextOpen) {
  pickerOpen = Boolean(nextOpen);
  const menu = document.getElementById("st-assign-slot-menu");
  const trigger = document.getElementById("st-assign-slot-trigger");
  const label = document.getElementById("st-assign-slot-trigger-label");
  menu?.classList.toggle("is-hidden", !pickerOpen);
  if (menu) menu.hidden = !pickerOpen;
  trigger?.setAttribute("aria-expanded", pickerOpen ? "true" : "false");
  if (label) {
    label.textContent = pickerOpen
      ? "Hide slot list"
      : "Choose New Releases or Only on Stake…";
  }
  if (pickerOpen) {
    renderSlotPickerOptions();
    if (!slotCatalog.length) {
      loadSlotCatalog({ force: true });
    }
    window.setTimeout(() => {
      document.getElementById("st-assign-slot-search")?.focus();
    }, 0);
  } else {
    pickerFilter = "";
    const search = document.getElementById("st-assign-slot-search");
    if (search) search.value = "";
  }
}

function renderSlotPickerOptions() {
  const groupsEl = document.getElementById("st-assign-slot-groups");
  const empty = document.getElementById("st-assign-slot-empty");
  const meta = document.getElementById("st-assign-catalog-meta");
  if (!groupsEl) return;

  groupsEl.replaceChildren();
  const query = pickerFilter.trim().toLowerCase();
  const addedSlugs = new Set(
    state.slots.map((slot) => String(slot.slug || "").toLowerCase()).filter(Boolean)
  );

  const groups = getPickerGroups();

  let visibleCount = 0;

  for (const group of groups) {
    const slots = catalogSlotsForGroup(group, query);

    if (!slots.length) continue;

    const section = document.createElement("div");
    section.className = "st-slot-picker-group";

    const heading = document.createElement("p");
    heading.className = "st-slot-picker-group-label";
    heading.textContent = group.label;
    section.append(heading);

    slots.forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "st-slot-picker-option";
      button.dataset.slotSlug = slot.slug;
      button.setAttribute("role", "option");

      const alreadyAdded = addedSlugs.has(String(slot.slug || "").toLowerCase());
      if (alreadyAdded) {
        button.disabled = true;
        button.classList.add("is-added");
      }

      button.append(createSlotThumb(slot.name, slot.thumbnailUrl));

      const copy = document.createElement("span");
      copy.className = "st-slot-picker-option-copy";

      const name = document.createElement("span");
      name.className = "st-slot-picker-option-name";
      name.textContent = slot.name;

      const provider = document.createElement("span");
      provider.className = "st-slot-picker-option-provider";
      provider.textContent = alreadyAdded
        ? "Already added"
        : slot.provider || group.label;

      copy.append(name, provider);
      button.append(copy);
      section.append(button);
      visibleCount += 1;
    });

    groupsEl.append(section);
  }

  if (empty) {
    if (!slotCatalog.length) {
      empty.textContent = "Loading Stake slots…";
      empty.classList.remove("is-hidden");
    } else if (!visibleCount) {
      empty.textContent = query
        ? "No matching slots."
        : "No New Releases / Only on Stake slots found.";
      empty.classList.remove("is-hidden");
    } else {
      empty.classList.add("is-hidden");
    }
  }

  if (meta) {
    if (!slotCatalog.length) {
      meta.textContent =
        "Loading catalog… If this stays empty, sync slots from Bonus Hunt.";
    } else {
      const sectionCount = CLAIM_SLOT_GROUPS.reduce(
        (total, group) => total + catalogSlotsForGroup(group).length,
        0
      );
      meta.textContent = `${sectionCount} New Releases / Only on Stake slots`;
    }
  }
}

function addCatalogSlot(slug) {
  const catalogHit = findCatalogSlotBySlug(slug);
  if (!catalogHit) {
    setAssignStatus("Choose a slot from the list.", "error");
    return;
  }

  const already = state.slots.some(
    (slot) =>
      String(slot.slug || "").toLowerCase() ===
      String(catalogHit.slug || "").toLowerCase()
  );
  if (already) {
    setAssignStatus("That slot is already on the list.", "error");
    return;
  }

  const next = [
    ...state.slots,
    {
      id: newSlotId(),
      name: catalogHit.name,
      slug: catalogHit.slug || null,
      thumbnailUrl: normalizeSlotThumbnailUrl(catalogHit.thumbnailUrl),
      entryId: null,
    },
  ];
  setPickerOpen(false);
  queueSlotSave(next);
}

function initAssign() {
  const trigger = document.getElementById("st-assign-slot-trigger");
  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPickerOpen(!pickerOpen);
  });

  document.querySelector('label[for="st-assign-slot-search"]')?.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      setPickerOpen(true);
    }
  );

  document.getElementById("st-assign-slot-search")?.addEventListener("input", (event) => {
    pickerFilter = String(event.target.value || "");
    renderSlotPickerOptions();
  });

  document.getElementById("st-assign-slot-search")?.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });

  document.getElementById("st-assign-slot-groups")?.addEventListener("click", (event) => {
    const option = event.target.closest(".st-slot-picker-option");
    if (!option || option.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    addCatalogSlot(option.dataset.slotSlug);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!pickerOpen) return;
    const picker = document.getElementById("st-slot-picker");
    if (picker && !picker.contains(event.target)) {
      setPickerOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pickerOpen) {
      setPickerOpen(false);
    }
  });

  document.getElementById("st-assign-list")?.addEventListener("change", (event) => {
    const select = event.target.closest(".slot-tournaments-assign-select");
    if (!select) return;
    const slotId = select.dataset.slotId;
    const entryId = String(select.value || "").trim() || null;
    const next = state.slots.map((slot) => {
      if (slot.id === slotId) {
        return { ...slot, entryId };
      }
      if (entryId && slot.entryId === entryId) {
        return { ...slot, entryId: null };
      }
      return slot;
    });
    queueSlotSave(next);
  });

  document.getElementById("st-assign-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-slot-id]");
    if (!button) return;
    const slotId = button.getAttribute("data-remove-slot-id");
    queueSlotSave(state.slots.filter((slot) => slot.id !== slotId));
  });

  document.getElementById("st-assign-random")?.addEventListener("click", () => {
    if (!state.slots.length) {
      setAssignStatus("Add slots before assigning.", "error");
      return;
    }
    if (!state.entries.length) {
      setAssignStatus("No entrants to assign yet.", "error");
      return;
    }

    const entrants = shuffle(state.entries.map((entry) => entry.id));
    const next = state.slots.map((slot, index) => ({
      ...slot,
      entryId: entrants[index] || null,
    }));
    queueSlotSave(next);
  });

  document.getElementById("st-assign-clear")?.addEventListener("click", () => {
    if (!state.slots.some((slot) => slot.entryId)) {
      setAssignStatus("No assignments to clear.");
      return;
    }
    queueSlotSave(state.slots.map((slot) => ({ ...slot, entryId: null })));
  });
}

let catalogLoadPromise = null;

async function loadSlotCatalog({ force = false } = {}) {
  if (catalogLoadPromise && !force) {
    return catalogLoadPromise;
  }

  catalogLoadPromise = (async () => {
    const meta = document.getElementById("st-assign-catalog-meta");
    if (meta && !slotCatalog.length) {
      meta.textContent = "Loading Stake slots…";
    }

    try {
      const response = await fetch("/api/bonus-hunt/slots", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not load slot catalog.");
      }
      const data = await response.json();
      const rawSlots = Array.isArray(data.slots) ? data.slots : [];
      slotCatalog = rawSlots.filter((slot) =>
        CLAIM_SLOT_GROUPS.some((group) => slotBelongsToGroup(slot, group.slug))
      );
      slotGroups = (Array.isArray(data.groups) ? data.groups : []).filter(
        (group) =>
          CLAIM_SLOT_GROUPS.some((allowed) => allowed.slug === group.slug)
      );
      if (!slotGroups.length) {
        slotGroups = [...CLAIM_SLOT_GROUPS];
      }
      renderSlotPickerOptions();
      renderClaimSlotPickerOptions();
      if (currentUser?.isAdmin) {
        renderAssignPanel();
        renderEntries();
      }
      return slotCatalog;
    } catch (error) {
      if (meta) {
        meta.textContent = error.message || "Could not load Stake slot catalog.";
      }
      const empty = document.getElementById("st-assign-slot-empty");
      if (empty && pickerOpen) {
        empty.textContent = error.message || "Could not load Stake slots.";
        empty.classList.remove("is-hidden");
      }
      const claimEmpty = document.getElementById("st-claim-slot-empty");
      if (claimEmpty && claimPickerOpen) {
        claimEmpty.textContent = error.message || "Could not load Stake slots.";
        claimEmpty.classList.remove("is-hidden");
      }
      throw error;
    } finally {
      catalogLoadPromise = null;
    }
  })();

  return catalogLoadPromise;
}

function initAdmin() {
  document.getElementById("st-settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAdminStatus("Saving setup...");
    try {
      await postJson("/api/slot-tournaments/settings", {
        title: document.getElementById("st-admin-title-input")?.value || "",
        slotName: document.getElementById("st-admin-slot")?.value || "",
        buyIn: document.getElementById("st-admin-buyin")?.value || "",
        capacity: Number(
          document.getElementById("st-admin-capacity")?.value || 0
        ),
      });
      setAdminStatus("Setup saved.", "success");
    } catch (error) {
      setAdminStatus(error.message || "Could not save setup.", "error");
    }
  });

  document.getElementById("st-toggle-open")?.addEventListener("click", async () => {
    await toggleSignups(!state.open);
  });

  document.getElementById("st-status-toggle")?.addEventListener("change", async (event) => {
    const nextOpen = Boolean(event.target.checked);
    if (nextOpen === state.open) return;
    await toggleSignups(nextOpen);
  });

  document.getElementById("st-phase-live")?.addEventListener("click", async () => {
    try {
      await postJson("/api/slot-tournaments/phase", { phase: "live" });
      setAdminStatus("Tournament marked live.", "success");
    } catch (error) {
      setAdminStatus(error.message || "Could not start live.", "error");
    }
  });

  document.getElementById("st-phase-closed")?.addEventListener("click", async () => {
    try {
      await postJson("/api/slot-tournaments/phase", { phase: "closed" });
      setAdminStatus("Board closed.", "success");
    } catch (error) {
      setAdminStatus(error.message || "Could not close board.", "error");
    }
  });

  document.getElementById("st-clear-entries")?.addEventListener("click", async () => {
    try {
      await postJson("/api/slot-tournaments/entries/clear", {});
      setAdminStatus("Signups cleared.", "success");
    } catch (error) {
      setAdminStatus(error.message || "Could not clear signups.", "error");
    }
  });

  document.getElementById("st-bots-add")?.addEventListener("click", async () => {
    const count = Number(document.getElementById("st-bots-count")?.value || 0);
    setBanner("Adding bots...");
    try {
      const data = await postJson("/api/slot-tournaments/entries/bots", { count });
      setBanner(
        `Added ${data.botsAdded || count} bot${(data.botsAdded || count) === 1 ? "" : "s"}.`,
        "success"
      );
    } catch (error) {
      setBanner(error.message || "Could not add bots.", "error");
    }
  });

  document.getElementById("st-bots-fill")?.addEventListener("click", async () => {
    setBanner("Filling remaining spots with bots...");
    try {
      const data = await postJson("/api/slot-tournaments/entries/bots", {
        fillRemaining: true,
      });
      setBanner(
        `Filled with ${data.botsAdded || 0} bot${(data.botsAdded || 0) === 1 ? "" : "s"}.`,
        "success"
      );
    } catch (error) {
      setBanner(error.message || "Could not fill with bots.", "error");
    }
  });

  document.getElementById("st-aff-only")?.addEventListener("change", async (event) => {
    try {
      await postJson("/api/slot-tournaments/affiliates-only", {
        affiliatesOnly: Boolean(event.target.checked),
      });
    } catch (error) {
      setAdminStatus(error.message || "Could not update AFF.", "error");
      await refreshStatus().catch(() => {});
    }
  });

  document.getElementById("st-sub-only")?.addEventListener("change", async (event) => {
    try {
      await postJson("/api/slot-tournaments/subscribers-only", {
        subscribersOnly: Boolean(event.target.checked),
      });
    } catch (error) {
      setAdminStatus(error.message || "Could not update SUB.", "error");
      await refreshStatus().catch(() => {});
    }
  });
}

function setClaimStatus(message, tone = "") {
  const status = document.getElementById("st-claim-modal-status");
  if (!status) return;
  status.textContent = message || "";
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
}

function setClaimPickerOpen(open) {
  const modal = document.getElementById("st-claim-modal");
  if (!modal) return;

  claimPickerOpen = Boolean(open);
  modal.classList.toggle("is-hidden", !claimPickerOpen);
  modal.hidden = !claimPickerOpen;
  const predictOpen = !document
    .getElementById("st-predict-modal")
    ?.classList.contains("is-hidden");
  document.body.classList.toggle(
    "st-predict-modal-open",
    claimPickerOpen || predictOpen
  );

  if (claimPickerOpen) {
    setClaimStatus("");
    claimPickerFilter = "";
    const search = document.getElementById("st-claim-slot-search");
    if (search) search.value = "";
    renderClaimSlotPickerOptions();
    loadSlotCatalog()
      .then(() => {
        if (claimPickerOpen) renderClaimSlotPickerOptions();
      })
      .catch((error) => {
        setClaimStatus(error.message || "Could not load Stake slots.", "error");
        renderClaimSlotPickerOptions();
      });
    window.setTimeout(() => {
      document.getElementById("st-claim-slot-search")?.focus();
    }, 0);
  }
}

function renderClaimSlotPickerOptions() {
  const groupsEl = document.getElementById("st-claim-slot-groups");
  const empty = document.getElementById("st-claim-slot-empty");
  if (!groupsEl) return;

  groupsEl.replaceChildren();
  const query = claimPickerFilter.trim().toLowerCase();
  const exceptEntryId = viewerNeedsSlot() ? state.viewerEntryId : null;

  const groups = getPickerGroups();

  let visibleCount = 0;

  for (const group of groups) {
    const slots = catalogSlotsForGroup(group, query);

    if (!slots.length) continue;

    const section = document.createElement("div");
    section.className = "st-slot-picker-group";

    const heading = document.createElement("p");
    heading.className = "st-slot-picker-group-label";
    heading.textContent = group.label;
    section.append(heading);

    slots.forEach((slot) => {
      const taken = slotTakenByEntrant(slot, exceptEntryId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "st-slot-picker-option";
      button.dataset.slotSlug = slot.slug || "";
      button.dataset.slotName = slot.name || "";
      button.setAttribute("role", "option");

      if (taken || claimBusy) {
        button.disabled = true;
        button.classList.add("is-added");
      }

      button.append(createSlotThumb(slot.name, slot.thumbnailUrl));

      const copy = document.createElement("span");
      copy.className = "st-slot-picker-option-copy";

      const name = document.createElement("span");
      name.className = "st-slot-picker-option-name";
      name.textContent = slot.name;

      const provider = document.createElement("span");
      provider.className = "st-slot-picker-option-provider";
      provider.textContent = taken ? "Taken" : slot.provider || group.label;

      copy.append(name, provider);
      button.append(copy);
      section.append(button);
      visibleCount += 1;
    });

    groupsEl.append(section);
  }

  if (empty) {
    if (!slotCatalog.length) {
      empty.textContent = "Loading Stake slots…";
      empty.classList.remove("is-hidden");
    } else if (!visibleCount) {
      empty.textContent = query
        ? "No matching slots."
        : "No New Releases / Only on Stake slots found.";
      empty.classList.remove("is-hidden");
    } else {
      empty.classList.add("is-hidden");
    }
  }
}

async function claimWithSlot(slug, name) {
  if (claimBusy) return;
  const catalogHit =
    findCatalogSlotBySlug(slug) ||
    slotCatalog.find(
      (slot) =>
        String(slot.name || "").trim().toLowerCase() ===
        String(name || "").trim().toLowerCase()
    );
  if (!catalogHit?.slug && !catalogHit?.name) {
    setClaimStatus("Choose a slot from the list.", "error");
    return;
  }

  if (
    slotTakenByEntrant(
      catalogHit,
      viewerNeedsSlot() ? state.viewerEntryId : null
    )
  ) {
    setClaimStatus("That slot is already taken.", "error");
    renderClaimSlotPickerOptions();
    return;
  }

  claimBusy = true;
  renderStatus();
  renderClaimSlotPickerOptions();
  setClaimStatus("Claiming spot…");

  try {
    const payload = catalogHit.slug
      ? { slotSlug: catalogHit.slug }
      : { slotName: catalogHit.name };
    const data = await postJson("/api/slot-tournaments/join", payload);
    setClaimPickerOpen(false);
    const message = data.slotAssigned
      ? "Slot picked. Spot secured."
      : data.alreadyEntered
        ? "You already claimed a spot."
        : "Spot claimed.";
    setBanner(message, "success");
  } catch (error) {
    setClaimStatus(error.message || "Could not claim a spot.", "error");
    setBanner(error.message || "Could not claim a spot.", "error");
    await refreshStatus().catch(() => {});
    renderClaimSlotPickerOptions();
  } finally {
    claimBusy = false;
    renderStatus();
  }
}

function initJoin() {
  document.getElementById("st-join-btn")?.addEventListener("click", () => {
    if (!canOpenClaimPicker() || claimBusy) return;
    setClaimPickerOpen(true);
  });

  document.getElementById("st-claim-slot-search")?.addEventListener("input", (event) => {
    claimPickerFilter = String(event.target.value || "");
    renderClaimSlotPickerOptions();
  });

  document.getElementById("st-claim-slot-groups")?.addEventListener("click", (event) => {
    const option = event.target.closest(".st-slot-picker-option");
    if (!option || option.disabled) return;
    event.preventDefault();
    claimWithSlot(option.dataset.slotSlug, option.dataset.slotName);
  });

  document.querySelectorAll("[data-st-claim-close]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      if (!claimBusy) setClaimPickerOpen(false);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && claimPickerOpen && !claimBusy) {
      setClaimPickerOpen(false);
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
    if (currentUser?.isAdmin || canOpenClaimPicker()) {
      loadSlotCatalog();
    }
  } catch (error) {
    setBanner(error.message || "Could not load board.", "error");
  }
});

initAssign();
initPredictions();
initAdmin();
initJoin();
refreshStatus()
  .then(() => {
    startPolling();
    if (currentUser?.isAdmin || canOpenClaimPicker()) {
      loadSlotCatalog();
    }
  })
  .catch((error) => {
    setBanner(error.message || "Could not load board.", "error");
    startPolling();
  });
