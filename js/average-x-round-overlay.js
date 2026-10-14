const params = new URLSearchParams(window.location.search);
const demoMode = params.has("demo");
const demoRound = {
  mode: "round",
  status: "open",
  averageX: 2.4,
  slot: {
    name: "Sweet Bonanza",
    provider: "Pragmatic Play",
    thumbnailUrl: "https://mediumrare.imgix.net/1cabb5679a1c6696240aad6a354d55da7c28b1823f6bd4400c0c12936d2ce688",
  },
  bonuses: [
    { cost: 40, win: 120, x: 3 },
    { cost: 40, win: 72, x: 1.8 },
    { cost: 40, win: null, x: null },
  ],
};

let overlaySignature = "";

function slotInitials(name) {
  return String(name || "Slot")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatAverage(value) {
  if (value == null || !Number.isFinite(Number(value))) return "Avg —";
  return `${Number(value).toFixed(2)}x`;
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Number.isInteger(number) ? 0 : 2;
  return `$${number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

function roundVisible(round) {
  if (!round || round.mode === "head") return false;
  return Boolean(round.slot?.name);
}

function roundSignature(round) {
  const buys = (round.bonuses || []).map((bonus) => `${bonus.cost}:${bonus.win}:${bonus.x}`).join(",");
  const slot = round.slot || {};
  return [slot.name || "", slot.provider || "", slot.thumbnailUrl || "", round.averageX ?? "", buys].join("|");
}

function renderRound(round) {
  const widget = document.getElementById("ovo-widget");
  if (!roundVisible(round)) {
    if (widget) widget.hidden = true;
    overlaySignature = "";
    return;
  }
  const signature = roundSignature(round);
  if (signature === overlaySignature) return;
  overlaySignature = signature;
  if (widget) {
    widget.hidden = false;
    widget.classList.add("is-round");
  }

  const slot = round.slot;
  const board = document.getElementById("ovo-round");
  if (!board) return;
  board.replaceChildren();

  const top = document.createElement("div");
  top.className = "ovo-round-slot";
  const logo = document.createElement("div");
  logo.className = "ovo-logo";
  if (slot.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = slot.thumbnailUrl;
    image.alt = "";
    image.addEventListener("error", () => {
      image.remove();
      logo.textContent = slotInitials(slot.name);
    });
    logo.appendChild(image);
  } else {
    logo.textContent = slotInitials(slot.name);
  }

  const copy = document.createElement("div");
  copy.className = "ovo-copy";
  const name = document.createElement("h2");
  name.className = "ovo-name";
  name.textContent = slot.name;
  copy.appendChild(name);
  if (slot.provider) {
    const meta = document.createElement("p");
    meta.className = "ovo-meta";
    meta.textContent = slot.provider;
    copy.appendChild(meta);
  }
  const average = document.createElement("p");
  average.className = "ovo-prize";
  average.textContent = formatAverage(round.averageX);
  copy.appendChild(average);
  top.append(logo, copy);

  const list = document.createElement("ol");
  list.className = "ovo-buys ovo-round-buys";
  (round.bonuses || []).forEach((bonus, index) => {
    const row = document.createElement("li");
    const number = document.createElement("span");
    number.textContent = String(index + 1);
    const cost = document.createElement("span");
    cost.textContent = formatMoney(bonus.cost);
    const win = document.createElement("span");
    win.textContent = bonus.win == null ? "—" : formatMoney(bonus.win);
    const multi = document.createElement("span");
    multi.className = "ovo-buy-x";
    multi.textContent = bonus.x == null ? "—" : `${Number(bonus.x).toFixed(2)}x`;
    row.append(number, cost, win, multi);
    list.appendChild(row);
  });

  board.append(top);
  if (round.bonuses?.length) board.appendChild(list);
}

async function loadRound() {
  const response = await fetch("/api/average-x", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load Average X.");
  if (demoMode && !roundVisible(data)) {
    renderRound(demoRound);
    return;
  }
  renderRound(data);
}

loadRound().catch(() => {});
window.setInterval(() => {
  loadRound().catch(() => {});
}, 3000);
