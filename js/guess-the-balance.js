let gameEnabled = false;
let currentUser = null;

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

  if (toggle) {
    toggle.checked = gameEnabled;
  }
}

function updateGamePanels() {
  const guest = document.getElementById("game-panel-guest");
  const member = document.getElementById("game-panel-member");
  const closed = document.getElementById("game-panel-closed");
  const adminPanel = document.getElementById("game-admin-panel");
  const isSignedIn = Boolean(currentUser);

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  closed?.classList.toggle("is-hidden", gameEnabled);
  guest?.classList.toggle("is-hidden", gameEnabled || isSignedIn);
  member?.classList.toggle("is-hidden", !gameEnabled || !isSignedIn);
}

async function loadGameStatus() {
  try {
    const response = await fetch("/api/guess-the-balance/status", {
      credentials: "same-origin",
    });

    if (!response.ok) return;

    const data = await response.json();
    gameEnabled = Boolean(data.enabled);
    updateToggleLabel();
    updateGamePanels();
  } catch {
    // Keep the last known state.
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
  updateToggleLabel();
  updateGamePanels();
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
      submitBtn.disabled = false;
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
});

initAdminToggle();
initGuessForm();
loadGameStatus();
