function stakeSessionApiBase() {
  if (/vercel\.app$/i.test(window.location.hostname)) {
    return "https://www.blakjac21.com";
  }
  return window.location.origin;
}

function buildStakeWatchScript({ token, importUrl }) {
  return `(async () => {
  const token = ${JSON.stringify(token)};
  const importUrl = ${JSON.stringify(importUrl)};
  const lockKey = "__bjStakeSession";
  if (window[lockKey]) {
    console.warn("Stake session tracker is already running.");
    return;
  }
  window[lockKey] = true;
  const endpoint = location.origin.replace(/\\/$/, "") + "/_api/graphql";
  const queries = [
    "query HouseBets($limit: Int!, $offset: Int!) { user { houseBetList(limit: $limit, offset: $offset) { id iid bet { __typename ... on CasinoBet { id amount payout payoutMultiplier currency updatedAt createdAt game { name slug } } } } } }",
    "query HouseBets($limit: Int!, $offset: Int!) { user { houseBetList(limit: $limit, offset: $offset) { id iid bet { __typename ... on CasinoBet { id amount payout payoutMultiplier currency updatedAt createdAt game } } } } }"
  ];
  const sent = new Map();

  const gameOf = (bet) => {
    const game = bet && bet.game;
    if (game && typeof game === "object") {
      return { game: String(game.name || "").trim(), slug: String(game.slug || "").trim() };
    }
    return { game: String(game || "").trim(), slug: "" };
  };

  const normalize = (row) => {
    const bet = (row && row.bet) || row || {};
    const names = gameOf(bet);
    const id = String(bet.id || row.id || row.iid || "").trim();
    if (!id || !names.game) return null;
    const amount = Number(bet.amount);
    if (!Number.isFinite(amount)) return null;
    const payout = bet.payout === null || bet.payout === undefined ? null : Number(bet.payout);
    return {
      id,
      game: names.game,
      slug: names.slug,
      amount,
      payout: Number.isFinite(payout) ? payout : null,
      multiplier: Number(bet.payoutMultiplier) || null,
      currency: String(bet.currency || ""),
      createdAt: String(bet.createdAt || bet.updatedAt || "")
    };
  };

  const loadBets = async () => {
    let lastError = "Stake did not return bets.";
    for (const query of queries) {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-language": "en"
        },
        body: JSON.stringify({ query, variables: { limit: 25, offset: 0 } })
      });
      const data = await response.json().catch(() => null);
      const rows = data && data.data && data.data.user && data.data.user.houseBetList;
      if (Array.isArray(rows)) {
        return rows.map(normalize).filter(Boolean);
      }
      lastError = (data && data.errors && data.errors[0] && data.errors[0].message) || lastError;
    }
    throw new Error(lastError);
  };

  const postBets = async (bets) => {
    const response = await fetch(importUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, bets })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not save bets.");
    return data;
  };

  console.log("Tracking Stake bets for BLAKJAC21. Leave this tab open.");
  const tick = async () => {
    const bets = await loadBets();
    const fresh = bets.filter((bet) => sent.get(bet.id) !== String(bet.payout));
    if (!fresh.length) return;
    await postBets(fresh);
    fresh.forEach((bet) => sent.set(bet.id, String(bet.payout)));
    console.log("Saved " + fresh.length + " Stake bet" + (fresh.length === 1 ? "" : "s") + ".");
  };

  try {
    await tick();
  } catch (error) {
    window[lockKey] = false;
    console.error("Stake tracker failed:", error.message || error);
    return;
  }

  window.setInterval(() => {
    tick().catch((error) => console.warn("Stake tracker:", error.message || error));
  }, 4000);
})();`;
}

function formatSessionMoney(amount, currency) {
  const value = Number(amount);
  const text = Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";
  const code = String(currency || "").toUpperCase();
  if (!code || code === "USD") return `$${text}`;
  return `${text} ${code}`;
}

function renderStakeSession(root, data) {
  const summary = root.querySelector("[data-stake-summary]");
  const list = root.querySelector("[data-stake-list]");
  const empty = root.querySelector("[data-stake-empty]");
  if (summary) {
    if (!data?.startedAt) {
      summary.textContent = "Not tracking.";
    } else {
      const filter = data.filterNote ? ` · ${data.filterNote}` : "";
      const net = Number(data.net) || 0;
      const sign = net > 0 ? "+" : "";
      summary.textContent = `${data.count || 0} bets · wagered ${formatSessionMoney(data.wagered)} · net ${sign}${formatSessionMoney(net)}${filter}`;
    }
  }
  if (!list || !empty) return;
  list.replaceChildren();
  const bets = Array.isArray(data?.bets) ? data.bets : [];
  empty.classList.toggle("is-hidden", bets.length > 0);
  list.classList.toggle("is-hidden", bets.length === 0);
  for (const bet of bets) {
    const item = document.createElement("li");
    item.className = "stake-session-row";
    const name = document.createElement("span");
    name.className = "stake-session-game";
    name.textContent = bet.game;
    const stake = document.createElement("span");
    stake.textContent = formatSessionMoney(bet.amount, bet.currency);
    const result = document.createElement("span");
    const payout = Number(bet.payout);
    const net = Number.isFinite(payout) ? payout - Number(bet.amount) : null;
    result.className =
      net === null ? "" : net >= 0 ? "stake-session-win" : "stake-session-loss";
    result.textContent =
      net === null
        ? "Open"
        : `${net >= 0 ? "+" : ""}${formatSessionMoney(net, bet.currency)}`;
    item.append(name, stake, result);
    list.appendChild(item);
  }
}

function bindStakeSession(root) {
  if (root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  const context = root.dataset.context;
  const status = root.querySelector("[data-stake-status]");
  const start = root.querySelector("[data-stake-start]");
  const clear = root.querySelector("[data-stake-clear]");

  const setStatus = (message, tone) => {
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-hidden", !message);
    status.classList.toggle("is-error", tone === "error");
    status.classList.toggle("is-success", tone === "success");
  };

  const refresh = async () => {
    const response = await fetch(
      `/api/stake-session/status?${new URLSearchParams({ context })}`,
      { credentials: "same-origin", cache: "no-store" }
    );
    if (response.status === 403) return;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    renderStakeSession(root, data);
  };

  start?.addEventListener("click", async () => {
    start.disabled = true;
    setStatus("Starting Stake tracker…");
    try {
      const response = await fetch("/api/stake-session/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        throw new Error(data.error || "Could not start tracking.");
      }
      const script = buildStakeWatchScript({
        token: data.token,
        importUrl: `${stakeSessionApiBase()}/api/stake-session/import`,
      });
      window.open("https://stake.com/", "_blank");
      try {
        await navigator.clipboard.writeText(script);
        setStatus(
          "Tracker copied. On Stake: F12 → Console → paste → Enter. Leave that tab open.",
          "success"
        );
      } catch {
        setStatus("Allow the Stake popup, then copy the tracker from the console prompt.", "error");
        window.prompt("Paste this on the Stake console:", script);
      }
      await refresh();
    } catch (error) {
      setStatus(error.message || "Could not start tracking.", "error");
    } finally {
      start.disabled = false;
    }
  });

  clear?.addEventListener("click", async () => {
    clear.disabled = true;
    try {
      const response = await fetch("/api/stake-session/clear", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not clear the session.");
      renderStakeSession(root, data);
      setStatus("Session cleared.", "success");
    } catch (error) {
      setStatus(error.message || "Could not clear the session.", "error");
    } finally {
      clear.disabled = false;
    }
  });

  refresh().catch(() => {});
  window.setInterval(() => {
    refresh().catch(() => {});
  }, 4000);
}

function mountStakeSessions() {
  document.querySelectorAll("[data-stake-session]").forEach((root) => {
    if (root.closest(".is-hidden")) return;
    bindStakeSession(root);
  });
}

window.mountStakeSessions = mountStakeSessions;
document.addEventListener("DOMContentLoaded", mountStakeSessions);
