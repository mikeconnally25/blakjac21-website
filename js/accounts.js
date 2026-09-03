let currentUser = null;
let allUsers = [];
let altClusters = [];
let searchQuery = "";

function formatDate(iso) {
  if (!iso) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function formatDateTime(iso) {
  if (!iso) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function setAccountsStatus(message, tone = "") {
  const status = document.getElementById("accounts-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
}

function renderAccessState() {
  const panel = document.getElementById("accounts-panel");
  const denied = document.getElementById("accounts-denied");
  const isAdmin = Boolean(currentUser?.isAdmin);

  panel?.classList.toggle("is-hidden", !isAdmin);
  denied?.classList.toggle("is-hidden", isAdmin);
}

function updateAccountCounts(total, visible = total) {
  const heroCount = document.getElementById("accounts-hero-count");
  const countBadge = document.getElementById("accounts-count-badge");
  const countPill = document.getElementById("accounts-count");
  const searchResults = document.getElementById("accounts-search-results");
  const trimmedQuery = searchQuery.trim();

  if (heroCount) heroCount.textContent = String(total);
  if (countBadge) countBadge.textContent = String(total);

  if (countPill) {
    countPill.textContent =
      trimmedQuery && visible !== total
        ? `${visible} of ${total} shown`
        : `${total} registered`;
  }

  if (searchResults) {
    if (!trimmedQuery) {
      searchResults.textContent = "";
      searchResults.classList.add("is-hidden");
      return;
    }

    searchResults.textContent =
      visible === 0
        ? `No players match "${trimmedQuery}".`
        : `${visible} player${visible === 1 ? "" : "s"} match "${trimmedQuery}".`;
    searchResults.classList.remove("is-hidden");
  }
}

function filterUsers(users, query) {
  const term = query.trim().toLowerCase();
  if (!term) {
    return users;
  }

  return users.filter((user) => {
    const username = String(user.username || "").toLowerCase();
    const kickUserId = String(user.kickUserId || "").toLowerCase();
    const stakeUsername = String(user.stakeUsername || "").toLowerCase();
    const lastLoginIp = String(user.lastLoginIp || "").toLowerCase();
    const historyIps = (user.loginHistory || [])
      .map((entry) => String(entry.ip || "").toLowerCase())
      .join(" ");
    const altNames = (user.possibleAlts || [])
      .map((alt) => String(alt.username || "").toLowerCase())
      .join(" ");

    return (
      username.includes(term) ||
      kickUserId.includes(term) ||
      stakeUsername.includes(term) ||
      lastLoginIp.includes(term) ||
      historyIps.includes(term) ||
      altNames.includes(term)
    );
  });
}

function createAvatar(user) {
  const avatar = document.createElement("span");
  avatar.className = "accounts-avatar";

  if (user.profilePicture) {
    const image = document.createElement("img");
    image.src = user.profilePicture;
    image.alt = "";
    image.width = 40;
    image.height = 40;
    avatar.append(image);
    return avatar;
  }

  avatar.textContent = (user.username || "?").slice(0, 1).toUpperCase();
  return avatar;
}

function createMetaItem(label, value) {
  const item = document.createElement("div");
  item.className = "accounts-meta-item";

  const labelEl = document.createElement("span");
  labelEl.className = "accounts-meta-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "accounts-date";
  valueEl.textContent = value;

  item.append(labelEl, valueEl);
  return item;
}

function renderAltClusters() {
  const panel = document.getElementById("accounts-alts-panel");
  const list = document.getElementById("accounts-alts-list");
  const count = document.getElementById("accounts-alts-count");

  if (!panel || !list || !count) return;

  const clusters = altClusters || [];
  count.textContent =
    clusters.length === 1 ? "1 cluster" : `${clusters.length} clusters`;
  panel.classList.toggle("is-hidden", clusters.length === 0);
  list.replaceChildren();

  clusters.forEach((cluster) => {
    const item = document.createElement("li");
    item.className = "accounts-alts-entry";

    const names = document.createElement("p");
    names.className = "accounts-alts-names";
    names.textContent = (cluster.users || [])
      .map((user) => user.username)
      .join(" · ");

    const ips = document.createElement("p");
    ips.className = "accounts-alts-ips";
    ips.textContent = `Shared IP${
      (cluster.sharedIps || []).length === 1 ? "" : "s"
    }: ${(cluster.sharedIps || []).join(", ")}`;

    item.append(names, ips);
    list.append(item);
  });
}

function renderAccounts(users) {
  const list = document.getElementById("accounts-list");
  const empty = document.getElementById("accounts-empty");

  if (!list || !empty) return;

  const total = allUsers.length;
  const visible = users.length;
  updateAccountCounts(total, visible);
  list.replaceChildren();

  if (total === 0) {
    empty.textContent = "No registered users yet.";
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  if (visible === 0) {
    empty.textContent = searchQuery.trim()
      ? `No players match "${searchQuery.trim()}".`
      : "No registered users yet.";
    empty.classList.remove("is-hidden");
    list.classList.add("is-hidden");
    return;
  }

  empty.classList.add("is-hidden");
  list.classList.remove("is-hidden");

  users.forEach((user, index) => {
    const item = document.createElement("li");
    item.className = "accounts-entry";

    const rank = document.createElement("span");
    rank.className = "accounts-entry-rank";
    rank.textContent = String(index + 1).padStart(2, "0");

    const main = document.createElement("div");
    main.className = "accounts-entry-main";

    const player = document.createElement("div");
    player.className = "accounts-player";
    player.append(createAvatar(user));

    const copy = document.createElement("div");
    copy.className = "accounts-entry-copy";

    const nameRow = document.createElement("div");
    nameRow.className = "accounts-name-row";

    const name = document.createElement("span");
    name.className = "accounts-username";
    name.textContent = user.username;
    nameRow.append(name);

    if (user.stakeCodeVerified) {
      const affBadge = document.createElement("span");
      affBadge.className = "accounts-aff-badge";
      affBadge.textContent = "AFF";
      affBadge.title = "Verified on code BLAKJAC21";
      nameRow.append(affBadge);
    }

    if (user.kickSubActive) {
      const subBadge = document.createElement("span");
      subBadge.className = "accounts-sub-badge";
      subBadge.textContent = "SUB";
      subBadge.title = "Active Kick subscriber";
      nameRow.append(subBadge);
    }

    if ((user.possibleAlts || []).length > 0) {
      const altBadge = document.createElement("span");
      altBadge.className = "accounts-alt-badge";
      altBadge.textContent = "ALT?";
      altBadge.title = `Possible shared-IP alts: ${(user.possibleAlts || [])
        .map((alt) => alt.username)
        .join(", ")}`;
      nameRow.append(altBadge);
    }

    copy.append(nameRow);

    const kickId = document.createElement("span");
    kickId.className = "accounts-kick-id";
    kickId.textContent = user.stakeUsername
      ? `Stake: ${user.stakeUsername}`
      : `Kick ID ${user.kickUserId}`;

    copy.append(kickId);

    if ((user.possibleAlts || []).length > 0) {
      const alts = document.createElement("p");
      alts.className = "accounts-alt-note";
      alts.textContent = `Possible alts: ${(user.possibleAlts || [])
        .map((alt) => `${alt.username} (${alt.sharedIps.join(", ")})`)
        .join(" · ")}`;
      copy.append(alts);
    }

    if (user.lastLoginIp) {
      const ipNote = document.createElement("p");
      ipNote.className = "accounts-ip-note";
      const recent = (user.loginHistory || []).slice(-3).reverse();
      ipNote.textContent = recent.length
        ? `Recent IPs: ${recent
            .map((entry) => `${entry.ip} · ${formatDateTime(entry.at)}`)
            .join(" · ")}`
        : `Last IP: ${user.lastLoginIp}`;
      copy.append(ipNote);
    }

    player.append(copy);

    const meta = document.createElement("div");
    meta.className = "accounts-entry-meta";
    meta.append(
      createMetaItem("Joined", formatDate(user.createdAt)),
      createMetaItem("Last login", formatDate(user.lastLoginAt)),
      createMetaItem(
        "Stake linked",
        user.stakeLinkedAt ? formatDate(user.stakeLinkedAt) : "Not linked"
      )
    );

    main.append(player, meta);
    item.append(rank, main);
    list.append(item);
  });
}

function renderFilteredAccounts() {
  renderAltClusters();
  renderAccounts(filterUsers(allUsers, searchQuery));
}

function updateSearchControls() {
  const clearBtn = document.getElementById("accounts-search-clear");
  const hasQuery = Boolean(searchQuery.trim());
  clearBtn?.classList.toggle("is-hidden", !hasQuery);
}

async function loadAccounts() {
  if (!currentUser?.isAdmin) {
    renderAccessState();
    return;
  }

  setAccountsStatus("Loading accounts...");

  try {
    const response = await fetch("/api/users", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      setAccountsStatus(data.error || "Could not load accounts.", "error");
      return;
    }

    allUsers = data.users || [];
    altClusters = data.altClusters || [];
    setAccountsStatus("");
    renderFilteredAccounts();
    updateSearchControls();
  } catch {
    setAccountsStatus("Could not load accounts.", "error");
  }
}

function initSearch() {
  const searchInput = document.getElementById("accounts-search");
  const clearBtn = document.getElementById("accounts-search-clear");

  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value;
    updateSearchControls();
    renderFilteredAccounts();
  });

  clearBtn?.addEventListener("click", () => {
    searchQuery = "";
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    updateSearchControls();
    renderFilteredAccounts();
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  renderAccessState();
  await loadAccounts();
});

async function initAccounts() {
  initSearch();

  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      renderAccessState();
      return;
    }

    const data = await response.json();
    currentUser = data.authenticated ? data.user : null;
    renderAccessState();
    await loadAccounts();
  } catch {
    renderAccessState();
  }
}

initAccounts();
