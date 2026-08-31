let gameEnabled = false;
let endingBalance = null;
let currentUser = null;
let pollTimer = null;
let guessesPollTimer = null;
let enabledLockUntil = 0;

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function setEndingBalanceStatus(message, type = "") {
  const status = document.getElementById("ending-balance-status");
  if (!status) return;

  status.textContent = message;
  status.classList.remove("is-hidden", "is-success", "is-error");
  status.classList.toggle("is-success", type === "success");
  status.classList.toggle("is-error", type === "error");

  if (!message) {
    status.classList.add("is-hidden");
  }
}

function updateEndingBalanceInput() {
  const input = document.getElementById("ending-balance");
  if (!input || !currentUser?.isAdmin) return;

  if (endingBalance === null || endingBalance === undefined) {
    input.value = "";
    return;
  }

  input.value = String(endingBalance);
}

function scheduleGuessesPolling() {
  if (guessesPollTimer) {
    clearInterval(guessesPollTimer);
  }

  guessesPollTimer = setInterval(loadGuesses, 1000);
}

function renderGuessesList(guesses) {
  const list = document.getElementById("guesses-list");
  const empty = document.getElementById("guesses-empty");
  const count = document.getElementById("guesses-count");

  if (!list || !empty || !count) return;

  const total = guesses.length;
  count.textContent = total === 1 ? "1 guess" : `${total} guesses`;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

  guesses.forEach((guess) => {
    const item = document.createElement("li");
    item.className = "guess-entry";

    const user = document.createElement("span");
    user.className = "guess-entry-user";
    user.textContent = guess.username;

    const amount = document.createElement("span");
    amount.className = "guess-entry-amount";
    amount.textContent = formatCurrency(guess.amount);

    item.append(user, amount);
    list.append(item);
  });
}

function createPodiumSlot(place, winner) {
  const slot = document.createElement("div");
  slot.className = `podium-slot place-${place}`;

  const block = document.createElement("div");
  block.className = "podium-block";

  const medal = document.createElement("span");
  medal.className = "podium-medal";
  medal.textContent = place === 1 ? "1st" : place === 2 ? "2nd" : "3rd";

  const user = document.createElement("span");
  user.className = "podium-user";
  user.textContent = winner?.username ?? "—";

  block.append(medal, user);

  if (winner) {
    const guess = document.createElement("span");
    guess.className = "podium-guess";
    guess.textContent = formatCurrency(winner.amount);

    const diff = document.createElement("span");
    diff.className = "podium-diff";
    diff.textContent = `${formatCurrency(winner.difference)} off`;

    block.append(guess, diff);
  }

  slot.append(block);
  return slot;
}

function renderPodium(results) {
  const panel = document.getElementById("podium-panel");
  const stage = document.getElementById("podium-stage");
  const balance = document.getElementById("podium-ending-balance");

  if (!panel || !stage || !balance) return;

  const winners = results?.winners ?? [];
  const hasResults =
    results?.endingBalance !== null &&
    results?.endingBalance !== undefined &&
    winners.length > 0;

  panel.classList.toggle("is-hidden", !hasResults);

  if (!hasResults) {
    stage.replaceChildren();
    return;
  }

  balance.textContent = formatCurrency(results.endingBalance);
  stage.replaceChildren();

  [2, 1, 3].forEach((place) => {
    const winner = winners.find((entry) => entry.place === place);
    stage.append(createPodiumSlot(place, winner));
  });
}

async function loadGuesses() {
  try {
    const response = await fetch("/api/guess-the-balance/guesses", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    renderGuessesList(Array.isArray(data.guesses) ? data.guesses : []);
    renderPodium(data.results ?? null);
  } catch {
    // Keep the last rendered list.
  }
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

function resetPageState() {
  endingBalance = null;
  updateEndingBalanceInput();
  document.getElementById("guess-form")?.reset();
  setGuessStatus("");
  setEndingBalanceStatus("");
  renderGuessesList([]);
  renderPodium(null);
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
    if (Object.prototype.hasOwnProperty.call(data, "endingBalance")) {
      endingBalance = data.endingBalance;
      updateEndingBalanceInput();
    }

    if (wasEnabled && !nextEnabled) {
      resetPageState();
      await loadGuesses();
    }

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
    resetPageState();
    await loadGuesses();
  }
  updateToggleLabel();
  updateGamePanels();
  schedulePolling();
}

function initEndingBalanceForm() {
  const saveBtn = document.getElementById("ending-balance-save");
  const input = document.getElementById("ending-balance");
  if (!saveBtn || !input) return;

  saveBtn.addEventListener("click", async () => {
    if (!currentUser?.isAdmin) return;

    const rawValue = input.value.trim();
    const amount = rawValue === "" ? null : Number(rawValue);

    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setEndingBalanceStatus("Enter a valid balance amount.", "error");
      return;
    }

    saveBtn.disabled = true;
    setEndingBalanceStatus("Saving ending balance...");

    try {
      const response = await fetch("/api/guess-the-balance/ending-balance", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      const data = await response.json();

      if (!response.ok) {
        setEndingBalanceStatus(
          data.error || "Could not save ending balance.",
          "error"
        );
        return;
      }

      endingBalance = data.endingBalance ?? null;
      updateEndingBalanceInput();
      setEndingBalanceStatus(
        endingBalance === null
          ? "Ending balance cleared."
          : `Ending balance saved: ${formatCurrency(endingBalance)}`,
        "success"
      );
      await loadGuesses();
    } catch {
      setEndingBalanceStatus("Could not save ending balance. Try again.", "error");
    } finally {
      saveBtn.disabled = false;
    }
  });
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
      await loadGuesses();
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
  updateEndingBalanceInput();
  schedulePolling();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadGameStatus();
    loadGuesses();
  }
});

async function bootstrapGuessPage() {
  await Promise.all([loadGameStatus(), loadCurrentUser(), loadGuesses()]);
  updateGamePanels();
  updateEndingBalanceInput();
  schedulePolling();
  scheduleGuessesPolling();
}

initAdminToggle();
initEndingBalanceForm();
initGuessForm();
bootstrapGuessPage();
