let currentUser = null;

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

function updateAccountCounts(total) {
  const heroCount = document.getElementById("accounts-hero-count");
  const countBadge = document.getElementById("accounts-count-badge");
  const countPill = document.getElementById("accounts-count");

  if (heroCount) heroCount.textContent = String(total);
  if (countBadge) countBadge.textContent = String(total);
  if (countPill) {
    countPill.textContent = `${total} registered`;
  }
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

function renderAccounts(users, total) {
  const list = document.getElementById("accounts-list");
  const empty = document.getElementById("accounts-empty");

  if (!list || !empty) return;

  updateAccountCounts(total);
  list.replaceChildren();

  const hasUsers = users.length > 0;
  empty.classList.toggle("is-hidden", hasUsers);
  list.classList.toggle("is-hidden", !hasUsers);

  if (!hasUsers) {
    empty.textContent = "No registered users yet.";
    return;
  }

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

    const name = document.createElement("span");
    name.className = "accounts-username";
    name.textContent = user.username;

    const kickId = document.createElement("span");
    kickId.className = "accounts-kick-id";
    kickId.textContent = `Kick ID ${user.kickUserId}`;

    copy.append(name, kickId);
    player.append(copy);

    const meta = document.createElement("div");
    meta.className = "accounts-entry-meta";
    meta.append(
      createMetaItem("Joined", formatDate(user.createdAt)),
      createMetaItem("Last login", formatDate(user.lastLoginAt))
    );

    main.append(player, meta);
    item.append(rank, main);
    list.append(item);
  });
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

    setAccountsStatus("");
    renderAccounts(data.users || [], data.total || 0);
  } catch {
    setAccountsStatus("Could not load accounts.", "error");
  }
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  renderAccessState();
  await loadAccounts();
});

async function initAccounts() {
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
