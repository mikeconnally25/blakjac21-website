let currentUser = null;
let pollTimer = null;
let slotCatalog = [];
let assignSaveTimer = null;
let assignDirty = false;
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
  results: [],
  viewerEntered: false,
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

function findCatalogSlot(name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    slotCatalog.find((slot) => String(slot.name || "").toLowerCase() === needle) ||
    null
  );
}

function assignedSlotForEntry(entryId) {
  const id = String(entryId || "").trim();
  if (!id) return null;
  return state.slots.find((slot) => slot.entryId === id) || null;
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
      results: Array.isArray(data.results) ? data.results : [],
      viewerEntered: Boolean(data.viewerEntered),
    };
    renderStatus();
    renderInfo();
    renderEntries();
    renderResults();
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
    results: Array.isArray(data.results) ? data.results : [],
    viewerEntered: Boolean(data.viewerEntered),
  };
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

  if (hint) {
    if (state.open) {
      if (state.viewerEntered) {
        hint.textContent = "You're in. Good luck.";
      } else if (!currentUser?.kickUserId) {
        hint.textContent = "Sign in with Kick to claim a spot.";
      } else if (state.spotsLeft <= 0) {
        hint.textContent = "Tournament is full.";
      } else {
        hint.textContent = "Signups are open — claim a spot below.";
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

  const canJoin =
    state.open &&
    currentUser?.kickUserId &&
    !state.viewerEntered &&
    state.spotsLeft > 0;
  const needsSignIn = state.open && !currentUser?.kickUserId;

  joinBtn?.classList.toggle("is-hidden", !canJoin && !state.viewerEntered);
  if (joinBtn) {
    joinBtn.disabled = !canJoin;
    joinBtn.textContent = state.viewerEntered ? "Spot claimed" : "Claim spot";
  }

  signInBtn?.classList.toggle("is-hidden", !needsSignIn);
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

    const name = document.createElement("span");
    name.className = "slot-tournaments-entry-name";
    name.textContent = entry.username;

    copy.append(name);

    const assigned = assignedSlotForEntry(entry.id);
    if (assigned?.name) {
      const slot = document.createElement("span");
      slot.className = "slot-tournaments-entry-slot";
      slot.textContent = assigned.name;
      copy.append(slot);
    }

    row.append(place, copy);
    list.append(row);
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

    const name = document.createElement("p");
    name.className = "slot-tournaments-assign-name";
    name.textContent = slot.name;

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

    row.append(indexEl, name, select, remove);
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

function initAssign() {
  document.getElementById("st-assign-add-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("st-assign-slot-input");
    const name = String(input?.value || "").trim();
    if (!name) {
      setAssignStatus("Enter a slot name.", "error");
      return;
    }

    const catalogHit = findCatalogSlot(name);
    const next = [
      ...state.slots,
      {
        id: newSlotId(),
        name: catalogHit?.name || name,
        slug: catalogHit?.slug || null,
        entryId: null,
      },
    ];
    if (input) input.value = "";
    queueSlotSave(next);
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

async function loadSlotCatalog() {
  try {
    const response = await fetch("/api/bonus-hunt/slots", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = await response.json();
    slotCatalog = Array.isArray(data.slots) ? data.slots : [];
    const list = document.getElementById("st-assign-slot-catalog");
    if (!list) return;
    list.replaceChildren();
    slotCatalog.forEach((slot) => {
      const option = document.createElement("option");
      option.value = slot.name;
      list.append(option);
    });
  } catch {
    // Catalog is optional for free-text slot names.
  }
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

function initJoin() {
  document.getElementById("st-join-btn")?.addEventListener("click", async () => {
    setBanner("Claiming spot...");
    try {
      const data = await postJson("/api/slot-tournaments/join", {});
      setBanner(
        data.alreadyEntered ? "You already claimed a spot." : "Spot claimed.",
        "success"
      );
    } catch (error) {
      setBanner(error.message || "Could not claim a spot.", "error");
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
    if (currentUser?.isAdmin) {
      loadSlotCatalog();
    }
  } catch (error) {
    setBanner(error.message || "Could not load board.", "error");
  }
});

initAssign();
initAdmin();
initJoin();
refreshStatus()
  .then(() => {
    startPolling();
    if (currentUser?.isAdmin) {
      loadSlotCatalog();
    }
  })
  .catch((error) => {
    setBanner(error.message || "Could not load board.", "error");
    startPolling();
  });
