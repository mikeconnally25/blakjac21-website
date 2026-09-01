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

let currentAuthUser = null;

function ensureStakeLinkModal() {
  if (document.getElementById("stake-link-modal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.id = "stake-link-modal";
  modal.className = "stake-link-modal is-hidden";
  modal.innerHTML = `
    <div class="stake-link-backdrop" data-stake-link-dismiss></div>
    <div class="stake-link-dialog" role="dialog" aria-modal="true" aria-labelledby="stake-link-title">
      <p class="stake-link-eyebrow">One more step</p>
      <h2 class="stake-link-title" id="stake-link-title">Link your Stake account</h2>
      <p class="stake-link-copy">
        Enter your Stake username so we can match you on leaderboards, giveaways, and stream games.
        Use code <strong>BLAKJAC21</strong> when you sign up.
      </p>
      <form class="stake-link-form" id="stake-link-form">
        <label class="guess-label" for="stake-link-input">Stake username</label>
        <div class="guess-input-row">
          <input
            class="guess-input"
            id="stake-link-input"
            name="stakeUsername"
            type="text"
            maxlength="24"
            autocomplete="username"
            spellcheck="false"
            placeholder="YourStakeName"
            required
          />
        </div>
        <p class="stake-link-error is-hidden" id="stake-link-error" role="alert"></p>
        <div class="stake-link-actions">
          <button type="submit" class="btn btn-sm btn-primary" id="stake-link-submit">
            Link account
          </button>
          <button type="button" class="btn btn-sm btn-outline" id="stake-link-skip">
            Skip for now
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const form = modal.querySelector("#stake-link-form");
  const skipBtn = modal.querySelector("#stake-link-skip");
  const backdrop = modal.querySelector("[data-stake-link-dismiss]");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitStakeLink();
  });

  skipBtn?.addEventListener("click", () => {
    sessionStorage.setItem("bj21-stake-prompt-dismissed", "1");
    hideStakeLinkModal();
  });

  backdrop?.addEventListener("click", () => {
    sessionStorage.setItem("bj21-stake-prompt-dismissed", "1");
    hideStakeLinkModal();
  });
}

function setStakeLinkError(message) {
  const error = document.getElementById("stake-link-error");
  if (!error) return;

  error.textContent = message;
  error.classList.toggle("is-hidden", !message);
}

function hideStakeLinkModal() {
  document.getElementById("stake-link-modal")?.classList.add("is-hidden");
  setStakeLinkError("");
}

function showStakeLinkModal() {
  ensureStakeLinkModal();
  const modal = document.getElementById("stake-link-modal");
  const input = document.getElementById("stake-link-input");
  modal?.classList.remove("is-hidden");
  setStakeLinkError("");
  if (input) {
    input.value = "";
    input.focus();
  }
}

function maybeShowStakeLinkPrompt(user) {
  const params = new URLSearchParams(window.location.search);
  const justAuthed =
    params.get("auth") === "created" || params.get("auth") === "signed-in";

  if (justAuthed) {
    sessionStorage.removeItem("bj21-stake-prompt-dismissed");
  }

  if (!user?.kickUserId || user.stakeUsername) {
    hideStakeLinkModal();
    return;
  }

  if (sessionStorage.getItem("bj21-stake-prompt-dismissed") === "1") {
    hideStakeLinkModal();
    return;
  }

  showStakeLinkModal();
}

async function submitStakeLink() {
  const input = document.getElementById("stake-link-input");
  const submitBtn = document.getElementById("stake-link-submit");
  const stakeUsername = input?.value.trim();

  if (!stakeUsername) {
    setStakeLinkError("Enter your Stake username.");
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  setStakeLinkError("");

  try {
    const response = await fetch("/api/users/link-stake", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stakeUsername }),
    });
    const data = await response.json();

    if (!response.ok) {
      setStakeLinkError(data.error || "Could not link Stake account.");
      return;
    }

    currentAuthUser = data.user;
    renderAuthState(data.user);
    hideStakeLinkModal();
  } catch {
    setStakeLinkError("Could not link Stake account. Try again.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function renderAuthState(user) {
  currentAuthUser = user || null;

  const guest = document.getElementById("auth-guest");
  const member = document.getElementById("auth-member");
  const usernameEl = document.getElementById("auth-username");
  const adminBadge = document.getElementById("auth-admin-badge");
  const adminAccountsNav = document.getElementById("admin-nav-accounts");
  const stakeBadge = document.getElementById("auth-stake-badge");
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
    if (stakeBadge) {
      stakeBadge.textContent = user.stakeUsername
        ? `Stake: ${user.stakeUsername}`
        : "Link Stake";
      stakeBadge.classList.toggle("is-linked", Boolean(user.stakeUsername));
      stakeBadge.classList.remove("is-hidden");
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
    if (stakeBadge) stakeBadge.classList.add("is-hidden");
    hideStakeLinkModal();
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
    toast.classList.toggle(
      "is-error",
      new URLSearchParams(window.location.search).get("auth") === "error"
    );
    clearAuthQuery();
  }

  maybeShowStakeLinkPrompt(user);
}

function initStakeBadge() {
  const authUser = document.querySelector(".auth-user");
  if (!authUser || document.getElementById("auth-stake-badge")) {
    return;
  }

  const badge = document.createElement("button");
  badge.type = "button";
  badge.id = "auth-stake-badge";
  badge.className = "auth-stake-badge is-hidden";
  badge.addEventListener("click", () => {
    if (currentAuthUser?.stakeUsername) {
      return;
    }
    showStakeLinkModal();
  });

  authUser.append(badge);
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
  ensureStakeLinkModal();
  initStakeBadge();

  const returnTo = encodeURIComponent(
    `${window.location.pathname}${window.location.search}`
  );

  document.querySelectorAll('a[href="/api/auth/login"]').forEach((link) => {
    link.href = `/api/auth/login?returnTo=${returnTo}`;
  });

  const logoutBtn = document.getElementById("auth-logout");

  logoutBtn?.addEventListener("click", async () => {
    sessionStorage.removeItem("bj21-stake-prompt-dismissed");
    await fetch("/api/auth/logout", { method: "POST" });
    renderAuthState(null);
  });

  loadAuthState();
}

initAuth();
