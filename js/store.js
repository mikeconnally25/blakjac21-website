let currentUser = null;
let catalog = [];
let myRedemptions = [];
let pendingQueue = [];
let pointsBalance = 0;

function setStoreStatus(message, tone = "") {
  const status = document.getElementById("store-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
}

function formatPoints(value) {
  return `${Number(value) || 0} pts`;
}

function renderBalance() {
  const value = document.getElementById("store-balance-value");
  const copy = document.getElementById("store-balance-copy");
  if (!value || !copy) return;

  if (!currentUser) {
    value.textContent = "—";
    copy.textContent =
      "Sign in with Kick to see your balance and redeem rewards.";
    return;
  }

  value.textContent = String(pointsBalance);
  copy.textContent = `Signed in as ${currentUser.username}.`;
}

function statusLabel(status) {
  if (status === "fulfilled") return "Fulfilled";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

function createRowMeta(parts) {
  const meta = document.createElement("div");
  meta.className = "store-row-meta";
  parts.filter(Boolean).forEach((part, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "store-row-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "·";
      meta.append(sep);
    }
    const bit = document.createElement("span");
    bit.textContent = part;
    meta.append(bit);
  });
  return meta;
}

function createStatusPill(status) {
  const pill = document.createElement("span");
  pill.className = `store-status-pill is-${status || "pending"}`;
  pill.textContent = statusLabel(status);
  return pill;
}

function renderCatalog() {
  const list = document.getElementById("store-catalog-list");
  const empty = document.getElementById("store-catalog-empty");
  if (!list || !empty) return;

  const activeItems = catalog.filter((item) => item.active !== false);
  list.replaceChildren();

  if (!activeItems.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  activeItems.forEach((item) => {
    const row = document.createElement("li");
    row.className = "store-catalog-item";

    const copy = document.createElement("div");
    copy.className = "store-catalog-copy";

    const title = document.createElement("h3");
    title.className = "store-catalog-title";
    title.textContent = item.title;

    const cost = document.createElement("p");
    cost.className = "store-catalog-cost";
    cost.textContent = formatPoints(item.cost);

    copy.append(title, cost);

    if (item.description) {
      const description = document.createElement("p");
      description.className = "store-catalog-description";
      description.textContent = item.description;
      copy.append(description);
    }

    const redeem = document.createElement("button");
    redeem.type = "button";
    redeem.className = "btn btn-sm btn-primary";
    redeem.textContent = "Redeem";
    redeem.disabled = !currentUser || pointsBalance < item.cost;
    redeem.addEventListener("click", () => {
      void redeemItem(item.id, redeem);
    });

    row.append(copy, redeem);
    list.append(row);
  });
}

function formatWhen(value) {
  const at = Date.parse(value || "");
  if (!Number.isFinite(at)) return "";
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderMyRedemptions() {
  const list = document.getElementById("store-redemptions-list");
  const empty = document.getElementById("store-redemptions-empty");
  if (!list || !empty) return;

  list.replaceChildren();

  if (!currentUser || !myRedemptions.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    empty.textContent = currentUser
      ? "No redemptions yet."
      : "Sign in to see your redemptions.";
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  myRedemptions.forEach((entry) => {
    const row = document.createElement("li");
    row.className = `store-row store-redemption-item is-${entry.status || "pending"}`;

    const copy = document.createElement("div");
    copy.className = "store-row-copy";

    const title = document.createElement("p");
    title.className = "store-row-title";
    title.textContent = entry.itemTitle;

    copy.append(
      title,
      createRowMeta([formatPoints(entry.cost), formatWhen(entry.updatedAt || entry.createdAt)])
    );
    row.append(copy, createStatusPill(entry.status));
    list.append(row);
  });
}

function renderAdminCatalog() {
  const list = document.getElementById("store-admin-catalog");
  const empty = document.getElementById("store-admin-catalog-empty");
  if (!list) return;
  list.replaceChildren();

  if (!catalog.length) {
    empty?.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty?.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  catalog.forEach((item) => {
    const row = document.createElement("li");
    row.className = `store-row store-admin-item${item.active ? "" : " is-inactive"}`;

    const copy = document.createElement("div");
    copy.className = "store-row-copy";

    const title = document.createElement("p");
    title.className = "store-row-title";
    title.textContent = item.title;

    copy.append(
      title,
      createRowMeta([
        formatPoints(item.cost),
        item.active ? "Active" : "Inactive",
      ])
    );

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-sm btn-outline";
    toggle.textContent = item.active ? "Disable" : "Enable";
    toggle.addEventListener("click", () => {
      void toggleCatalogItem(item.id, !item.active, toggle);
    });

    row.append(copy, toggle);
    list.append(row);
  });
}

function renderQueue() {
  const list = document.getElementById("store-queue-list");
  const empty = document.getElementById("store-queue-empty");
  if (!list || !empty) return;

  const pending = pendingQueue.filter((entry) => entry.status === "pending");
  list.replaceChildren();

  if (!pending.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  pending.forEach((entry) => {
    const row = document.createElement("li");
    row.className = "store-row store-queue-item";

    const copy = document.createElement("div");
    copy.className = "store-row-copy";

    const title = document.createElement("p");
    title.className = "store-row-title";
    title.textContent = entry.itemTitle;

    copy.append(
      title,
      createRowMeta([entry.username, formatPoints(entry.cost)])
    );

    const actions = document.createElement("div");
    actions.className = "store-queue-actions";

    const fulfill = document.createElement("button");
    fulfill.type = "button";
    fulfill.className = "btn btn-sm btn-primary";
    fulfill.textContent = "Fulfill";
    fulfill.addEventListener("click", () => {
      void fulfillRedemption(entry.id, fulfill);
    });

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-sm btn-outline";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      void cancelRedemption(entry.id, cancel);
    });

    actions.append(fulfill, cancel);
    row.append(copy, actions);
    list.append(row);
  });
}

function renderHistory() {
  const list = document.getElementById("store-history-list");
  const empty = document.getElementById("store-history-empty");
  if (!list || !empty) return;

  const history = pendingQueue
    .filter((entry) => entry.status === "fulfilled" || entry.status === "cancelled")
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt || b.createdAt) -
        Date.parse(a.updatedAt || a.createdAt)
    );

  list.replaceChildren();

  if (!history.length) {
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  history.forEach((entry) => {
    const row = document.createElement("li");
    row.className = `store-row store-queue-item store-history-item is-${entry.status}`;

    const copy = document.createElement("div");
    copy.className = "store-row-copy";

    const title = document.createElement("p");
    title.className = "store-row-title";
    title.textContent = entry.itemTitle;

    copy.append(
      title,
      createRowMeta([
        entry.username,
        formatPoints(entry.cost),
        formatWhen(entry.updatedAt || entry.createdAt),
      ])
    );

    row.append(copy, createStatusPill(entry.status));
    list.append(row);
  });
}

function renderAdmin() {
  const panel = document.getElementById("store-admin");
  const isAdmin = Boolean(currentUser?.isAdmin);
  panel?.classList.toggle("is-hidden", !isAdmin);
  if (!isAdmin) return;
  renderAdminCatalog();
  renderQueue();
  renderHistory();
}

function renderAll() {
  renderBalance();
  renderCatalog();
  renderMyRedemptions();
  renderAdmin();
}

async function loadCatalog() {
  const response = await fetch("/api/points/catalog", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load catalog.");
  }
  const data = await response.json();
  catalog = Array.isArray(data.catalog) ? data.catalog : [];
}

async function loadMe() {
  if (!currentUser) {
    pointsBalance = 0;
    myRedemptions = [];
    return;
  }

  const response = await fetch("/api/points/me", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load points balance.");
  }
  const data = await response.json();
  pointsBalance = Number(data.balance?.points) || 0;
  myRedemptions = Array.isArray(data.redemptions) ? data.redemptions : [];
}

async function loadQueue() {
  if (!currentUser?.isAdmin) {
    pendingQueue = [];
    return;
  }

  const response = await fetch("/api/points/redemptions", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load redemptions.");
  }
  const data = await response.json();
  pendingQueue = Array.isArray(data.redemptions) ? data.redemptions : [];
}

async function refreshStore() {
  try {
    await Promise.all([loadCatalog(), loadMe(), loadQueue()]);
    renderAll();
    setStoreStatus("");
  } catch (error) {
    setStoreStatus(error.message || "Could not load store.", "error");
  }
}

async function redeemItem(itemId, button) {
  if (!currentUser) {
    setStoreStatus("Sign in with Kick to redeem.", "error");
    return;
  }

  if (button) button.disabled = true;
  setStoreStatus("Redeeming...");

  try {
    const response = await fetch("/api/points/redeem", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not redeem item.");
    }

    pointsBalance = Number(data.balance?.points) || 0;
    myRedemptions = Array.isArray(data.redemptions) ? data.redemptions : [];
    if (currentUser?.isAdmin) {
      await loadQueue();
    }
    renderAll();
    setStoreStatus("Redeemed. Waiting for admin fulfill.", "success");
  } catch (error) {
    setStoreStatus(error.message || "Could not redeem item.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function toggleCatalogItem(id, active, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/points/catalog", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not update item.");
    }
    catalog = Array.isArray(data.catalog) ? data.catalog : catalog;
    renderAll();
    setStoreStatus(active ? "Item enabled." : "Item disabled.", "success");
  } catch (error) {
    setStoreStatus(error.message || "Could not update item.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function fulfillRedemption(id, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/points/fulfill-redemption", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not fulfill redemption.");
    }
    pendingQueue = Array.isArray(data.redemptions) ? data.redemptions : [];
    await loadMe();
    renderAll();
    setStoreStatus("Redemption fulfilled.", "success");
    document
      .getElementById("store-history-panel")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setStoreStatus(error.message || "Could not fulfill redemption.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function cancelRedemption(id, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/points/cancel-redemption", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not cancel redemption.");
    }
    pendingQueue = Array.isArray(data.redemptions) ? data.redemptions : [];
    await loadMe();
    renderAll();
    setStoreStatus("Redemption cancelled and points refunded.", "success");
    document
      .getElementById("store-history-panel")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setStoreStatus(error.message || "Could not cancel redemption.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function initCatalogForm() {
  const form = document.getElementById("store-catalog-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.getElementById("store-item-title")?.value || "";
    const cost = document.getElementById("store-item-cost")?.value || "";
    const description =
      document.getElementById("store-item-description")?.value || "";

    setStoreStatus("Saving catalog item...");
    try {
      const response = await fetch("/api/points/catalog", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          cost: Number(cost),
          description,
          active: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not save item.");
      }
      catalog = Array.isArray(data.catalog) ? data.catalog : catalog;
      form.reset();
      renderAll();
      setStoreStatus("Catalog item added.", "success");
    } catch (error) {
      setStoreStatus(error.message || "Could not save item.", "error");
    }
  });
}

function setAwardChatStatus(message, tone = "") {
  const status = document.getElementById("store-award-chat-status");
  if (!status) {
    setStoreStatus(message, tone);
    return;
  }

  status.textContent = message || "";
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
  if (message) {
    setStoreStatus(message, tone);
  }
}

function initAwardChatForm() {
  const form = document.getElementById("store-award-chat-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.getElementById("store-award-chat-submit");
    const amount = Number(
      document.getElementById("store-award-chat-amount")?.value || 0
    );
    const withinMinutes = Number(
      document.getElementById("store-award-chat-minutes")?.value || 15
    );

    if (submit) submit.disabled = true;
    setAwardChatStatus("Awarding recent Kick chatters...");
    try {
      const response = await fetch("/api/points/award-chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, withinMinutes }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not award chatters.");
      }
      await loadMe();
      renderAll();
      setAwardChatStatus(
        `Awarded ${data.amount > 0 ? "+" : ""}${data.amount} points to ${data.awarded} chatters (last ${data.withinMinutes}m).`,
        "success"
      );
    } catch (error) {
      setAwardChatStatus(error.message || "Could not award chatters.", "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  await refreshStore();
});

initCatalogForm();
initAwardChatForm();
refreshStore();
