let currentUser = null;
let bonusListRenderedAsAdmin = false;
let pollTimer = null;
let slotPollTimer = null;
let slotCatalog = [];
let slotGroups = [];
let slotCatalogUpdatedAt = null;
let slotCatalogSectionStats = null;
let acceptingRequests = false;
let affiliatesOnly = false;
let subscribersOnly = false;
let huntBonuses = [];
let slotRequests = [];
let mySlotRequests = [];
let slotRequestLimit = 3;
const pendingSlotRequestRemovals = new Set();
let slotBetDrafts = new Map();
let bonusPayoutDrafts = new Map();
let huntMeta = {
  title: "Live Hunt",
  startBalance: 0,
  showHighestMulti: false,
  collecting: true,
  status: "collecting",
};
let pastHunts = [];
let lastSummary = null;
let huntAddSelectedSlot = null;
let huntAddSearchQuery = "";

const REQUEST_STATUS_LABELS = {
  open: "Requests open",
  closed: "Requests closed",
};

function slotInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "?";
}

function avatarColor(name) {
  let hash = 0;
  for (const char of String(name || "")) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 42%)`;
}

function formatMultiplier(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}x`;
}

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

function setRequestStatus(message, tone = "") {
  const status = document.getElementById("slot-request-status");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("is-hidden", !message);
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
}

function renderHuntHeader(hunt) {
  const title = document.getElementById("hunt-title");
  const titleInput = document.getElementById("hunt-title-input");
  const startInput = document.getElementById("hunt-start-input");

  if (title) {
    title.textContent = hunt?.title || "Live Hunt";
  }

  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = hunt?.title || "Live Hunt";
  }

  if (startInput && document.activeElement !== startInput) {
    startInput.value = Number(hunt?.startBalance || 0).toFixed(2);
  }

  updateHighestMultiToggle(hunt);
  updateHuntPhaseStatus(hunt);
  updateHuntAddAvailability();
}

function updateHighestMultiToggle(hunt) {
  const toggle = document.getElementById("hunt-highest-multi-toggle");
  const status = document.getElementById("hunt-highest-multi-status");
  const enabled = Boolean(hunt?.showHighestMulti);

  if (toggle && currentUser?.isAdmin && document.activeElement !== toggle) {
    toggle.checked = enabled;
  }

  if (status) {
    status.textContent = enabled
      ? "Shown on tracker and OBS Lucky Win"
      : "Hidden on tracker and OBS Lucky Win";
  }
}

function renderHighestMulti(summary, hunt) {
  const callout = document.getElementById("hunt-highest-multi");
  const value = document.getElementById("hunt-highest-multi-value");
  const byline = document.getElementById("hunt-highest-multi-byline");
  if (!callout || !value || !byline) return;

  const show = Boolean(hunt?.showHighestMulti);
  const highest = summary?.highestMulti || null;
  const visible = show && highest && Number.isFinite(Number(highest.multiplier));

  callout.classList.toggle("is-hidden", !visible);

  if (!visible) {
    value.textContent = "—";
    byline.textContent = "";
    byline.classList.add("is-hidden");
    return;
  }

  value.textContent = `${formatMultiplier(highest.multiplier)} · ${highest.slot}`;
  const requester = String(highest.requestedBy || "").trim();
  if (requester) {
    byline.textContent = `by ${requester}`;
    byline.classList.remove("is-hidden");
  } else {
    byline.textContent = "";
    byline.classList.add("is-hidden");
  }
}

function renderSummary(summary, hunt) {
  lastSummary = summary || null;
  const totalBonuses = document.getElementById("summary-total");
  const startCost = document.getElementById("summary-start-cost");
  const winnings = document.getElementById("summary-winnings");
  const profit = document.getElementById("summary-profit");
  const avgBet = document.getElementById("summary-avg-bet");
  const curAvg = document.getElementById("summary-cur-avg");
  const totalX = document.getElementById("summary-total-x");
  const breakeven = document.getElementById("summary-breakeven");
  const runAvg = document.getElementById("summary-run-avg");
  const progress = document.getElementById("hunt-progress");
  const progressCount = document.getElementById("hunt-progress-count");
  const progressFill = document.getElementById("hunt-progress-fill");
  const bonusCount = document.getElementById("hunt-bonus-count");

  if (!totalBonuses || !startCost || !profit) return;

  const profitLoss =
    summary.profitLoss === null || summary.profitLoss === undefined
      ? Number(hunt?.startBalance || 0) - Number(summary.totalWon || 0)
      : summary.profitLoss;

  totalBonuses.textContent = String(summary.totalBonuses);
  startCost.textContent = formatCurrency(hunt?.startBalance || 0);

  if (winnings) {
    winnings.textContent = formatCurrency(summary.totalWon || 0);
  }

  profit.textContent = formatCurrency(profitLoss);
  // Positive = still behind start cost; negative = ahead of start.
  profit.classList.toggle("is-positive", profitLoss < 0);
  profit.classList.toggle("is-negative", profitLoss > 0);

  if (avgBet) {
    avgBet.textContent =
      summary.avgBet === null || summary.avgBet === undefined
        ? "—"
        : formatCurrency(summary.avgBet);
  }

  if (curAvg) {
    curAvg.textContent =
      summary.curAvg === null || summary.curAvg === undefined
        ? "—"
        : formatCurrency(summary.curAvg);
  }

  if (totalX) {
    totalX.textContent =
      summary.totalX === null || summary.totalX === undefined
        ? "—"
        : formatMultiplier(summary.totalX);
  }

  if (runAvg) {
    runAvg.textContent =
      summary.runAverageX === null || summary.runAverageX === undefined
        ? "—"
        : formatMultiplier(summary.runAverageX);
  }

  if (breakeven) {
    if (summary.breakevenX === null || summary.breakevenX === undefined) {
      breakeven.textContent = "—";
      breakeven.classList.remove("is-positive", "is-negative", "is-target");
      breakeven.title =
        summary.pendingCount > 0
          ? "Average X remaining bonuses must hit (payout = bet × X) to recover start cost"
          : "Required average only applies while bonuses are still opening";
    } else if (summary.breakevenX <= 0) {
      breakeven.textContent = "0.00x";
      breakeven.classList.add("is-positive");
      breakeven.classList.remove("is-negative", "is-target");
      breakeven.title = "Winnings already cover the hunt start cost";
    } else {
      breakeven.textContent = formatMultiplier(summary.breakevenX);
      breakeven.classList.remove("is-positive", "is-negative");
      breakeven.classList.toggle("is-target", summary.breakevenX >= 1);
      breakeven.classList.toggle("is-negative", summary.breakevenX > 100);
      breakeven.title = `Need ${formatMultiplier(summary.breakevenX)} average on $${summary.pendingBetTotal.toFixed(2)} in remaining bets to recover start cost`;
    }
  }

  if (bonusCount) {
    bonusCount.textContent =
      summary.totalBonuses === 1 ? "1 total" : `${summary.totalBonuses} total`;
  }

  const progressPercent =
    summary.totalBonuses > 0
      ? Math.round((summary.openedCount / summary.totalBonuses) * 100)
      : 0;

  if (progressFill) {
    progressFill.style.width = `${progressPercent}%`;
  }

  if (progressCount) {
    progressCount.textContent = summary.totalBonuses
      ? `${progressPercent}% opened`
      : "";
  }

  if (progress) {
    if (!summary.totalBonuses) {
      progress.textContent = "Waiting for the first bonus buy.";
    } else if (summary.pendingCount > 0) {
      progress.textContent = `Opened ${summary.openedCount} of ${summary.totalBonuses} · ${formatCurrency(summary.totalWon)} won`;
    } else {
      progress.textContent = `Hunt complete · ${formatCurrency(summary.totalWon)} won`;
    }
  }

  renderHighestMulti(summary, hunt);
}

function bonusesUnchanged(previous, next) {
  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const current = previous[index];
    const incoming = next[index];

    if (
      current.id !== incoming.id ||
      current.status !== incoming.status ||
      current.payout !== incoming.payout ||
      current.bet !== incoming.bet ||
      current.slot !== incoming.slot ||
      current.thumbnailUrl !== incoming.thumbnailUrl ||
      current.requestedBy !== incoming.requestedBy ||
      Boolean(current.superBonus) !== Boolean(incoming.superBonus) ||
      Boolean(current.epicBonus) !== Boolean(incoming.epicBonus)
    ) {
      return false;
    }
  }

  return true;
}

function isEditingBonusPayout() {
  const active = document.activeElement;
  return active?.classList?.contains("bonus-payout-input") ?? false;
}

function sortBonusesByBetAsc(bonuses) {
  return [...(bonuses || [])].sort((a, b) => {
    const betDiff = (Number(a.bet) || 0) - (Number(b.bet) || 0);
    if (betDiff !== 0) return betDiff;
    return (Number(a.number) || 0) - (Number(b.number) || 0);
  });
}

function updateBonusList(bonuses, { force = false, previous = huntBonuses } = {}) {
  const asAdmin = Boolean(currentUser?.isAdmin);

  if (!force && isEditingBonusPayout()) {
    return;
  }

  if (
    !force &&
    bonusesUnchanged(previous, bonuses) &&
    asAdmin === bonusListRenderedAsAdmin
  ) {
    return;
  }

  renderBonusList(bonuses);
  bonusListRenderedAsAdmin = asAdmin;
}

function syncBonusListViewport() {
  const list = document.getElementById("bonus-list");
  if (!list || list.classList.contains("is-hidden")) {
    return;
  }

  const cards = [...list.querySelectorAll(".hunt-bonus-card")];
  if (cards.length <= 5) {
    list.style.maxHeight = "";
    list.classList.remove("is-scrollable");
    return;
  }

  const first = cards[0];
  const fifth = cards[4];
  const height = fifth.offsetTop + fifth.offsetHeight - first.offsetTop;
  list.style.maxHeight = `${Math.ceil(height)}px`;
  list.classList.add("is-scrollable");
}

function getNextPendingBonusId(currentId) {
  const ordered = sortBonusesByBetAsc(huntBonuses);
  const index = ordered.findIndex((bonus) => bonus.id === currentId);
  if (index < 0) {
    return null;
  }

  for (let offset = index + 1; offset < ordered.length; offset += 1) {
    if (ordered[offset].status === "pending") {
      return ordered[offset].id;
    }
  }

  return null;
}

function focusBonusPayoutInput(bonusId) {
  if (!bonusId) {
    return;
  }

  const card = document.querySelector(`.hunt-bonus-card[data-id="${CSS.escape(bonusId)}"]`);
  const input = card?.querySelector(".bonus-payout-input");
  if (!input) {
    return;
  }

  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  input.focus({ preventScroll: true });
  input.select();
}

function renderBonusList(bonuses) {
  const list = document.getElementById("bonus-list");
  const empty = document.getElementById("bonus-empty");

  if (!list || !empty) return;

  const ordered = sortBonusesByBetAsc(bonuses);
  const total = ordered.length;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  const existingIds = new Set(
    [...list.querySelectorAll(".hunt-bonus-card")].map((element) => element.dataset.id)
  );
  list.replaceChildren();

  const openingId = ordered.find((bonus) => bonus.status === "pending")?.id;

  ordered.forEach((bonus) => {
    const item = document.createElement("li");
    item.className = "hunt-bonus-card";
    item.dataset.id = bonus.id;

    const isNewBonus = !existingIds.has(bonus.id);
    if (isNewBonus) {
      item.style.animationDelay = `${Math.min(bonus.number, 8) * 40}ms`;
    } else {
      item.style.animation = "none";
    }

    if (bonus.id === openingId) {
      item.classList.add("is-opening");
    }

    if (bonus.superBonus) {
      item.classList.add("is-super");
    }

    if (bonus.epicBonus) {
      item.classList.add("is-epic");
    }

    const index = document.createElement("span");
    index.className = "hunt-bonus-index";
    index.textContent = `#${bonus.number}`;

    const catalogSlot = findCatalogSlot({ slotName: bonus.slot, slotSlug: bonus.slotSlug });
    const displayName = getBonusSlotDisplayName(bonus, catalogSlot);
    const thumbnailUrl = getSlotRequestThumbnail(
      {
        thumbnailUrl: bonus.thumbnailUrl,
        slotName: bonus.slot,
        slotSlug: bonus.slotSlug,
      },
      catalogSlot
    );
    const avatar = createSlotThumb(displayName, thumbnailUrl, {
      rootClass: "hunt-bonus-avatar",
      imageClass: "hunt-bonus-avatar-image",
    });

    const main = document.createElement("div");
    main.className = "hunt-bonus-main";

    const slot = document.createElement("p");
    slot.className = "hunt-bonus-slot";
    slot.textContent = displayName;

    const provider = document.createElement("p");
    provider.className = "hunt-bonus-provider";
    provider.textContent = `Bet ${formatCurrency(bonus.bet)}`;

    main.append(slot, provider);

    if (bonus.superBonus || bonus.epicBonus) {
      const badges = document.createElement("div");
      badges.className = "hunt-bonus-badges";

      if (bonus.superBonus) {
        const superBadge = document.createElement("span");
        superBadge.className = "hunt-bonus-super-badge";
        superBadge.textContent = "Super";
        badges.append(superBadge);
      }

      if (bonus.epicBonus) {
        const epicBadge = document.createElement("span");
        epicBadge.className = "hunt-bonus-epic-badge";
        epicBadge.textContent = "Epic";
        badges.append(epicBadge);
      }

      main.append(badges);
    }

    if (bonus.requestedBy) {
      const requester = document.createElement("p");
      requester.className = "hunt-bonus-requester";
      requester.textContent = `by ${bonus.requestedBy}`;
      main.append(requester);
    }

    const result = document.createElement("div");
    result.className = "hunt-bonus-result";

    let payoutInput = null;
    let saveWinBtn = null;

    if (bonus.status === "opened") {
      const payout = document.createElement("div");
      payout.className = "hunt-bonus-payout";
      if ((bonus.payout ?? 0) >= bonus.bet) {
        payout.classList.add("is-win");
      }
      payout.textContent = formatCurrency(bonus.payout ?? 0);

      const multiplier = document.createElement("div");
      multiplier.className = "hunt-bonus-multiplier";
      if ((bonus.multiplier ?? 0) >= 1) {
        multiplier.classList.add("is-win");
      }
      multiplier.textContent = formatMultiplier(bonus.multiplier);

      result.append(payout, multiplier);
    } else {
      const pending = document.createElement("div");
      pending.className = "hunt-bonus-pending";
      pending.textContent = bonus.id === openingId ? "Opening" : "—";
      result.append(pending);
    }

    item.append(index, avatar, main, result);

    if (currentUser?.isAdmin) {
      const actions = document.createElement("div");
      actions.className = "hunt-bonus-admin";

      const payoutField = document.createElement("div");
      payoutField.className = "hunt-bonus-win-field";

      const payoutLabel = document.createElement("span");
      payoutLabel.className = "hunt-bonus-win-label";
      payoutLabel.textContent = "Win";

      const payoutRow = document.createElement("label");
      payoutRow.className = "guess-input-row hunt-bonus-win-row";

      const payoutPrefix = document.createElement("span");
      payoutPrefix.className = "guess-prefix";
      payoutPrefix.textContent = "$";
      payoutPrefix.setAttribute("aria-hidden", "true");

      payoutInput = document.createElement("input");
      payoutInput.className = "guess-input bonus-payout-input";
      payoutInput.type = "number";
      payoutInput.inputMode = "decimal";
      payoutInput.min = "0";
      payoutInput.step = "0.01";
      payoutInput.placeholder = "0.00";
      payoutInput.setAttribute(
        "aria-label",
        bonus.status === "opened"
          ? `Edit win amount for ${bonus.slot}`
          : `Win amount for ${bonus.slot}`
      );
      payoutInput.value = bonusPayoutDrafts.has(bonus.id)
        ? bonusPayoutDrafts.get(bonus.id)
        : bonus.status === "opened" && bonus.payout !== null && bonus.payout !== undefined
          ? Number(bonus.payout).toFixed(2)
          : "";

      payoutRow.append(payoutPrefix, payoutInput);
      payoutField.append(payoutLabel, payoutRow);

      saveWinBtn = document.createElement("button");
      saveWinBtn.type = "button";
      saveWinBtn.className = "btn btn-sm btn-primary";
      saveWinBtn.textContent =
        bonus.status === "opened" ? "Update win" : "Save win";
      saveWinBtn.addEventListener("click", () =>
        saveBonusPayout(bonus.id, payoutInput.value, saveWinBtn)
      );

      payoutInput.addEventListener("input", () => {
        bonusPayoutDrafts.set(bonus.id, payoutInput.value);
      });

      payoutInput.addEventListener("blur", () => {
        if (!payoutInput.value.trim()) {
          bonusPayoutDrafts.delete(bonus.id);
        }
      });

      payoutInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void saveBonusPayout(bonus.id, payoutInput.value, saveWinBtn);
        }
      });

      actions.append(payoutField, saveWinBtn);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-sm btn-outline";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeBonusEntry(bonus.id, removeBtn));
      actions.append(removeBtn);

      const flagToggles = document.createElement("div");
      flagToggles.className = "hunt-bonus-flag-toggles";

      const superToggle = createBonusFlagToggle({
        label: "Super",
        checked: Boolean(bonus.superBonus),
        ariaLabel: `Mark ${bonus.slot} as super bonus`,
        onChange: (checked, input) => {
          void setBonusFlag(bonus.id, "superBonus", checked, input);
        },
      });

      const epicToggle = createBonusFlagToggle({
        label: "Epic",
        checked: Boolean(bonus.epicBonus),
        ariaLabel: `Mark ${bonus.slot} as epic bonus`,
        onChange: (checked, input) => {
          void setBonusFlag(bonus.id, "epicBonus", checked, input);
        },
      });

      flagToggles.append(superToggle, epicToggle);
      actions.append(flagToggles);
      item.append(actions);
    }

    list.append(item);
  });

  requestAnimationFrame(() => {
    syncBonusListViewport();
  });
}

function formatHuntDate(value) {
  if (!value) return "";

  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function huntStatusLabel(status) {
  switch (status) {
    case "complete":
      return "Complete";
    case "opening":
      return "Opening";
    case "collecting":
      return "Collecting";
    default:
      return "Ended";
  }
}

function renderPastHunts(hunts) {
  const list = document.getElementById("past-hunts-list");
  const empty = document.getElementById("past-hunts-empty");
  const count = document.getElementById("past-hunts-count");

  if (!list || !empty) return;

  const total = hunts.length;
  const isAdmin = Boolean(currentUser?.isAdmin);
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

  if (count) {
    count.textContent = total === 1 ? "1 hunt" : `${total} hunts`;
  }

  hunts.forEach((hunt) => {
    const item = document.createElement("li");
    item.className = "past-hunt-entry";
    item.dataset.huntId = hunt.id;

    const summary = hunt.summary || {};
    const profit = Number(summary.profit || 0);

    const row = document.createElement("div");
    row.className = "past-hunt-entry-row";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "past-hunt-entry-toggle";
    toggle.setAttribute("aria-expanded", "false");

    const top = document.createElement("div");
    top.className = "past-hunt-entry-top";

    const main = document.createElement("div");
    main.className = "past-hunt-entry-main";

    const title = document.createElement("h4");
    title.className = "past-hunt-entry-title";
    title.textContent = hunt.title || "Live Hunt";

    const meta = document.createElement("p");
    meta.className = "past-hunt-entry-meta";
    meta.textContent = `${formatHuntDate(hunt.endedAt)} · ${summary.totalBonuses || 0} bonuses`;

    main.append(title, meta);

    const stats = document.createElement("div");
    stats.className = "past-hunt-entry-stats";

    const profitValue = document.createElement("span");
    profitValue.className = "past-hunt-entry-profit";
    profitValue.textContent = formatCurrency(profit);
    profitValue.classList.toggle("is-positive", profit > 0);
    profitValue.classList.toggle("is-negative", profit < 0);

    const status = document.createElement("span");
    status.className = `past-hunt-entry-status past-hunt-entry-status--${hunt.status || "complete"}`;
    status.textContent = huntStatusLabel(hunt.status);

    stats.append(profitValue, status);
    top.append(main, stats);
    toggle.append(top);

    row.append(toggle);

    if (isAdmin) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "past-hunt-remove";
      removeBtn.setAttribute(
        "aria-label",
        `Delete past hunt ${hunt.title || "Live Hunt"}`
      );
      removeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM6 9h2v9H6V9Z"/></svg>';
      removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void deletePastHuntEntry(hunt, removeBtn);
      });
      row.append(removeBtn);
    }

    const details = document.createElement("div");
    details.className = "past-hunt-entry-details is-hidden";

    const detailStats = document.createElement("div");
    detailStats.className = "past-hunt-entry-detail-stats";

    const startStat = document.createElement("div");
    startStat.className = "past-hunt-detail-stat";
    startStat.innerHTML = `<span>Start</span><strong>${formatCurrency(hunt.startBalance || 0)}</strong>`;

    const wonStat = document.createElement("div");
    wonStat.className = "past-hunt-detail-stat";
    wonStat.innerHTML = `<span>Won</span><strong>${formatCurrency(summary.totalWon || 0)}</strong>`;

    detailStats.append(startStat, wonStat);

    const bonusList = document.createElement("ul");
    bonusList.className = "past-hunt-bonus-list";

    sortBonusesByBetAsc(hunt.bonuses).forEach((bonus) => {
      const bonusItem = document.createElement("li");
      bonusItem.className = "past-hunt-bonus-item";

      const slot = document.createElement("span");
      slot.className = "past-hunt-bonus-slot";
      const tags = [];
      if (bonus.superBonus) tags.push("Super");
      if (bonus.epicBonus) tags.push("Epic");
      const pastCatalogSlot = findCatalogSlot({
        slotName: bonus.slot,
        slotSlug: bonus.slotSlug,
      });
      const pastName = getBonusSlotDisplayName(bonus, pastCatalogSlot);
      slot.textContent = tags.length
        ? `${pastName} · ${tags.join(" · ")}`
        : pastName;

      const result = document.createElement("span");
      result.className = "past-hunt-bonus-result";
      if (bonus.status === "opened") {
        result.textContent = `${formatCurrency(bonus.payout ?? 0)} · ${formatMultiplier(bonus.multiplier)}`;
        if ((bonus.payout ?? 0) >= bonus.bet) {
          result.classList.add("is-win");
        }
      } else {
        result.textContent = "Not opened";
      }

      bonusItem.append(slot, result);
      bonusList.append(bonusItem);
    });

    details.append(detailStats, bonusList);

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      details.classList.toggle("is-hidden", expanded);
      item.classList.toggle("is-expanded", !expanded);
    });

    item.append(row, details);
    list.append(item);
  });
}

async function deletePastHuntEntry(hunt, button) {
  const title = hunt.title || "this past hunt";
  if (!window.confirm(`Delete "${title}" from past hunts? This cannot be undone.`)) {
    return;
  }

  button.disabled = true;
  setStatus("Deleting past hunt...");

  try {
    const response = await fetch("/api/bonus-hunt/history/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: hunt.id }),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not delete past hunt.", "error");
      return;
    }

    pastHunts = data.pastHunts || pastHunts.filter((entry) => entry.id !== hunt.id);
    renderPastHunts(pastHunts);
    setStatus("Past hunt deleted.", "success");
  } catch {
    setStatus("Could not delete past hunt. Try again.", "error");
  } finally {
    button.disabled = false;
  }
}

async function loadPastHunts() {
  try {
    const response = await fetch("/api/bonus-hunt/history", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    pastHunts = data.pastHunts || [];
    renderPastHunts(pastHunts);
  } catch {
    // Keep the last known state.
  }
}

async function loadBonusHunt() {
  try {
    const response = await fetch("/api/bonus-hunt", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    const previousBonuses = huntBonuses;
    huntMeta = {
      ...(data.hunt || huntMeta),
      collecting: data.hunt?.collecting !== false,
    };
    huntBonuses = data.bonuses || [];
    renderHuntHeader(huntMeta);
    renderSummary(data.summary, huntMeta);
    updateBonusList(huntBonuses, { previous: previousBonuses });
  } catch {
    // Keep the last known state.
  }
}

function stripProviderFromSlotName(slotName, provider) {
  let name = String(slotName || "")
    .trim()
    .replace(/\s+/g, " ");
  const prov = String(provider || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!name || !prov) {
    return name;
  }

  const lower = name.toLowerCase();
  const provLower = prov.toLowerCase();
  if (lower === provLower) {
    return name;
  }

  if (lower.endsWith(` ${provLower}`)) {
    return name.slice(0, -(prov.length + 1)).trim();
  }

  return name;
}

function getBonusSlotDisplayName(bonus, catalogSlot) {
  const provider = bonus?.provider || catalogSlot?.provider || "";
  if (catalogSlot?.name) {
    const fromCatalog =
      stripProviderFromSlotName(catalogSlot.name, catalogSlot.provider) ||
      catalogSlot.name;
    // Prefer catalog title when we matched by slug, even if stored bonus name is dirty.
    if (bonus?.slotSlug && catalogSlot.slug === bonus.slotSlug) {
      return fromCatalog;
    }
    if (
      stripProviderFromSlotName(bonus?.slot, provider) === fromCatalog ||
      !provider
    ) {
      return fromCatalog;
    }
  }

  let name = stripProviderFromSlotName(bonus?.slot, provider) || bonus?.slot || "";

  // Fall back: try stripping any known catalog provider suffix from a dirty bonus name.
  if (name && name === bonus?.slot) {
    for (const slot of slotCatalog) {
      if (!slot?.provider) continue;
      const cleaned = stripProviderFromSlotName(name, slot.provider);
      if (cleaned && cleaned !== name) {
        return cleaned;
      }
    }
  }

  return name;
}

function groupLabelForSlot(slot) {
  if (!slot) return "";
  const group = slotGroups.find((entry) => entry.slug === slot.groupSlug);
  return group?.label || slot.provider || "";
}

function slotBelongsToGroup(slot, groupSlug) {
  if (!slot || !groupSlug) {
    return false;
  }

  if (slot.groupSlug === groupSlug) {
    return true;
  }

  return Array.isArray(slot.groupSlugs) && slot.groupSlugs.includes(groupSlug);
}

function getCatalogSectionCounts() {
  const counts = {};
  for (const group of slotGroups) {
    counts[group.slug] = slotCatalog.filter((slot) =>
      slotBelongsToGroup(slot, group.slug)
    ).length;
  }

  const unique = new Set(
    slotCatalog.map((slot) => String(slot.slug || "").toLowerCase()).filter(Boolean)
  ).size;

  return { counts, unique };
}

function formatCatalogCountSummary() {
  const sections = slotCatalogSectionStats?.sections;
  const uniqueFromApi = slotCatalogSectionStats?.unique;
  let parts;
  let unique;

  if (sections?.length) {
    parts = sections.map((section) => `${section.label}: ${section.count || 0}`);
    unique =
      Number.isFinite(uniqueFromApi) && uniqueFromApi >= 0
        ? uniqueFromApi
        : sections.reduce((sum, section) => sum + (section.count || 0), 0);
  } else {
    const local = getCatalogSectionCounts();
    unique = local.unique;
    parts = (slotGroups.length
      ? slotGroups
      : [
          { slug: "new-releases", label: "New Releases" },
          { slug: "only-on-stake", label: "Only on Stake" },
        ]
    ).map((group) => {
      const total = local.counts[group.slug] || 0;
      return `${group.label}: ${total}`;
    });
  }

  let summary = parts.length
    ? `${parts.join(" · ")} (${unique} unique)`
    : unique === 1
      ? "1 unique Stake slot"
      : `${unique} unique Stake slots`;

  if (slotCatalogUpdatedAt) {
    const updatedMs = Date.parse(slotCatalogUpdatedAt);
    if (Number.isFinite(updatedMs)) {
      const secondsAgo = Math.max(0, Math.round((Date.now() - updatedMs) / 1000));
      summary +=
        secondsAgo < 5
          ? " · updated just now"
          : secondsAgo < 60
            ? ` · updated ${secondsAgo}s ago`
            : ` · updated ${Math.round(secondsAgo / 60)}m ago`;
    }
  }

  return summary;
}

function updateSlotCatalogNote() {
  const note = document.getElementById("slot-catalog-note");
  const summary = slotCatalog.length
    ? formatCatalogCountSummary()
    : "No slots loaded yet. Use Sync New Releases and Sync Only on Stake above.";

  if (note && currentUser?.isAdmin) {
    note.textContent = summary;
  }

  const count = document.getElementById("slot-catalog-count");
  if (count) {
    if (slotCatalog.length) {
      count.textContent = formatCatalogCountSummary();
    } else if (currentUser?.isAdmin) {
      count.textContent = "Slot list empty · sync Allowed slots above";
    }
  }
}

function updateHuntAddSlotMeta() {
  const meta = document.getElementById("hunt-add-slot-meta");
  const search = document.getElementById("hunt-add-slot-search");
  if (!meta) return;

  const collectingOff = Boolean(currentUser?.isAdmin) && huntMeta?.collecting === false;

  if (!slotCatalog.length) {
    meta.textContent =
      "No slots loaded. Sync Allowed slots in Requests admin first.";
    if (search) {
      search.placeholder = "Sync Allowed slots first…";
      search.disabled = true;
    }
    return;
  }

  if (collectingOff) {
    meta.textContent = "Collecting is off. Turn Collecting on to add bonuses.";
  } else {
    meta.textContent = formatCatalogCountSummary();
  }

  if (search) {
    const unique =
      slotCatalogSectionStats?.unique ||
      getCatalogSectionCounts().unique ||
      slotCatalog.length;
    search.placeholder = collectingOff
      ? "Collecting is off…"
      : `Search ${unique} slots…`;
    search.disabled = collectingOff;
  }

  updateHuntAddAvailability();
}

function renderHuntAddSelectedSlot() {
  const selected = document.getElementById("hunt-add-slot-selected");
  const nameEl = document.getElementById("hunt-add-slot-selected-name");
  const metaEl = document.getElementById("hunt-add-slot-selected-meta");
  const submit = document.getElementById("hunt-add-bonus-submit");
  if (!selected || !nameEl || !metaEl) return;

  if (!huntAddSelectedSlot) {
    selected.classList.add("is-hidden");
    nameEl.textContent = "";
    metaEl.textContent = "";
    if (submit) submit.disabled = false;
    return;
  }

  selected.classList.remove("is-hidden");
  nameEl.textContent = huntAddSelectedSlot.name || "Selected slot";
  metaEl.textContent = String(huntAddSelectedSlot.provider || "").trim();
}

function clearHuntAddSelection({ keepSearch = false } = {}) {
  huntAddSelectedSlot = null;
  if (!keepSearch) {
    huntAddSearchQuery = "";
    const search = document.getElementById("hunt-add-slot-search");
    if (search) search.value = "";
  }
  renderHuntAddSelectedSlot();
  renderHuntAddSlotResults();
}

function renderHuntAddSlotResults() {
  const results = document.getElementById("hunt-add-slot-results");
  const empty = document.getElementById("hunt-add-slot-empty");
  if (!results || !empty) return;

  results.replaceChildren();
  const query = huntAddSearchQuery.trim().toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);

  if (huntAddSelectedSlot) {
    results.classList.add("is-hidden");
    empty.classList.add("is-hidden");
    empty.textContent = "";
    return;
  }

  if (!slotCatalog.length) {
    results.classList.add("is-hidden");
    empty.classList.remove("is-hidden");
    empty.textContent =
      "Slot catalog is empty. Sync Allowed slots in Requests admin first.";
    return;
  }

  const matches = [];
  const seenSlugs = new Set();
  for (const slot of slotCatalog) {
    const slug = String(slot.slug || "").toLowerCase();
    if (slug && seenSlugs.has(slug)) {
      continue;
    }

    const haystack = [slot.name, slot.slug, slot.provider]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (tokens.length && !tokens.every((token) => haystack.includes(token))) {
      continue;
    }

    if (slug) {
      seenSlugs.add(slug);
    }
    matches.push(slot);
  }

  matches.sort((a, b) => {
    if (tokens.length) {
      const aName = String(a.name || "").toLowerCase();
      const bName = String(b.name || "").toLowerCase();
      const aStarts = tokens.some((token) => aName.startsWith(token)) ? 0 : 1;
      const bStarts = tokens.some((token) => bName.startsWith(token)) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
    }
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
      sensitivity: "base",
    });
  });

  // Empty query = browse the catalog; typed query = filtered matches.
  const limited = matches.slice(0, query ? 40 : 30);

  if (!limited.length) {
    results.classList.add("is-hidden");
    empty.classList.remove("is-hidden");
    empty.textContent = query ? "No matching slots." : "No slots available.";
    return;
  }

  empty.classList.add("is-hidden");
  empty.textContent = "";
  results.classList.remove("is-hidden");

  limited.forEach((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hunt-add-slot-option";
    button.dataset.slotSlug = slot.slug || "";
    button.setAttribute("role", "option");

    button.append(
      createSlotThumb(slot.name, normalizeSlotThumbnailUrl(slot.thumbnailUrl), {
        rootClass: "hunt-add-slot-thumb",
        imageClass: "hunt-add-slot-thumb-image",
      })
    );

    const copy = document.createElement("span");
    copy.className = "hunt-add-slot-option-copy";

    const name = document.createElement("span");
    name.className = "hunt-add-slot-option-name";
    name.textContent = slot.name;

    const provider = document.createElement("span");
    provider.className = "hunt-add-slot-option-provider";
    provider.textContent = String(slot.provider || "").trim();

    copy.append(name, provider);
    button.append(copy);
    results.append(button);
  });
}

function selectHuntAddSlot(slot) {
  if (!slot) return;
  huntAddSelectedSlot = slot;
  huntAddSearchQuery = slot.name || "";
  const search = document.getElementById("hunt-add-slot-search");
  if (search) search.value = slot.name || "";
  renderHuntAddSelectedSlot();
  renderHuntAddSlotResults();
  document.getElementById("hunt-add-bet")?.focus();
}

async function addBonusToHunt({
  slot,
  bet,
  slotSlug,
  thumbnailUrl,
  provider,
  requestedBy,
} = {}) {
  const slotName = slot?.trim();
  const betAmount = Number(bet);
  const requester = String(requestedBy || "").trim();

  if (!slotName) {
    setStatus("Enter a slot name.", "error");
    return null;
  }

  if (!Number.isFinite(betAmount) || betAmount < 0) {
    setStatus("Enter a valid bet amount.", "error");
    return null;
  }

  setStatus("Adding bonus...");

  try {
    const response = await fetch("/api/bonus-hunt/add", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot: slotName,
        bet: betAmount,
        slotSlug: slotSlug || undefined,
        thumbnailUrl: thumbnailUrl || undefined,
        provider: provider || undefined,
        requestedBy: requester || undefined,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not add bonus.", "error");
      return null;
    }

    setStatus("Bonus added.", "success");
    await loadBonusHunt();
    return data.bonus || null;
  } catch {
    setStatus("Could not add bonus. Try again.", "error");
    return null;
  }
}

function scrollToBonusCard(bonusId) {
  const card = bonusId
    ? document.querySelector(`.hunt-bonus-card[data-id="${bonusId}"]`)
    : null;
  const target = card || document.querySelector(".hunt-bonus-section");

  target?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
}

function resolveSlotRequestBet(request, betInput) {
  const typedBet = betInput?.value?.trim() || slotBetDrafts.get(request.id)?.trim() || "";
  if (typedBet) {
    return typedBet;
  }

  if (request.bet === null || request.bet === undefined) {
    return "";
  }

  return formatSlotBetValue(request.bet);
}

async function submitBonusAddForm({
  button,
  slot,
  bet,
  slotSlug,
  thumbnailUrl,
  provider,
  requestedBy,
} = {}) {
  if (button) {
    button.disabled = true;
  }

  const bonus = await addBonusToHunt({
    slot,
    bet,
    slotSlug,
    thumbnailUrl,
    provider,
    requestedBy,
  });
  if (bonus) {
    scrollToBonusCard(bonus.id);
  }

  if (button) {
    button.disabled = false;
  }

  return bonus;
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

function renderKickChatStatus(status) {
  const panel = document.getElementById("kick-chat-admin");
  const chatStatus = document.getElementById("kick-chat-status");
  const botMeta = document.getElementById("kick-bot-status");
  const webhookLog = document.getElementById("kick-webhook-log");
  const connectButton = document.getElementById("kick-bot-connect");
  const subscribeButton = document.getElementById("kick-chat-subscribe");

  if (!currentUser?.isAdmin) {
    panel?.classList.add("is-hidden");
    return;
  }

  panel?.classList.remove("is-hidden");

  if (!status) {
    if (chatStatus) {
      chatStatus.textContent = "Could not load Kick chat status.";
      chatStatus.className = "requests-hub-kick-status is-error";
    }
    return;
  }

  const lines = [];
  if (status.kickChatSubscribed) {
    lines.push("Chat listener is subscribed.");
  } else {
    lines.push("Chat listener is not subscribed. Click Enable !s in chat.");
  }

  if (status.chatRepliesReady) {
    lines.push("Bot replies are configured.");
  } else {
    lines.push("Connect chat bot if you want confirmation messages in Kick chat.");
  }

  if (status.subscriptionError) {
    lines.push(status.subscriptionError);
  }

  const latestWebhook = status.recentWebhookEvents?.[0];
  if (latestWebhook) {
    if (latestWebhook.ok && latestWebhook.handled) {
      lines.push(`Last chat event processed ${new Date(latestWebhook.at).toLocaleTimeString()}.`);
    } else if (latestWebhook.error) {
      lines.push(`Last webhook issue: ${latestWebhook.error}`);
    } else if (latestWebhook.reason === "not-command") {
      lines.push(`Last chat event received ${new Date(latestWebhook.at).toLocaleTimeString()} (not a !s command).`);
    }
  } else {
    lines.push("No chat webhook events received yet.");
  }

  if (chatStatus) {
    chatStatus.textContent = lines.join(" ");
    chatStatus.className = `requests-hub-kick-status ${
      status.kickChatSubscribed ? "is-success" : "is-error"
    }`;
  }

  if (botMeta) {
    botMeta.textContent = status.webhookUrl
      ? `Kick Developer Portal webhook URL: ${status.webhookUrl}`
      : "";
  }

  if (webhookLog) {
    const entries = status.recentWebhookEvents || [];
    if (entries.length) {
      webhookLog.textContent = entries
        .slice(0, 3)
        .map((entry) => {
          const time = new Date(entry.at).toLocaleTimeString();
          if (entry.error) return `${time}: ${entry.error}`;
          if (entry.handled) return `${time}: processed !s from ${entry.username || "viewer"}`;
          return `${time}: ${entry.reason || entry.stage || "event"}`;
        })
        .join(" | ");
      webhookLog.classList.remove("is-hidden");
    } else {
      webhookLog.textContent = "";
      webhookLog.classList.add("is-hidden");
    }
  }

  if (connectButton) {
    connectButton.classList.toggle("is-hidden", Boolean(status.chatRepliesReady));
  }

  if (subscribeButton) {
    subscribeButton.classList.toggle("is-hidden", Boolean(status.kickChatSubscribed));
  }
}

async function loadKickChatStatus() {
  if (!currentUser?.isAdmin) {
    renderKickChatStatus(null);
    return;
  }

  try {
    const response = await fetch("/api/kick/chat-status", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      renderKickChatStatus(null);
      return;
    }

    const status = await response.json();
    renderKickChatStatus(status);
  } catch {
    renderKickChatStatus(null);
  }
}

function handleKickBotRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const kickBot = params.get("kickBot");
  if (!kickBot) return;

  if (kickBot === "connected") {
    const username = params.get("username");
    setStatus(
      username
        ? `Kick chat bot ready as ${username}.`
        : "Kick chat bot ready.",
      "success"
    );
    void loadKickChatStatus();
  } else if (kickBot === "error") {
    const message = params.get("message");
    const text =
      message === "Client authentication failed"
        ? "Kick Client Secret is invalid on the server. Regenerate it in the Kick Developer Portal, update KICK_CLIENT_SECRET in Vercel, and redeploy."
        : message || "Could not connect Kick chat bot.";
    setStatus(text, "error");
  }

  params.delete("kickBot");
  params.delete("username");
  params.delete("message");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function accessModeLabel() {
  if (affiliatesOnly && subscribersOnly) {
    return "AFF/SUB";
  }
  if (affiliatesOnly) {
    return "AFF";
  }
  if (subscribersOnly) {
    return "SUB";
  }
  return "";
}

function accessModeNoteText() {
  if (affiliatesOnly && subscribersOnly) {
    return "AFF/SUB only — verified BLAKJAC21 affiliates and active Kick subscribers can request.";
  }
  if (affiliatesOnly) {
    return "AFF only — verified BLAKJAC21 affiliates can request.";
  }
  if (subscribersOnly) {
    return "SUB only — active Kick subscribers can request.";
  }
  return "";
}

function huntPhaseClass(status) {
  switch (status) {
    case "opening":
      return "hunt-status hunt-status--opening";
    case "complete":
      return "hunt-status hunt-status--complete";
    case "collecting":
    default:
      return "hunt-status hunt-status--collecting";
  }
}

function updateHuntPhaseStatus(hunt = huntMeta) {
  const status = document.getElementById("hunt-status");
  if (!status) return;

  const collecting = hunt?.collecting !== false;
  const isAdmin = Boolean(currentUser?.isAdmin);

  status.textContent = collecting ? "Collecting" : "Collecting off";
  status.className = collecting
    ? "hunt-status hunt-status--collecting hunt-status-toggle"
    : "hunt-status hunt-status--collecting-off hunt-status-toggle";
  status.setAttribute("aria-pressed", collecting ? "true" : "false");
  status.disabled = !isAdmin;
  status.title = isAdmin
    ? "Click to toggle collecting bonuses"
    : collecting
      ? "Hunt is collecting bonuses"
      : "Collecting is off";
}

async function setCollecting(nextCollecting) {
  const response = await fetch("/api/bonus-hunt/settings", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: huntMeta.title,
      startBalance: huntMeta.startBalance,
      showHighestMulti: Boolean(huntMeta.showHighestMulti),
      collecting: Boolean(nextCollecting),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Could not update collecting setting.");
  }

  huntMeta = {
    ...huntMeta,
    ...(data.hunt || {}),
    collecting: data.hunt?.collecting !== false,
  };
  updateHuntPhaseStatus(huntMeta);
  updateHuntAddAvailability();
  return data;
}

function updateHuntAddAvailability() {
  const form = document.getElementById("hunt-add-bonus-form");
  const search = document.getElementById("hunt-add-slot-search");
  const submit = document.getElementById("hunt-add-bonus-submit");
  const bet = document.getElementById("hunt-add-bet");
  const collecting = huntMeta?.collecting !== false;
  const locked = Boolean(currentUser?.isAdmin) && !collecting;

  if (search) search.disabled = locked || (!slotCatalog.length && Boolean(currentUser?.isAdmin));
  if (bet) bet.disabled = locked;
  if (submit) submit.disabled = locked;
  form?.classList.toggle("is-collecting-off", locked);
}

function updateRequestStatusBadges() {
  const requestsStatus = document.getElementById("hunt-requests-status");
  const panelStatus = document.getElementById("requests-panel-status");
  const isAdmin = Boolean(currentUser?.isAdmin);
  const mode = accessModeLabel();

  const label = acceptingRequests
    ? mode
      ? `Requests · ${mode}`
      : REQUEST_STATUS_LABELS.open
    : REQUEST_STATUS_LABELS.closed;
  const statusClass = acceptingRequests
    ? "hunt-status hunt-status--requests-open hunt-status-toggle"
    : "hunt-status hunt-status--requests-closed hunt-status-toggle";
  const panelClass = acceptingRequests
    ? "requests-hub-status requests-hub-status--open"
    : "requests-hub-status requests-hub-status--closed";

  if (requestsStatus) {
    requestsStatus.textContent = label;
    requestsStatus.className = statusClass;
    requestsStatus.setAttribute("aria-pressed", acceptingRequests ? "true" : "false");
    requestsStatus.disabled = !isAdmin;
    requestsStatus.title = isAdmin
      ? "Click to toggle slot requests (separate from hunt phase)"
      : acceptingRequests
        ? mode
          ? `Slot requests open (${mode} only)`
          : "Slot requests are open"
        : "Slot requests are closed";
  }

  if (panelStatus) {
    panelStatus.textContent = label;
    panelStatus.className = panelClass;
  }
}

function updateToggleLabel() {
  const label = document.getElementById("slot-requests-toggle-status");
  const toggle = document.getElementById("slot-requests-toggle");

  if (label) {
    label.textContent = acceptingRequests
      ? "Accepting slot requests"
      : "Slot requests are closed";
  }

  if (toggle && currentUser?.isAdmin) {
    toggle.checked = acceptingRequests;
  }

  updateRequestStatusBadges();
  updateAccessModeLabels();
}

function updateAccessModeLabels() {
  const affLabel = document.getElementById("slot-requests-aff-status");
  const subLabel = document.getElementById("slot-requests-sub-status");
  const affToggle = document.getElementById("slot-requests-aff-toggle");
  const subToggle = document.getElementById("slot-requests-sub-toggle");
  const note = document.getElementById("slot-request-access-note");
  const modeNote = accessModeNoteText();

  if (affLabel) {
    affLabel.textContent = affiliatesOnly
      ? "Only verified AFF users can request"
      : "Affiliate restriction off";
  }

  if (subLabel) {
    subLabel.textContent = subscribersOnly
      ? "Only Kick subscribers can request"
      : "Subscriber restriction off";
  }

  if (affToggle && currentUser?.isAdmin) {
    affToggle.checked = affiliatesOnly;
  }

  if (subToggle && currentUser?.isAdmin) {
    subToggle.checked = subscribersOnly;
  }

  if (note) {
    note.textContent = modeNote;
    note.classList.toggle("is-hidden", !modeNote || !acceptingRequests);
  }
}

async function setSlotRequestAccessMode({ nextAffiliatesOnly, nextSubscribersOnly }) {
  const response = await fetch("/api/bonus-hunt/requests/aff-sub-only", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      affiliatesOnly: nextAffiliatesOnly,
      subscribersOnly: nextSubscribersOnly,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not update request access settings.");
  }

  affiliatesOnly = Boolean(data.affiliatesOnly);
  subscribersOnly = Boolean(data.subscribersOnly);
  acceptingRequests = Boolean(data.acceptingRequests);
  updateAccessModeLabels();
  updateRequestPanels();
  updateToggleLabel();
  return data;
}

async function setAcceptingRequests(nextAccepting) {
  const response = await fetch("/api/bonus-hunt/requests/toggle", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accepting: nextAccepting }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not update slot request setting.");
  }

  acceptingRequests = Boolean(data.acceptingRequests);
  if ("affiliatesOnly" in data) {
    affiliatesOnly = Boolean(data.affiliatesOnly);
  }
  if ("subscribersOnly" in data) {
    subscribersOnly = Boolean(data.subscribersOnly);
  }
  updateRequestPanels();
  updateToggleLabel();
  renderSlotRequests(slotRequests);

  if (acceptingRequests) {
    void loadSlotCatalog();
  }

  if (currentUser?.isAdmin && data.kickChatError) {
    setStatus(`Slot requests are on, but Kick chat failed to connect: ${data.kickChatError}`, "error");
  } else if (currentUser?.isAdmin && data.acceptingRequests && data.kickChatSubscribed === false) {
    setStatus("Slot requests are on, but chat is not subscribed. Click Enable !s in chat.", "error");
  }

  if (currentUser?.isAdmin) {
    await loadKickChatStatus();
  }

  return data;
}

function updateRequestPanels() {
  const closedPanel = document.getElementById("slot-request-closed");
  const requestPanel = document.getElementById("slot-request-panel");
  const guestPanel = document.getElementById("slot-request-guest");
  const adminActions = document.getElementById("slot-requests-admin");
  const isAdmin = Boolean(currentUser?.isAdmin);
  const isSignedIn = Boolean(currentUser);
  const open = acceptingRequests;
  const atLimit = mySlotRequests.length >= slotRequestLimit;

  closedPanel?.classList.toggle("is-hidden", open || isAdmin);
  requestPanel?.classList.toggle("is-hidden", !open || isAdmin || !isSignedIn);
  guestPanel?.classList.toggle("is-hidden", !open || isSignedIn);
  adminActions?.classList.toggle("is-hidden", !isAdmin);

  const select = document.getElementById("slot-request-select");
  const submitBtn = document.getElementById("slot-request-submit");
  const limitNote = document.getElementById("slot-request-limit-note");
  const canSubmit = open && isSignedIn && !isAdmin && !atLimit;

  if (select) {
    select.disabled = !canSubmit;
  }

  if (submitBtn) {
    submitBtn.disabled = !canSubmit;
  }

  if (limitNote) {
    if (!open || isAdmin || !isSignedIn) {
      limitNote.classList.add("is-hidden");
    } else {
      const remaining = Math.max(0, slotRequestLimit - mySlotRequests.length);
      limitNote.classList.remove("is-hidden");
      if (atLimit) {
        limitNote.textContent = `You have ${slotRequestLimit} slot requests in the queue.`;
      } else if (mySlotRequests.length) {
        limitNote.textContent = `You can request up to ${slotRequestLimit} slots (${remaining} remaining).`;
      } else {
        limitNote.textContent = `You can request up to ${slotRequestLimit} slots.`;
      }
    }
  }
}

function mountSlotQueuePanel() {
  const adminTools = document.getElementById("slot-requests-admin");
  adminTools?.classList.toggle("is-hidden", !currentUser?.isAdmin);
}

function updatePanels() {
  const adminPanel = document.getElementById("bonus-hunt-admin");
  const settingsForm = document.getElementById("hunt-settings-form");
  const highestMultiToggle = document.getElementById("hunt-highest-multi-toggle");

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  settingsForm?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  if (highestMultiToggle) {
    highestMultiToggle.disabled = !currentUser?.isAdmin;
  }
  mountSlotQueuePanel();
  updateRequestPanels();
  updateToggleLabel();
}

function renderSlotCatalogSelect(selectedSlug = "") {
  const select = document.getElementById("slot-request-select");
  const count = document.getElementById("slot-catalog-count");

  if (!select) return;

  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = slotCatalog.length
    ? "Choose a slot..."
    : "No slots loaded yet";
  select.append(placeholder);

  const grouped = new Map();
  for (const slot of slotCatalog) {
    for (const group of slotGroups) {
      if (!slotBelongsToGroup(slot, group.slug)) {
        continue;
      }
      if (!grouped.has(group.slug)) {
        grouped.set(group.slug, []);
      }
      grouped.get(group.slug).push(slot);
    }
  }

  for (const group of slotGroups) {
    const slots = grouped.get(group.slug) || [];
    if (!slots.length) continue;

    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;

    for (const slot of slots) {
      const option = document.createElement("option");
      option.value = slot.slug;
      option.textContent = slot.name;
      option.dataset.groupSlug = group.slug;
      if (slot.slug === selectedSlug) {
        option.selected = true;
      }
      optgroup.append(option);
    }

    select.append(optgroup);
  }

  if (count) {
    count.textContent = formatCatalogCountSummary();
  }
}

function isEditingSlotRequestBet() {
  const active = document.activeElement;
  return active?.classList?.contains("slot-request-bet-input") ?? false;
}

function formatSlotBetValue(bet) {
  if (bet === null || bet === undefined || bet === "") {
    return "";
  }

  return Number(bet).toFixed(2);
}

function findCatalogSlot(request) {
  if (!request) {
    return null;
  }

  const slug = String(request.slotSlug || "").trim().toLowerCase();
  const name = String(request.slotName || request.slot || "")
    .trim()
    .toLowerCase();

  return (
    slotCatalog.find((slot) => slug && slot.slug === slug) ||
    slotCatalog.find((slot) => slot.name.toLowerCase() === name) ||
    slotCatalog.find((slot) => {
      const slotName = String(slot.name || "").toLowerCase();
      const provider = String(slot.provider || "").toLowerCase();
      if (!slotName || !name) return false;
      if (provider && name === `${slotName} ${provider}`) return true;
      return name.startsWith(`${slotName} `);
    }) ||
    null
  );
}

function getSlotRequestProvider(request, catalogSlot) {
  if (request.provider) {
    return request.provider;
  }

  if (catalogSlot?.provider) {
    return catalogSlot.provider;
  }

  if (request.groupSlug === "pending") {
    return "";
  }

  return "";
}

function normalizeSlotThumbnailUrl(url) {
  const value = String(url || "").trim();
  if (!value) {
    return null;
  }

  const normalized = value.startsWith("//") ? `https:${value}` : value;
  const base = normalized.split("?")[0];
  return `${base}?w=150&h=200&fit=min&auto=format`;
}

function getSlotRequestThumbnail(request, catalogSlot) {
  return normalizeSlotThumbnailUrl(request.thumbnailUrl || catalogSlot?.thumbnailUrl);
}

function createSlotThumb(
  slotName,
  thumbnailUrl,
  { rootClass = "slot-request-thumb", imageClass = "slot-request-thumb-image" } = {}
) {
  const thumb = document.createElement("div");
  thumb.className = rootClass;

  if (thumbnailUrl) {
    const image = document.createElement("img");
    image.className = imageClass;
    image.src = thumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.remove();
      thumb.textContent = slotInitials(slotName);
      thumb.classList.add("is-fallback");
      thumb.style.background = avatarColor(slotName);
    });
    thumb.append(image);
  } else {
    thumb.textContent = slotInitials(slotName);
    thumb.classList.add("is-fallback");
    thumb.style.background = avatarColor(slotName);
  }

  return thumb;
}

function createSlotRequestThumb(slotName, thumbnailUrl) {
  return createSlotThumb(slotName, thumbnailUrl);
}

function renderSlotRequests(requests) {
  const list = document.getElementById("slot-requests-list");
  const empty = document.getElementById("slot-requests-empty");
  const count = document.getElementById("slot-requests-count");

  if (!list || !empty) return;

  const total = requests.length;
  empty.classList.toggle("is-hidden", total > 0);
  list.classList.toggle("is-hidden", total === 0);
  list.replaceChildren();

  if (count) {
    count.textContent = total === 1 ? "1 request" : `${total} requests`;
  }

  if (!total) {
    const isAdmin = Boolean(currentUser?.isAdmin);
    if (acceptingRequests) {
      empty.textContent = "No requests yet. Viewers can type !s slot name in chat.";
    } else if (isAdmin) {
      empty.textContent =
        "No requests in the queue. Turn on Slot requests (header or toggle) to start accepting them.";
    } else {
      empty.textContent =
        "Nothing in the queue yet. Check back when Requests are open.";
    }
  }

  requests.forEach((request) => {
    const catalogSlot = findCatalogSlot(request);
    const provider = getSlotRequestProvider(request, catalogSlot);
    const thumbnailUrl = getSlotRequestThumbnail(request, catalogSlot);

    const item = document.createElement("li");
    item.className = "slot-request-entry";
    item.dataset.requestId = request.id;

    const thumb = createSlotRequestThumb(request.slotName, thumbnailUrl);

    const info = document.createElement("div");
    info.className = "slot-request-info";

    const titleRow = document.createElement("div");
    titleRow.className = "slot-request-title-row";

    const slot = document.createElement("span");
    slot.className = "slot-request-slot";
    slot.textContent = request.slotName;

    titleRow.append(slot);

    if (provider) {
      const providerEl = document.createElement("span");
      providerEl.className = "slot-request-provider";
      providerEl.textContent = provider;
      titleRow.append(providerEl);
    }

    const user = document.createElement("span");
    user.className = "slot-request-user";
    user.textContent = `by ${request.username}`;

    info.append(titleRow, user);
    item.append(thumb, info);

    if (currentUser?.isAdmin) {
      const controls = document.createElement("div");
      controls.className = "slot-request-controls";

      const betField = document.createElement("div");
      betField.className = "slot-request-field";

      const betLabel = document.createElement("span");
      betLabel.className = "slot-request-field-label";
      betLabel.textContent = "Bet";

      const betRow = document.createElement("div");
      betRow.className = "guess-input-row";

      const prefix = document.createElement("span");
      prefix.className = "guess-prefix";
      prefix.setAttribute("aria-hidden", "true");
      prefix.textContent = "$";

      const betInput = document.createElement("input");
      betInput.type = "number";
      betInput.className = "guess-input slot-request-bet-input";
      betInput.min = "0.01";
      betInput.max = "1000";
      betInput.step = "0.01";
      betInput.inputMode = "decimal";
      betInput.placeholder = "0.00";
      betInput.value = slotBetDrafts.has(request.id)
        ? slotBetDrafts.get(request.id)
        : formatSlotBetValue(request.bet);
      betInput.setAttribute("aria-label", `Bet size for ${request.slotName}`);

      betRow.append(prefix, betInput);
      betField.append(betLabel, betRow);

      betInput.addEventListener("input", () => {
        slotBetDrafts.set(request.id, betInput.value);
      });

      betInput.addEventListener("blur", () => {
        const value = betInput.value.trim();
        if (!value) {
          return;
        }

        if (value === formatSlotBetValue(request.bet)) {
          slotBetDrafts.delete(request.id);
          return;
        }

        void saveSlotRequestBet(request.id, value, { silent: true });
      });

      betInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void saveSlotRequestBet(request.id, betInput.value);
        }
      });

      const addBonusBtn = document.createElement("button");
      addBonusBtn.type = "button";
      addBonusBtn.className = "btn btn-sm btn-primary";
      addBonusBtn.textContent = "Add bonus";
      addBonusBtn.addEventListener("click", async () => {
        const betValue = resolveSlotRequestBet(request, betInput);
        const betAmount = Number(betValue);

        if (!betValue || !Number.isFinite(betAmount) || betAmount < 0.01) {
          setStatus("Enter a bet size before adding the bonus.", "error");
          betInput.focus();
          return;
        }

        if (betInput.value.trim()) {
          await saveSlotRequestBet(request.id, betInput.value, {
            silent: true,
            skipRender: true,
          });
        }

        const catalogSlot = findCatalogSlot(request);
        const bonus = await submitBonusAddForm({
          button: addBonusBtn,
          slot: request.slotName,
          slotSlug: request.slotSlug,
          thumbnailUrl: getSlotRequestThumbnail(request, catalogSlot),
          provider: getSlotRequestProvider(request, catalogSlot),
          bet: betValue,
          requestedBy: request.username,
        });

        if (bonus) {
          await removeSlotRequestEntry(request.id, addBonusBtn, {
            successMessage: "Bonus added.",
          });
        }
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "slot-request-remove";
      removeBtn.setAttribute("aria-label", `Remove ${request.slotName} request`);
      removeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM6 9h2v9H6V9Z"/></svg>';
      removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void removeSlotRequestEntry(request.id, removeBtn);
      });

      controls.append(betField, addBonusBtn, removeBtn);
      item.append(controls);
    }

    list.append(item);
  });
}

async function loadSlotCatalog() {
  try {
    const response = await fetch("/api/bonus-hunt/slots", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Could not load slot catalog.");
    }

    const data = await response.json();
    slotCatalog = data.slots || [];
    slotGroups = data.groups || [];
    slotCatalogUpdatedAt = data.updatedAt || null;
    slotCatalogSectionStats = {
      sections: Array.isArray(data.sections) ? data.sections : null,
      unique: Number(data.unique) || 0,
    };

    const select = document.getElementById("slot-request-select");
    const selectedSlug = select?.value || "";
    renderSlotCatalogSelect(selectedSlug);
    updateHuntAddSlotMeta();
    updateSlotCatalogNote();
    renderHuntAddSlotResults();

    if (currentUser?.isAdmin && data.total > 0 && !data.withThumbnails) {
      setStatus(
        "Slot list is loaded, but logos are missing.",
        "error"
      );
    }

    if (slotRequests.length && !isEditingSlotRequestBet()) {
      renderSlotRequests(slotRequests);
    }
  } catch (error) {
    const count = document.getElementById("slot-catalog-count");
    if (count && !slotCatalog.length) {
      count.textContent = "Slot list unavailable";
      setRequestStatus(error.message, "error");
    }
  }
}

async function loadSlotRequests({ forceRender = false } = {}) {
  try {
    const response = await fetch("/api/bonus-hunt/requests", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    acceptingRequests = Boolean(data.acceptingRequests);
    affiliatesOnly = Boolean(data.affiliatesOnly);
    subscribersOnly = Boolean(data.subscribersOnly);
    let incoming = data.requests || [];
    if (pendingSlotRequestRemovals.size) {
      incoming = incoming.filter(
        (entry) => !pendingSlotRequestRemovals.has(entry.id)
      );
    }
    slotRequests = incoming;
    mySlotRequests = data.myRequests || (data.myRequest ? [data.myRequest] : []);
    slotRequestLimit = Number(data.requestLimit) || 3;

    if (forceRender || !isEditingSlotRequestBet()) {
      renderSlotRequests(slotRequests);
    } else {
      const count = document.getElementById("slot-requests-count");
      if (count) {
        const total = slotRequests.length;
        count.textContent = total === 1 ? "1 request" : `${total} requests`;
      }
    }

    updateRequestPanels();
    updateToggleLabel();

    const catalogCount = document.getElementById("slot-catalog-count");
    if (catalogCount) {
      if (slotCatalog.length) {
        catalogCount.textContent = formatCatalogCountSummary();
      } else if (currentUser?.isAdmin) {
        catalogCount.textContent =
          "Slot list empty · sync Allowed slots above";
      } else {
        catalogCount.textContent = "Slot list is loading...";
      }
    }

    if (currentUser?.isAdmin && data.kickChatSubscribed === false) {
      setStatus(
        "Kick chat is not subscribed yet. Use Enable !s in chat in the admin panel.",
        "error"
      );
    }

    if (currentUser?.isAdmin) {
      renderKickChatStatus({
        kickChatSubscribed: Boolean(data.kickChatSubscribed),
        chatRepliesReady: false,
        subscriptionError: data.kickChatSubscriptionError || null,
        webhookUrl: null,
      });
    }

    const select = document.getElementById("slot-request-select");
    if (!select?.value && data.myRequest?.slotSlug) {
      renderSlotCatalogSelect(data.myRequest.slotSlug);
    }
  } catch {
    // Keep the last known state.
  }
}

async function saveSlotRequestBet(id, betValue, { button, silent = false, skipRender = false } = {}) {
  if (button) {
    button.disabled = true;
  }

  if (!silent) {
    setStatus("Saving bet size...");
  }

  try {
    const response = await fetch("/api/bonus-hunt/requests/bet", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, bet: betValue }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (!silent) {
        setStatus(data.error || "Could not save bet size.", "error");
      }
      return false;
    }

    if (!silent) {
      setStatus("Bet size saved.", "success");
    }

    slotBetDrafts.delete(id);

    const savedRequest = data.request;
    if (savedRequest) {
      slotRequests = slotRequests.map((entry) =>
        entry.id === savedRequest.id ? savedRequest : entry
      );
    }

    if (!skipRender && !isEditingSlotRequestBet()) {
      renderSlotRequests(slotRequests);
    }

    return true;
  } catch {
    if (!silent) {
      setStatus("Could not save bet size. Try again.", "error");
    }
    return false;
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function removeSlotRequestEntry(id, button, { successMessage } = {}) {
  if (!id || pendingSlotRequestRemovals.has(id)) {
    return false;
  }

  if (button) {
    button.disabled = true;
  }
  pendingSlotRequestRemovals.add(id);
  slotBetDrafts.delete(id);

  if (document.activeElement?.classList?.contains("slot-request-bet-input")) {
    document.activeElement.blur();
  }

  slotRequests = slotRequests.filter((entry) => entry.id !== id);
  renderSlotRequests(slotRequests);

  if (!successMessage) {
    setStatus("Removing slot request...");
  }

  try {
    const response = await fetch("/api/bonus-hunt/requests/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      pendingSlotRequestRemovals.delete(id);
      setStatus(data.error || "Could not remove slot request.", "error");
      await loadSlotRequests({ forceRender: true });
      return false;
    }

    pendingSlotRequestRemovals.delete(id);
    setStatus(successMessage || "Slot request removed.", "success");
    await loadSlotRequests({ forceRender: true });
    return true;
  } catch (error) {
    pendingSlotRequestRemovals.delete(id);
    setStatus(error.message || "Could not remove slot request. Try again.", "error");
    await loadSlotRequests({ forceRender: true });
    return false;
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
    }
  }
}

function initSlotRequestListActions() {
  const list = document.getElementById("slot-requests-list");
  if (!list || list.dataset.actionsBound === "true") {
    return;
  }

  list.dataset.actionsBound = "true";
  list.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".slot-request-remove");
    if (!removeBtn || removeBtn.disabled) {
      return;
    }

    const entry = removeBtn.closest(".slot-request-entry");
    const id = entry?.dataset.requestId;
    if (!id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void removeSlotRequestEntry(id, removeBtn);
  });
}

function schedulePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  if (slotPollTimer) {
    clearInterval(slotPollTimer);
  }

  pollTimer = setInterval(loadBonusHunt, 5000);
  slotPollTimer = setInterval(() => {
    loadSlotCatalog();
    loadSlotRequests();
  }, 5000);
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

    setStatus(
      huntBonuses.find((entry) => entry.id === id)?.status === "opened"
        ? "Win updated."
        : "Win saved.",
      "success"
    );
    const nextPendingId = getNextPendingBonusId(id);
    bonusPayoutDrafts.delete(id);
    if (document.activeElement?.classList?.contains("bonus-payout-input")) {
      document.activeElement.blur();
    }
    await loadBonusHunt();
    // Only auto-advance to the next pending when logging a first win.
    if (nextPendingId) {
      focusBonusPayoutInput(nextPendingId);
    }
  } catch {
    setStatus("Could not save payout. Try again.", "error");
  } finally {
    button.disabled = false;
  }
}

async function setBonusFlag(id, field, value, input) {
  const labels = {
    superBonus: { on: "Marking super bonus...", off: "Clearing super bonus...", doneOn: "Marked as super bonus.", doneOff: "Super bonus cleared.", fail: "Could not update super bonus." },
    epicBonus: { on: "Marking epic bonus...", off: "Clearing epic bonus...", doneOn: "Marked as epic bonus.", doneOff: "Epic bonus cleared.", fail: "Could not update epic bonus." },
  };
  const copy = labels[field] || {
    on: "Updating...",
    off: "Updating...",
    doneOn: "Updated.",
    doneOff: "Updated.",
    fail: "Could not update bonus.",
  };

  if (input) {
    input.disabled = true;
  }

  setStatus(value ? copy.on : copy.off);

  try {
    const response = await fetch("/api/bonus-hunt/update", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: Boolean(value) }),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || copy.fail, "error");
      if (input) {
        input.checked = !value;
      }
      return;
    }

    setStatus(value ? copy.doneOn : copy.doneOff, "success");
    await loadBonusHunt();
  } catch {
    setStatus(`${copy.fail} Try again.`, "error");
    if (input) {
      input.checked = !value;
    }
  } finally {
    if (input) {
      input.disabled = false;
    }
  }
}

function createBonusFlagToggle({ label, checked, ariaLabel, onChange }) {
  const wrap = document.createElement("label");
  wrap.className = "hunt-bonus-flag-toggle";

  const text = document.createElement("span");
  text.className = "hunt-bonus-win-label";
  text.textContent = label;

  const toggle = document.createElement("span");
  toggle.className = "toggle";

  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = Boolean(checked);
  toggleInput.setAttribute("aria-label", ariaLabel);

  const toggleSlider = document.createElement("span");
  toggleSlider.className = "toggle-slider";
  toggleSlider.setAttribute("aria-hidden", "true");

  toggle.append(toggleInput, toggleSlider);
  wrap.append(text, toggle);

  toggleInput.addEventListener("change", () => {
    onChange(toggleInput.checked, toggleInput);
  });

  return wrap;
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

function initOverlayPreview() {
  const sourceUrl = new URL("/bonus-hunt/overlay/source.html", window.location.origin).href;
  const urlInput = document.getElementById("hunt-overlay-url");
  const copyBtn = document.getElementById("hunt-overlay-copy");
  const copyStatus = document.getElementById("hunt-overlay-copy-status");

  if (urlInput) {
    urlInput.value = sourceUrl;
  }

  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(sourceUrl);
      if (copyStatus) {
        copyStatus.textContent = "Copied OBS URL to clipboard.";
      }
    } catch {
      urlInput?.select();
      document.execCommand("copy");
      if (copyStatus) {
        copyStatus.textContent = "Copied OBS URL to clipboard.";
      }
    }
  });
}

async function setShowHighestMulti(nextValue) {
  const response = await fetch("/api/bonus-hunt/settings", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: huntMeta.title,
      startBalance: huntMeta.startBalance,
      showHighestMulti: nextValue,
      collecting: huntMeta.collecting !== false,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not update highest multi setting.");
  }

  huntMeta = {
    ...(data.hunt || huntMeta),
    collecting: data.hunt?.collecting !== false,
    showHighestMulti: data.hunt?.showHighestMulti ?? nextValue,
  };
  renderHuntHeader(huntMeta);
  renderSummary(data.summary || lastSummary || {}, huntMeta);
  return data;
}

function initHighestMultiToggle() {
  const toggle = document.getElementById("hunt-highest-multi-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    const nextValue = toggle.checked;
    toggle.disabled = true;
    setStatus(
      nextValue ? "Showing highest multi..." : "Hiding highest multi..."
    );

    try {
      await setShowHighestMulti(nextValue);
      setStatus(
        nextValue
          ? "Highest multi is on for the tracker and OBS Lucky Win."
          : "Highest multi is hidden.",
        "success"
      );
    } catch (error) {
      toggle.checked = !nextValue;
      setStatus(
        error.message || "Could not update highest multi setting.",
        "error"
      );
    } finally {
      toggle.disabled = !currentUser?.isAdmin;
    }
  });
}

function initAdminForm() {
  const settingsForm = document.getElementById("hunt-settings-form");
  const addBonusForm = document.getElementById("hunt-add-bonus-form");
  const addSearch = document.getElementById("hunt-add-slot-search");
  const addResults = document.getElementById("hunt-add-slot-results");
  const addClear = document.getElementById("hunt-add-slot-clear");

  addSearch?.addEventListener("input", (event) => {
    huntAddSearchQuery = event.currentTarget.value || "";
    if (
      huntAddSelectedSlot &&
      huntAddSearchQuery.trim().toLowerCase() !==
        String(huntAddSelectedSlot.name || "")
          .trim()
          .toLowerCase()
    ) {
      huntAddSelectedSlot = null;
      renderHuntAddSelectedSlot();
    }
    renderHuntAddSlotResults();
  });

  addSearch?.addEventListener("focus", () => {
    if (!huntAddSelectedSlot) {
      renderHuntAddSlotResults();
    }
  });

  addSearch?.addEventListener("click", () => {
    if (!huntAddSelectedSlot) {
      renderHuntAddSlotResults();
    }
  });

  addResults?.addEventListener("click", (event) => {
    const option = event.target.closest(".hunt-add-slot-option");
    if (!option) return;
    const slug = option.dataset.slotSlug || "";
    const slot =
      slotCatalog.find(
        (entry) =>
          String(entry.slug || "").toLowerCase() === slug.toLowerCase()
      ) || null;
    selectHuntAddSlot(slot);
  });

  addClear?.addEventListener("click", () => {
    clearHuntAddSelection();
    addSearch?.focus();
  });

  addBonusForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.getElementById("hunt-add-bonus-submit");
    const bet = document.getElementById("hunt-add-bet")?.value;
    const slot = huntAddSelectedSlot;

    if (!slot) {
      setStatus("Search and select a slot first.", "error");
      addSearch?.focus();
      return;
    }

    const bonus = await submitBonusAddForm({
      button: submit,
      slot: slot.name,
      bet,
      slotSlug: slot.slug,
      thumbnailUrl: normalizeSlotThumbnailUrl(slot.thumbnailUrl),
      provider: slot.provider,
    });

    if (bonus) {
      const betInput = document.getElementById("hunt-add-bet");
      if (betInput) betInput.value = "";
      clearHuntAddSelection();
      addSearch?.focus();
    }
  });

  updateHuntAddSlotMeta();

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = document.getElementById("hunt-title-input")?.value?.trim();
    const startBalance = document.getElementById("hunt-start-input")?.value;
    const saveBtn = document.getElementById("hunt-settings-save");

    saveBtn.disabled = true;
    setStatus("Saving hunt settings...");

    try {
      const response = await fetch("/api/bonus-hunt/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          startBalance,
          showHighestMulti: Boolean(huntMeta.showHighestMulti),
          collecting: huntMeta.collecting !== false,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not save hunt settings.", "error");
        return;
      }

      huntMeta = {
        ...(data.hunt || huntMeta),
        collecting: data.hunt?.collecting !== false,
      };
      renderHuntHeader(huntMeta);
      renderSummary(data.summary, huntMeta);
      setStatus("Hunt settings saved.", "success");
    } catch {
      setStatus("Could not save hunt settings. Try again.", "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  const clearBtn = document.getElementById("bonus-clear-hunt");
  const endBtn = document.getElementById("bonus-end-hunt");

  clearBtn?.addEventListener("click", async () => {
    if (!window.confirm("Clear the entire bonus hunt? This will not save it to past hunts.")) {
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

  endBtn?.addEventListener("click", async () => {
    const bonusCount = Number(document.getElementById("summary-total")?.textContent || 0);
    const message = bonusCount
      ? "End this hunt and save it to past hunts? The live tracker will reset."
      : "End this hunt with no bonuses? It will still be saved to past hunts.";

    if (!window.confirm(message)) {
      return;
    }

    endBtn.disabled = true;
    setStatus("Ending hunt...");

    try {
      const response = await fetch("/api/bonus-hunt/end", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not end hunt.", "error");
        return;
      }

      huntMeta = data.hunt || huntMeta;
      renderHuntHeader(huntMeta);
      renderSummary(data.summary, huntMeta);
      huntBonuses = data.bonuses || [];
      updateBonusList(huntBonuses, { force: true });
      setStatus("Hunt ended and saved to past hunts.", "success");
      await loadPastHunts();
    } catch {
      setStatus("Could not end hunt. Try again.", "error");
    } finally {
      endBtn.disabled = false;
    }
  });

  document.getElementById("kick-chat-subscribe")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus("Enabling !s in Kick chat...");

    try {
      const response = await fetch("/api/kick/subscribe", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not enable !s in chat.", "error");
        return;
      }

      acceptingRequests = Boolean(data.acceptingRequests);
      if ("affiliatesOnly" in data) {
        affiliatesOnly = Boolean(data.affiliatesOnly);
      }
      if ("subscribersOnly" in data) {
        subscribersOnly = Boolean(data.subscribersOnly);
      }
      updateRequestPanels();
      updateToggleLabel();
      await Promise.all([loadSlotCatalog(), loadSlotRequests()]);

      const refreshedCount = slotCatalog.length;
      const slotMessage =
        refreshedCount > 0
          ? `Kick chat !s enabled. ${refreshedCount} slots loaded.`
          : "Kick chat !s enabled. Sync Allowed slots so viewers can request.";
      setStatus(slotMessage, refreshedCount > 0 ? "success" : "error");
      await loadKickChatStatus();
    } catch {
      setStatus("Could not enable !s in chat. Try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("kick-test-command")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus("Testing slot queue...");

    try {
      const response = await fetch("/api/kick/test-command", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotQuery: "gates of olympus" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Queue test failed.", "error");
        return;
      }

      await loadSlotRequests();
      setStatus(
        data.latestRequest
          ? `Queue test worked. Added ${data.latestRequest.slotName}.`
          : "Queue test ran but no request was saved.",
        data.latestRequest ? "success" : "error"
      );
      await loadKickChatStatus();
    } catch {
      setStatus("Queue test failed. Try again.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("hunt-status")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!currentUser?.isAdmin || button.disabled) {
      return;
    }

    const nextCollecting = !(huntMeta.collecting !== false);
    button.disabled = true;
    setStatus(nextCollecting ? "Turning collecting on..." : "Turning collecting off...");

    try {
      await setCollecting(nextCollecting);
      setStatus(
        huntMeta.collecting !== false
          ? "Collecting is on."
          : "Collecting is off. New bonuses are blocked until you turn it back on.",
        "success"
      );
    } catch (error) {
      setStatus(error.message || "Could not update collecting.", "error");
    } finally {
      button.disabled = !currentUser?.isAdmin;
    }
  });

  document.getElementById("hunt-requests-status")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!currentUser?.isAdmin || button.disabled) {
      return;
    }

    const nextAccepting = !acceptingRequests;
    button.disabled = true;
    setStatus(nextAccepting ? "Opening slot requests..." : "Closing slot requests...");

    try {
      await setAcceptingRequests(nextAccepting);
      setStatus(
        acceptingRequests
          ? "Slot requests are now open. Announced in Kick chat."
          : "Slot requests closed for now.",
        "success"
      );
    } catch (error) {
      setStatus(error.message || "Could not update slot request setting.", "error");
    } finally {
      button.disabled = !currentUser?.isAdmin;
    }
  });

  document.getElementById("slot-requests-toggle")?.addEventListener("change", async (event) => {
    const toggle = event.currentTarget;
    const nextAccepting = toggle.checked;

    toggle.disabled = true;
    setStatus(nextAccepting ? "Opening slot requests..." : "Closing slot requests...");

    try {
      await setAcceptingRequests(nextAccepting);
      setStatus(
        acceptingRequests
          ? "Slot requests are now open. Announced in Kick chat."
          : "Slot requests are now closed.",
        "success"
      );
    } catch {
      toggle.checked = !nextAccepting;
      setStatus("Could not update slot request setting. Try again.", "error");
    } finally {
      toggle.disabled = false;
    }
  });

  document.getElementById("slot-requests-aff-toggle")?.addEventListener("change", async (event) => {
    const toggle = event.currentTarget;
    const nextAffiliatesOnly = toggle.checked;
    const previous = affiliatesOnly;

    toggle.disabled = true;
    setStatus(
      nextAffiliatesOnly
        ? "Turning on AFF-only requests..."
        : "Turning off AFF-only requests..."
    );

    try {
      await setSlotRequestAccessMode({
        nextAffiliatesOnly,
        nextSubscribersOnly: subscribersOnly,
      });
      setStatus(
        affiliatesOnly
          ? subscribersOnly
            ? "AFF and SUB modes on. Affiliates or Kick subs can request."
            : "AFF-only mode on. Only verified affiliates can request."
          : subscribersOnly
            ? "AFF-only off. SUB-only still active."
            : "Access open to everyone while requests are open.",
        "success"
      );
    } catch (error) {
      toggle.checked = previous;
      setStatus(error.message || "Could not update AFF-only setting.", "error");
    } finally {
      toggle.disabled = false;
    }
  });

  document.getElementById("slot-requests-sub-toggle")?.addEventListener("change", async (event) => {
    const toggle = event.currentTarget;
    const nextSubscribersOnly = toggle.checked;
    const previous = subscribersOnly;

    toggle.disabled = true;
    setStatus(
      nextSubscribersOnly
        ? "Turning on SUB-only requests..."
        : "Turning off SUB-only requests..."
    );

    try {
      await setSlotRequestAccessMode({
        nextAffiliatesOnly: affiliatesOnly,
        nextSubscribersOnly,
      });
      setStatus(
        subscribersOnly
          ? affiliatesOnly
            ? "AFF and SUB modes on. Affiliates or Kick subs can request."
            : "SUB-only mode on. Only Kick subscribers can request."
          : affiliatesOnly
            ? "SUB-only off. AFF-only still active."
            : "Access open to everyone while requests are open.",
        "success"
      );
    } catch (error) {
      toggle.checked = previous;
      setStatus(error.message || "Could not update SUB-only setting.", "error");
    } finally {
      toggle.disabled = false;
    }
  });

  function buildDirectSyncScript({ groupSlug, token, apiBase, openerOrigin }) {
    const label =
      groupSlug === "only-on-stake" ? "Only on Stake" : "New Releases";
    const importUrl = `${apiBase}/api/bonus-hunt/slots/import-sync`;
    return `(async () => {
  const groupSlug = ${JSON.stringify(groupSlug)};
  const token = ${JSON.stringify(token)};
  const importUrl = ${JSON.stringify(importUrl)};
  const openerOrigin = ${JSON.stringify(openerOrigin)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lockKey = "__bhSlotSyncLock_" + groupSlug + "_" + token.slice(0, 12);
  if (window[lockKey]) {
    console.warn("Sync already running for this token — ignore duplicate paste.");
    return;
  }
  window[lockKey] = true;

  const countGames = () =>
    document.querySelectorAll('a[href*="/casino/games/"]').length;

  const findLoadMore = () =>
    [...document.querySelectorAll("button")].find((b) => {
      if (b.disabled) return false;
      return /^\\s*Load More\\s*$/i.test((b.innerText || b.textContent || "").trim());
    });

  const scrollToBottom = () => {
    const top = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    window.scrollTo(0, top);
    document.documentElement.scrollTop = top;
    document.body.scrollTop = top;
    const btn = findLoadMore();
    if (btn) btn.scrollIntoView({ block: "end", behavior: "auto" });
  };

  const pickThumbnail = (anchor) => {
    const img =
      anchor.querySelector("img[src], img[srcset], img[data-src]") ||
      anchor.querySelector("img");
    if (!img) return null;
    let url =
      img.currentSrc ||
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      "";
    if (!url && img.srcset) {
      url = String(img.srcset).split(",")[0].trim().split(/\\s+/)[0] || "";
    }
    if (!url) return null;
    if (url.startsWith("//")) url = "https:" + url;
    if (url.startsWith("/")) url = location.origin + url;
    return url;
  };

  const uploadViaOpener = (slots) =>
    new Promise((resolve, reject) => {
      if (!window.opener || window.opener.closed) {
        reject(new Error("no opener"));
        return;
      }
      const onAck = (event) => {
        if (event.origin !== openerOrigin) return;
        if (event.data?.source !== "bh-slot-sync-ack" || event.data.token !== token) return;
        window.removeEventListener("message", onAck);
        if (event.data.ok) resolve(event.data);
        else reject(new Error(event.data.error || "Upload failed"));
      };
      window.addEventListener("message", onAck);
      window.opener.postMessage(
        { source: "bh-slot-sync", token, groupSlug, slots },
        openerOrigin
      );
      setTimeout(() => {
        window.removeEventListener("message", onAck);
        reject(new Error("Bonus Hunt did not acknowledge upload (keep the Bonus Hunt tab open)."));
      }, 90000);
    });

  const uploadViaFetch = async (slots) => {
    const response = await fetch(importUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, payload: { slots }, done: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Upload failed");
    }
    return data;
  };

  console.log("Syncing ${label} to Bonus Hunt (full group load + logos)...");
  let lastCount = 0;
  let stable = 0;
  let missingBtnStreak = 0;

  for (let i = 0; i < 400; i++) {
    scrollToBottom();
    const btn = findLoadMore();
    if (btn) {
      missingBtnStreak = 0;
      btn.click();
      // Stake hides Load More while the next page loads — wait for it.
      await sleep(850);
      scrollToBottom();
      const again = findLoadMore();
      if (again) {
        again.click();
        await sleep(500);
      }
    } else {
      missingBtnStreak += 1;
      // Keep scrolling; button often reappears after the request finishes.
      await sleep(650);
      scrollToBottom();
    }

    const count = countGames();
    if (i % 5 === 0 || !btn) {
      console.log(
        "Pass " +
          (i + 1) +
          ": " +
          count +
          " links" +
          (btn ? " (Load More)" : " (waiting for Load More)")
      );
    }

    if (count === lastCount) {
      stable += 1;
      // Only finish after a long quiet stretch with no Load More.
      // Early "no button" gaps are normal mid-load and must not stop the sync.
      if (stable >= 12 && missingBtnStreak >= 8) break;
    } else {
      stable = 0;
      lastCount = count;
    }
  }

  scrollToBottom();
  await sleep(800);
  // One last sweep in case a final page landed after the last click.
  for (let j = 0; j < 6; j++) {
    const btn = findLoadMore();
    if (!btn) break;
    btn.click();
    await sleep(900);
    scrollToBottom();
  }
  await sleep(500);

  const skip = new Set(["poker", "roulette", "blackjack", "baccarat", "dice", "mines", "plinko", "limbo", "keno", "wheel", "hilo", "crash"]);
  const seen = new Set();
  const slots = [];
  let withLogos = 0;

  for (const a of document.querySelectorAll('a[href*="/casino/games/"]')) {
    const slug = a.pathname.split("/").filter(Boolean).pop();
    if (!slug || skip.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const nameEl =
      a.querySelector(".edge-typography-body-md-strong") ||
      a.querySelector(".game-info-wrap:not(.game-group) span") ||
      a.querySelector("img[alt]");
    const providerEl = a.querySelector(".game-group");
    let name = (nameEl?.alt || nameEl?.textContent || "")
      .replace(/\\s+/g, " ")
      .trim();
    const provider = (providerEl?.textContent || "").replace(/\\s+/g, " ").trim() || undefined;
    if (!name) {
      const raw = (a.textContent || "").replace(/\\s+/g, " ").trim();
      name = raw.replace(/\\s+\\d+\\s*playing.*$/i, "").trim();
      if (provider && name.toLowerCase().endsWith(provider.toLowerCase())) {
        name = name.slice(0, -provider.length).trim();
      }
    }
    name = name || slug;
    const thumbnailUrl = pickThumbnail(a);
    if (thumbnailUrl) withLogos += 1;
    slots.push({
      name,
      slug,
      groupSlug,
      provider,
      thumbnailUrl: thumbnailUrl || undefined,
    });
  }

  console.log("Uploading " + slots.length + " ${label} slots (" + withLogos + " with logos)...");
  try {
    let data;
    try {
      data = await uploadViaOpener(slots);
      console.log("Uploaded via Bonus Hunt tab (bypasses Stake CSP).");
    } catch (openerError) {
      console.warn("Opener upload unavailable (" + (openerError.message || openerError) + "). Trying direct fetch…");
      data = await uploadViaFetch(slots);
    }
    console.log("Done. Uploaded " + slots.length + " ${label} slots (" + (data.withThumbnails || withLogos) + " logos). Return to Bonus Hunt.");
  } catch (error) {
    console.error("Upload failed:", error.message || error);
    throw error;
  } finally {
    window[lockKey] = false;
  }
})();`;
  }

  function isStakeMessageOrigin(origin) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      return (
        host === "stake.com" ||
        host.endsWith(".stake.com") ||
        host === "stake.bet" ||
        host.endsWith(".stake.bet") ||
        host === "stake.us" ||
        host.endsWith(".stake.us")
      );
    } catch {
      return false;
    }
  }

  let stakeSyncMessageBound = false;
  const syncCompletionWaiters = new Map();

  function waitForSyncCompletion(token) {
    return new Promise((resolve) => {
      syncCompletionWaiters.set(token, resolve);
    });
  }

  function resolveSyncCompletion(token, payload) {
    const resolve = syncCompletionWaiters.get(token);
    if (!resolve) return;
    syncCompletionWaiters.delete(token);
    resolve(payload);
  }

  function ensureStakeSyncMessageListener() {
    if (stakeSyncMessageBound) return;
    stakeSyncMessageBound = true;

    window.addEventListener("message", (event) => {
      if (!isStakeMessageOrigin(event.origin)) return;
      const data = event.data;
      if (data?.source !== "bh-slot-sync" || !data.token || !Array.isArray(data.slots)) {
        return;
      }

      void (async () => {
        try {
          setCatalogSyncStatus(
            `Receiving ${data.slots.length} slots from Stake…`
          );
          const response = await fetch("/api/bonus-hunt/slots/import-sync", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: data.token,
              payload: { slots: data.slots },
              done: true,
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(result.error || "Could not import slots.");
          }

          // Refresh Allowed slots immediately — don't wait for the poll loop.
          await loadSlotCatalog();
          setCatalogSyncStatus(
            `Imported ${data.slots.length} slots. ${formatCatalogCountSummary()}`,
            "success"
          );

          event.source?.postMessage(
            {
              source: "bh-slot-sync-ack",
              token: data.token,
              ok: true,
              count: result.count,
              withThumbnails: result.withThumbnails,
            },
            event.origin
          );
          resolveSyncCompletion(data.token, {
            complete: true,
            count: result.unique || result.count,
            withThumbnails: result.withThumbnails,
            sections: result.sections,
          });
        } catch (error) {
          event.source?.postMessage(
            {
              source: "bh-slot-sync-ack",
              token: data.token,
              ok: false,
              error: error.message || "Import failed",
            },
            event.origin
          );
        }
      })();
    });
  }

  function resolveSyncApiBase() {
    const origin = window.location.origin;
    if (/vercel\.app$/i.test(window.location.hostname)) {
      return "https://www.blakjac21.com";
    }
    return origin;
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  function setCatalogSyncStatus(message, tone = "") {
    const el = document.getElementById("slot-catalog-import-status");
    if (el) {
      el.textContent = message;
      el.classList.toggle("is-hidden", !message);
      el.classList.toggle("is-error", tone === "error");
      el.classList.toggle("is-success", tone === "success");
    }
    setStatus(message, tone);
  }

  async function pollSyncToken(token, { timeoutMs = 10 * 60 * 1000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const response = await fetch(
        `/api/bonus-hunt/slots/sync-status?${new URLSearchParams({ token })}`,
        { credentials: "same-origin", cache: "no-store" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not check sync status.");
      }
      if (data.complete) {
        return data;
      }
      if (data.error) {
        throw new Error(data.error);
      }
      if (data.progress) {
        setCatalogSyncStatus(`Syncing… ${data.progress}`);
      }
      await new Promise((r) => setTimeout(r, 750));
    }
    throw new Error("Timed out waiting for Stake sync. Run the console script, then try again.");
  }

  async function startDirectGroupSync(groupSlug) {
    const label =
      groupSlug === "only-on-stake" ? "Only on Stake" : "New Releases";
    const stakeUrl =
      groupSlug === "only-on-stake"
        ? "https://stake.com/casino/group/only-on-stake"
        : "https://stake.com/casino/group/new-releases";

    ensureStakeSyncMessageListener();
    setCatalogSyncStatus(`Preparing ${label} sync…`);

    const tokenResponse = await fetch("/api/bonus-hunt/slots/sync-token", {
      method: "POST",
      credentials: "same-origin",
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.token) {
      throw new Error(tokenData.error || "Could not start sync.");
    }

    const script = buildDirectSyncScript({
      groupSlug,
      token: tokenData.token,
      apiBase: resolveSyncApiBase(),
      openerOrigin: window.location.origin,
    });
    await copyTextToClipboard(script);
    // Keep window.opener so Stake can postMessage back (avoids Stake CSP blocking fetch).
    window.open(stakeUrl, "_blank");

    setCatalogSyncStatus(
      `${label} script copied. Keep this Bonus Hunt tab open. On Stake: F12 → Console → paste → Enter. Large groups can take 1–2 minutes while Load More finishes…`
    );

    const status = await Promise.race([
      pollSyncToken(tokenData.token),
      waitForSyncCompletion(tokenData.token),
    ]);
    syncCompletionWaiters.delete(tokenData.token);

    await loadSlotCatalog();
    const logoNote =
      status.withThumbnails > 0
        ? ` · ${status.withThumbnails} with logos`
        : "";
    setCatalogSyncStatus(
      `${label} synced. ${formatCatalogCountSummary()}${logoNote}`,
      "success"
    );
  }

  document.getElementById("slot-sync-new-releases")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await startDirectGroupSync("new-releases");
    } catch (error) {
      setCatalogSyncStatus(error.message || "Could not sync New Releases.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("slot-sync-only-on-stake")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await startDirectGroupSync("only-on-stake");
    } catch (error) {
      setCatalogSyncStatus(error.message || "Could not sync Only on Stake.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("slot-requests-clear")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;

    if (!window.confirm("Clear all slot requests?")) {
      return;
    }

    button.disabled = true;
    setStatus("Clearing slot requests...");

    try {
      const response = await fetch("/api/bonus-hunt/requests/clear", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not clear slot requests.", "error");
        return;
      }

      setStatus("Slot requests cleared.", "success");
      await loadSlotRequests();
    } catch {
      setStatus("Could not clear slot requests. Try again.", "error");
    } finally {
      button.disabled = false;
    }
  });
}

function initSlotRequestForm() {
  const form = document.getElementById("slot-request-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      setRequestStatus("Sign in with Kick to request a slot.", "error");
      return;
    }

    if (!acceptingRequests) {
      setRequestStatus("Slot requests are closed right now.", "error");
      return;
    }

    if (mySlotRequests.length >= slotRequestLimit) {
      setRequestStatus(
        `You already have ${slotRequestLimit} slot requests in the queue.`,
        "error"
      );
      return;
    }

    const select = document.getElementById("slot-request-select");
    const submitBtn = document.getElementById("slot-request-submit");
    const slotSlug = select?.value;

    if (!slotCatalog.length) {
      setRequestStatus(
        "Slot list is empty. Ask the admin to refresh it from Stake.",
        "error"
      );
      return;
    }

    if (!slotSlug) {
      setRequestStatus("Choose a slot from the list.", "error");
      return;
    }

    submitBtn.disabled = true;
    setRequestStatus("Submitting your request...");

    try {
      const response = await fetch("/api/bonus-hunt/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotSlug }),
      });

      const data = await response.json();
      if (!response.ok) {
        setRequestStatus(data.error || "Could not submit request.", "error");
        return;
      }

      form.reset();
      mySlotRequests = data.myRequests || mySlotRequests;
      slotRequestLimit = Number(data.requestLimit) || slotRequestLimit;
      updateRequestPanels();
      const remaining = Math.max(0, slotRequestLimit - mySlotRequests.length);
      const remainingNote =
        remaining > 0
          ? ` ${remaining} request${remaining === 1 ? "" : "s"} remaining.`
          : " Queue full.";
      setRequestStatus(`Requested ${data.request.slotName}.${remainingNote}`, "success");
      await loadSlotRequests();
    } catch {
      setRequestStatus("Could not submit request. Try again.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  updatePanels();
  updateBonusList(huntBonuses, { force: true });
  renderPastHunts(pastHunts);
  await Promise.all([loadBonusHunt(), loadSlotCatalog(), loadSlotRequests(), loadKickChatStatus()]);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadBonusHunt();
    loadSlotCatalog();
    loadSlotRequests();
  }
});

async function bootstrapBonusHuntPage() {
  handleKickBotRedirectParams();
  await loadCurrentUser();
  await Promise.all([loadBonusHunt(), loadPastHunts(), loadSlotCatalog(), loadSlotRequests()]);
  updatePanels();
  updateBonusList(huntBonuses, { force: true });
  renderPastHunts(pastHunts);
  renderSlotRequests(slotRequests);
  await loadKickChatStatus();
  schedulePolling();
}

initAdminForm();
initHighestMultiToggle();
initOverlayPreview();
initSlotRequestForm();
initSlotRequestListActions();
bootstrapBonusHuntPage();
