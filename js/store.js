let currentUser = null;
let catalog = [];
let myRedemptions = [];
let pendingQueue = [];
let pointsBalance = 0;
let pointsLeaders = [];
let pointsLeaderYou = null;
let pointsLeaderTotal = 0;
let pointsRace = null;
let storeLbFilter = "";
let storeLbFirstPaint = true;
let canRedeem = true;
let buyPackages = [];
let buyConfig = {
  configured: false,
  enabled: true,
  rate: 100,
  minUsd: 1,
  maxUsd: 100,
  minPoints: 100,
  maxPoints: 10000,
  stepPoints: 100,
};
let selectedBuyPackageId = null;
let redeemSlotCatalog = [];
let redeemSlotCatalogLoadedAt = 0;
let selectedRedeemSlot = null;

function isBuyPointsOpen() {
  return Boolean(buyConfig.configured) && buyConfig.enabled !== false;
}

function setStoreStatus(message, tone = "") {
  const status = document.getElementById("store-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
}

function formatPoints(value) {
  return `${Number(value) || 0} UncCoins`;
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
  if (!canRedeem) {
    copy.textContent = `Signed in as ${currentUser.username}. Store redemptions are disabled for uncapped accounts.`;
  } else {
    copy.textContent = `Signed in as ${currentUser.username}.`;
  }
}

function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  return `$${n % 1 === 0 ? String(n) : n.toFixed(2)}`;
}

function renderBuyForm() {
  const packagesEl = document.getElementById("store-buy-packages");
  const note = document.getElementById("store-buy-note");
  const copy = document.getElementById("store-buy-copy");
  if (!note) return;

  const pkg = buyPackages[0];
  if (copy) {
    if (buyPackages.length > 1) {
      copy.textContent = "Choose a package · pay with crypto";
    } else if (pkg) {
      copy.textContent = `${Number(pkg.points).toLocaleString()} UncCoins for ${formatUsd(pkg.usd)} · pay with crypto`;
    } else {
      copy.textContent = "2,000 UncCoins for $15 · pay with crypto";
    }
  }

  const canBuy = Boolean(currentUser) && isBuyPointsOpen();
  packagesEl?.classList.toggle("is-disabled", !canBuy);

  if (!buyConfig.configured) {
    note.textContent =
      "Crypto purchases are not configured yet. Add NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET on Vercel, then redeploy.";
    return;
  }
  if (buyConfig.enabled === false) {
    note.textContent = "Buying UncCoins is paused right now. Check back later.";
    return;
  }
  if (!currentUser) {
    note.textContent = "Sign in with Kick to buy UncCoins.";
    return;
  }
  note.textContent = "Tap a package to checkout.";
}

function renderBuyPackages() {
  const packagesEl = document.getElementById("store-buy-packages");
  if (!packagesEl) return;

  packagesEl.replaceChildren();
  buyPackages.forEach((pkg) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "store-buy-package-btn";
    btn.dataset.packageId = pkg.id;

    const pts = document.createElement("span");
    pts.className = "store-buy-package-pts";
    pts.textContent = `${Number(pkg.points).toLocaleString()} UncCoins`;

    const sep = document.createElement("span");
    sep.className = "store-buy-package-sep";
    sep.setAttribute("aria-hidden", "true");

    const usd = document.createElement("span");
    usd.className = "store-buy-package-usd";
    usd.textContent = formatUsd(pkg.usd);

    btn.append(pts, sep, usd);

    if (selectedBuyPackageId === pkg.id) {
      btn.classList.add("is-selected");
    }
    btn.addEventListener("click", () => {
      if (!currentUser || !isBuyPointsOpen()) {
        setStoreStatus(
          !buyConfig.configured
            ? "Crypto purchases are not configured yet."
            : buyConfig.enabled === false
              ? "Buying UncCoins is paused right now."
              : "Sign in with Kick to buy UncCoins.",
          "error"
        );
        return;
      }
      selectedBuyPackageId = pkg.id;
      document
        .querySelectorAll(".store-buy-package-btn")
        .forEach((el) =>
          el.classList.toggle("is-selected", el.dataset.packageId === pkg.id)
        );
      startBuyPurchase({ packageId: pkg.id });
    });
    packagesEl.append(btn);
  });
}

async function startBuyPurchase(payload) {
  const packageButtons = document.querySelectorAll(".store-buy-package-btn");
  packageButtons.forEach((btn) => {
    btn.disabled = true;
  });
  setStoreStatus("Opening crypto checkout...");
  try {
    const response = await fetch("/api/points/buy", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not start purchase.");
    }
    if (!data.invoiceUrl) {
      throw new Error("Checkout URL missing.");
    }
    window.location.href = data.invoiceUrl;
  } catch (error) {
    setStoreStatus(error.message || "Could not start purchase.", "error");
    renderBuyForm();
    packageButtons.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function statusLabel(status) {
  if (status === "fulfilled") return "Fulfilled";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

function itemNeedsBonusType(item) {
  const text = `${item?.title || ""} ${item?.description || ""}`.toLowerCase();
  return /bonus/.test(text);
}

function formatBonusType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "regular") return "Regular";
  if (type === "super") return "Super";
  if (type === "epic") return "Epic";
  return "";
}

function redemptionDetailParts(entry) {
  return [
    entry?.slotName || "",
    formatBonusType(entry?.bonusType),
  ].filter(Boolean);
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
    document.getElementById("store-catalog-note")?.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  const descriptions = activeItems.map((item) => String(item.description || "").trim());
  const sharedDescription =
    descriptions[0] && descriptions.every((text) => text === descriptions[0])
      ? descriptions[0]
      : "";
  const note = document.getElementById("store-catalog-note");
  if (note) {
    note.textContent = sharedDescription;
    note.classList.toggle("is-hidden", !sharedDescription);
  }

  activeItems.forEach((item, index) => {
    const row = document.createElement("li");
    row.className = "store-reward-card";
    row.style.setProperty("--reward-delay", `${Math.min(index, 8) * 45}ms`);

    const glow = document.createElement("span");
    glow.className = "store-reward-card-glow";
    glow.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "store-reward-card-body";

    const title = document.createElement("h3");
    title.className = "store-reward-card-title";
    title.textContent = item.title;

    const cost = document.createElement("p");
    cost.className = "store-reward-card-cost";
    cost.innerHTML = `<strong>${Number(item.cost) || 0}</strong> <span>UncCoins</span>`;

    body.append(title, cost);

    const ownDescription = String(item.description || "").trim();
    if (ownDescription && ownDescription !== sharedDescription) {
      const description = document.createElement("p");
      description.className = "store-reward-card-description";
      description.textContent = ownDescription;
      body.append(description);
    }

    const redeem = document.createElement("button");
    redeem.type = "button";
    redeem.className = "btn btn-primary store-reward-card-cta";
    redeem.textContent = "Redeem";
    redeem.disabled =
      !currentUser || !canRedeem || pointsBalance < item.cost;
    if (!currentUser) {
      redeem.title = "Sign in with Kick to redeem";
    } else if (!canRedeem) {
      redeem.title = "Redemptions disabled for this account";
      row.classList.add("is-locked");
    } else if (pointsBalance < item.cost) {
      redeem.title = "Not enough UncCoins";
      row.classList.add("is-locked");
    }
    redeem.addEventListener("click", () => {
      void redeemItem(item.id, redeem);
    });

    row.append(glow, body, redeem);
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
      createRowMeta([
        ...redemptionDetailParts(entry),
        formatPoints(entry.cost),
        formatWhen(entry.updatedAt || entry.createdAt),
      ])
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
        item.description || "",
      ])
    );

    const actions = document.createElement("div");
    actions.className = "store-queue-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-sm btn-primary";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      beginCatalogEdit(item);
    });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-sm btn-outline";
    toggle.textContent = item.active ? "Disable" : "Enable";
    toggle.addEventListener("click", () => {
      void toggleCatalogItem(item.id, !item.active, toggle);
    });

    actions.append(edit, toggle);
    row.append(copy, actions);
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
      createRowMeta([
        entry.username,
        ...redemptionDetailParts(entry),
        formatPoints(entry.cost),
      ])
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
        ...redemptionDetailParts(entry),
        formatPoints(entry.cost),
        formatWhen(entry.updatedAt || entry.createdAt),
      ])
    );

    const actions = document.createElement("div");
    actions.className = "store-queue-actions";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-sm btn-outline";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      void deletePastRedemption(entry.id, remove);
    });

    actions.append(createStatusPill(entry.status), remove);
    row.append(copy, actions);
    list.append(row);
  });
}

function renderAdmin() {
  const panel = document.getElementById("store-admin");
  const queuePanel = document.getElementById("store-queue-panel");
  const redemptionsPanel = document.getElementById("store-redemptions-panel");
  const browseSide = document.getElementById("store-browse-side");
  const adminSidebar = document.getElementById("store-admin-sidebar");
  const isAdmin = Boolean(currentUser?.isAdmin);

  panel?.classList.toggle("is-hidden", !isAdmin);
  queuePanel?.classList.toggle("is-hidden", !isAdmin);

  if (redemptionsPanel && browseSide && adminSidebar) {
    if (isAdmin) {
      adminSidebar.insertBefore(redemptionsPanel, adminSidebar.firstChild);
    } else if (redemptionsPanel.parentElement !== browseSide) {
      browseSide.appendChild(redemptionsPanel);
    }
  }

  if (!isAdmin) return;
  renderAdminCatalog();
  renderQueue();
  renderHistory();
  renderBuyToggle();
}

function renderBuyToggle() {
  const toggle = document.getElementById("store-buy-toggle");
  const status = document.getElementById("store-buy-toggle-status");
  if (!toggle || !status) return;

  toggle.checked = buyConfig.enabled !== false;
  status.textContent =
    buyConfig.enabled !== false
      ? "Buy UncCoins is open"
      : "Buy UncCoins is paused";
}

function storeLbEntries() {
  const entries = pointsLeaders.slice();
  if (
    pointsLeaderYou &&
    !entries.some((entry) => entry.rank === pointsLeaderYou.rank)
  ) {
    entries.push(pointsLeaderYou);
  }
  return entries;
}

function storeLbLeader() {
  return pointsLeaders[0] || null;
}

function storeLbIsYou(entry) {
  return Boolean(pointsLeaderYou && entry?.rank === pointsLeaderYou.rank);
}

function storeLbShare(entry, leader) {
  const top = Number(leader?.points) || 0;
  if (top <= 0) return 0;
  return (Number(entry?.points) || 0) / top * 100;
}

function storeLbGap(entry, leader) {
  if (!leader) return "";
  if (entry.rank === leader.rank) return "Leading the board";
  const share = storeLbShare(entry, leader);
  const shareText = share < 1 ? "<1% of 1st" : `${Math.round(share)}% of 1st`;
  const gap = Math.max(0, Number(leader.points) - Number(entry.points));
  return `${shareText} · ${gap.toLocaleString()} behind`;
}

function storeLbPrize(rank) {
  if (rank === 1) return "$100";
  if (rank === 2) return "$50";
  if (rank === 3) return "$25";
  return "—";
}

function storeLbReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function storeLbPaintPoints(el, value) {
  const amount = Number(value) || 0;
  if (!storeLbFirstPaint || storeLbReducedMotion()) {
    el.textContent = amount.toLocaleString();
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / 720);
    const eased = 1 - (1 - progress) ** 3;
    el.textContent = Math.round(amount * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function storeLbFillBar(bar, share) {
  const fill = bar.querySelector("span");
  if (!fill) return;
  const width = share > 0 ? Math.max(share, 3) : 0;
  if (!storeLbFirstPaint || storeLbReducedMotion()) {
    fill.style.width = `${width}%`;
    return;
  }
  fill.style.width = "0%";
  requestAnimationFrame(() => {
    fill.style.width = `${width}%`;
  });
}

function storeLbFocus(rank) {
  const item = document.getElementById(`store-unc-rank-${rank}`);
  const row = item?.querySelector(".lb-row");
  if (!item || !row) return;
  item.scrollIntoView({
    behavior: storeLbReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  document.querySelectorAll("#store-unc-list .lb-row[aria-expanded='true']").forEach((open) => {
    open.setAttribute("aria-expanded", "false");
  });
  row.setAttribute("aria-expanded", "true");
  row.focus();
}

function storeLbPlace(rank) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

function createStorePodiumCard(place, entry, leader) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `lb-podium-card place-${place}`;
  if (!entry) card.disabled = true;
  if (entry && storeLbIsYou(entry)) card.classList.add("is-you");
  card.setAttribute(
    "aria-label",
    entry ? `Show ${storeLbPlace(place)} on the board` : storeLbPlace(place)
  );

  const placeEl = document.createElement("span");
  placeEl.className = "lb-place";
  placeEl.textContent = String(place);

  const name = document.createElement("span");
  name.className = "lb-podium-name";
  name.textContent = entry?.username || "—";

  const points = document.createElement("span");
  points.className = "lb-podium-wager";
  if (entry) storeLbPaintPoints(points, entry.points);

  const prize = document.createElement("span");
  prize.className = "lb-podium-prize";
  prize.textContent = storeLbPrize(place);

  const bar = document.createElement("span");
  bar.className = "lb-bar";
  bar.setAttribute("aria-hidden", "true");
  bar.append(document.createElement("span"));

  card.append(placeEl, name, points, prize, bar);
  if (entry) {
    storeLbFillBar(bar, storeLbShare(entry, leader));
    card.addEventListener("click", () => storeLbFocus(entry.rank));
  }
  return card;
}

function renderStorePodium(entries, leader) {
  const panel = document.getElementById("store-unc-podium");
  const stage = document.getElementById("store-unc-podium-stage");
  if (!panel || !stage) return;
  const top = entries.filter((entry) => entry.rank <= 3).slice(0, 3);
  panel.classList.toggle("is-hidden", top.length === 0);
  stage.replaceChildren();
  if (!top.length) return;
  const byRank = new Map(top.map((entry) => [entry.rank, entry]));
  [2, 1, 3].forEach((place) => {
    stage.append(createStorePodiumCard(place, byRank.get(place) || null, leader));
  });
}

function createStoreStanding(entry, leader, index) {
  const item = document.createElement("li");
  item.className = `lb-item place-${Math.min(entry.rank, 4)}`;
  item.id = `store-unc-rank-${entry.rank}`;
  item.dataset.name = String(entry.username || "").toLowerCase();
  if (storeLbFirstPaint) {
    item.classList.add("is-entering");
    item.style.setProperty("--enter-delay", `${Math.min(index, 9) * 40}ms`);
  }
  if (storeLbIsYou(entry)) item.classList.add("is-you");

  const row = document.createElement("button");
  row.type = "button";
  row.className = "lb-row";
  row.setAttribute("aria-expanded", "false");

  const rank = document.createElement("span");
  rank.className = "lb-rank";
  rank.textContent = String(entry.rank).padStart(2, "0");

  const player = document.createElement("span");
  player.className = "lb-player";

  const name = document.createElement("span");
  name.className = "lb-name";
  name.textContent = entry.username || "viewer";
  if (storeLbIsYou(entry)) {
    const you = document.createElement("span");
    you.className = "lb-you";
    you.textContent = "You";
    name.append(you);
  }

  const bar = document.createElement("span");
  bar.className = "lb-bar";
  bar.setAttribute("aria-hidden", "true");
  bar.append(document.createElement("span"));

  const gap = document.createElement("span");
  gap.className = "lb-gap";
  gap.textContent = storeLbGap(entry, leader);
  player.append(name, bar, gap);

  const points = document.createElement("span");
  points.className = "lb-wager";
  storeLbPaintPoints(points, entry.points);

  const prize = document.createElement("span");
  prize.className = "lb-prize";
  prize.textContent = storeLbPrize(entry.rank);

  row.append(rank, player, points, prize);
  row.addEventListener("click", () => {
    const open = row.getAttribute("aria-expanded") === "true";
    document.querySelectorAll("#store-unc-list .lb-row[aria-expanded='true']").forEach((other) => {
      if (other !== row) other.setAttribute("aria-expanded", "false");
    });
    row.setAttribute("aria-expanded", open ? "false" : "true");
  });

  item.append(row);
  storeLbFillBar(bar, storeLbShare(entry, leader));
  return item;
}

function applyStoreLbFilter() {
  const query = storeLbFilter.trim().toLowerCase();
  const items = [...document.querySelectorAll("#store-unc-list .lb-item")];
  let shown = 0;
  items.forEach((item) => {
    const match = !query || String(item.dataset.name || "").includes(query);
    item.classList.toggle("is-filtered-out", !match);
    if (match) shown += 1;
  });
  document
    .getElementById("store-unc-filter-empty")
    ?.classList.toggle("is-hidden", !query || shown > 0 || items.length === 0);
}

function paintStoreRace() {
  const ends = document.getElementById("store-unc-ends");
  const label = document.getElementById("store-unc-ends-label");
  const players = document.getElementById("store-unc-players");
  if (players) players.textContent = pointsLeaderTotal ? String(pointsLeaderTotal) : "—";
  if (!ends) return;
  const end = Date.parse(pointsRace?.endsAt || "");
  if (!Number.isFinite(end)) {
    if (label) label.textContent = "Ends in";
    ends.textContent = "30 days";
    return;
  }
  const ms = end - Date.now();
  if (ms <= 0) {
    if (label) label.textContent = "Period";
    ends.textContent = "Ended";
    return;
  }
  if (label) label.textContent = "Ends in";
  const days = Math.ceil(ms / 86400000);
  ends.textContent = days === 1 ? "1 day" : `${days} days`;
}

function renderLeaderboard() {
  const list = document.getElementById("store-unc-list");
  const empty = document.getElementById("store-unc-empty");
  const head = document.getElementById("store-unc-head");
  if (!list || !empty) return;

  const entries = storeLbEntries();
  const leader = storeLbLeader();
  paintStoreRace();
  renderStorePodium(pointsLeaders, leader);
  list.replaceChildren();

  const hasEntries = entries.length > 0;
  empty.classList.toggle("is-hidden", hasEntries);
  head?.classList.toggle("is-hidden", !hasEntries);
  list.classList.toggle("is-hidden", !hasEntries);
  entries.forEach((entry, index) => {
    list.append(createStoreStanding(entry, leader, index));
  });
  applyStoreLbFilter();
  if (hasEntries) storeLbFirstPaint = false;
}

function renderAll() {
  renderBalance();
  renderBuyPackages();
  renderBuyForm();
  renderCatalog();
  renderMyRedemptions();
  renderLeaderboard();
  renderAdmin();
}

async function loadLeaderboard() {
  const response = await fetch("/api/points/leaderboard", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load the UncCoins leaderboard.");
  }
  const data = await response.json();
  pointsLeaders = Array.isArray(data.leaders) ? data.leaders : [];
  pointsLeaderYou = data.you && Number(data.you.points) > 0 ? data.you : null;
  pointsLeaderTotal = Number(data.total) || pointsLeaders.length;
  pointsRace = data.race || null;
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
    canRedeem = true;
    return;
  }

  const response = await fetch("/api/points/me", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Could not load UncCoins balance.");
  }
  const data = await response.json();
  pointsBalance = Number(data.balance?.points) || 0;
  myRedemptions = Array.isArray(data.redemptions) ? data.redemptions : [];
  canRedeem = data.canRedeem !== false;
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

async function loadBuyPackages() {
  const response = await fetch("/api/points/buy/packages", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    buyPackages = [];
    buyConfig.configured = false;
    buyConfig.enabled = true;
    return;
  }
  const data = await response.json().catch(() => ({}));
  buyPackages = Array.isArray(data.packages) ? data.packages : [];
  buyConfig = {
    configured: Boolean(data.configured),
    enabled: data.enabled !== false,
    rate: Number(data.rate) || 100,
    minUsd: Number(data.minUsd) || 1,
    maxUsd: Number(data.maxUsd) || 100,
    minPoints: Number(data.minPoints) || 100,
    maxPoints: Number(data.maxPoints) || 10000,
    stepPoints: Number(data.stepPoints) || 100,
  };
}

async function refreshStore() {
  try {
    await Promise.all([
      loadCatalog(),
      loadMe(),
      loadQueue(),
      loadBuyPackages(),
      loadLeaderboard(),
    ]);
    renderAll();
  } catch (error) {
    setStoreStatus(error.message || "Could not load store.", "error");
  }
}

function setRedeemModalError(message) {
  const error = document.getElementById("store-redeem-error");
  if (!error) return;
  error.textContent = message || "";
  error.classList.toggle("is-hidden", !message);
}

async function loadRedeemSlotCatalog({ force = false } = {}) {
  if (
    !force &&
    redeemSlotCatalog.length &&
    Date.now() - redeemSlotCatalogLoadedAt < 60000
  ) {
    return redeemSlotCatalog;
  }
  const response = await fetch("/api/bonus-hunt/slots", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Could not load slots.");
  }
  redeemSlotCatalog = Array.isArray(data.slots) ? data.slots : [];
  redeemSlotCatalogLoadedAt = Date.now();
  return redeemSlotCatalog;
}

function matchRedeemSlots(query) {
  const tokens = String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length || !redeemSlotCatalog.length) return [];
  const seen = new Set();
  const matches = [];
  for (const slot of redeemSlotCatalog) {
    const slug = String(slot.slug || "").toLowerCase();
    if (slug && seen.has(slug)) continue;
    const haystack = [slot.name, slot.slug, slot.provider, slot.groupLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!tokens.every((token) => haystack.includes(token))) continue;
    if (slug) seen.add(slug);
    matches.push(slot);
  }
  matches.sort((a, b) => {
    const aName = String(a.name || "").toLowerCase();
    const bName = String(b.name || "").toLowerCase();
    const aStarts = tokens.some((token) => aName.startsWith(token)) ? 0 : 1;
    const bStarts = tokens.some((token) => bName.startsWith(token)) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return aName.localeCompare(bName, undefined, { sensitivity: "base" });
  });
  return matches.slice(0, 12);
}

function paintSelectedRedeemSlot() {
  const selected = document.getElementById("store-redeem-slot-selected");
  const name = document.getElementById("store-redeem-slot-selected-name");
  const meta = document.getElementById("store-redeem-slot-selected-meta");
  const search = document.getElementById("store-redeem-slot-search");
  const results = document.getElementById("store-redeem-slot-results");
  const empty = document.getElementById("store-redeem-slot-empty");
  if (!selected) return;

  if (!selectedRedeemSlot) {
    selected.classList.add("is-hidden");
    if (name) name.textContent = "";
    if (meta) meta.textContent = "";
    search?.classList.remove("is-hidden");
    return;
  }

  selected.classList.remove("is-hidden");
  if (name) name.textContent = selectedRedeemSlot.name || "Slot";
  if (meta) {
    meta.textContent = [selectedRedeemSlot.groupLabel, selectedRedeemSlot.provider]
      .filter(Boolean)
      .join(" · ");
  }
  if (search) {
    search.value = "";
    search.classList.add("is-hidden");
  }
  results?.classList.add("is-hidden");
  empty?.classList.add("is-hidden");
}

function clearSelectedRedeemSlot() {
  selectedRedeemSlot = null;
  paintSelectedRedeemSlot();
  document.getElementById("store-redeem-slot-search")?.focus();
}

function renderRedeemSlotResults() {
  const results = document.getElementById("store-redeem-slot-results");
  const empty = document.getElementById("store-redeem-slot-empty");
  const search = document.getElementById("store-redeem-slot-search");
  if (!results || !empty || !search || selectedRedeemSlot) return;

  const query = search.value.trim();
  results.replaceChildren();
  if (!query) {
    results.classList.add("is-hidden");
    empty.classList.add("is-hidden");
    return;
  }

  if (!redeemSlotCatalog.length) {
    results.classList.add("is-hidden");
    empty.classList.remove("is-hidden");
    empty.textContent =
      "No synced slots yet. Sync New Releases and Only on Stake on Bonus Hunt first.";
    return;
  }

  const matches = matchRedeemSlots(query);
  if (!matches.length) {
    results.classList.add("is-hidden");
    empty.classList.remove("is-hidden");
    empty.textContent = "No matching slots in New Releases or Only on Stake.";
    return;
  }

  empty.classList.add("is-hidden");
  results.classList.remove("is-hidden");
  matches.forEach((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hunt-add-slot-option";
    button.setAttribute("role", "option");

    const copy = document.createElement("span");
    copy.className = "hunt-add-slot-option-copy";
    const label = document.createElement("span");
    label.className = "hunt-add-slot-option-name";
    label.textContent = slot.name;
    const note = document.createElement("span");
    note.className = "hunt-add-slot-option-provider";
    note.textContent = [slot.groupLabel, slot.provider].filter(Boolean).join(" · ");
    copy.append(label, note);
    button.append(copy);
    button.addEventListener("click", () => {
      selectedRedeemSlot = {
        name: slot.name,
        slug: slot.slug,
        provider: slot.provider || "",
        groupLabel: slot.groupLabel || "",
      };
      setRedeemModalError("");
      paintSelectedRedeemSlot();
    });
    results.append(button);
  });
}

function closeRedeemModal() {
  const modal = document.getElementById("store-redeem-modal");
  const form = document.getElementById("store-redeem-form");
  modal?.classList.add("is-hidden");
  setRedeemModalError("");
  selectedRedeemSlot = null;
  if (form) {
    form.dataset.itemId = "";
    form.reset();
  }
  document.getElementById("store-redeem-type")?.classList.add("is-hidden");
  document.getElementById("store-redeem-slot-results")?.classList.add("is-hidden");
  document.getElementById("store-redeem-slot-empty")?.classList.add("is-hidden");
  paintSelectedRedeemSlot();
}

async function openRedeemModal(item) {
  const modal = document.getElementById("store-redeem-modal");
  const form = document.getElementById("store-redeem-form");
  const copy = document.getElementById("store-redeem-copy");
  const typeWrap = document.getElementById("store-redeem-type");
  const search = document.getElementById("store-redeem-slot-search");
  if (!modal || !form || !item) return;

  form.dataset.itemId = item.id;
  form.dataset.needsBonusType = itemNeedsBonusType(item) ? "1" : "0";
  form.reset();
  selectedRedeemSlot = null;
  setRedeemModalError("");
  paintSelectedRedeemSlot();
  if (copy) {
    copy.textContent = itemNeedsBonusType(item)
      ? `Redeeming ${item.title}. Pick a synced slot, then Regular, Super, or Epic.`
      : `Redeeming ${item.title}. Pick a synced New Releases or Only on Stake slot.`;
  }
  typeWrap?.classList.toggle("is-hidden", !itemNeedsBonusType(item));
  modal.classList.remove("is-hidden");
  search?.focus();

  try {
    await loadRedeemSlotCatalog();
    renderRedeemSlotResults();
  } catch (error) {
    setRedeemModalError(error.message || "Could not load slots.");
  }
}

async function submitRedeemDetails({ itemId, slotName, slotSlug, bonusType }) {
  const response = await fetch("/api/points/redeem", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, slotName, slotSlug, bonusType }),
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
  await loadLeaderboard();
  renderAll();
  setStoreStatus("Redeemed. Waiting for admin fulfill.", "success");
}

async function redeemItem(itemId, button) {
  if (!currentUser) {
    setStoreStatus("Sign in with Kick to redeem.", "error");
    return;
  }
  if (!canRedeem) {
    setStoreStatus("This account cannot redeem store rewards.", "error");
    return;
  }

  const item = catalog.find((entry) => entry.id === itemId);
  if (!item) {
    setStoreStatus("That reward is not available.", "error");
    return;
  }

  if (button) button.disabled = true;
  try {
    await openRedeemModal(item);
  } finally {
    if (button) button.disabled = false;
  }
}

function initRedeemModal() {
  const modal = document.getElementById("store-redeem-modal");
  const form = document.getElementById("store-redeem-form");
  const search = document.getElementById("store-redeem-slot-search");
  if (!modal || !form) return;

  document.getElementById("store-redeem-cancel")?.addEventListener("click", () => {
    closeRedeemModal();
  });
  document.getElementById("store-redeem-backdrop")?.addEventListener("click", () => {
    closeRedeemModal();
  });
  document.getElementById("store-redeem-slot-clear")?.addEventListener("click", () => {
    clearSelectedRedeemSlot();
  });
  search?.addEventListener("input", () => {
    renderRedeemSlotResults();
  });
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = document.querySelector("#store-redeem-slot-results .hunt-add-slot-option");
      first?.click();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("is-hidden")) {
      closeRedeemModal();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const itemId = form.dataset.itemId || "";
    const needsBonusType = form.dataset.needsBonusType === "1";
    const bonusType =
      form.querySelector('input[name="bonusType"]:checked')?.value || "";
    const submit = document.getElementById("store-redeem-submit");

    if (!selectedRedeemSlot?.name || !selectedRedeemSlot?.slug) {
      setRedeemModalError("Pick a slot from New Releases or Only on Stake.");
      search?.focus();
      return;
    }
    if (needsBonusType && !bonusType) {
      setRedeemModalError("Pick Regular, Super, or Epic.");
      return;
    }

    if (submit) submit.disabled = true;
    setRedeemModalError("");
    setStoreStatus("Redeeming...");
    try {
      await submitRedeemDetails({
        itemId,
        slotName: selectedRedeemSlot.name,
        slotSlug: selectedRedeemSlot.slug,
        bonusType,
      });
      closeRedeemModal();
    } catch (error) {
      setRedeemModalError(error.message || "Could not redeem item.");
      setStoreStatus(error.message || "Could not redeem item.", "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
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
    setStoreStatus("Redemption cancelled and UncCoins refunded.", "success");
    document
      .getElementById("store-history-panel")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setStoreStatus(error.message || "Could not cancel redemption.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function deletePastRedemption(id, button) {
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/points/delete-redemption", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not delete redemption.");
    }
    pendingQueue = Array.isArray(data.redemptions) ? data.redemptions : [];
    await loadMe();
    renderAll();
    setStoreStatus("Past redemption deleted.", "success");
  } catch (error) {
    setStoreStatus(error.message || "Could not delete redemption.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function setCatalogFormMode({ editing = false } = {}) {
  const label = document.getElementById("store-catalog-form-label");
  const submit = document.getElementById("store-catalog-submit");
  const cancel = document.getElementById("store-catalog-cancel-edit");
  if (label) label.textContent = editing ? "Edit reward" : "Add reward";
  if (submit) submit.textContent = editing ? "Save changes" : "Add to catalog";
  cancel?.classList.toggle("is-hidden", !editing);
}

function clearCatalogForm() {
  const form = document.getElementById("store-catalog-form");
  const idInput = document.getElementById("store-item-id");
  form?.reset();
  if (idInput) idInput.value = "";
  setCatalogFormMode({ editing: false });
}

function beginCatalogEdit(item) {
  const idInput = document.getElementById("store-item-id");
  const title = document.getElementById("store-item-title");
  const cost = document.getElementById("store-item-cost");
  const description = document.getElementById("store-item-description");
  if (!idInput || !title || !cost || !description) return;

  idInput.value = item.id || "";
  title.value = item.title || "";
  cost.value = String(item.cost ?? "");
  description.value = item.description || "";
  setCatalogFormMode({ editing: true });

  document
    .getElementById("store-catalog-form")
    ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  title.focus();
}

function initCatalogForm() {
  const form = document.getElementById("store-catalog-form");
  if (!form) return;

  document
    .getElementById("store-catalog-cancel-edit")
    ?.addEventListener("click", () => {
      clearCatalogForm();
      setStoreStatus("");
    });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = document.getElementById("store-item-id")?.value || "";
    const title = document.getElementById("store-item-title")?.value || "";
    const cost = document.getElementById("store-item-cost")?.value || "";
    const description =
      document.getElementById("store-item-description")?.value || "";
    const existing = id ? catalog.find((entry) => entry.id === id) : null;
    const editing = Boolean(id);

    setStoreStatus(editing ? "Saving changes..." : "Saving catalog item...");
    try {
      const response = await fetch("/api/points/catalog", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id || undefined,
          title,
          cost: Number(cost),
          description,
          active: existing ? existing.active !== false : true,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not save item.");
      }
      catalog = Array.isArray(data.catalog) ? data.catalog : catalog;
      clearCatalogForm();
      renderAll();
      setStoreStatus(
        editing ? "Catalog item updated." : "Catalog item added.",
        "success"
      );
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

function initBuyForm() {
  const form = document.getElementById("store-buy-form");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });
}

function handlePurchaseReturnQuery() {
  const params = new URLSearchParams(window.location.search);
  const purchase = params.get("purchase");
  if (!purchase) return;

  if (purchase === "success") {
    setStoreStatus(
      "Payment received. UncCoins credit after the crypto payment confirms — refresh in a moment if your balance has not updated yet.",
      "success"
    );
  } else if (purchase === "cancel") {
    setStoreStatus("Purchase cancelled. No UncCoins were charged.", "error");
  }

  params.delete("purchase");
  const next = params.toString();
  const url = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
  window.history.replaceState({}, "", url);
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
        `Awarded ${data.amount > 0 ? "+" : ""}${data.amount} UncCoins to ${data.awarded} chatters (last ${data.withinMinutes}m).`,
        "success"
      );
    } catch (error) {
      setAwardChatStatus(error.message || "Could not award chatters.", "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function initBuyToggle() {
  const toggle = document.getElementById("store-buy-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    if (!currentUser?.isAdmin) {
      toggle.checked = buyConfig.enabled !== false;
      return;
    }

    const nextEnabled = Boolean(toggle.checked);
    const previous = buyConfig.enabled !== false;
    toggle.disabled = true;
    try {
      const response = await fetch("/api/points/buy/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not update buy UncCoins.");
      }
      buyConfig.enabled = data.enabled !== false;
      renderBuyToggle();
      renderBuyForm();
      renderBuyPackages();
      setStoreStatus(
        buyConfig.enabled
          ? "Buy UncCoins resumed."
          : "Buy UncCoins paused.",
        "success"
      );
    } catch (error) {
      buyConfig.enabled = previous;
      toggle.checked = previous;
      renderBuyToggle();
      setStoreStatus(error.message || "Could not update buy UncCoins.", "error");
    } finally {
      toggle.disabled = false;
    }
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  await refreshStore();
});

window.addEventListener("points:change", (event) => {
  if (!currentUser) return;
  const points = Number(event.detail?.points);
  if (!Number.isFinite(points)) return;
  pointsBalance = points;
  renderBalance();
  renderCatalog();
  void loadLeaderboard()
    .then(() => renderLeaderboard())
    .catch(() => {});
});

initCatalogForm();
initBuyForm();
initBuyToggle();
initAwardChatForm();
initRedeemModal();
document.getElementById("store-unc-filter")?.addEventListener("input", (event) => {
  storeLbFilter = event.target.value || "";
  applyStoreLbFilter();
});
window.setInterval(paintStoreRace, 60000);
handlePurchaseReturnQuery();
refreshStore();
