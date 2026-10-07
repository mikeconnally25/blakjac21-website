const POLL_MS = 5000;

const DEMO_SLOTS = [
  {
    name: "Mammoth Melt",
    slug: "midnightstudios-mammoth-melt",
    thumbnailUrl: "",
    pendingCount: 1,
    biggestWin: 1240,
    biggestX: 48.2,
    bonusCount: 6,
  },
  {
    name: "Sweet Fiesta",
    slug: "pragmatic-play-sweet-fiesta",
    thumbnailUrl: "",
    pendingCount: 2,
    biggestWin: 860.5,
    biggestX: 12.5,
    bonusCount: 3,
  },
];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatWin(value) {
  return value === null || value === undefined ? "—" : money.format(value);
}

function formatX(value) {
  return value === null || value === undefined
    ? "—"
    : `${Number(value).toLocaleString("en-US")}x`;
}

function initials(name) {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "?"
  );
}

function renderThumb(container, slot) {
  container.replaceChildren();
  container.style.background = "";
  if (!slot.thumbnailUrl) {
    container.textContent = initials(slot.name);
    return;
  }

  const image = document.createElement("img");
  image.alt = "";
  image.src = slot.thumbnailUrl;
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    container.replaceChildren();
    container.textContent = initials(slot.name);
  });
  container.append(image);
}

function signature(slots, hiddenCount) {
  return JSON.stringify({ slots, hiddenCount });
}

function renderLiveSlots({ slots = [], hiddenCount = 0 } = {}) {
  const root = document.getElementById("ss-overlay");
  const list = document.getElementById("ss-list");
  const more = document.getElementById("ss-more");
  if (!root || !list) return;

  const nextKey = signature(slots, hiddenCount);
  if (root.dataset.key === nextKey) return;
  root.dataset.key = nextKey;

  const visible = Array.isArray(slots) ? slots : [];
  root.classList.toggle("is-hidden", visible.length === 0);
  list.replaceChildren();

  if (more) {
    more.textContent = hiddenCount > 0 ? `+${hiddenCount} more` : "";
  }

  for (const slot of visible) {
    const row = document.createElement("article");
    row.className = "ss-row";

    const thumb = document.createElement("div");
    thumb.className = "ss-thumb";
    renderThumb(thumb, slot);

    const copy = document.createElement("div");
    copy.className = "ss-copy";

    const nameRow = document.createElement("div");
    nameRow.className = "ss-name-row";
    const name = document.createElement("p");
    name.className = "ss-name";
    name.textContent = slot.name;
    nameRow.append(name);
    if (Number(slot.pendingCount) > 1) {
      const left = document.createElement("span");
      left.className = "ss-left";
      left.textContent = `${slot.pendingCount} left`;
      nameRow.append(left);
    }

    const stats = document.createElement("div");
    stats.className = "ss-stats";
    for (const [label, value] of [
      ["Biggest win", formatWin(slot.biggestWin)],
      ["Biggest x", formatX(slot.biggestX)],
      ["Bonuses", String(slot.bonusCount || 0)],
    ]) {
      const stat = document.createElement("div");
      stat.className = "ss-stat";
      const caption = document.createElement("span");
      caption.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      stat.append(caption, strong);
      stats.append(stat);
    }

    copy.append(nameRow, stats);
    row.append(thumb, copy);
    list.append(row);
  }
}

async function refreshLiveSlots() {
  const response = await fetch("/api/slot-stats-live", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load spinning slots.");
  renderLiveSlots(data);
}

function startLiveSlots() {
  const demo = new URLSearchParams(window.location.search).get("demo") === "1";
  if (demo) {
    renderLiveSlots({ slots: DEMO_SLOTS, hiddenCount: 0 });
    return;
  }

  const tick = () => {
    refreshLiveSlots().catch(() => {});
  };
  tick();
  window.setInterval(tick, POLL_MS);
}

startLiveSlots();
