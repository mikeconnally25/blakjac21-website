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
let selectedSpinRange = "";
let headSide = "";
const headDraft = {
  left: { slot: null, rows: [{ cost: "", win: "" }] },
  right: { slot: null, rows: [{ cost: "", win: "" }] },
};

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
  const range = state?.ranges?.find((item) => item.id === rangeId);
  if (!range) return rangeId;
  return range.team ? `Team ${range.team} · ${range.label}` : range.label;
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
      <thead><tr><th>#</th><th>Bet</th><th>Payout</th><th>X</th></tr></thead>
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
        <span>${range.team ? `${range.team} · ` : ""}${escapeHtml(range.label)}</span>
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
  editorEl.innerHTML = draft
    .map(
      (row, index) => `<div class="avgx-row">
        <span>${index + 1}</span>
        <label class="avgx-money">
          <span>Bet size</span>
          <span class="guess-input-row">
            <span class="guess-prefix" aria-hidden="true">$</span>
            <input class="guess-input" data-cost type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeHtml(row.cost)}" placeholder="1.00" aria-label="Bonus ${index + 1} bet size" />
          </span>
        </label>
        <label class="avgx-money">
          <span>Payout</span>
          <span class="guess-input-row">
            <span class="guess-prefix" aria-hidden="true">$</span>
            <input class="guess-input" data-win type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(row.win)}" placeholder="0.00" aria-label="Bonus ${index + 1} payout" />
          </span>
        </label>
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

function sideTable(bonuses) {
  if (!bonuses?.length) return "";
  const rows = bonuses
    .map(
      (bonus, index) => `<tr>
        <td>${index + 1}</td>
        <td>${money(bonus.cost)}</td>
        <td>${bonus.win == null ? "—" : money(bonus.win)}</td>
        <td>${formatX(bonus.x)}</td>
      </tr>`
    )
    .join("");
  return `<table class="avgx-table"><thead><tr><th>#</th><th>Buy</th><th>Win</th><th>X</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderHead() {
  const match = state?.head;
  const versus = document.getElementById("avgx-versus");
  const form = document.getElementById("avgx-head-form");
  const yours = document.getElementById("avgx-head-yours");
  const bets = document.getElementById("avgx-head-bets");
  if (!versus) return;

  const card = (side) => {
    if (!side) return "";
    const selected = headSide === side.side ? " is-selected" : "";
    const winner = match?.final && match.winner === side.side ? " is-winner" : "";
    const name = side.slot?.name || `Slot ${side.team}`;
    return `<div>
      <button type="button" class="avgx-side${selected}${winner}" data-head-side="${side.side}">
        <span>${side.team} · ${escapeHtml(name)}</span>
        <strong>${formatX(side.averageX)}</strong>
        <small>${side.stake || 0} in · ${side.filledCount || 0}/${side.bonusCount || 0}</small>
      </button>
      ${sideTable(side.bonuses)}
    </div>`;
  };

  versus.innerHTML = `${card(match?.left)}<p class="avgx-vs">VS</p>${card(match?.right)}`;

  const open = match?.status === "open" && state?.balance != null;
  form.classList.toggle("is-hidden", !open);
  if (state?.maxBet) document.getElementById("avgx-head-amount").max = String(state.maxBet);

  const mine = match?.yourBet;
  if (mine && !headSide) headSide = mine.side;
  if (match?.status === "open" && state?.balance == null) {
    yours.textContent = "Sign in with Kick to bet.";
  } else if (mine) {
    const name = mine.side === "left" ? match.left?.slot?.name : match.right?.slot?.name;
    const paid = mine.payout == null ? "" : mine.refund ? " Refunded." : ` Paid ${mine.payout} UncCoins.`;
    yours.textContent = `Your bet: ${mine.amount} on ${name || mine.side}.${paid}`;
  } else if (match?.final) {
    yours.textContent = match.winner === "tie"
      ? "Tie. Every bet is refunded."
      : `${(match.winner === "left" ? match.left : match.right)?.slot?.name || "Winner"} takes it.`;
  } else if (match?.status === "locked") {
    yours.textContent = "Bets are closed. Totals are going in.";
  } else {
    yours.textContent = "";
  }

  const betters = match?.bets || [];
  bets.classList.toggle("is-hidden", !match);
  bets.innerHTML = match
    ? ["left", "right"]
        .map((side) => headBetterColumn(match, side, betters.filter((bet) => bet.side === side)))
        .join("")
    : "";
}

function headBetterColumn(match, side, rows) {
  const team = match[side];
  const name = team?.slot?.name || `Slot ${team?.team || ""}`;
  const mineId = match.yourBet?.kickUserId || "";
  const people = rows
    .slice()
    .sort((a, b) => b.amount - a.amount || String(a.username).localeCompare(String(b.username)))
    .map((bet) => {
      const mine = bet.kickUserId && bet.kickUserId === mineId ? " is-mine" : "";
      const result =
        bet.payout == null ? "" : bet.refund ? " <small>refund</small>" : ` <small>paid ${bet.payout}</small>`;
      return `<li class="avgx-better${mine}"><span>${escapeHtml(bet.username)}</span><strong>${bet.amount}${result}</strong></li>`;
    })
    .join("");
  return `<div>
    <p class="avgx-betters-label">${team?.team || ""} · ${escapeHtml(name)} · ${team?.stake || 0}</p>
    ${people ? `<ul class="avgx-betters-list">${people}</ul>` : `<p class="avgx-betters-empty">No bets yet</p>`}
  </div>`;
}

function readHeadDraft(side) {
  const editor = document.getElementById(`avgx-head-editor-${side}`);
  const costs = [...editor.querySelectorAll("[data-head-cost]")];
  if (!costs.length) return;
  const wins = [...editor.querySelectorAll("[data-head-win]")];
  headDraft[side].rows = costs.map((input, index) => ({
    cost: input.value,
    win: wins[index]?.value ?? "",
  }));
}

function renderHeadEditor(side) {
  const editor = document.getElementById(`avgx-head-editor-${side}`);
  const picked = document.getElementById(`avgx-head-picked-${side}`);
  const draft = headDraft[side];
  editor.innerHTML = draft.rows
    .map(
      (row, index) => `<div class="avgx-row">
        <span>${index + 1}</span>
        <input class="guess-input" data-head-cost type="number" min="0.01" step="0.01" value="${escapeHtml(row.cost)}" placeholder="Buy" aria-label="Slot bonus ${index + 1} buy" />
        <input class="guess-input" data-head-win type="number" min="0" step="0.01" value="${escapeHtml(row.win)}" placeholder="Win" aria-label="Slot bonus ${index + 1} win" />
        <button type="button" class="btn btn-sm btn-outline" data-head-remove="${index}" data-head-side="${side}">Remove</button>
      </div>`
    )
    .join("");
  picked.textContent = draft.slot
    ? `${draft.slot.name}${draft.slot.provider ? ` · ${draft.slot.provider}` : ""}`
    : "No slot picked.";
}

function updateHeadActions() {
  const status = state?.head?.status || "idle";
  document.getElementById("avgx-head-open")?.classList.toggle("is-hidden", status === "open" || status === "locked");
  document.getElementById("avgx-head-settle")?.classList.toggle("is-hidden", status === "idle" || status === "settled");
  document.getElementById("avgx-head-reset")?.classList.toggle("is-hidden", status === "idle");
}

function renderHeadAdmin() {
  const admin = document.getElementById("avgx-head-admin");
  if (!admin) return;
  admin.classList.toggle("is-hidden", !state?.isAdmin);
  if (!state?.isAdmin) return;
  updateHeadActions();
  if (admin.contains(document.activeElement)) return;
  for (const side of ["left", "right"]) {
    const saved = state.head?.[side];
    if (saved?.slot && !headDraft[side].slot) headDraft[side].slot = saved.slot;
    if (
      saved?.bonuses?.length &&
      headDraft[side].rows.length === 1 &&
      headDraft[side].rows[0].cost === "" &&
      !document.querySelector(`#avgx-head-editor-${side} [data-head-cost]`)
    ) {
      headDraft[side].rows = saved.bonuses.map((bonus) => ({
        cost: bonus.cost ?? "",
        win: bonus.win ?? "",
      }));
    }
    renderHeadEditor(side);
  }
}

function spinLabel(rangeId) {
  const range = state?.spins?.ranges?.find((item) => item.id === rangeId);
  if (!range) return rangeId;
  return range.team ? `Team ${range.team} · ${range.label}` : range.label;
}

function renderSpins() {
  const game = state?.spins;
  const slotLine = document.getElementById("avgx-spins-slot");
  const ranges = document.getElementById("avgx-spins-ranges");
  const form = document.getElementById("avgx-spins-form");
  const yours = document.getElementById("avgx-spins-yours");
  const bets = document.getElementById("avgx-spins-bets");
  if (!ranges || !game) return;

  const slotName = game.slot?.name || state?.slot?.name || "";
  slotLine.textContent = slotName
    ? slotName
    : "Pick a slot above. This bets on how many bonuses hit in 100 spins.";

  const mine = game.yourBet;
  if (mine && !selectedSpinRange) selectedSpinRange = mine.rangeId;
  ranges.innerHTML = (game.ranges || [])
    .map((range) => {
      const selected = range.id === selectedSpinRange ? " is-selected" : "";
      const winner = game.final && range.id === game.winningRangeId ? " is-winner" : "";
      return `<button type="button" class="avgx-range${selected}${winner}" data-spin-range="${escapeHtml(range.id)}">
        <span>${range.team} · ${escapeHtml(range.label)}</span>
        <strong>${range.stake || 0}</strong>
        <small>${range.count || 0} bets</small>
      </button>`;
    })
    .join("");

  const open = game.status === "open" && state?.balance != null;
  form.classList.toggle("is-hidden", !open);
  if (state?.maxBet) document.getElementById("avgx-spins-amount").max = String(state.maxBet);

  if (game.status === "open" && state?.balance == null) {
    yours.textContent = "Sign in with Kick to bet.";
  } else if (mine) {
    const paid = mine.payout == null ? "" : mine.refund ? " Refunded." : ` Paid ${mine.payout} UncCoins.`;
    yours.textContent = `Your bet: ${mine.amount} on ${spinLabel(mine.rangeId)} bonuses.${paid}`;
  } else if (game.final) {
    yours.textContent = `${game.count} bonuses · ${spinLabel(game.winningRangeId)}.`;
  } else if (game.status === "locked") {
    yours.textContent = "Bets are closed.";
  } else {
    yours.textContent = "";
  }

  bets.innerHTML = (game.bets || [])
    .slice()
    .reverse()
    .slice(0, 12)
    .map((bet) => `<li><span>${escapeHtml(bet.username)}</span><span>${escapeHtml(spinLabel(bet.rangeId))}</span><strong>${bet.amount}</strong></li>`)
    .join("");

  const status = game.status || "idle";
  document.getElementById("avgx-spins-open")?.classList.toggle("is-hidden", status === "open" || status === "locked");
  document.getElementById("avgx-spins-settle")?.classList.toggle("is-hidden", status === "idle" || status === "settled");
  document.getElementById("avgx-spins-reset")?.classList.toggle("is-hidden", status === "idle");
  const countInput = document.getElementById("avgx-spins-count");
  if (countInput && document.activeElement !== countInput && game.count != null) {
    countInput.value = String(game.count);
  }
}

function render() {
  renderBoard();
  renderAdmin();
  renderSpins();
  renderHead();
  renderHeadAdmin();
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

document.getElementById("avgx-spins-ranges")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-spin-range]");
  if (!button) return;
  selectedSpinRange = button.dataset.spinRange;
  renderSpins();
});

document.getElementById("avgx-spins-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedSpinRange) {
    setStatus("Pick how many bonuses first.", "error");
    return;
  }
  try {
    await post({
      action: "spins-bet",
      rangeId: selectedSpinRange,
      amount: document.getElementById("avgx-spins-amount").value,
    });
    setStatus("Bet placed.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-spins-open")?.addEventListener("click", async () => {
  try {
    await post({ action: "spins-open", slot: pickedSlot || state?.slot || null });
    setStatus("100 spin bets are open.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-spins-settle")?.addEventListener("click", async () => {
  const count = document.getElementById("avgx-spins-count")?.value;
  if (count === "" || count == null) {
    setStatus("Enter how many bonuses hit.", "error");
    return;
  }
  try {
    await post({ action: "spins-settle", count });
    const game = state.spins;
    setStatus(`${game.count} bonuses. ${spinLabel(game.winningRangeId)} takes the pot.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-spins-reset")?.addEventListener("click", async () => {
  if (!window.confirm("Reset the 100 spins? Open bets are refunded.")) return;
  try {
    await post({ action: "spins-reset" });
    selectedSpinRange = "";
    const countInput = document.getElementById("avgx-spins-count");
    if (countInput) countInput.value = "";
    setStatus("100 spins cleared.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
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

document.getElementById("avgx-versus").addEventListener("click", (event) => {
  const button = event.target.closest("[data-head-side]");
  if (!button) return;
  headSide = button.dataset.headSide;
  renderHead();
});

document.getElementById("avgx-head-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (headSide !== "left" && headSide !== "right") {
    setStatus("Pick a slot first.", "error");
    return;
  }
  try {
    await post({
      action: "head-bet",
      side: headSide,
      amount: document.getElementById("avgx-head-amount").value,
    });
    setStatus("Bet placed.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

function showHeadMatches(side) {
  const input = document.getElementById(`avgx-head-search-${side}`);
  const results = document.getElementById(`avgx-head-results-${side}`);
  const query = input.value.trim().toLowerCase();
  if (query.length < 2) {
    results.innerHTML = "";
    return;
  }
  const matches = catalog
    .filter((slot) => `${slot.name} ${slot.provider || ""}`.toLowerCase().includes(query))
    .slice(0, 6);
  results.innerHTML = matches
    .map(
      (slot, index) =>
        `<button type="button" data-head-pick="${index}" data-head-side="${side}">${escapeHtml(slot.name)}${slot.provider ? ` · ${escapeHtml(slot.provider)}` : ""}</button>`
    )
    .join("");
  results._matches = matches;
}

for (const side of ["left", "right"]) {
  const input = document.getElementById(`avgx-head-search-${side}`);
  input.addEventListener("input", () => {
    loadCatalog()
      .then(() => showHeadMatches(side))
      .catch((error) => setStatus(error.message, "error"));
  });
  input.addEventListener("focus", () => {
    loadCatalog().catch((error) => setStatus(error.message, "error"));
  });
  document.getElementById(`avgx-head-results-${side}`).addEventListener("click", (event) => {
    const button = event.target.closest("[data-head-pick]");
    if (!button) return;
    const results = document.getElementById(`avgx-head-results-${side}`);
    headDraft[side].slot = results._matches?.[Number(button.dataset.headPick)] || null;
    input.value = headDraft[side].slot?.name || "";
    results.innerHTML = "";
    renderHeadEditor(side);
  });
  const editor = document.getElementById(`avgx-head-editor-${side}`);
  editor.addEventListener("input", (event) => {
    if (!event.target.matches("[data-head-cost]")) return;
    const costs = [...editor.querySelectorAll("[data-head-cost]")];
    if (event.target !== costs[0]) return;
    for (const input of costs.slice(1)) input.value = event.target.value;
  });
  editor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-head-remove]");
    if (!button) return;
    readHeadDraft(side);
    headDraft[side].rows.splice(Number(button.dataset.headRemove), 1);
    if (!headDraft[side].rows.length) headDraft[side].rows.push({ cost: "", win: "" });
    renderHeadEditor(side);
  });
  document.getElementById(`avgx-head-add-${side}`).addEventListener("click", () => {
    readHeadDraft(side);
    headDraft[side].rows.push({ cost: headDraft[side].rows[0]?.cost || "", win: "" });
    renderHeadEditor(side);
  });
}

function headSetupBody() {
  readHeadDraft("left");
  readHeadDraft("right");
  return {
    left: { slot: headDraft.left.slot, bonuses: headDraft.left.rows.map((row) => ({ cost: row.cost })) },
    right: { slot: headDraft.right.slot, bonuses: headDraft.right.rows.map((row) => ({ cost: row.cost })) },
  };
}

function headWinGap() {
  readHeadDraft("left");
  readHeadDraft("right");
  const blank = (rows) => rows.some((row) => row.win === "" || row.win == null);
  if (blank(headDraft.left.rows)) return "Enter a win total for every bonus on slot 1.";
  if (blank(headDraft.right.rows)) return "Enter a win total for every bonus on slot 2.";
  const savedLeft = state?.head?.left?.bonusCount || 0;
  const savedRight = state?.head?.right?.bonusCount || 0;
  if (savedLeft && headDraft.left.rows.length !== savedLeft) return "Slot 1 needs the same number of bonuses that were saved.";
  if (savedRight && headDraft.right.rows.length !== savedRight) return "Slot 2 needs the same number of bonuses that were saved.";
  return "";
}

document.getElementById("avgx-head-open").addEventListener("click", async () => {
  try {
    await post({ action: "head-setup", ...headSetupBody() });
    await post({ action: "head-open" });
    setStatus("Head to head bets are open.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-head-settle").addEventListener("click", async () => {
  const gap = headWinGap();
  if (gap) {
    setStatus(gap, "error");
    return;
  }
  try {
    if (state?.head?.status === "open") await post({ action: "head-close" });
    await post({
      action: "head-totals",
      leftWins: headDraft.left.rows.map((row) => row.win),
      rightWins: headDraft.right.rows.map((row) => row.win),
    });
    await post({ action: "head-settle" });
    const winner = state.head?.winner;
    const name = winner === "tie" ? "Tie" : (winner === "left" ? state.head.left : state.head.right)?.slot?.name;
    setStatus(winner === "tie" ? "Tie. Bets refunded." : `${name} wins.`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.getElementById("avgx-head-reset").addEventListener("click", async () => {
  if (!window.confirm("Reset the head to head? Open bets are refunded.")) return;
  try {
    await post({ action: "head-reset" });
    headDraft.left = { slot: null, rows: [{ cost: "", win: "" }] };
    headDraft.right = { slot: null, rows: [{ cost: "", win: "" }] };
    headSide = "";
    setStatus("Head to head cleared.", "ok");
    renderHeadEditor("left");
    renderHeadEditor("right");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

const overlayUrl = document.getElementById("avgx-overlay-url");
if (overlayUrl) overlayUrl.value = new URL("/average-x/overlay/source.html", window.location.href).href;

document.getElementById("avgx-overlay-copy")?.addEventListener("click", async () => {
  const status = document.getElementById("avgx-overlay-copy-status");
  try {
    await navigator.clipboard.writeText(overlayUrl?.value || "");
  } catch {
    overlayUrl?.select();
    document.execCommand("copy");
  }
  if (status) status.textContent = "Copied to clipboard.";
});

refresh().catch((error) => setStatus(error.message, "error"));
setInterval(() => {
  refresh().catch(() => {});
}, 4000);
