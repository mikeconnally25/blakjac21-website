let oneVOneIsAdmin = false;

function formatCoins(amount) {
  return `${Number(amount) || 0} UncCoin${Number(amount) === 1 ? "" : "s"}`;
}

function renderBet(element, { number, occupied, pool, myBet, winner, signedIn }, keepValue) {
  if (!occupied && !pool && winner !== number) return;
  const block = document.createElement("div");
  block.className = "one-v-one-bet";

  const pot = document.createElement("p");
  pot.className = "one-v-one-pot";
  pot.textContent = `Pool · ${formatCoins(pool)} · win pays 2x`;
  block.appendChild(pot);

  if (myBet?.side === number) {
    const mine = document.createElement("p");
    mine.className = "one-v-one-mine";
    mine.textContent = `Your bet · ${formatCoins(myBet.amount)}`;
    block.appendChild(mine);
  }

  if (winner === number) {
    const won = document.createElement("p");
    won.className = "one-v-one-won";
    won.textContent = "Winner";
    block.appendChild(won);
  } else if (!winner && occupied) {
    if (signedIn) {
      const form = document.createElement("form");
      form.className = "one-v-one-bet-form";
      form.dataset.side = String(number);

      const input = document.createElement("input");
      input.className = "guess-input one-v-one-bet-amount";
      input.type = "number";
      input.min = "1";
      input.max = "5000";
      input.step = "1";
      input.inputMode = "numeric";
      input.placeholder = "Amount";
      input.setAttribute("aria-label", `UncCoins to bet on side ${number}`);
      if (keepValue) input.value = keepValue;

      const button = document.createElement("button");
      button.type = "submit";
      button.className = "btn btn-sm btn-primary";
      button.textContent = `Bet team ${number}`;

      form.append(input, button);
      block.appendChild(form);
    } else {
      const link = document.createElement("a");
      link.className = "btn btn-sm btn-kick";
      link.href = "/api/auth/login";
      link.textContent = "Sign in to bet";
      block.appendChild(link);
    }
  }

  element.appendChild(block);
  if (keepValue) element.querySelector(".one-v-one-bet-amount")?.focus();
}

function renderSide(element, side, seatLabel, bet) {
  if (!element) return;
  const previous = element.querySelector(".one-v-one-bet-amount");
  const keepValue = previous && document.activeElement === previous ? previous.value : "";
  element.replaceChildren();
  element.classList.toggle("is-winner", bet?.winner === Number(seatLabel));

  const seat = document.createElement("p");
  seat.className = "one-v-one-seat";
  seat.textContent = seatLabel;

  const heading = document.createElement("h2");
  heading.className = "one-v-one-name";
  heading.textContent = side?.username || "Open seat";

  const list = document.createElement("ul");
  list.className = "one-v-one-calls";

  const slot = side?.slot;
  if (!slot) {
    const empty = document.createElement("li");
    empty.className = "one-v-one-empty";
    empty.textContent = side ? "Request a slot in chat." : "Waiting for a draw.";
    list.appendChild(empty);
  } else {
    const item = document.createElement("li");
    item.className = "one-v-one-pick";

    const logo = document.createElement("div");
    logo.className = "one-v-one-logo";
    const initials = String(slot.slotName || "Slot")
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

    if (slot.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = slot.thumbnailUrl;
      image.alt = "";
      image.addEventListener("error", () => {
        image.remove();
        logo.textContent = initials;
      });
      logo.appendChild(image);
    } else {
      logo.textContent = initials;
    }

    const title = document.createElement("p");
    title.className = "one-v-one-slot";
    title.textContent = slot.slotName || "Slot";

    item.append(logo, title);
    if (slot.provider) {
      const detail = document.createElement("p");
      detail.className = "one-v-one-meta";
      detail.textContent = slot.provider;
      item.appendChild(detail);
    }
    list.appendChild(item);
  }

  element.append(seat, heading, list);
  renderBet(element, bet, keepValue);
}

let kickChatSignature = "";

function renderKickChat(messages, matchup) {
  const log = document.getElementById("one-v-one-chat");
  const empty = document.getElementById("one-v-one-chat-empty");
  if (!log) return;

  const items = Array.isArray(messages) ? messages : [];
  const signature = items.map((message) => message.id).join("|");
  empty?.classList.toggle("is-hidden", items.length > 0);
  if (signature === kickChatSignature) return;

  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  kickChatSignature = signature;
  log.replaceChildren();

  const drawn = new Set(
    [matchup?.left?.username, matchup?.right?.username]
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  );

  for (const message of items) {
    const row = document.createElement("article");
    const username = message.username || "viewer";
    row.className = "one-v-one-chat-row";
    if (drawn.has(username.toLowerCase())) row.classList.add("is-drawn");
    if (parseChatBet(message.text)) row.classList.add("is-bet");

    const name = document.createElement("span");
    name.className = "one-v-one-chat-name";
    name.textContent = username;

    const text = document.createElement("p");
    text.className = "one-v-one-chat-text";
    text.textContent = message.text || "";

    row.append(name, text);
    log.appendChild(row);
  }

  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function renderOneVOne(data) {
  oneVOneIsAdmin = Boolean(data?.isAdmin);
  document.getElementById("one-v-one-admin")?.classList.toggle("is-hidden", !oneVOneIsAdmin);

  const poolText = document.getElementById("one-v-one-pool-text");
  const poolDot = document.getElementById("one-v-one-pool-dot");
  const entriesToggle = document.getElementById("one-v-one-entries-toggle");
  const entriesOpen = Boolean(data?.entriesOpen);
  if (poolText) {
    const count = Number(data?.entryCount) || 0;
    const label = count === 1 ? "entrant" : "entrants";
    poolText.textContent = entriesOpen
      ? `${count} ${label} · type 1v1 in chat`
      : `${count} ${label} · entries closed`;
    poolDot?.classList.toggle("is-live", entriesOpen);
  }
  if (entriesToggle) entriesToggle.textContent = entriesOpen ? "Close entries" : "Open entries";

  const balanceEl = document.getElementById("one-v-one-balance");
  if (balanceEl) {
    const points = Number(data?.balance);
    const showBalance = Boolean(data?.signedIn) && Number.isFinite(points);
    balanceEl.classList.toggle("is-hidden", !showBalance);
    if (showBalance) balanceEl.textContent = `You have ${points.toLocaleString()} UncCoins`;
  }

  const bet = {
    pools: data?.pools || { one: 0, two: 0 },
    myBet: data?.myBet || null,
    winner: data?.winner || null,
    signedIn: Boolean(data?.signedIn),
  };
  renderSide(document.getElementById("one-v-one-side-left"), data?.matchup?.left, "1", {
    number: 1,
    occupied: Boolean(data?.matchup?.left),
    pool: bet.pools.one,
    myBet: bet.myBet,
    winner: bet.winner,
    signedIn: bet.signedIn,
  });
  renderSide(document.getElementById("one-v-one-side-right"), data?.matchup?.right, "2", {
    number: 2,
    occupied: Boolean(data?.matchup?.right),
    pool: bet.pools.two,
    myBet: bet.myBet,
    winner: bet.winner,
    signedIn: bet.signedIn,
  });
  const removeLeft = document.getElementById("one-v-one-remove-left");
  const removeRight = document.getElementById("one-v-one-remove-right");
  const settled = Boolean(data?.winner);
  if (removeLeft) removeLeft.disabled = !data?.matchup?.left;
  if (removeRight) removeRight.disabled = !data?.matchup?.right;
  const winOne = document.getElementById("one-v-one-win-1");
  const winTwo = document.getElementById("one-v-one-win-2");
  if (winOne) winOne.disabled = settled || !data?.matchup?.left;
  if (winTwo) winTwo.disabled = settled || !data?.matchup?.right;
  renderBetList(betsFromKickChat(data?.chat, data?.bets));
  renderKickChat(data?.chat, data?.matchup);
}

function parseChatBet(text) {
  const match = String(text || "").trim().match(/^!bet\s+(\d+)\s+team\s*([12])\s*$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 1) return null;
  return { amount, side: Number(match[2]) };
}

function betsFromKickChat(messages, stored) {
  const merged = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const parsed = parseChatBet(message.text);
    if (!parsed) continue;
    const username = message.username || "viewer";
    const key = username.toLowerCase();
    const existing = merged.get(key);
    if (existing && existing.side === parsed.side) existing.amount += parsed.amount;
    else if (!existing) {
      merged.set(key, { username, side: parsed.side, amount: parsed.amount, mine: false });
    }
  }

  for (const bet of Array.isArray(stored) ? stored : []) {
    const username = bet.username || "viewer";
    merged.set(username.toLowerCase(), {
      username,
      side: Number(bet.side),
      amount: Number(bet.amount) || 0,
      mine: Boolean(bet.mine),
    });
  }

  return [...merged.values()];
}

function renderBetList(bets) {
  const rows = Array.isArray(bets) ? bets : [];
  for (const side of [1, 2]) {
    const total = document.getElementById(`one-v-one-bets-${side}-total`);
    if (!total) continue;
    const stake = rows
      .filter((bet) => Number(bet.side) === side)
      .reduce((sum, bet) => sum + (Number(bet.amount) || 0), 0);
    total.textContent = stake.toLocaleString();
  }
}

function setOneVOneNote(message, isError) {
  const note = document.getElementById("one-v-one-admin-note");
  if (!note) return;
  note.textContent = message || "";
  note.classList.toggle("is-error", Boolean(isError));
}

async function loadOneVOne() {
  const response = await fetch("/api/one-v-one/status", { cache: "no-store", credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load the 1v1.");
  renderOneVOne(data);
}

async function saveOneVOne(event) {
  event.preventDefault();
  setOneVOneNote("");
  const count = Number(event.submitter?.value) === 1 ? 1 : 2;

  try {
    const response = await fetch("/api/one-v-one/set", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not draw the 1v1.");
    renderOneVOne(data);
    setOneVOneNote(count === 1 ? "Drew 1 viewer." : "Drew 2 viewers.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

async function removeOneVOne(side) {
  setOneVOneNote("");
  try {
    const response = await fetch("/api/one-v-one/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not remove that viewer.");
    renderOneVOne(data);
    setOneVOneNote(side === "1" ? "Removed side 1." : "Removed side 2.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

async function clearOneVOne() {
  setOneVOneNote("");
  try {
    const response = await fetch("/api/one-v-one/clear", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not reset the 1v1.");
    renderOneVOne(data);
    setOneVOneNote("1v1 reset.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

async function toggleOneVOneEntries() {
  setOneVOneNote("");
  const open = document.getElementById("one-v-one-entries-toggle")?.textContent !== "Close entries";
  try {
    const response = await fetch("/api/one-v-one/entries", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update entries.");
    renderOneVOne(data);
    setOneVOneNote(open ? "Entries are open. Chat 1v1 to join." : "Entries are closed.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

async function clearOneVOneEntries() {
  setOneVOneNote("");
  try {
    const response = await fetch("/api/one-v-one/entries/clear", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not clear entrants.");
    renderOneVOne(data);
    setOneVOneNote("Entrants cleared.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

function setBetNote(message, isError) {
  const note = document.getElementById("one-v-one-bet-note");
  if (!note) return;
  note.textContent = message || "";
  note.classList.toggle("is-error", Boolean(isError));
}

async function placeBet(event) {
  event.preventDefault();
  const form = event.target;
  const amount = form.querySelector(".one-v-one-bet-amount")?.value;
  setBetNote("");
  try {
    const response = await fetch("/api/one-v-one/bet", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side: form.dataset.side, amount }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not place that bet.");
    renderOneVOne(data);
    setBetNote(`Bet placed on side ${form.dataset.side}.`);
  } catch (error) {
    setBetNote(error.message, true);
  }
}

async function settleOneVOne(side) {
  setOneVOneNote("");
  try {
    const response = await fetch("/api/one-v-one/settle", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not settle the 1v1.");
    renderOneVOne(data);
    setOneVOneNote(side === "1" ? "Team 1 wins. Winning bets paid 2x." : "Team 2 wins. Winning bets paid 2x.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

document.getElementById("one-v-one-admin")?.addEventListener("submit", saveOneVOne);
document.getElementById("one-v-one-entries-toggle")?.addEventListener("click", toggleOneVOneEntries);
document.getElementById("one-v-one-entries-clear")?.addEventListener("click", clearOneVOneEntries);
document.getElementById("one-v-one-remove-left")?.addEventListener("click", () => removeOneVOne("1"));
document.getElementById("one-v-one-remove-right")?.addEventListener("click", () => removeOneVOne("2"));
document.getElementById("one-v-one-win-1")?.addEventListener("click", () => settleOneVOne("1"));
document.getElementById("one-v-one-win-2")?.addEventListener("click", () => settleOneVOne("2"));
document.getElementById("one-v-one-clear")?.addEventListener("click", clearOneVOne);
document.getElementById("one-v-one-board")?.addEventListener("submit", (event) => {
  if (event.target?.classList?.contains("one-v-one-bet-form")) placeBet(event);
});
window.addEventListener("auth:change", () => {
  loadOneVOne().catch((error) => setOneVOneNote(error.message, true));
});

loadOneVOne().catch((error) => setOneVOneNote(error.message, true));
window.setInterval(() => {
  loadOneVOne().catch(() => {});
}, 5000);
