let currentUser = null;
let pollTimer = null;

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function setStatus(message, tone = "") {
  const status = document.getElementById("bonus-hunt-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
}

function renderSummary(summary) {
  const totalBonuses = document.getElementById("summary-total");
  const totalCost = document.getElementById("summary-cost");
  const totalWon = document.getElementById("summary-won");
  const profit = document.getElementById("summary-profit");

  if (!totalBonuses || !totalCost || !totalWon || !profit) return;

  totalBonuses.textContent = String(summary.totalBonuses);
  totalCost.textContent = formatCurrency(summary.totalCost);
  totalWon.textContent = formatCurrency(summary.totalWon);

  profit.textContent = formatCurrency(summary.profit);
  profit.classList.toggle("is-positive", summary.profit > 0);
  profit.classList.toggle("is-negative", summary.profit < 0);
}

function renderBonusList(bonuses) {
  const list = document.getElementById("bonus-list");
  const empty = document.getElementById("bonus-empty");
  const count = document.getElementById("bonus-count");

  if (!list || !empty || !count) return;

  const total = bonuses.length;
  count.textContent =
    total === 1 ? "1 bonus" : `${total} bonuses`;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

  bonuses.forEach((bonus) => {
    const item = document.createElement("li");
    item.className = "bonus-entry";
    item.dataset.id = bonus.id;

    const main = document.createElement("div");
    main.className = "bonus-entry-main";

    const number = document.createElement("span");
    number.className = "bonus-entry-number";
    number.textContent = `#${bonus.number}`;

    const slot = document.createElement("span");
    slot.className = "bonus-entry-slot";
    slot.textContent = bonus.slot;

    const meta = document.createElement("div");
    meta.className = "bonus-entry-meta";

    const bet = document.createElement("span");
    bet.className = "bonus-entry-bet";
    bet.textContent = formatCurrency(bonus.bet);

    const payout = document.createElement("span");
    payout.className = "bonus-entry-payout";
    payout.textContent =
      bonus.status === "opened"
        ? formatCurrency(bonus.payout ?? 0)
        : "Pending";

    const status = document.createElement("span");
    status.className = `bonus-entry-status bonus-entry-status--${bonus.status}`;
    status.textContent = bonus.status === "opened" ? "Opened" : "Pending";

    meta.append(bet, payout, status);
    main.append(number, slot, meta);
    item.append(main);

    if (currentUser?.isAdmin) {
      const actions = document.createElement("div");
      actions.className = "bonus-entry-actions";

      if (bonus.status === "pending") {
        const payoutInput = document.createElement("input");
        payoutInput.className = "bonus-payout-input";
        payoutInput.type = "number";
        payoutInput.inputMode = "decimal";
        payoutInput.min = "0";
        payoutInput.step = "0.01";
        payoutInput.placeholder = "Payout";
        payoutInput.setAttribute("aria-label", `Payout for ${bonus.slot}`);

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "btn btn-sm btn-primary";
        openBtn.textContent = "Save";
        openBtn.addEventListener("click", () =>
          saveBonusPayout(bonus.id, payoutInput.value, openBtn)
        );

        actions.append(payoutInput, openBtn);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-sm btn-outline";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeBonusEntry(bonus.id, removeBtn));
      actions.append(removeBtn);
      item.append(actions);
    }

    list.append(item);
  });
}

async function loadBonusHunt() {
  try {
    const response = await fetch("/api/bonus-hunt", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    renderSummary(data.summary);
    renderBonusList(data.bonuses);
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
  } catch {
    currentUser = null;
  }
}

function updateAdminPanel() {
  const panel = document.getElementById("bonus-hunt-admin");
  panel?.classList.toggle("is-hidden", !currentUser?.isAdmin);
}

function schedulePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(loadBonusHunt, 2000);
}

async function saveBonusPayout(id, rawPayout, button) {
  const payout = Number(rawPayout);
  if (!Number.isFinite(payout) || payout < 0) {
    setStatus("Enter a valid payout amount.", "error");
    return;
  }

  button.disabled = true;
  setStatus("Saving payout...");

  try {
    const response = await fetch("/api/bonus-hunt/update", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, payout }),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not save payout.", "error");
      return;
    }

    setStatus("Payout saved.", "success");
    await loadBonusHunt();
  } catch {
    setStatus("Could not save payout. Try again.", "error");
  } finally {
    button.disabled = false;
  }
}

async function removeBonusEntry(id, button) {
  button.disabled = true;
  setStatus("Removing bonus...");

  try {
    const response = await fetch("/api/bonus-hunt/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not remove bonus.", "error");
      return;
    }

    setStatus("Bonus removed.", "success");
    await loadBonusHunt();
  } catch {
    setStatus("Could not remove bonus. Try again.", "error");
  } finally {
    button.disabled = false;
  }
}

function initAdminForm() {
  const form = document.getElementById("bonus-add-form");
  const clearBtn = document.getElementById("bonus-clear-hunt");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const slotInput = document.getElementById("bonus-slot");
    const betInput = document.getElementById("bonus-bet");
    const submitBtn = document.getElementById("bonus-add-submit");
    const slot = slotInput?.value.trim();
    const bet = Number(betInput?.value);

    if (!slot) {
      setStatus("Enter a slot name.", "error");
      return;
    }

    if (!Number.isFinite(bet) || bet < 0) {
      setStatus("Enter a valid bet amount.", "error");
      return;
    }

    submitBtn.disabled = true;
    setStatus("Adding bonus...");

    try {
      const response = await fetch("/api/bonus-hunt/add", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, bet }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not add bonus.", "error");
        return;
      }

      form.reset();
      setStatus("Bonus added.", "success");
      await loadBonusHunt();
    } catch {
      setStatus("Could not add bonus. Try again.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  clearBtn?.addEventListener("click", async () => {
    if (!window.confirm("Clear the entire bonus hunt?")) {
      return;
    }

    clearBtn.disabled = true;
    setStatus("Clearing bonus hunt...");

    try {
      const response = await fetch("/api/bonus-hunt/clear", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not clear bonus hunt.", "error");
        return;
      }

      setStatus("Bonus hunt cleared.", "success");
      await loadBonusHunt();
    } catch {
      setStatus("Could not clear bonus hunt. Try again.", "error");
    } finally {
      clearBtn.disabled = false;
    }
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  updateAdminPanel();
  await loadBonusHunt();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadBonusHunt();
  }
});

async function bootstrapBonusHuntPage() {
  await Promise.all([loadCurrentUser(), loadBonusHunt()]);
  updateAdminPanel();
  schedulePolling();
}

initAdminForm();
bootstrapBonusHuntPage();
