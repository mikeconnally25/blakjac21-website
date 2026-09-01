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

function createAvatar(user) {
  const avatar = document.createElement("span");
  avatar.className = "accounts-avatar";

  if (user.profilePicture) {
    const image = document.createElement("img");
    image.src = user.profilePicture;
    image.alt = "";
    image.width = 36;
    image.height = 36;
    avatar.append(image);
    return avatar;
  }

  avatar.textContent = (user.username || "?").slice(0, 1).toUpperCase();
  return avatar;
}

function renderAccounts(users, total) {
  const list = document.getElementById("accounts-list");
  const empty = document.getElementById("accounts-empty");
  const tableHead = document.getElementById("accounts-table-head");
  const count = document.getElementById("accounts-count");

  if (!list || !empty || !tableHead) return;

  if (count) {
    count.textContent = `${total} registered`;
  }

  list.replaceChildren();

  const hasUsers = users.length > 0;
  empty.classList.toggle("is-hidden", hasUsers);
  tableHead.classList.toggle("is-hidden", !hasUsers);
  list.classList.toggle("is-hidden", !hasUsers);

  if (!hasUsers) {
    empty.textContent = "No registered users yet.";
    return;
  }

  users.forEach((user, index) => {
    const item = document.createElement("li");
    item.className = "accounts-entry";

    const rank = document.createElement("span");
    rank.className = "accounts-rank";
    rank.textContent = String(index + 1).padStart(2, "0");

    const player = document.createElement("div");
    player.className = "accounts-player";
    player.append(createAvatar(user));

    const name = document.createElement("span");
    name.className = "accounts-username";
    name.textContent = user.username;
    player.append(name);

    const kickId = document.createElement("span");
    kickId.className = "accounts-kick-id";
    kickId.textContent = user.kickUserId;

    const joined = document.createElement("span");
    joined.className = "accounts-date";
    joined.textContent = formatDate(user.createdAt);

    const lastLogin = document.createElement("span");
    lastLogin.className = "accounts-date";
    lastLogin.textContent = formatDate(user.lastLoginAt);

    item.append(rank, player, kickId, joined, lastLogin);
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
