let currentUser = null;
let pollTimer = null;
let slotCatalog = [];
let slotGroups = [];
let assignSaveTimer = null;
let assignDirty = false;
let pickerOpen = false;
let pickerFilter = "";
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

function assignedSlotForEntry(entryId) {
  const id = String(entryId || "").trim();
  if (!id) return null;
  return state.slots.find((slot) => slot.entryId === id) || null;
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
      const slotRow = document.createElement("span");
      slotRow.className = "slot-tournaments-entry-slot-row";
      slotRow.append(createSlotThumb(assigned.name, resolveSlotThumbnail(assigned)));
      const slot = document.createElement("span");
      slot.className = "slot-tournaments-entry-slot";
      slot.textContent = assigned.name;
      slotRow.append(slot);
      copy.append(slotRow);
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

  const groups =
    slotGroups.length > 0
      ? slotGroups
      : [
          { slug: "new-releases", label: "New Releases" },
          { slug: "only-on-stake", label: "Only on Stake" },
        ];

  let visibleCount = 0;

  for (const group of groups) {
    const slots = slotCatalog
      .filter((slot) => String(slot.groupSlug || "") === group.slug)
      .filter((slot) => {
        if (!query) return true;
        const haystack = [slot.name, slot.provider, group.label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          sensitivity: "base",
        })
      );

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
      meta.textContent = `${slotCatalog.length} Stake slots loaded`;
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
      slotCatalog = Array.isArray(data.slots) ? data.slots : [];
      slotGroups = Array.isArray(data.groups) ? data.groups : [];
      renderSlotPickerOptions();
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
