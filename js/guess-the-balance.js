let gameEnabled = false;
let currentUser = null;
let pollTimer = null;
let enabledLockUntil = 0;

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function setGuessStatus(message, type = "") {
  const status = document.getElementById("guess-status");
  if (!status) return;

  status.textContent = message;
  status.classList.remove("is-hidden", "is-success", "is-error");
  status.classList.toggle("is-success", type === "success");
  status.classList.toggle("is-error", type === "error");

  if (!message) {
    status.classList.add("is-hidden");
  }
}

function updateToggleLabel() {
  const label = document.getElementById("game-toggle-status");
  const toggle = document.getElementById("game-toggle");

  if (label) {
    label.textContent = gameEnabled
      ? "Guessing is on — viewers can submit guesses"
      : "Guessing is off — viewers cannot submit guesses";
  }

  if (toggle && currentUser?.isAdmin) {
    toggle.checked = gameEnabled;
  }
}

function updateGamePanels() {
  const guest = document.getElementById("game-panel-guest");
  const member = document.getElementById("game-panel-member");
  const closed = document.getElementById("game-panel-closed");
  const waiting = document.getElementById("game-panel-waiting");
  const adminPanel = document.getElementById("game-admin-panel");
  const guessInput = document.getElementById("guess-amount");
  const guessSubmit = document.getElementById("guess-submit");
  const isSignedIn = Boolean(currentUser);
  const canGuess = gameEnabled && isSignedIn;

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  closed?.classList.toggle("is-hidden", gameEnabled || isSignedIn);
  guest?.classList.toggle("is-hidden", !gameEnabled || isSignedIn);
  member?.classList.toggle("is-hidden", !isSignedIn);
  waiting?.classList.toggle("is-hidden", gameEnabled || !isSignedIn);

  if (guessInput) {
    guessInput.disabled = !canGuess;
    guessInput.removeAttribute("readonly");
  }

  if (guessSubmit) {
    guessSubmit.disabled = !canGuess;
  }
}

function schedulePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  const interval = currentUser && !gameEnabled ? 2000 : 5000;
  pollTimer = setInterval(loadGameStatus, interval);
}

async function loadGameStatus() {
  try {
    const response = await fetch("/api/guess-the-balance/status", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    const wasEnabled = gameEnabled;
    const nextEnabled = Boolean(data.enabled);

    if (
      Date.now() < enabledLockUntil &&
      gameEnabled &&
      !nextEnabled &&
      currentUser?.isAdmin
    ) {
      schedulePolling();
      return;
    }

    gameEnabled = nextEnabled;
    updateToggleLabel();
    updateGamePanels();

    if (!wasEnabled && gameEnabled && currentUser) {
      setGuessStatus("Guessing is open. Enter your guess below.", "success");
    }

    schedulePolling();
  } catch {
    // Keep the last known state.
  }
}

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      currentUser = null;
      return;
    }

    const data = await response.json();
    currentUser = data.authenticated ? data.user : null;

    const gameUsername = document.getElementById("game-username");
    if (gameUsername && currentUser) {
      gameUsername.textContent = currentUser.username;
    }
  } catch {
    currentUser = null;
  }
}

async function setGameEnabled(enabled) {
  const response = await fetch("/api/guess-the-balance/toggle", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not update guessing status.");
  }

  gameEnabled = Boolean(data.enabled);
  if (gameEnabled) {
    enabledLockUntil = Date.now() + 15000;
  } else {
    enabledLockUntil = 0;
  }
  updateToggleLabel();
  updateGamePanels();
  schedulePolling();
}

function initAdminToggle() {
  const toggle = document.getElementById("game-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    const nextEnabled = toggle.checked;
    toggle.disabled = true;

    try {
      await setGameEnabled(nextEnabled);
      setGuessStatus("");
    } catch (error) {
      toggle.checked = !nextEnabled;
      setGuessStatus(error.message, "error");
    } finally {
      toggle.disabled = false;
    }
  });
}

function initGuessForm() {
  const form = document.getElementById("guess-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      setGuessStatus("Sign in with Kick to submit a guess.", "error");
      return;
    }

    await loadGameStatus();

    if (!gameEnabled) {
      setGuessStatus("Guessing is currently closed.", "error");
      return;
    }

    const input = document.getElementById("guess-amount");
    const submitBtn = document.getElementById("guess-submit");
    const amount = Number(input?.value);

    if (!Number.isFinite(amount) || amount < 0) {
      setGuessStatus("Enter a valid balance amount.", "error");
      return;
    }

    submitBtn.disabled = true;
    setGuessStatus("Submitting your guess...");

    try {
      const response = await fetch("/api/guess-the-balance/submit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      const data = await response.json();

      if (!response.ok) {
        setGuessStatus(data.error || "Could not submit your guess.", "error");
        if (response.status === 403) {
          gameEnabled = false;
          updateGamePanels();
          schedulePolling();
        }
        return;
      }

      setGuessStatus(
        `Guess submitted: ${formatCurrency(data.guess.amount)}`,
        "success"
      );
      form.reset();
    } catch {
      setGuessStatus("Could not submit your guess. Try again.", "error");
    } finally {
      submitBtn.disabled = !gameEnabled || !currentUser;
    }
  });
}

window.addEventListener("auth:change", (event) => {
  currentUser = event.detail?.user || null;

  const gameUsername = document.getElementById("game-username");
  if (gameUsername && currentUser) {
    gameUsername.textContent = currentUser.username;
  }

  updateGamePanels();
  schedulePolling();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadGameStatus();
  }
});

async function bootstrapGuessPage() {
  await Promise.all([loadGameStatus(), loadCurrentUser()]);
  updateGamePanels();
  schedulePolling();
}

initAdminToggle();
initGuessForm();
bootstrapGuessPage();
