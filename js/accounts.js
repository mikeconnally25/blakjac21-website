let currentUser = null;
let allUsers = [];
let altClusters = [];
let searchQuery = "";
let filterAffOnly = false;
let filterSubOnly = false;

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
  const hasFilters = Boolean(trimmedQuery || filterAffOnly || filterSubOnly);

  if (heroCount) heroCount.textContent = String(total);
  if (countBadge) countBadge.textContent = String(total);

  if (countPill) {
    countPill.textContent =
      hasFilters && visible !== total
        ? `${visible} of ${total} shown`
        : `${total} registered`;
  }

  if (searchResults) {
    if (!hasFilters) {
      searchResults.textContent = "";
      searchResults.classList.add("is-hidden");
      return;
    }

    const parts = [];
    if (trimmedQuery) parts.push(`"${trimmedQuery}"`);
    if (filterAffOnly) parts.push("AFF");
    if (filterSubOnly) parts.push("SUB");
    const label = parts.join(" + ");

    searchResults.textContent =
      visible === 0
        ? `No players match ${label}.`
        : `${visible} player${visible === 1 ? "" : "s"} match ${label}.`;
    searchResults.classList.remove("is-hidden");
  }
}

function filterUsers(users, query) {
  const term = query.trim().toLowerCase();

  return users.filter((user) => {
    if (filterAffOnly && !user.stakeCodeVerified) {
      return false;
    }
    if (filterSubOnly && !user.kickSubActive) {
      return false;
    }

    if (!term) {
      return true;
    }

    const username = String(user.username || "").toLowerCase();
    const kickUserId = String(user.kickUserId || "").toLowerCase();
    const stakeUsername = String(user.stakeUsername || "").toLowerCase();
    const lastLoginIp = String(user.lastLoginIp || "").toLowerCase();
    const lastLoginLocation = String(user.lastLoginLocation || "").toLowerCase();
    const historyIps = (user.loginHistory || [])
      .map((entry) => String(entry.ip || "").toLowerCase())
      .join(" ");
    const historyPlaces = (user.loginHistory || [])
      .map((entry) =>
        [entry.city, entry.region, entry.country]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      )
      .join(" ");
    const altNames = (user.possibleAlts || [])
      .map((alt) => String(alt.username || "").toLowerCase())
      .join(" ");

    return (
      username.includes(term) ||
      kickUserId.includes(term) ||
      stakeUsername.includes(term) ||
      lastLoginIp.includes(term) ||
      lastLoginLocation.includes(term) ||
      historyIps.includes(term) ||
      historyPlaces.includes(term) ||
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

    (cluster.users || []).forEach((user, index) => {
      if (index > 0) {
        names.append(document.createTextNode(" · "));
      }

      const name = document.createElement("span");
      name.className = user.isPrimary
        ? "accounts-alts-name is-primary"
        : "accounts-alts-name is-blocked";
      name.textContent = user.isPrimary
        ? `${user.username} (primary)`
        : `${user.username} (blocked)`;
      names.append(name);
    });

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
    const parts = [];
    if (searchQuery.trim()) parts.push(`"${searchQuery.trim()}"`);
    if (filterAffOnly) parts.push("AFF");
    if (filterSubOnly) parts.push("SUB");
    empty.textContent = parts.length
      ? `No players match ${parts.join(" + ")}.`
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

    const badges = document.createElement("span");
    badges.className = "accounts-badges";

    if (Boolean(user.stakeCodeVerified)) {
      const affBadge = document.createElement("span");
      affBadge.className = "accounts-aff-badge";
      affBadge.textContent = "AFF";
      affBadge.title = user.affOnRoster
        ? "Verified on code BLAKJAC21"
        : "Manually granted AFF";
      badges.append(affBadge);
    }

    if (Boolean(user.kickSubActive)) {
      const subBadge = document.createElement("span");
      subBadge.className = "accounts-sub-badge";
      subBadge.textContent = "SUB";
      subBadge.title = "Active Kick subscriber";
      badges.append(subBadge);
    }

    if ((user.possibleAlts || []).length > 0) {
      const altBadge = document.createElement("span");
      altBadge.className = user.altSoftBlocked
        ? "accounts-alt-badge is-soft-blocked"
        : "accounts-alt-badge is-primary";
      altBadge.textContent = user.altSoftBlocked ? "ALT" : "ALT?";
      const primaryName =
        allUsers.find((entry) => entry.kickUserId === user.altPrimaryKickUserId)
          ?.username || "oldest account";
      altBadge.title = user.altSoftBlocked
        ? `Soft-blocked shared-IP alt. Oldest eligible: ${primaryName}`
        : `Primary in shared-IP cluster (eligible). Possible alts: ${(
            user.possibleAlts || []
          )
            .map((alt) => alt.username)
            .join(", ")}`;
      badges.append(altBadge);
    }

    if (badges.childElementCount > 0) {
      nameRow.append(badges);
    }

    if (!user.affOnRoster) {
      const affToggle = document.createElement("button");
      affToggle.type = "button";
      affToggle.className = user.affGranted
        ? "btn btn-sm btn-outline accounts-aff-toggle"
        : "btn btn-sm btn-primary accounts-aff-toggle";
      affToggle.textContent = user.affGranted ? "Revoke AFF" : "Grant AFF";
      affToggle.title = user.affGranted
        ? "Remove manually granted AFF"
        : "Manually give this user the AFF pill";
      affToggle.addEventListener("click", () => {
        void setAccountAffGranted(user.kickUserId, !user.affGranted, affToggle);
      });
      nameRow.append(affToggle);
    }

    copy.append(nameRow);

    const stakeRow = document.createElement("div");
    stakeRow.className = "accounts-stake-row";

    const stakeLabel = document.createElement("span");
    stakeLabel.className = "accounts-kick-id";
    if (user.stakeUsername) {
      stakeLabel.textContent = user.stakeCodeVerified
        ? `Stake: ${user.stakeUsername} (verified)`
        : `Stake: ${user.stakeUsername} (unverified)`;
    } else {
      stakeLabel.textContent = `Kick ID ${user.kickUserId}`;
    }

    const editStakeBtn = document.createElement("button");
    editStakeBtn.type = "button";
    editStakeBtn.className = "btn btn-sm btn-outline accounts-stake-edit";
    editStakeBtn.textContent = user.stakeUsername ? "Edit" : "Link";
    editStakeBtn.title = user.stakeUsername
      ? "Edit linked Stake username"
      : "Link a Stake username";

    const showStakeEditor = () => {
      stakeRow.replaceChildren();

      const prefix = document.createElement("span");
      prefix.className = "accounts-kick-id";
      prefix.textContent = "Stake:";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "accounts-stake-input";
      input.value = user.stakeUsername || "";
      input.placeholder = "Stake username";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 24;

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-sm btn-primary accounts-stake-save";
      saveBtn.textContent = "Save";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-sm btn-outline accounts-stake-cancel";
      cancelBtn.textContent = "Cancel";

      const restoreRow = () => {
        stakeRow.replaceChildren(stakeLabel, editStakeBtn);
      };

      const submit = () => {
        void setAccountStakeUsername(
          user.kickUserId,
          input.value,
          saveBtn,
          cancelBtn
        );
      };

      saveBtn.addEventListener("click", submit);
      cancelBtn.addEventListener("click", restoreRow);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          restoreRow();
        }
      });

      stakeRow.append(prefix, input, saveBtn, cancelBtn);
      input.focus();
      input.select();
    };

    editStakeBtn.addEventListener("click", showStakeEditor);
    stakeRow.append(stakeLabel, editStakeBtn);
    copy.append(stakeRow);

    const pointsRow = document.createElement("div");
    pointsRow.className = "accounts-points-row";

    const pointsLabel = document.createElement("span");
    pointsLabel.className = "accounts-kick-id";
    pointsLabel.textContent = `Points: ${Number(user.points) || 0}`;

    const pointsInput = document.createElement("input");
    pointsInput.type = "number";
    pointsInput.className = "accounts-points-input";
    pointsInput.placeholder = "+100";
    pointsInput.step = "1";

    const pointsBtn = document.createElement("button");
    pointsBtn.type = "button";
    pointsBtn.className = "btn btn-sm btn-primary accounts-points-award";
    pointsBtn.textContent = "Award";
    pointsBtn.title = "Award (or subtract with a negative amount) points";
    pointsBtn.addEventListener("click", () => {
      void awardAccountPoints(user.kickUserId, pointsInput.value, pointsBtn);
    });

    pointsRow.append(pointsLabel, pointsInput, pointsBtn);
    copy.append(pointsRow);

    if ((user.possibleAlts || []).length > 0) {
      const alts = document.createElement("p");
      alts.className = "accounts-alt-note";
      const primaryName =
        allUsers.find((entry) => entry.kickUserId === user.altPrimaryKickUserId)
          ?.username || "oldest account";
      const status = user.altSoftBlocked
        ? `Soft-blocked — oldest eligible: ${primaryName}.`
        : "Primary account — eligible to win giveaways and podium.";
      alts.textContent = `${status} Possible alts: ${(user.possibleAlts || [])
        .map((alt) => `${alt.username} (${alt.sharedIps.join(", ")})`)
        .join(" · ")}`;
      copy.append(alts);
    }

    player.append(copy);

    const meta = document.createElement("div");
    meta.className = "accounts-entry-meta";
    meta.append(
      createMetaItem("Joined", formatDate(user.createdAt)),
      createMetaItem("Last login", formatDate(user.lastLoginAt)),
      createMetaItem(
        "Last from",
        user.lastLoginLocation || user.lastLoginIp || "—"
      ),
      createMetaItem(
        "Stake linked",
        user.stakeLinkedAt ? formatDate(user.stakeLinkedAt) : "Not linked"
      )
    );

    const details = document.createElement("details");
    details.className = "accounts-login-details";

    const summary = document.createElement("summary");
    summary.className = "accounts-login-summary";
    summary.textContent = user.registrationIp
      ? "Login IPs"
      : "Login IPs (none recorded yet)";

    const detailsBody = document.createElement("div");
    detailsBody.className = "accounts-login-body";

    const registerRow = document.createElement("div");
    registerRow.className = "accounts-login-row";

    const registerLabel = document.createElement("span");
    registerLabel.className = "accounts-login-label";
    registerLabel.textContent = "Registered with";

    const registerValue = document.createElement("span");
    registerValue.className = "accounts-login-value";
    if (user.registrationIp) {
      const place = user.registrationLocation
        ? `${user.registrationLocation} · `
        : "";
      registerValue.textContent = `${place}${user.registrationIp}${
        user.registrationAt ? ` · ${formatDateTime(user.registrationAt)}` : ""
      }`;
    } else {
      registerValue.textContent =
        "No registration IP yet. It is saved the next time this account signs in with Kick.";
    }

    registerRow.append(registerLabel, registerValue);
    detailsBody.append(registerRow);

    if (user.lastLoginIp) {
      const lastRow = document.createElement("div");
      lastRow.className = "accounts-login-row";

      const lastLabel = document.createElement("span");
      lastLabel.className = "accounts-login-label";
      lastLabel.textContent = "Last login";

      const lastValue = document.createElement("span");
      lastValue.className = "accounts-login-value";
      const place = user.lastLoginLocation ? `${user.lastLoginLocation} · ` : "";
      lastValue.textContent = `${place}${user.lastLoginIp}${
        user.lastLoginAt ? ` · ${formatDateTime(user.lastLoginAt)}` : ""
      }`;

      lastRow.append(lastLabel, lastValue);
      detailsBody.append(lastRow);
    }

    const history = user.loginHistory || [];
    if (history.length > 0) {
      const historyLabel = document.createElement("p");
      historyLabel.className = "accounts-login-history-label";
      historyLabel.textContent = "Login history";
      detailsBody.append(historyLabel);

      const historyList = document.createElement("ul");
      historyList.className = "accounts-login-history";

      [...history].reverse().forEach((entry) => {
        const historyItem = document.createElement("li");
        const place = [entry.city, entry.region, entry.country]
          .filter(Boolean)
          .join(", ");
        historyItem.textContent = `${entry.ip}${
          place ? ` · ${place}` : ""
        } · ${formatDateTime(entry.at)}`;
        historyList.append(historyItem);
      });

      detailsBody.append(historyList);
    }

    details.append(summary, detailsBody);

    main.append(player, meta, details);
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

async function setAccountAffGranted(kickUserId, granted, button) {
  if (button) button.disabled = true;
  setAccountsStatus(granted ? "Granting AFF..." : "Revoking AFF...");

  try {
    const response = await fetch("/api/users/aff-grant", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kickUserId, granted }),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      setAccountsStatus(
        response.ok
          ? "Could not update AFF status."
          : `Could not update AFF status (${response.status}).`,
        "error"
      );
      return;
    }

    if (!response.ok) {
      setAccountsStatus(data.error || "Could not update AFF status.", "error");
      return;
    }

    allUsers = data.users || [];
    altClusters = data.altClusters || [];
    setAccountsStatus(
      granted ? "AFF granted." : "AFF revoked.",
      "success"
    );
    renderFilteredAccounts();
  } catch {
    setAccountsStatus("Could not update AFF status.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function setAccountStakeUsername(kickUserId, stakeUsername, saveButton, cancelButton) {
  if (saveButton) saveButton.disabled = true;
  if (cancelButton) cancelButton.disabled = true;
  setAccountsStatus("Updating Stake username...");

  try {
    const response = await fetch("/api/users/set-stake", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kickUserId, stakeUsername }),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      setAccountsStatus(
        response.ok
          ? "Could not update Stake username."
          : `Could not update Stake username (${response.status}).`,
        "error"
      );
      return;
    }

    if (!response.ok) {
      setAccountsStatus(
        data.error || "Could not update Stake username.",
        "error"
      );
      return;
    }

    allUsers = data.users || [];
    altClusters = data.altClusters || [];
    setAccountsStatus("Stake username updated.", "success");
    renderFilteredAccounts();
  } catch {
    setAccountsStatus("Could not update Stake username.", "error");
  } finally {
    if (saveButton) saveButton.disabled = false;
    if (cancelButton) cancelButton.disabled = false;
  }
}

async function awardAccountPoints(kickUserId, amountValue, button) {
  const amount = Number(amountValue);
  if (!Number.isFinite(amount) || amount === 0) {
    setAccountsStatus("Enter a non-zero points amount.", "error");
    return;
  }

  if (button) button.disabled = true;
  setAccountsStatus(amount > 0 ? "Awarding points..." : "Adjusting points...");

  try {
    const response = await fetch("/api/points/award", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kickUserId, amount }),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      setAccountsStatus(
        response.ok
          ? "Could not update points."
          : `Could not update points (${response.status}).`,
        "error"
      );
      return;
    }

    if (!response.ok) {
      setAccountsStatus(data.error || "Could not update points.", "error");
      return;
    }

    allUsers = data.users || [];
    altClusters = data.altClusters || [];
    setAccountsStatus(
      `Points updated. Balance: ${data.balance?.points ?? 0}.`,
      "success"
    );
    renderFilteredAccounts();
  } catch {
    setAccountsStatus("Could not update points.", "error");
  } finally {
    if (button) button.disabled = false;
  }
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
  const affToggle = document.getElementById("accounts-filter-aff");
  const subToggle = document.getElementById("accounts-filter-sub");

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

  affToggle?.addEventListener("click", () => {
    filterAffOnly = !filterAffOnly;
    affToggle.classList.toggle("is-active", filterAffOnly);
    affToggle.setAttribute("aria-pressed", filterAffOnly ? "true" : "false");
    renderFilteredAccounts();
  });

  subToggle?.addEventListener("click", () => {
    filterSubOnly = !filterSubOnly;
    subToggle.classList.toggle("is-active", filterSubOnly);
    subToggle.setAttribute("aria-pressed", filterSubOnly ? "true" : "false");
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
