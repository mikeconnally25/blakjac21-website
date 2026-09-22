(() => {
  let currentUser = null;
  let bjSessionId = null;
  let bjSnapshot = { hands: [[]], dealer: [], activeHand: 0 };
  let rouletteOutside = null;
  let rouletteNumbers = new Set();
  let rouletteWheelAngle = 0;
  let rouletteBallAngle = 0;
  let rouletteSpinning = false;
  let kenoPicks = new Set();
  let kenoDrawing = false;
  let busy = false;
  let dealing = false;

  const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const RESULT_LABEL = {
    win: "You win",
    lose: "Dealer wins",
    bust: "Bust",
    push: "Push",
    blackjack: "Blackjack!",
    split: "Hands settled",
  };
  const DEAL_MS = 340;
  const DEAL_FLIGHT_MS = 780;
  const ROULETTE_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
  ];
  const ROULETTE_RED = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
  ]);
  const ROULETTE_POCKET = 360 / ROULETTE_ORDER.length;
  const ROULETTE_SPIN_MS = 4200;

  function $(id) {
    return document.getElementById(id);
  }

  function formatPoints(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-US");
  }

  function setStatus(message, { error = false } = {}) {
    const el = $("hg-status");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-hidden", !message);
    el.classList.toggle("is-error", Boolean(error && message));
  }

  function setBalance(points) {
    const el = $("hg-balance");
    if (!el) return;
    if (points == null) {
      el.textContent = "—";
      return;
    }
    el.textContent = formatPoints(points);
  }

  function applyBalance(payload) {
    const points =
      payload?.balance?.points ??
      payload?.points ??
      (typeof payload?.balance === "number" ? payload.balance : null);
    if (points != null) setBalance(points);
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function wait(ms) {
    if (prefersReducedMotion() || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  let kenoAudioCtx = null;

  function getKenoAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!kenoAudioCtx) {
      kenoAudioCtx = new AudioCtx();
    }
    if (kenoAudioCtx.state === "suspended") {
      void kenoAudioCtx.resume();
    }
    return kenoAudioCtx;
  }

  function playKenoTone(kind) {
    const ctx = getKenoAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const isHit = kind === "hit";
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = isHit ? "triangle" : "sine";
    osc.frequency.setValueAtTime(isHit ? 660 : 180, now);
    if (isHit) {
      osc.frequency.exponentialRampToValueAtTime(990, now + 0.09);
    } else {
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.12);
    }

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(isHit ? 3200 : 900, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(isHit ? 0.085 : 0.045, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (isHit ? 0.16 : 0.14));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  function playKenoWinSound() {
    const ctx = getKenoAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, index) => {
      const t = now + index * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = index === notes.length - 1 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.11, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  function hideKenoWinBanner() {
    const banner = $("hg-keno-win-banner");
    if (!banner) return;
    banner.classList.add("is-hidden");
    banner.innerHTML = "";
  }

  function showKenoWinBanner(data) {
    const banner = $("hg-keno-win-banner");
    if (!banner) return;
    const payout = formatPoints(data.payout);
    const hits = Number(data.hitCount) || 0;
    const mult = data.multiplier != null ? `${data.multiplier}x` : "";
    banner.innerHTML = `
      <div class="hg-keno-win-banner-inner">
        <span class="hg-keno-win-banner-label">You win</span>
        <span class="hg-keno-win-banner-detail">+${payout} pts · ${hits} hit${hits === 1 ? "" : "s"}${mult ? ` · ${mult}` : ""}</span>
      </div>
    `;
    banner.classList.remove("is-hidden");
  }

  function cardClass(card) {
    if (card?.hidden) return "hg-card is-hidden-card";
    const suit = card?.suit || "";
    const red = suit === "H" || suit === "D";
    return `hg-card${red ? " is-red" : ""}`;
  }

  function createCardEl(card, { deal = false, flip = false } = {}) {
    const el = document.createElement("span");
    el.className = cardClass(card);
    if (deal && !prefersReducedMotion()) el.classList.add("is-dealing");
    if (flip && !prefersReducedMotion()) el.classList.add("is-flipping");
    if (card?.hidden) {
      el.textContent = "?";
      el.setAttribute("aria-label", "Hidden card");
    } else {
      const suit = SUIT_SYMBOL[card.suit] || card.suit || "";
      el.innerHTML = `<span class="hg-card-rank">${card.rank}</span><span class="hg-card-suit">${suit}</span>`;
      el.setAttribute("aria-label", `${card.rank} of ${suit}`);
    }
    if (deal || flip) {
      el.addEventListener(
        "animationend",
        () => {
          el.classList.remove("is-dealing", "is-flipping");
        },
        { once: true }
      );
    }
    return el;
  }

  function clearCards(container) {
    if (!container) return;
    container.innerHTML = "";
  }

  function stateHands(state) {
    if (Array.isArray(state?.hands) && state.hands.length) {
      return state.hands;
    }
    return [
      {
        cards: state?.player?.cards || [],
        total: state?.player?.total,
        bet: state?.bet,
        active: true,
        result: state?.result,
        payout: state?.payout,
      },
    ];
  }

  function setTotals(state, { hide = false } = {}) {
    const dealerTotal = $("hg-bj-dealer-total");
    if (hide) {
      if (dealerTotal) dealerTotal.textContent = "";
      document.querySelectorAll("[data-hg-hand-total]").forEach((el) => {
        el.textContent = "";
      });
      return;
    }
    if (dealerTotal) {
      dealerTotal.textContent =
        state?.dealer?.total != null ? `(${state.dealer.total})` : "";
    }
  }

  function setResult(state) {
    const result = $("hg-bj-result");
    if (!result) return;
    if (state?.result) {
      const label = RESULT_LABEL[state.result] || state.result;
      const payout =
        state.payout > 0 ? ` · +${formatPoints(state.payout)} pts` : "";
      result.textContent = `${label}${payout}`;
      result.className = `hg-result hg-bj-result is-${state.result}`;
    } else {
      result.textContent = "";
      result.className = "hg-result hg-bj-result";
    }
  }

  function setBlackjackActions(state) {
    const hit = $("hg-bj-hit");
    const stand = $("hg-bj-stand");
    const dbl = $("hg-bj-double");
    const split = $("hg-bj-split");
    const deal = $("hg-bj-deal");
    const bet = $("hg-bj-bet");
    const locked = busy || dealing;
    const playing = Boolean(
      state && state.status === "player" && !state.result && (state.canHit || state.canStand)
    );

    if (hit) hit.disabled = locked || !state?.canHit;
    if (stand) stand.disabled = locked || !state?.canStand;
    if (dbl) dbl.disabled = locked || !state?.canDouble;
    if (split) split.disabled = locked || !state?.canSplit;
    if (deal) deal.disabled = locked || playing;
    if (bet) bet.disabled = locked || playing;
  }

  function ensurePlayerHands(count) {
    const row = $("hg-bj-player-row");
    if (!row) return [];
    while (row.children.length < count) {
      const index = row.children.length;
      const hand = document.createElement("div");
      hand.className = "hg-hand hg-hand-player";
      hand.dataset.handIndex = String(index);
      hand.innerHTML = `
        <div class="hg-cards" data-hg-cards></div>
        <p class="hg-hand-label">Hand ${index + 1} <span data-hg-hand-total></span></p>
        <div class="hg-bj-spot">
          <div class="hg-bj-chip" aria-hidden="true">
            <span class="hg-bj-chip-inner" data-hg-chip>10</span>
          </div>
          <span class="hg-bj-spot-label">Bet</span>
        </div>
      `;
      row.appendChild(hand);
    }
    while (row.children.length > Math.max(1, count)) {
      row.removeChild(row.lastElementChild);
    }
    return [...row.querySelectorAll(".hg-hand-player")];
  }

  function paintHandShell(state, { hideTotals = false } = {}) {
    const hands = stateHands(state);
    const nodes = ensurePlayerHands(hands.length);
    const activeIdx = Number(state?.activeHand) || 0;

    nodes.forEach((node, index) => {
      const hand = hands[index];
      const isActive = Boolean(hand?.active) || (index === activeIdx && state?.status === "player");
      node.classList.toggle("is-active", isActive && state?.status === "player");
      node.classList.toggle("is-done", Boolean(hand?.done || hand?.result));
      const label = node.querySelector(".hg-hand-label");
      const totalEl = node.querySelector("[data-hg-hand-total]") || $("hg-bj-player-total");
      if (label && index === 0 && hands.length === 1) {
        label.innerHTML = `You <span data-hg-hand-total id="hg-bj-player-total"></span>`;
      } else if (label && hands.length > 1) {
        label.innerHTML = `Hand ${index + 1} <span data-hg-hand-total></span>`;
      }
      const total = node.querySelector("[data-hg-hand-total]");
      if (total) {
        total.textContent =
          hideTotals || hand?.total == null ? "" : `(${hand.total})`;
      }
      const chip = node.querySelector("[data-hg-chip], #hg-bj-chip-value");
      if (chip) {
        const betVal = hand?.bet ?? Number($("hg-bj-bet")?.value || 0);
        chip.textContent =
          Number.isFinite(Number(betVal)) && Number(betVal) > 0
            ? String(Math.floor(Number(betVal)))
            : "—";
      }
      if (!node.querySelector("[data-hg-cards]") && index === 0) {
        const cards = node.querySelector(".hg-cards");
        if (cards) cards.id = "hg-bj-player-cards";
      }
    });

    return nodes;
  }

  function handCardsContainer(node, index) {
    if (index === 0) {
      return node.querySelector("#hg-bj-player-cards") || node.querySelector(".hg-cards");
    }
    return node.querySelector("[data-hg-cards]") || node.querySelector(".hg-cards");
  }

  async function dealCardTo(container, card, { flip = false } = {}) {
    if (!container) return;
    const table = $("hg-bj-table");
    if (table && !prefersReducedMotion()) {
      table.classList.remove("is-dealing");
      void table.offsetWidth;
      table.classList.add("is-dealing");
    }
    const el = createCardEl(card, { deal: true, flip });
    container.appendChild(el);
    await wait(DEAL_MS);
  }

  async function animateInitialDeal(state) {
    const dealerCards = $("hg-bj-dealer-cards");
    clearCards(dealerCards);
    setTotals(null, { hide: true });
    setResult(null);

    const hands = stateHands(state);
    const nodes = paintHandShell(state, { hideTotals: true });
    nodes.forEach((node) => clearCards(handCardsContainer(node, Number(node.dataset.handIndex) || 0)));

    const player = hands[0]?.cards || [];
    const dealer = state.dealer?.cards || [];
    const rounds = Math.max(player.length, dealer.length);
    const playerContainer = handCardsContainer(nodes[0], 0);

    if (prefersReducedMotion()) {
      player.forEach((card) => playerContainer.appendChild(createCardEl(card)));
      dealer.forEach((card) => dealerCards.appendChild(createCardEl(card)));
      return;
    }

    for (let i = 0; i < rounds; i += 1) {
      if (player[i]) await dealCardTo(playerContainer, player[i]);
      if (dealer[i]) await dealCardTo(dealerCards, dealer[i]);
    }
    await wait(DEAL_FLIGHT_MS - DEAL_MS);
  }

  async function animateCardDelta(state) {
    const dealerCards = $("hg-bj-dealer-cards");
    const nextHands = stateHands(state);
    const prevHands = bjSnapshot.hands || [];
    const nextDealer = state.dealer?.cards || [];
    const prevDealer = bjSnapshot.dealer || [];
    const nodes = paintHandShell(state, { hideTotals: true });

    if (prefersReducedMotion()) {
      clearCards(dealerCards);
      nextDealer.forEach((card) => dealerCards.appendChild(createCardEl(card)));
      nodes.forEach((node, index) => {
        const container = handCardsContainer(node, index);
        clearCards(container);
        (nextHands[index]?.cards || []).forEach((card) => {
          container.appendChild(createCardEl(card));
        });
      });
      return;
    }

    // Split: rebuild both hands with deal animation for new cards
    if (nextHands.length > prevHands.length) {
      for (let h = 0; h < nextHands.length; h += 1) {
        const container = handCardsContainer(nodes[h], h);
        clearCards(container);
        const cards = nextHands[h]?.cards || [];
        for (const card of cards) {
          await dealCardTo(container, card);
        }
      }
    } else {
      for (let h = 0; h < nextHands.length; h += 1) {
        const container = handCardsContainer(nodes[h], h);
        const prev = prevHands[h] || [];
        const next = nextHands[h]?.cards || [];
        // If DOM got out of sync (hand advance), resync without re-animating old cards
        if (container && container.childElementCount !== prev.length) {
          clearCards(container);
          prev.forEach((card) => container.appendChild(createCardEl(card)));
        }
        for (let i = prev.length; i < next.length; i += 1) {
          await dealCardTo(container, next[i]);
        }
      }
    }

    const dealerReveal =
      prevDealer.some((c) => c?.hidden) &&
      nextDealer.length >= prevDealer.length &&
      !nextDealer.some((c) => c?.hidden);

    if (dealerReveal) {
      clearCards(dealerCards);
      for (let i = 0; i < nextDealer.length; i += 1) {
        const flip = Boolean(prevDealer[i]?.hidden) && !nextDealer[i]?.hidden;
        const isNew = i >= prevDealer.length;
        if (isNew) {
          await dealCardTo(dealerCards, nextDealer[i]);
        } else {
          const el = createCardEl(nextDealer[i], { flip });
          dealerCards.appendChild(el);
          if (flip) await wait(320);
        }
      }
    } else {
      for (let i = prevDealer.length; i < nextDealer.length; i += 1) {
        await dealCardTo(dealerCards, nextDealer[i]);
      }
    }

    await wait(Math.max(0, DEAL_FLIGHT_MS - DEAL_MS));
  }

  function finishBjRender(state) {
    if (state?.resolved) {
      bjSessionId = null;
    } else {
      bjSessionId = state.sessionId || bjSessionId;
    }
    const hands = stateHands(state);
    bjSnapshot = {
      hands: hands.map((hand) => [...(hand.cards || [])]),
      dealer: [...(state.dealer?.cards || [])],
      activeHand: Number(state.activeHand) || 0,
    };

    const nodes = paintHandShell(state);
    nodes.forEach((node, index) => {
      const container = handCardsContainer(node, index);
      if (!container) return;
      if (container.childElementCount !== (hands[index]?.cards || []).length) {
        clearCards(container);
        (hands[index]?.cards || []).forEach((card) => {
          container.appendChild(createCardEl(card));
        });
      }
    });

    const dealerContainer = $("hg-bj-dealer-cards");
    if (
      dealerContainer &&
      dealerContainer.childElementCount !== (state.dealer?.cards || []).length
    ) {
      clearCards(dealerContainer);
      (state.dealer?.cards || []).forEach((card) => {
        dealerContainer.appendChild(createCardEl(card));
      });
    }

    setTotals(state);
    setResult(state);
    setBlackjackActions(state);
    syncBjChip();
    $("hg-bj-table")?.classList.remove("is-dealing");
  }

  function renderBlackjack(state) {
    if (!state) {
      clearCards($("hg-bj-dealer-cards"));
      ensurePlayerHands(1);
      const first = $("hg-bj-player");
      if (first) {
        first.classList.add("is-active");
        first.classList.remove("is-done");
        clearCards(handCardsContainer(first, 0));
        const label = first.querySelector(".hg-hand-label");
        if (label) {
          label.innerHTML = `You <span data-hg-hand-total id="hg-bj-player-total"></span>`;
        }
      }
      setTotals(null, { hide: true });
      setResult(null);
      bjSnapshot = { hands: [[]], dealer: [], activeHand: 0 };
      setBlackjackActions(null);
      syncBjChip();
      $("hg-bj-table")?.classList.remove("is-dealing");
      return;
    }

    clearCards($("hg-bj-dealer-cards"));
    const hands = stateHands(state);
    const nodes = paintHandShell(state);
    (state.dealer?.cards || []).forEach((card) => {
      $("hg-bj-dealer-cards")?.appendChild(createCardEl(card));
    });
    nodes.forEach((node, index) => {
      const container = handCardsContainer(node, index);
      clearCards(container);
      (hands[index]?.cards || []).forEach((card) => {
        container.appendChild(createCardEl(card));
      });
    });
    finishBjRender(state);
  }

  async function presentBlackjack(state, mode) {
    dealing = true;
    setBlackjackActions(state);
    try {
      if (mode === "deal") {
        await animateInitialDeal(state);
      } else {
        await animateCardDelta(state);
      }
    } finally {
      dealing = false;
      finishBjRender(state);
    }
  }

  function syncBjChip() {
    const bet = $("hg-bj-bet");
    const chip = $("hg-bj-chip-value");
    if (!chip || !bet) return;
    const n = Math.floor(Number(bet.value));
    chip.textContent = Number.isFinite(n) && n > 0 ? String(n) : "—";
  }

  function syncBetLimits(maxBet) {
    document
      .querySelectorAll(".hg-bet-input:not(#hg-self-credit-amount)")
      .forEach((input) => {
      if (maxBet == null) {
        input.removeAttribute("max");
        input.title = "No max bet for your account";
      } else {
        input.max = String(maxBet);
        input.title = `Max bet ${maxBet} pts`;
        const value = Math.floor(Number(input.value));
        if (Number.isFinite(value) && value > maxBet) {
          input.value = String(maxBet);
        }
      }
    });
  }

  function syncSelfCreditUi(canSelfCredit) {
    const wrap = $("hg-self-credit");
    const input = $("hg-self-credit-amount");
    wrap?.classList.toggle("is-hidden", !canSelfCredit);
    // Uncapped accounts have no per-add limit (clear any cached HTML max).
    if (input) {
      input.removeAttribute("max");
      input.title = canSelfCredit ? "No amount limit" : "";
    }
  }

  function syncAuthUi() {
    const guest = $("hg-guest");
    const stage = $("hg-stage");
    const signedIn = Boolean(currentUser?.kickUserId);
    guest?.classList.toggle("is-hidden", signedIn);
    stage?.classList.toggle("is-hidden", !signedIn);
    if (!signedIn) {
      setBalance(null);
      syncBetLimits(5000);
      syncSelfCreditUi(false);
      bjSessionId = null;
      renderBlackjack(null);
      setStatus("");
    }
  }

  async function loadBalance() {
    if (!currentUser?.kickUserId) {
      setBalance(null);
      syncSelfCreditUi(false);
      return;
    }
    try {
      const response = await fetch("/api/house-games/balance", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        currentUser = null;
        syncAuthUi();
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      setBalance(data.points);
      syncBetLimits(
        Object.prototype.hasOwnProperty.call(data, "maxBet")
          ? data.maxBet
          : 5000
      );
      syncSelfCreditUi(Boolean(data.canSelfCredit));
    } catch {
      /* ignore */
    }
  }

  async function selfCreditPoints() {
    const input = $("hg-self-credit-amount");
    const button = $("hg-self-credit-btn");
    const amount = Math.floor(Number(input?.value || 0));
    if (!Number.isFinite(amount) || amount < 1) {
      setStatus("Enter at least 1 point to add.", { error: true });
      return;
    }
    if (button) button.disabled = true;
    try {
      const response = await fetch("/api/house-games/self-credit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not add points.");
      }
      setBalance(data.points);
      syncSelfCreditUi(true);
      setStatus(`Added ${formatPoints(data.added)} points.`);
    } catch (error) {
      setStatus(error.message || "Could not add points.", { error: true });
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function play(body) {
    if (busy) return null;
    busy = true;
    setStatus("");
    setBlackjackActions(
      bjSessionId
        ? { canHit: false, canStand: false, canDouble: false }
        : null
    );
    try {
      const response = await fetch("/api/house-games/play", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not play.");
      }
      applyBalance(data);
      return data;
    } catch (error) {
      setStatus(error.message || "Could not play.", { error: true });
      return null;
    } finally {
      busy = false;
    }
  }

  function switchGame(game) {
    document.querySelectorAll(".house-games-tab").forEach((tab) => {
      const active = tab.dataset.hgGame === game;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".house-game-panel").forEach((panel) => {
      const active = panel.dataset.hgPanel === game;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    setStatus("");
  }

  function rouletteColor(n) {
    if (n === 0) return "green";
    return ROULETTE_RED.has(n) ? "red" : "black";
  }

  function roulettePocketAngle(n) {
    const index = ROULETTE_ORDER.indexOf(Number(n));
    if (index < 0) return 0;
    // Pocket centers sit clockwise from top.
    return index * ROULETTE_POCKET + ROULETTE_POCKET / 2;
  }

  function buildRouletteWheel() {
    const mount = $("hg-roulette-wheel");
    if (!mount || mount.childElementCount) return;

    const size = 320;
    const cx = size / 2;
    const cy = size / 2;
    const outer = size / 2 - 2;
    const inner = outer * 0.62;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("class", "hg-roulette-svg");
    svg.setAttribute("aria-hidden", "true");

    ROULETTE_ORDER.forEach((num, index) => {
      const start = ((index * ROULETTE_POCKET - 90) * Math.PI) / 180;
      const end = (((index + 1) * ROULETTE_POCKET - 90) * Math.PI) / 180;
      const x1 = cx + outer * Math.cos(start);
      const y1 = cy + outer * Math.sin(start);
      const x2 = cx + outer * Math.cos(end);
      const y2 = cy + outer * Math.sin(end);
      const x3 = cx + inner * Math.cos(end);
      const y3 = cy + inner * Math.sin(end);
      const x4 = cx + inner * Math.cos(start);
      const y4 = cy + inner * Math.sin(start);
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute(
        "d",
        `M ${x1} ${y1} A ${outer} ${outer} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 0 0 ${x4} ${y4} Z`
      );
      path.setAttribute("class", `hg-roulette-pocket is-${rouletteColor(num)}`);
      svg.appendChild(path);

      const mid = ((index + 0.5) * ROULETTE_POCKET - 90) * (Math.PI / 180);
      const tx = cx + (outer * 0.82) * Math.cos(mid);
      const ty = cy + (outer * 0.82) * Math.sin(mid);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", String(tx));
      text.setAttribute("y", String(ty));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute(
        "transform",
        `rotate(${index * ROULETTE_POCKET + ROULETTE_POCKET / 2}, ${tx}, ${ty})`
      );
      text.setAttribute("class", "hg-roulette-label");
      text.textContent = String(num);
      svg.appendChild(text);
    });

    mount.appendChild(svg);
  }

  function buildRouletteBoard() {
    const board = $("hg-roulette-board");
    if (!board || board.childElementCount) return;

    const zero = document.createElement("button");
    zero.type = "button";
    zero.className = "hg-roulette-cell is-green is-zero";
    zero.dataset.choice = "0";
    zero.textContent = "0";
    zero.addEventListener("click", () => toggleRouletteNumber(0));
    board.appendChild(zero);

    for (let n = 1; n <= 36; n += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `hg-roulette-cell is-${rouletteColor(n)}`;
      btn.dataset.choice = String(n);
      btn.textContent = String(n);
      btn.addEventListener("click", () => toggleRouletteNumber(n));
      board.appendChild(btn);
    }
  }

  function toggleRouletteNumber(n) {
    const key = Number(n);
    rouletteOutside = null;
    if (rouletteNumbers.has(key)) {
      rouletteNumbers.delete(key);
    } else if (rouletteNumbers.size >= 12) {
      setStatus("Pick up to 12 numbers.", { error: true });
      return;
    } else {
      rouletteNumbers.add(key);
      setStatus("");
    }
    syncRoulettePicks();
  }

  function selectRouletteOutside(choice) {
    rouletteOutside = String(choice);
    rouletteNumbers = new Set();
    setStatus("");
    syncRoulettePicks();
  }

  function clearRoulettePicks() {
    rouletteOutside = null;
    rouletteNumbers = new Set();
    document.querySelectorAll(".hg-roulette-cell.is-hit").forEach((cell) => {
      cell.classList.remove("is-hit");
    });
    syncRoulettePicks();
  }

  function rouletteUnitBet() {
    const n = Math.floor(Number($("hg-roulette-bet")?.value || 0));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function syncRoulettePicks() {
    document.querySelectorAll(".hg-roulette-pick").forEach((btn) => {
      btn.classList.toggle(
        "is-active",
        btn.dataset.choice === rouletteOutside
      );
    });
    document.querySelectorAll(".hg-roulette-cell").forEach((btn) => {
      const num = Number(btn.dataset.choice);
      btn.classList.toggle("is-active", rouletteNumbers.has(num));
    });
    const label = $("hg-roulette-pick-label");
    if (!label) return;
    const unit = rouletteUnitBet();
    if (rouletteNumbers.size) {
      const total = unit * rouletteNumbers.size;
      const list = [...rouletteNumbers].sort((a, b) => a - b).join(", ");
      label.textContent = `${rouletteNumbers.size} number${rouletteNumbers.size === 1 ? "" : "s"} selected (${list}) · total ${formatPoints(total)} pts`;
      return;
    }
    if (rouletteOutside) {
      const names = {
        red: "Red",
        black: "Black",
        even: "Even",
        odd: "Odd",
        low: "1–18",
        high: "19–36",
      };
      label.textContent = `Betting ${names[rouletteOutside] || rouletteOutside} · ${formatPoints(unit)} pts`;
      return;
    }
    label.textContent = "Pick up to 12 numbers, or one outside bet";
  }

  function setRouletteTransforms() {
    const wheel = $("hg-roulette-wheel");
    const track = $("hg-roulette-ball-track");
    if (wheel) {
      wheel.style.transform = `rotate(${rouletteWheelAngle}deg)`;
    }
    if (track) {
      track.style.transform = `rotate(${rouletteBallAngle}deg)`;
    }
  }

  async function animateRouletteSpin(resultNumber) {
    const wrap = document.querySelector(".hg-roulette-rim");
    const ball = $("hg-roulette-ball-orb");
    const wheelEl = $("hg-roulette-wheel");
    const trackEl = $("hg-roulette-ball-track");

    if (!wrap || prefersReducedMotion()) {
      const pocket = roulettePocketAngle(resultNumber);
      rouletteWheelAngle = -pocket;
      rouletteBallAngle = 0;
      setRouletteTransforms();
      return;
    }

    wrap.classList.add("is-spinning");
    ball?.classList.add("is-spinning");

    const pocket = roulettePocketAngle(resultNumber);
    const wheelSpins = 4 + Math.floor(Math.random() * 2);
    const ballSpins = 6 + Math.floor(Math.random() * 2);

    const wheelNormalized = ((rouletteWheelAngle % 360) + 360) % 360;
    const wheelTarget = ((-pocket % 360) + 360) % 360;
    let wheelDelta = wheelTarget - wheelNormalized;
    if (wheelDelta > 0) wheelDelta -= 360;
    const finalWheel = rouletteWheelAngle + wheelSpins * 360 + wheelDelta;

    const ballNormalized = ((rouletteBallAngle % 360) + 360) % 360;
    let ballDelta = 0 - ballNormalized;
    if (ballDelta > 0) ballDelta -= 360;
    const finalBall = rouletteBallAngle - ballSpins * 360 + ballDelta;

    const duration = ROULETTE_SPIN_MS;
    if (wheelEl) {
      wheelEl.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.7, 0.12, 1)`;
    }
    if (trackEl) {
      trackEl.style.transition = `transform ${duration}ms cubic-bezier(0.05, 0.65, 0.15, 1)`;
    }

    void wheelEl?.offsetWidth;
    rouletteWheelAngle = finalWheel;
    rouletteBallAngle = finalBall;
    setRouletteTransforms();

    await wait(duration + 80);
    wrap.classList.remove("is-spinning");
    ball?.classList.remove("is-spinning");
    if (wheelEl) wheelEl.style.transition = "";
    if (trackEl) trackEl.style.transition = "";
  }

  function highlightRouletteResult(number) {
    document.querySelectorAll(".hg-roulette-cell").forEach((cell) => {
      cell.classList.toggle(
        "is-hit",
        Number(cell.dataset.choice) === Number(number)
      );
    });
  }

  const KENO_PAYTABLES = {
    classic: {
      1: { 1: 3.96 },
      2: { 1: 1.9, 2: 4.5 },
      3: { 1: 1, 2: 3.1, 3: 10.4 },
      4: { 1: 0.8, 2: 1.8, 3: 5, 4: 22.5 },
      5: { 1: 0.25, 2: 1.4, 3: 4.1, 4: 16.5, 5: 36 },
      6: { 2: 1, 3: 3.68, 4: 7, 5: 16.5, 6: 40 },
      7: { 2: 0.47, 3: 3, 4: 4.5, 5: 14, 6: 31, 7: 60 },
      8: { 3: 2.2, 4: 4, 5: 13, 6: 22, 7: 55, 8: 70 },
      9: { 3: 1.55, 4: 3, 5: 8, 6: 15, 7: 44, 8: 60, 9: 85 },
      10: { 3: 1.4, 4: 2.25, 5: 4.5, 6: 8, 7: 17, 8: 50, 9: 80, 10: 100 },
    },
    low: {
      1: { 0: 0.7, 1: 1.85 },
      2: { 1: 2, 2: 3.8 },
      3: { 1: 1.1, 2: 1.38, 3: 26 },
      4: { 2: 2.2, 3: 7.9, 4: 90 },
      5: { 2: 1.5, 3: 4.2, 4: 13, 5: 300 },
      6: { 2: 1.1, 3: 2, 4: 6.2, 5: 100, 6: 700 },
      7: { 2: 1.1, 3: 1.6, 4: 3.5, 5: 15, 6: 225, 7: 700 },
      8: { 2: 1.1, 3: 1.5, 4: 2, 5: 5.5, 6: 39, 7: 100, 8: 800 },
      9: { 2: 1.1, 3: 1.3, 4: 1.7, 5: 2.5, 6: 7.5, 7: 50, 8: 250, 9: 1000 },
      10: {
        2: 1.1,
        3: 1.2,
        4: 1.3,
        5: 1.8,
        6: 3.5,
        7: 13,
        8: 50,
        9: 250,
        10: 1000,
      },
    },
    medium: {
      1: { 0: 0.4, 1: 2.75 },
      2: { 1: 1.8, 2: 5.1 },
      3: { 2: 2.8, 3: 50 },
      4: { 2: 1.7, 3: 10, 4: 100 },
      5: { 2: 1.4, 3: 4, 4: 14, 5: 390 },
      6: { 3: 3, 4: 9, 5: 180, 6: 710 },
      7: { 3: 2, 4: 7, 5: 30, 6: 400, 7: 800 },
      8: { 3: 2, 4: 4, 5: 11, 6: 67, 7: 400, 8: 900 },
      9: { 3: 2, 4: 2.5, 5: 5, 6: 15, 7: 100, 8: 500, 9: 1000 },
      10: {
        3: 1.6,
        4: 2,
        5: 4,
        6: 7,
        7: 26,
        8: 100,
        9: 500,
        10: 1000,
      },
    },
    high: {
      1: { 1: 3.96 },
      2: { 2: 17.1 },
      3: { 3: 81.5 },
      4: { 3: 10, 4: 259 },
      5: { 3: 4.5, 4: 48, 5: 450 },
      6: { 4: 11, 5: 350, 6: 710 },
      7: { 4: 7, 5: 90, 6: 400, 7: 800 },
      8: { 4: 5, 5: 20, 6: 270, 7: 600, 8: 900 },
      9: { 4: 4, 5: 11, 6: 56, 7: 500, 8: 800, 9: 1000 },
      10: {
        4: 3.5,
        5: 8,
        6: 13,
        7: 63,
        8: 500,
        9: 800,
        10: 1000,
      },
    },
  };

  let kenoRisk = "classic";

  function formatKenoMult(mult) {
    const n = Number(mult);
    if (!Number.isFinite(n)) return "0";
    return String(Number(n.toFixed(2)));
  }

  function formatKenoHitsLabel(hits) {
    const n = Number(hits);
    if (n === 0) return "0 hits";
    return `${n} hit${n === 1 ? "" : "s"}`;
  }

  function activeKenoPaytable() {
    return KENO_PAYTABLES[kenoRisk] || KENO_PAYTABLES.classic;
  }

  function kenoUnitBet() {
    const n = Math.floor(Number($("hg-keno-bet")?.value || 0));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function setKenoRisk(nextRisk) {
    const risk = String(nextRisk || "")
      .trim()
      .toLowerCase();
    kenoRisk =
      risk === "low" || risk === "medium" || risk === "high" ? risk : "classic";
    document.querySelectorAll("[data-keno-risk]").forEach((btn) => {
      btn.classList.toggle(
        "is-active",
        btn.getAttribute("data-keno-risk") === kenoRisk
      );
    });
    renderKenoPaytable();
  }

  function renderKenoPaytable() {
    const body = $("hg-keno-paytable-body");
    const sub = $("hg-keno-paytable-sub");
    if (!body) return;

    const pickCount = kenoPicks.size;
    const bet = kenoUnitBet();
    const riskTables = activeKenoPaytable();
    const activeTable = riskTables[pickCount];
    const riskLabel =
      kenoRisk.charAt(0).toUpperCase() + kenoRisk.slice(1);

    if (sub) {
      if (!pickCount) {
        sub.textContent = `${riskLabel} risk · select picks to see hit payoffs`;
      } else {
        sub.textContent = `${riskLabel} · ${pickCount} pick${pickCount === 1 ? "" : "s"} · bet ${formatPoints(bet)} pts`;
      }
    }

    if (!activeTable) {
      body.innerHTML = `
        <div class="hg-keno-pay-rows hg-keno-pay-overview">
          ${Object.keys(riskTables)
            .map((picks) => {
              const table = riskTables[picks];
              const top = Object.entries(table)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([hits, mult]) => `${hits}=${formatKenoMult(mult)}x`)
                .join(" · ");
              return `<div class="hg-keno-pay-overview-row"><span>${picks} pick${picks === "1" ? "" : "s"}</span><span>${top}</span></div>`;
            })
            .join("")}
        </div>
      `;
      return;
    }

    const rows = Object.entries(activeTable)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([hits, mult]) => {
        const payout = Math.floor(bet * Number(mult));
        return `
          <div class="hg-keno-pay-row">
            <span class="hg-keno-pay-hits">${formatKenoHitsLabel(hits)}</span>
            <span class="hg-keno-pay-mult">${formatKenoMult(mult)}x</span>
            <span class="hg-keno-pay-pts">${formatPoints(payout)} pts</span>
          </div>
        `;
      })
      .join("");

    body.innerHTML = `
      <div class="hg-keno-pay-head">
        <span>Hits</span>
        <span>Pay</span>
        <span>Win</span>
      </div>
      <div class="hg-keno-pay-rows">${rows}</div>
    `;
  }

  function syncKenoHint() {
    const hint = $("hg-keno-hint");
    if (hint) {
      hint.textContent = `Pick 1–10 numbers (${kenoPicks.size} selected). 10 are drawn.`;
    }
    renderKenoPaytable();
  }

  function buildKenoBoard() {
    const board = $("hg-keno-board");
    if (!board || board.childElementCount) return;
    for (let n = 1; n <= 40; n += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hg-keno-cell";
      btn.dataset.num = String(n);
      btn.textContent = String(n);
      btn.addEventListener("click", () => {
        if (kenoDrawing) return;
        const key = n;
        if (kenoPicks.has(key)) {
          kenoPicks.delete(key);
        } else if (kenoPicks.size >= 10) {
          setStatus("Pick up to 10 numbers.", { error: true });
          return;
        } else {
          kenoPicks.add(key);
          setStatus("");
        }
        btn.classList.toggle("is-picked", kenoPicks.has(key));
        syncKenoHint();
      });
      board.appendChild(btn);
    }
    renderKenoPaytable();
  }

  function syncKenoPickCells() {
    document.querySelectorAll(".hg-keno-cell").forEach((cell) => {
      const n = Number(cell.dataset.num);
      cell.classList.toggle("is-picked", kenoPicks.has(n));
      cell.classList.remove("is-drawn", "is-hit", "is-miss", "is-revealing");
    });
  }

  function pickRandomKenoNumbers() {
    if (kenoDrawing) return;
    const countInput = $("hg-keno-random-count");
    let count = Math.floor(Number(countInput?.value || 5));
    if (!Number.isFinite(count)) count = 5;
    count = Math.max(1, Math.min(10, count));

    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }

    kenoPicks = new Set(pool.slice(0, count));
    hideKenoWinBanner();
    const result = $("hg-keno-result");
    if (result) result.textContent = "";
    syncKenoPickCells();
    syncKenoHint();
    setStatus(`Picked ${count} random number${count === 1 ? "" : "s"}.`);
  }

  function clearKenoMarks() {
    document.querySelectorAll(".hg-keno-cell").forEach((cell) => {
      cell.classList.remove("is-drawn", "is-hit", "is-miss", "is-revealing");
    });
  }

  function kenoCellFor(n) {
    return document.querySelector(`.hg-keno-cell[data-num="${n}"]`);
  }

  async function animateKenoDraw(data) {
    clearKenoMarks();
    hideKenoWinBanner();
    const drawn = Array.isArray(data.drawn) ? data.drawn : [];
    const hits = new Set(data.hits || []);
    const resultEl = $("hg-keno-result");
    const delayMs = prefersReducedMotion() ? 0 : 300;

    if (prefersReducedMotion()) {
      drawn.forEach((n) => {
        const cell = kenoCellFor(n);
        if (!cell) return;
        cell.classList.add(hits.has(n) ? "is-hit" : "is-miss");
      });
      playKenoTone(hits.size > 0 ? "hit" : "miss");
      return;
    }

    let hitSoFar = 0;
    for (let i = 0; i < drawn.length; i += 1) {
      const n = drawn[i];
      const cell = kenoCellFor(n);
      const isHit = hits.has(n);
      if (isHit) hitSoFar += 1;

      if (cell) {
        cell.classList.remove("is-revealing");
        void cell.offsetWidth;
        cell.classList.add("is-revealing");
        cell.classList.add(isHit ? "is-hit" : "is-miss");
      }

      playKenoTone(isHit ? "hit" : "miss");

      if (resultEl) {
        resultEl.textContent = `Drawing ${i + 1}/${drawn.length} · ${n} ${
          isHit ? "HIT" : "miss"
        } · ${hitSoFar} hit${hitSoFar === 1 ? "" : "s"}`;
      }

      await wait(delayMs);
    }
  }

  async function resumeActiveBlackjack() {
    if (!currentUser?.kickUserId) return;
    try {
      const response = await fetch("/api/house-games/play", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: "blackjack", action: "resume" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.sessionId || data.active === false) return;
      applyBalance(data);
      switchGame("blackjack");
      renderBlackjack(data);
      setStatus("Resumed your blackjack hand.");
    } catch {
      /* ignore resume failures */
    }
  }

  async function dealBlackjack() {
    const bet = Number($("hg-bj-bet")?.value || 0);
    const data = await play({ game: "blackjack", action: "start", bet });
    if (!data) {
      setBlackjackActions(null);
      return;
    }
    if (data.resumed) {
      switchGame("blackjack");
      renderBlackjack(data);
      setStatus("Resumed your blackjack hand.");
      return;
    }
    await presentBlackjack(data, "deal");
  }

  async function actBlackjack(action) {
    if (!bjSessionId) {
      setStatus("Deal a hand first.", { error: true });
      return;
    }
    const data = await play({
      game: "blackjack",
      action,
      sessionId: bjSessionId,
    });
    if (!data) {
      setBlackjackActions({
        canHit: true,
        canStand: true,
        canDouble: action !== "double",
        canSplit: action !== "split",
      });
      return;
    }
    await presentBlackjack(data, "act");
  }

  async function spinRoulette() {
    if (rouletteSpinning) return;
    const bet = rouletteUnitBet();
    const hasNumbers = rouletteNumbers.size > 0;
    const hasOutside = Boolean(rouletteOutside);
    if (!hasNumbers && !hasOutside) {
      setStatus("Pick a color/parity bet or at least one number.", {
        error: true,
      });
      return;
    }

    const payload = hasNumbers
      ? { game: "roulette", bet, picks: [...rouletteNumbers] }
      : { game: "roulette", bet, choice: rouletteOutside };

    const spinBtn = $("hg-roulette-spin");
    rouletteSpinning = true;
    if (spinBtn) spinBtn.disabled = true;

    const data = await play(payload);
    if (!data) {
      rouletteSpinning = false;
      if (spinBtn) spinBtn.disabled = false;
      return;
    }

    const el = $("hg-roulette-result");
    if (el) el.textContent = "Spinning…";
    document.querySelectorAll(".hg-roulette-cell.is-hit").forEach((cell) => {
      cell.classList.remove("is-hit");
    });

    try {
      await animateRouletteSpin(data.spin);
      highlightRouletteResult(data.spin);
      const color = data.color || rouletteColor(data.spin);
      const outcome = data.won
        ? `Win · +${formatPoints(data.payout)} pts`
        : "Lose";
      if (el) {
        el.innerHTML = `<span class="hg-roulette-ball is-${color}">${data.spin}</span><span class="hg-roulette-copy">${color} · ${outcome}</span>`;
      }
    } finally {
      rouletteSpinning = false;
      if (spinBtn) spinBtn.disabled = false;
    }
  }

  async function playKeno() {
    if (kenoDrawing) return;
    getKenoAudioContext();
    const bet = Number($("hg-keno-bet")?.value || 0);
    if (kenoPicks.size < 1) {
      setStatus("Pick at least one number.", { error: true });
      return;
    }

    const playBtn = $("hg-keno-play");
    const clearBtn = $("hg-keno-clear");
    const randomBtn = $("hg-keno-random");
    const randomCount = $("hg-keno-random-count");
    kenoDrawing = true;
    if (playBtn) playBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    if (randomBtn) randomBtn.disabled = true;
    if (randomCount) randomCount.disabled = true;

    const data = await play({
      game: "keno",
      bet,
      picks: [...kenoPicks],
      risk: kenoRisk,
    });

    if (!data) {
      kenoDrawing = false;
      if (playBtn) playBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
      if (randomBtn) randomBtn.disabled = false;
      if (randomCount) randomCount.disabled = false;
      return;
    }

    const el = $("hg-keno-result");
    if (el) el.textContent = "Drawing…";
    hideKenoWinBanner();

    try {
      await animateKenoDraw(data);
      if (el) {
        const riskLabel = data.risk
          ? `${String(data.risk).charAt(0).toUpperCase()}${String(data.risk).slice(1)} · `
          : "";
        const outcome = data.won
          ? `Win · ${riskLabel}${data.hitCount} hit · ${data.multiplier}x · +${formatPoints(data.payout)} pts`
          : `${riskLabel}${data.hitCount} hit · no payout`;
        el.textContent = outcome;
      }
      if (data.won) {
        showKenoWinBanner(data);
        playKenoWinSound();
      }
    } finally {
      kenoDrawing = false;
      if (playBtn) playBtn.disabled = false;
      if (clearBtn) clearBtn.disabled = false;
      if (randomBtn) randomBtn.disabled = false;
      if (randomCount) randomCount.disabled = false;
    }
  }

  function bindUi() {
    document.querySelectorAll(".house-games-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchGame(tab.dataset.hgGame));
    });

    $("hg-self-credit-btn")?.addEventListener("click", () => {
      void selfCreditPoints();
    });
    $("hg-self-credit-amount")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void selfCreditPoints();
      }
    });

    $("hg-bj-deal")?.addEventListener("click", () => {
      void dealBlackjack();
    });
    $("hg-bj-bet")?.addEventListener("input", syncBjChip);
    $("hg-bj-hit")?.addEventListener("click", () => {
      void actBlackjack("hit");
    });
    $("hg-bj-stand")?.addEventListener("click", () => {
      void actBlackjack("stand");
    });
    $("hg-bj-double")?.addEventListener("click", () => {
      void actBlackjack("double");
    });
    $("hg-bj-split")?.addEventListener("click", () => {
      void actBlackjack("split");
    });

    document.querySelectorAll(".hg-roulette-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectRouletteOutside(btn.dataset.choice);
      });
    });

    $("hg-roulette-bet")?.addEventListener("input", syncRoulettePicks);

    $("hg-roulette-clear")?.addEventListener("click", () => {
      clearRoulettePicks();
    });

    $("hg-roulette-spin")?.addEventListener("click", () => {
      void spinRoulette();
    });

    $("hg-keno-clear")?.addEventListener("click", () => {
      if (kenoDrawing) return;
      kenoPicks = new Set();
      document.querySelectorAll(".hg-keno-cell").forEach((cell) => {
        cell.classList.remove("is-picked", "is-drawn", "is-hit", "is-miss", "is-revealing");
      });
      hideKenoWinBanner();
      const hint = $("hg-keno-hint");
      if (hint) {
        hint.textContent = "Pick 1–10 numbers. 10 are drawn.";
      }
      const result = $("hg-keno-result");
      if (result) result.textContent = "";
      renderKenoPaytable();
    });

    $("hg-keno-random")?.addEventListener("click", () => {
      pickRandomKenoNumbers();
    });

    document.querySelectorAll("[data-keno-risk]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (kenoDrawing) return;
        setKenoRisk(btn.getAttribute("data-keno-risk"));
      });
    });

    $("hg-keno-bet")?.addEventListener("input", renderKenoPaytable);

    $("hg-keno-play")?.addEventListener("click", () => {
      void playKeno();
    });
  }

  async function loadAuth() {
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

  async function init() {
    if (!$("house-games")) return;
    buildRouletteWheel();
    buildRouletteBoard();
    setRouletteTransforms();
    buildKenoBoard();
    bindUi();
    syncBjChip();
    await loadAuth();
    syncAuthUi();
    if (currentUser?.kickUserId) {
      await loadBalance();
      await resumeActiveBlackjack();
    }
  }

  window.addEventListener("auth:change", (event) => {
    currentUser = event.detail?.user || null;
    syncAuthUi();
    if (currentUser?.kickUserId) {
      void loadBalance().then(() => resumeActiveBlackjack());
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void init();
    });
  } else {
    void init();
  }
})();
