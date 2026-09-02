const POLL_MS = 2000;
let slotCatalog = [];

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "$0.00";
  }

  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMultiplier(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "—";
  }

  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}x`;
}

function slotInitials(name) {
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

function avatarColor(name) {
  let hash = 0;
  for (const char of String(name || "")) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 42%)`;
}

function findCatalogSlot(bonus) {
  const slug = String(bonus?.slotSlug || "").trim().toLowerCase();
  const name = String(bonus?.slot || "").trim().toLowerCase();

  return (
    slotCatalog.find((slot) => slug && slot.slug === slug) ||
    slotCatalog.find((slot) => slot.name.toLowerCase() === name) ||
    null
  );
}

function getBonusThumbnailUrl(bonus) {
  const fromBonus = String(bonus?.thumbnailUrl || "").trim();
  if (fromBonus) {
    return fromBonus;
  }

  const catalogSlot = findCatalogSlot(bonus);
  return catalogSlot?.thumbnailUrl || null;
}

function renderThumb(container, { slotName, thumbnailUrl }) {
  container.replaceChildren();

  if (thumbnailUrl) {
    const image = document.createElement("img");
    image.src = thumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      container.replaceChildren();
      container.textContent = slotInitials(slotName);
      container.style.background = avatarColor(slotName);
    });
    container.append(image);
    return;
  }

  container.textContent = slotInitials(slotName);
  container.style.background = avatarColor(slotName);
}

function findBestWin(bonuses) {
  return bonuses
    .filter((bonus) => bonus.status === "opened" && bonus.payout !== null)
    .sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0))[0];
}

function findLuckyWin(bonuses) {
  return bonuses
    .filter((bonus) => bonus.status === "opened" && bonus.multiplier !== null)
    .sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0))[0];
}

function averageMultiplier(bonuses) {
  const opened = bonuses.filter(
    (bonus) => bonus.status === "opened" && Number.isFinite(bonus.multiplier)
  );

  if (!opened.length) {
    return null;
  }

  const total = opened.reduce((sum, bonus) => sum + bonus.multiplier, 0);
  return total / opened.length;
}

function renderHighlight({
  bonus,
  thumbId,
  slotId,
  metaId,
  metaFormatter,
}) {
  const thumb = document.getElementById(thumbId);
  const slot = document.getElementById(slotId);
  const meta = document.getElementById(metaId);

  if (!bonus) {
    renderThumb(thumb, { slotName: "—", thumbnailUrl: null });
    thumb.textContent = "—";
    slot.textContent = "—";
    meta.textContent = "—";
    return;
  }

  renderThumb(thumb, {
    slotName: bonus.slot,
    thumbnailUrl: getBonusThumbnailUrl(bonus),
  });
  slot.textContent = bonus.slot;
  meta.textContent = metaFormatter(bonus);
}

function createGameCell(bonus) {
  const game = document.createElement("td");
  game.className = "bh-overlay-game-cell";

  const thumb = document.createElement("div");
  thumb.className = "bh-overlay-row-thumb";
  renderThumb(thumb, {
    slotName: bonus.slot,
    thumbnailUrl: getBonusThumbnailUrl(bonus),
  });

  const name = document.createElement("span");
  name.className = "bh-overlay-game-name";
  name.textContent = bonus.slot;

  game.append(thumb, name);
  return game;
}

function renderBonusRows(bonuses) {
  const tbody = document.getElementById("bh-bonus-rows");
  if (!tbody) {
    return;
  }

  tbody.replaceChildren();

  if (!bonuses.length) {
    const row = document.createElement("tr");
    row.className = "bh-overlay-empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No bonuses yet";
    row.append(cell);
    tbody.append(row);
    return;
  }

  const visible = bonuses.slice(-8);

  for (const bonus of visible) {
    const row = document.createElement("tr");
    if (bonus.status === "pending") {
      row.classList.add("is-pending");
    }

    const index = document.createElement("td");
    index.textContent = String(bonus.number);

    const game = createGameCell(bonus);

    const bet = document.createElement("td");
    bet.textContent = formatMoney(bonus.bet);

    const payout = document.createElement("td");
    payout.textContent =
      bonus.status === "opened" ? formatMoney(bonus.payout ?? 0) : "—";

    row.append(index, game, bet, payout);
    tbody.append(row);
  }
}

function renderOverlay({ hunt, summary, bonuses, huntNumber }) {
  const huntId = document.getElementById("bh-hunt-id");
  const start = document.getElementById("bh-start");
  const total = document.getElementById("bh-total");
  const runAvg = document.getElementById("bh-run-avg");
  const winnings = document.getElementById("bh-winnings");
  const remaining = document.getElementById("bh-remaining");
  const reqAvg = document.getElementById("bh-req-avg");

  if (huntId) {
    huntId.textContent = `#${huntNumber}`;
  }

  if (start) {
    start.textContent = formatMoney(hunt?.startBalance ?? 0);
  }

  if (total) {
    total.textContent = String(summary?.totalBonuses ?? 0);
  }

  if (runAvg) {
    const avg =
      summary.runAverageX !== null && summary.runAverageX !== undefined
        ? summary.runAverageX
        : averageMultiplier(bonuses);
    runAvg.textContent = avg === null ? "—" : formatMultiplier(avg);
  }

  if (winnings) {
    winnings.textContent = formatMoney(summary?.totalWon ?? 0);
  }

  if (remaining) {
    remaining.textContent = String(summary?.pendingCount ?? 0);
  }

  if (reqAvg) {
    reqAvg.textContent =
      summary?.breakevenX === null || summary?.breakevenX === undefined
        ? "—"
        : formatMultiplier(summary.breakevenX);
  }

  const best = findBestWin(bonuses);
  const lucky = findLuckyWin(bonuses);

  renderHighlight({
    bonus: best,
    thumbId: "bh-best-thumb",
    slotId: "bh-best-slot",
    metaId: "bh-best-meta",
    metaFormatter: (bonus) =>
      `${formatMoney(bonus.payout ?? 0)} (${formatMoney(bonus.bet)})`,
  });

  renderHighlight({
    bonus: lucky,
    thumbId: "bh-lucky-thumb",
    slotId: "bh-lucky-slot",
    metaId: "bh-lucky-meta",
    metaFormatter: (bonus) =>
      `${formatMultiplier(bonus.multiplier)} (${formatMoney(bonus.bet)})`,
  });

  renderBonusRows(bonuses);
}

async function loadOverlay() {
  try {
    const [huntResponse, historyResponse, slotsResponse] = await Promise.all([
      fetch("/api/bonus-hunt", { cache: "no-store" }),
      fetch("/api/bonus-hunt/history", { cache: "no-store" }),
      fetch("/api/bonus-hunt/slots", { cache: "no-store" }),
    ]);

    if (!huntResponse.ok) {
      return;
    }

    if (slotsResponse.ok) {
      const slotsData = await slotsResponse.json();
      slotCatalog = slotsData.slots || [];
    }

    const huntData = await huntResponse.json();
    const historyData = historyResponse.ok
      ? await historyResponse.json()
      : { pastHunts: [] };
    const huntNumber = (historyData.pastHunts?.length || 0) + 1;

    renderOverlay({
      hunt: huntData.hunt,
      summary: huntData.summary,
      bonuses: huntData.bonuses || [],
      huntNumber,
    });
  } catch {
    // Keep the last rendered state.
  }
}

loadOverlay();
setInterval(loadOverlay, POLL_MS);
