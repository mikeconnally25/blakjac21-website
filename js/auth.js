function getAuthMessage() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get("auth");
  const message = params.get("message");

  if (!auth) return null;

  if (auth === "created") return "Account created with your Kick login.";
  if (auth === "signed-in") return "Signed in with Kick.";
  if (auth === "error") {
    if (message === "Client authentication failed") {
      return "Kick rejected the client secret. Regenerate it in Kick Developer Portal, paste it into .env, run npm run verify:kick until it says SUCCESS, then update Vercel and redeploy.";
    }
    return message || "Kick sign-in failed.";
  }

  return null;
}

function clearAuthQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("auth")) return;

  url.searchParams.delete("auth");
  url.searchParams.delete("message");
  window.history.replaceState({}, "", url);
}

function renderAuthState(user) {
  const guest = document.getElementById("auth-guest");
  const member = document.getElementById("auth-member");
  const usernameEl = document.getElementById("auth-username");
  const adminBadge = document.getElementById("auth-admin-badge");
  const adminAccountsNav = document.getElementById("admin-nav-accounts");
  const avatarEl = document.getElementById("auth-avatar");
  const toast = document.getElementById("auth-toast");
  const gameUsername = document.getElementById("game-username");

  if (!guest || !member) return;

  if (user) {
    guest.classList.add("is-hidden");
    member.classList.remove("is-hidden");

    if (usernameEl) usernameEl.textContent = user.username;
    if (gameUsername) gameUsername.textContent = user.username;
    if (adminBadge) adminBadge.classList.toggle("is-hidden", !user.isAdmin);
    if (adminAccountsNav) {
      adminAccountsNav.classList.toggle("is-hidden", !user.isAdmin);
    }
    if (avatarEl) {
      if (user.profilePicture) {
        avatarEl.src = user.profilePicture;
        avatarEl.alt = `${user.username} profile`;
        avatarEl.classList.remove("is-hidden");
      } else {
        avatarEl.removeAttribute("src");
        avatarEl.classList.add("is-hidden");
      }
    }
  } else {
    guest.classList.remove("is-hidden");
    member.classList.add("is-hidden");
    if (adminAccountsNav) adminAccountsNav.classList.add("is-hidden");
  }

  window.dispatchEvent(
    new CustomEvent("auth:change", {
      detail: { user: user || null },
    })
  );

  const authMessage = getAuthMessage();
  if (authMessage && toast) {
    toast.textContent = authMessage;
    toast.classList.remove("is-hidden");
    toast.classList.toggle("is-error", new URLSearchParams(window.location.search).get("auth") === "error");
    clearAuthQuery();
  }
}

async function loadAuthState() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!response.ok) {
      renderAuthState(null);
      return;
    }

    const data = await response.json();
    renderAuthState(data.authenticated ? data.user : null);
  } catch {
    renderAuthState(null);
  }
}

function initAuth() {
  const returnTo = encodeURIComponent(
    `${window.location.pathname}${window.location.search}`
  );

  document.querySelectorAll('a[href="/api/auth/login"]').forEach((link) => {
    link.href = `/api/auth/login?returnTo=${returnTo}`;
  });

  const logoutBtn = document.getElementById("auth-logout");

  logoutBtn?.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    renderAuthState(null);
  });

  loadAuthState();
}

initAuth();
