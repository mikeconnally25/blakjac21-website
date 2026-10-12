const statusEl = document.getElementById("avgx-status");
const slotEl = document.getElementById("avgx-slot");
const metricsEl = document.getElementById("avgx-metrics");
const bonusesEl = document.getElementById("avgx-bonuses");
const rangesEl = document.getElementById("avgx-ranges");
const formEl = document.getElementById("avgx-bet-form");
const amountEl = document.getElementById("avgx-amount");
const yoursEl = document.getElementById("avgx-yours");
const betsEl = document.getElementById("avgx-bets");
const adminEl = document.getElementById("avgx-admin");
const searchEl = document.getElementById("avgx-search");
const resultsEl = document.getElementById("avgx-results");
const pickedEl = document.getElementById("avgx-picked");
const editorEl = document.getElementById("avgx-editor");

let state = null;
let catalog = [];
let catalogLoading = false;
let pickedSlot = null;
let draft = [{ cost: "", win: "" }];
let selectedRange = "";

function setStatus(message, kind) {
  statusEl.textContent = message || "";
  statusEl.className = `avgx-status${kind ? ` is-${kind}` : ""}`;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatX(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(2)}x`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rangeLabel(rangeId) {
  return state?.ranges?.find((range) => range.id === rangeId)?.label || rangeId;
}

function renderBoard() {
  if (!state?.slot) {
    slotEl.innerHTML = `<p class="avgx-empty">No slot is set yet.</p>`;
  } else {
    const thumb = state.slot.thumbnailUrl
      ? `<img src="${escapeHtml(state.slot.thumbnailUrl)}" alt="" />`
      : "";
    slotEl.innerHTML = `
      <div class="avgx-slot-main">
        ${thumb}
        <div>
          <p class="avgx-kicker">${escapeHtml(state.status === "settled" ? "Final" : "Now playing")}</p>
          <h3>${escapeHtml(state.slot.name)}</h3>
          <p>${escapeHtml(state.slot.provider || "")}</p>
        </div>
      </div>`;
  }

  const averageLabel = state?.final ? "Final average" : "Running average";
  metricsEl.innerHTML = `
    <div><span>${averageLabel}</span><strong>${formatX(state?.averageX)}</strong></div>
    <div><span>Bonuses in</span><strong>${state?.filledCount || 0} / ${state?.bonusCount || 0}</strong></div>
    <div><span>Pool</span><strong>${state?.pool || 0}</strong></div>`;

  if (!state?.bonuses?.length) {
    bonusesEl.innerHTML = "";
  } else {
    const rows = state.bonuses
      .map(
        (bonus, index) => `<tr>
          <td>${index + 1}</td>
          <td>${money(bonus.cost)}</td>
          <td>${bonus.win == null ? "—" : money(bonus.win)}</td>
          <td>${formatX(bonus.x)}</td>
        </tr>`
      )
      .join("");
    bonusesEl.innerHTML = `<table class="avgx-table">
      <thead><tr><th>#</th><th>Buy</th><th>Win</th><th>X</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const yours = state?.yourBet;
  if (yours && !selectedRange) selectedRange = yours.rangeId;
  rangesEl.innerHTML = (state?.ranges || [])
    .map((range) => {
      const selected = range.id === selectedRange ? " is-selected" : "";
      const winner = state?.final && range.id === state.winningRangeId ? " is-winner" : "";
      return `<button type="button" class="avgx-range${selected}${winner}" data-range="${escapeHtml(range.id)}">
        <span>${escapeHtml(range.label)}</span>
        <strong>${range.stake || 0}</strong>
        <small>${range.count || 0} bets</small>
      </button>`;
    })
    .join("");

  if (!state || state.status !== "open") {
    formEl.classList.add("is-hidden");
  } else if (state.balance == null) {
    formEl.classList.add("is-hidden");
  } else {
    formEl.classList.remove("is-hidden");
    if (state.maxBet) amountEl.max = String(state.maxBet);
  }

  if (state?.status === "open" && state.balance == null) {
    yoursEl.textContent = "Sign in with Kick to bet.";
  } else if (yours) {
    const payout =
      yours.payout == null
        ? ""
        : yours.refund
          ? " Refunded."
          : ` Paid ${yours.payout} UncCoins.`;
    yoursEl.textContent = `Your bet: ${yours.amount} on ${rangeLabel(yours.rangeId)}.${payout}`;
  } else if (state?.status === "settled") {
    yoursEl.textContent = `Final average ${formatX(state.averageX)} · ${rangeLabel(state.winningRangeId)}.`;
  } else {
    yoursEl.textContent =
      state?.status === "open"
        ? `You have ${state.balance ?? 0} UncCoins.`
        : state?.status === "locked"
          ? "Bets are closed. Totals are going in."
          : "";
  }

  const bets = state?.bets || [];
  betsEl.innerHTML = bets
    .slice()
    .reverse()
    .slice(0, 40)
    .map(
      (bet) =>
        `<li><span>${escapeHtml(bet.username)}</span><span>${escapeHtml(rangeLabel(bet.rangeId))}</span><strong>${bet.amount}</strong></li>`
    )
    .join("");
}

function readDraftFromEditor() {
  const costs = [...editorEl.querySelectorAll("[data-cost]")];
  const wins = [...editorEl.querySelectorAll("[data-win]")];
  if (!costs.length) return;
  draft = costs.map((input, index) => ({
    cost: input.value,
    win: wins[index]?.value ?? "",
  }));
}

function renderEditor() {
  const locked = state?.status === "locked";
  editorEl.innerHTML = draft
    .map(
      (row, index) => `<div class="avgx-row">
        <span>${index + 1}</span>
        <label>Buy<input class="guess-input" data-cost type="number" min="0.01" step="0.01" value="${escapeHtml(row.cost)}" /></label>
        <label>Win<input class="guess-input" data-win type="number" min="0" step="0.01" value="${escapeHtml(row.win)}" ${locked || state?.status === "open" ? "" : ""} /></label>
        <button type="button" class="btn btn-sm btn-outline" data-remove="${index}">Remove</button>
      </div>`
    )
    .join("");
  pickedEl.textContent = pickedSlot
    ? `${pickedSlot.name}${pickedSlot.provider ? ` · ${pickedSlot.provider}` : ""}`
    : "No slot picked.";
}

function renderAdmin() {
  const admin = Boolean(state?.isAdmin);
  adminEl.classList.toggle("is-hidden", !admin);
  if (!admin) return;
  loadCatalog().catch((error) => setStatus(error.message, "error"));
  if (adminEl.contains(document.activeElement)) return;
  if (state?.slot && !pickedSlot) pickedSlot = state.slot;
  if (state?.bonuses?.length && draft.length === 1 && draft[0].cost === "" && !editorEl.querySelector("[data-cost]")) {
    draft = state.bonuses.map((bonus) => ({
      cost: bonus.cost ?? "",
      win: bonus.win ?? "",
    }));
  }
  renderEditor();
}

function render() {
  renderBoard();
  renderAdmin();
}

async function refresh() {
  const response = await fetch("/api/average-x", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load Average X.");
  state = data;
  render();
}

async function post(body) {
  const response = await fetch("/api/average-x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not update Average X.");
  state = data;
  render();
}

async function loadCatalog() {
  if (!state?.isAdmin || catalog.length || catalogLoading) return;
  catalogLoading = true;
  try {
    const response = await fetch("/api/bonus-hunt/slots", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load slots.");
    catalog = Array.isArray(data.slots) ? data.slots : [];
    if (searchEl.value.trim().length >= 2) showMatches();
  } finally {
    catalogLoading = false;
  }
}

function showMatches() {
  const query = searchEl.value.trim().toLowerCase();
  if (query.length < 2) {
    resultsEl.innerHTML = "";
    return;
  }
  const matches = catalog
    .filter((slot) => `${slot.name} ${slot.provider || ""}`.toLowerCase().includes(query))
    .slice(0, 8);
  resultsEl.innerHTML = matches
    .map(
      (slot, index) =>
        `<button type="button" data-pick="${index}">${escapeHtml(slot.name)}${slot.provider ? ` · ${escapeHtml(slot.provider)}` : ""}</button>`
    )
    .join("");
  resultsEl._matches = matches;
}

rangesEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-range]");
  if (!button) return;
  selectedRange = button.dataset.range;
  renderBoard();
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedRange) {
    setStatus("Pick a range first.", "error");
    return;
  }
  try {
    await post({ action: "bet", rangeId: selectedRange, amount: amountEl.value });
    setStatus("Bet placed.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

searchEl.addEventListener("input", () => {
  loadCatalog()
    .then(() => showMatches())
    .catch((error) => setStatus(error.message, "error"));
});

resultsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-pick]");
  if (!button) return;
  pickedSlot = resultsEl._matches?.[Number(button.dataset.pick)] || null;
  searchEl.value = pickedSlot?.name || "";
  resultsEl.innerHTML = "";
  renderEditor();
});

editorEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  readDraftFromEditor();
  draft.splice(Number(button.dataset.remove), 1);
  if (!draft.length) draft.push({ cost: "", win: "" });
  renderEditor();
});

document.getElementById("avgx-add").addEventListener("click", () => {
  readDraftFromEditor();
  draft.push({ cost: "", win: "" });
  renderEditor();
});

document.getElementById("avgx-save").addEventListener("click", async () => {
  readDraftFromEditor();
  try {
    await post({
      action: "setup",
      slot: pickedSlot,
      bonuses: draft.map((row) => ({ cost: row.cost })),
    });
    draft = (state.bonuses || []).map((bonus) => ({ cost: bonus.cost, win: "" }));
    setStatus("Round saved. Open bets when you are ready.", "ok");
    renderEditor();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-open").addEventListener("click", async () => {
  try {
    await post({ action: "open" });
    setStatus("Bets are open.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-close").addEventListener("click", async () => {
  try {
    await post({ action: "close" });
    setStatus("Bets are closed. Enter the win totals as they finish.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-totals").addEventListener("click", async () => {
  readDraftFromEditor();
  try {
    await post({
      action: "totals",
      wins: draft.map((row) => (row.win === "" ? null : row.win)),
    });
    setStatus("Totals saved.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-settle").addEventListener("click", async () => {
  try {
    await post({ action: "settle" });
    setStatus(`Settled at ${formatX(state.averageX)}.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-reset").addEventListener("click", async () => {
  if (!window.confirm("Reset this round? Open bets are refunded.")) return;
  try {
    await post({ action: "reset" });
    pickedSlot = null;
    draft = [{ cost: "", win: "" }];
    selectedRange = "";
    setStatus("Round cleared.", "ok");
    renderEditor();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

searchEl.addEventListener("focus", () => {
  loadCatalog().catch((error) => setStatus(error.message, "error"));
});

refresh().catch((error) => setStatus(error.message, "error"));
setInterval(() => {
  refresh().catch(() => {});
}, 4000);
