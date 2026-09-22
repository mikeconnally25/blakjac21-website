(() => {
  let currentUser = null;
  let bjSessionId = null;
  let bjSnapshot = { player: [], dealer: [] };
  let rouletteChoice = null;
  let kenoPicks = new Set();
  let busy = false;
  let dealing = false;

  const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const RESULT_LABEL = {
    win: "You win",
    lose: "Dealer wins",
    bust: "Bust",
    push: "Push",
    blackjack: "Blackjack!",
  };
  const DEAL_MS = 160;
  const DEAL_FLIGHT_MS = 420;

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
    return el;
  }

  function clearCards(container) {
    if (!container) return;
    container.innerHTML = "";
  }

  function setTotals(state, { hide = false } = {}) {
    const dealerTotal = $("hg-bj-dealer-total");
    const playerTotal = $("hg-bj-player-total");
    if (hide) {
      if (dealerTotal) dealerTotal.textContent = "";
      if (playerTotal) playerTotal.textContent = "";
      return;
    }
    if (dealerTotal) {
      dealerTotal.textContent =
        state?.dealer?.total != null ? `(${state.dealer.total})` : "";
    }
    if (playerTotal) {
      playerTotal.textContent =
        state?.player?.total != null ? `(${state.player.total})` : "";
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
    const deal = $("hg-bj-deal");
    const bet = $("hg-bj-bet");
    const locked = busy || dealing;
    const playing = Boolean(state && !state.result && state.canHit);

    if (hit) hit.disabled = locked || !state?.canHit;
    if (stand) stand.disabled = locked || !state?.canStand;
    if (dbl) dbl.disabled = locked || !state?.canDouble;
    if (deal) deal.disabled = locked || playing;
    if (bet) bet.disabled = locked || playing;
  }

  async function dealCardTo(container, card, { flip = false } = {}) {
    if (!container) return;
    const table = $("hg-bj-table");
    if (table && !prefersReducedMotion()) {
      table.classList.remove("is-dealing");
      // Force restart shoe flick for each card.
      void table.offsetWidth;
      table.classList.add("is-dealing");
    }
    const el = createCardEl(card, { deal: true, flip });
    container.appendChild(el);
    await wait(DEAL_MS);
  }

  async function animateInitialDeal(state) {
    const playerCards = $("hg-bj-player-cards");
    const dealerCards = $("hg-bj-dealer-cards");
    clearCards(playerCards);
    clearCards(dealerCards);
    setTotals(null, { hide: true });
    setResult(null);

    const player = state.player?.cards || [];
    const dealer = state.dealer?.cards || [];
    const rounds = Math.max(player.length, dealer.length);

    if (prefersReducedMotion()) {
      player.forEach((card) => playerCards.appendChild(createCardEl(card)));
      dealer.forEach((card) => dealerCards.appendChild(createCardEl(card)));
      return;
    }

    for (let i = 0; i < rounds; i += 1) {
      if (player[i]) await dealCardTo(playerCards, player[i]);
      if (dealer[i]) await dealCardTo(dealerCards, dealer[i]);
    }
    await wait(DEAL_FLIGHT_MS - DEAL_MS);
  }

  async function animateCardDelta(state) {
    const playerCards = $("hg-bj-player-cards");
    const dealerCards = $("hg-bj-dealer-cards");
    const nextPlayer = state.player?.cards || [];
    const nextDealer = state.dealer?.cards || [];
    const prevPlayer = bjSnapshot.player || [];
    const prevDealer = bjSnapshot.dealer || [];

    if (prefersReducedMotion()) {
      clearCards(playerCards);
      clearCards(dealerCards);
      nextPlayer.forEach((card) => playerCards.appendChild(createCardEl(card)));
      nextDealer.forEach((card) => dealerCards.appendChild(createCardEl(card)));
      return;
    }

    for (let i = prevPlayer.length; i < nextPlayer.length; i += 1) {
      await dealCardTo(playerCards, nextPlayer[i]);
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
          if (flip) await wait(220);
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
    bjSessionId = state.sessionId || bjSessionId;
    bjSnapshot = {
      player: [...(state.player?.cards || [])],
      dealer: [...(state.dealer?.cards || [])],
    };
    setTotals(state);
    setResult(state);
    setBlackjackActions(state);
    syncBjChip();
    $("hg-bj-table")?.classList.remove("is-dealing");
  }

  function renderBlackjack(state) {
    if (!state) {
      clearCards($("hg-bj-dealer-cards"));
      clearCards($("hg-bj-player-cards"));
      setTotals(null, { hide: true });
      setResult(null);
      bjSnapshot = { player: [], dealer: [] };
      setBlackjackActions(null);
      syncBjChip();
      $("hg-bj-table")?.classList.remove("is-dealing");
      return;
    }

    clearCards($("hg-bj-dealer-cards"));
    clearCards($("hg-bj-player-cards"));
    (state.dealer?.cards || []).forEach((card) => {
      $("hg-bj-dealer-cards")?.appendChild(createCardEl(card));
    });
    (state.player?.cards || []).forEach((card) => {
      $("hg-bj-player-cards")?.appendChild(createCardEl(card));
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

  function syncAuthUi() {
    const guest = $("hg-guest");
    const stage = $("hg-stage");
    const signedIn = Boolean(currentUser?.kickUserId);
    guest?.classList.toggle("is-hidden", signedIn);
    stage?.classList.toggle("is-hidden", !signedIn);
    if (!signedIn) {
      setBalance(null);
      bjSessionId = null;
      renderBlackjack(null);
      setStatus("");
    }
  }

  async function loadBalance() {
    if (!currentUser?.kickUserId) {
      setBalance(null);
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
    } catch {
      /* ignore */
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

  function syncRoulettePicks() {
    document.querySelectorAll(".hg-roulette-pick").forEach((btn) => {
      btn.classList.toggle(
        "is-active",
        btn.dataset.choice === rouletteChoice
      );
    });
  }

  function buildKenoBoard() {
    const board = $("hg-keno-board");
    if (!board || board.childElementCount) return;
    for (let n = 1; n <= 80; n += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hg-keno-cell";
      btn.dataset.num = String(n);
      btn.textContent = String(n);
      btn.addEventListener("click", () => {
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
        const hint = $("hg-keno-hint");
        if (hint) {
          hint.textContent = `Pick 1–10 numbers (${kenoPicks.size} selected). 20 are drawn.`;
        }
      });
      board.appendChild(btn);
    }
  }

  function clearKenoMarks() {
    document.querySelectorAll(".hg-keno-cell").forEach((cell) => {
      cell.classList.remove("is-drawn", "is-hit");
    });
  }

  function markKenoResult(data) {
    clearKenoMarks();
    const drawn = new Set(data.drawn || []);
    const hits = new Set(data.hits || []);
    document.querySelectorAll(".hg-keno-cell").forEach((cell) => {
      const n = Number(cell.dataset.num);
      if (drawn.has(n)) cell.classList.add("is-drawn");
      if (hits.has(n)) cell.classList.add("is-hit");
    });
  }

  async function dealBlackjack() {
    const bet = Number($("hg-bj-bet")?.value || 0);
    const data = await play({ game: "blackjack", action: "start", bet });
    if (!data) {
      setBlackjackActions(null);
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
      });
      return;
    }
    await presentBlackjack(data, "act");
  }

  async function spinRoulette() {
    const bet = Number($("hg-roulette-bet")?.value || 0);
    const numberInput = $("hg-roulette-number");
    const numberRaw = String(numberInput?.value || "").trim();
    let choice = rouletteChoice;
    if (numberRaw !== "") {
      choice = numberRaw;
    }
    if (!choice) {
      setStatus("Pick a color/parity bet or a number.", { error: true });
      return;
    }
    const data = await play({ game: "roulette", bet, choice });
    if (!data) return;
    const el = $("hg-roulette-result");
    if (el) {
      const color = data.color || "";
      const outcome = data.won
        ? `Win · +${formatPoints(data.payout)} pts`
        : "Lose";
      el.innerHTML = `<span class="hg-roulette-ball is-${color}">${data.spin}</span><span class="hg-roulette-copy">${color} · ${outcome}</span>`;
    }
  }

  async function playKeno() {
    const bet = Number($("hg-keno-bet")?.value || 0);
    if (kenoPicks.size < 1) {
      setStatus("Pick at least one number.", { error: true });
      return;
    }
    const data = await play({
      game: "keno",
      bet,
      picks: [...kenoPicks],
    });
    if (!data) return;
    markKenoResult(data);
    const el = $("hg-keno-result");
    if (el) {
      const outcome = data.won
        ? `Win · ${data.hitCount} hit · ${data.multiplier}x · +${formatPoints(data.payout)} pts`
        : `${data.hitCount} hit · no payout`;
      el.textContent = outcome;
    }
  }

  function bindUi() {
    document.querySelectorAll(".house-games-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchGame(tab.dataset.hgGame));
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

    document.querySelectorAll(".hg-roulette-pick").forEach((btn) => {
      btn.addEventListener("click", () => {
        rouletteChoice = btn.dataset.choice;
        const numberInput = $("hg-roulette-number");
        if (numberInput) numberInput.value = "";
        syncRoulettePicks();
      });
    });

    $("hg-roulette-number")?.addEventListener("input", () => {
      rouletteChoice = null;
      syncRoulettePicks();
    });

    $("hg-roulette-spin")?.addEventListener("click", () => {
      void spinRoulette();
    });

    $("hg-keno-clear")?.addEventListener("click", () => {
      kenoPicks = new Set();
      document.querySelectorAll(".hg-keno-cell").forEach((cell) => {
        cell.classList.remove("is-picked", "is-drawn", "is-hit");
      });
      const hint = $("hg-keno-hint");
      if (hint) {
        hint.textContent = "Pick 1–10 numbers. 20 are drawn.";
      }
      const result = $("hg-keno-result");
      if (result) result.textContent = "";
    });

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
    buildKenoBoard();
    bindUi();
    syncBjChip();
    await loadAuth();
    syncAuthUi();
    if (currentUser?.kickUserId) {
      await loadBalance();
    }
  }

  window.addEventListener("auth:change", (event) => {
    currentUser = event.detail?.user || null;
    syncAuthUi();
    if (currentUser?.kickUserId) {
      void loadBalance();
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
