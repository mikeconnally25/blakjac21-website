(() => {
  let currentUser = null;
  let pollTimer = null;
  let lastPayload = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setAdminStatus(message, tone = "") {
    const el = $("raffle-admin-status");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-hidden", !message);
    el.classList.toggle("is-error", tone === "error");
    el.classList.toggle("is-success", tone === "success");
  }

  function setPageStatus(message, tone = "") {
    const el = $("raffle-status");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-hidden", !message);
    el.classList.toggle("is-error", tone === "error");
  }

  function formatMoney(value, label) {
    if (label) return label;
    const amount = Number(value) || 0;
    return amount.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }

  function formatWhen(value) {
    const at = Date.parse(value || "");
    if (!Number.isFinite(at)) return "";
    return new Date(at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function updateAccess() {
    const isAdmin = Boolean(currentUser?.isAdmin);
    $("raffle-admin-panel")?.classList.toggle("is-hidden", !isAdmin);
  }

  function renderWinner(winner) {
    const card = $("raffle-winner-card");
    if (!card) return;

    if (!winner) {
      card.classList.add("is-hidden");
      return;
    }

    card.classList.remove("is-hidden");
    const name = $("raffle-winner-name");
    const meta = $("raffle-winner-meta");
    if (name) {
      name.textContent = winner.kickUsername
        ? `${winner.kickUsername} (${winner.stakeUsername})`
        : winner.stakeUsername;
    }
    if (meta) {
      const parts = [
        `${winner.tickets || 0} tickets`,
        formatMoney(winner.wagered),
      ];
      if (winner.revealedAt) {
        parts.push(`drawn ${formatWhen(winner.revealedAt)}`);
      }
      meta.textContent = parts.join(" · ");
    }
  }

  function renderBoard(payload) {
    const list = $("raffle-list");
    const empty = $("raffle-empty");
    const stats = $("raffle-stats");
    const footnote = $("raffle-footnote");
    const period = $("raffle-period");
    const entries = payload?.entries || [];

    if (period) {
      if (payload?.periodStart || payload?.periodEnd) {
        period.classList.remove("is-hidden");
        period.textContent = [payload.periodStart, payload.periodEnd]
          .filter(Boolean)
          .join(" → ");
      } else {
        period.classList.add("is-hidden");
        period.textContent = "";
      }
    }

    if (stats) {
      stats.innerHTML = `
        <span>${payload?.totalTickets || 0} tickets</span>
        <span>${payload?.eligibleCount || 0} eligible</span>
      `;
    }

    if (!entries.length) {
      empty?.classList.remove("is-hidden");
      if (empty) {
        empty.textContent = "No ticket holders yet. Wager on code BLAKJAC21 to earn tickets.";
      }
      list?.classList.add("is-hidden");
      list?.replaceChildren();
    } else {
      empty?.classList.add("is-hidden");
      list?.classList.remove("is-hidden");
      list.replaceChildren();

      for (const entry of entries) {
        const item = document.createElement("li");
        item.className = "weekly-raffle-row";
        if (!entry.eligible) item.classList.add("is-ineligible");
        if (
          payload?.winner &&
          entry.stakeUsername?.toLowerCase() ===
            payload.winner.stakeUsername?.toLowerCase()
        ) {
          item.classList.add("is-winner");
        }

        item.innerHTML = `
          <span class="weekly-raffle-stake">${entry.stakeUsername}</span>
          <span class="weekly-raffle-kick">${entry.kickUsername || "—"}</span>
          <span class="weekly-raffle-wagered">${formatMoney(entry.wagered, entry.wageredLabel)}</span>
          <span class="weekly-raffle-tickets">${entry.tickets}</span>
        `;
        list.append(item);
      }
    }

    if (footnote) {
      const rate = payload?.ticketsPerDollars || 50;
      const updated = payload?.updatedAt ? formatWhen(payload.updatedAt) : "";
      footnote.textContent = [
        `1 ticket per $${rate} wagered`,
        `${payload?.eligibleTickets || 0} eligible tickets in the draw pool`,
        updated ? `sheet synced ${updated}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }

  function applyPayload(payload) {
    lastPayload = payload;
    renderWinner(payload.winner);
    renderBoard(payload);
  }

  async function loadStatus() {
    const response = await fetch("/api/weekly-raffles/status", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not load weekly raffle.");
    }
    applyPayload(data);
    setPageStatus("");
  }

  async function drawWinner() {
    setAdminStatus("Drawing…");
    const response = await fetch("/api/weekly-raffles/reveal", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Draw failed.");
    }
    applyPayload(data);
    setAdminStatus(
      data.winner
        ? `Winner: ${data.winner.kickUsername || data.winner.stakeUsername}`
        : "Draw complete.",
      "success"
    );
  }

  async function clearWinner() {
    setAdminStatus("Clearing…");
    const response = await fetch("/api/weekly-raffles/clear-winner", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not clear winner.");
    }
    applyPayload(data);
    setAdminStatus("Winner cleared.", "success");
  }

  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      loadStatus().catch(() => {});
    }, 8000);
  }

  document.addEventListener("auth:change", (event) => {
    currentUser = event.detail?.user || null;
    updateAccess();
  });

  $("raffle-draw-btn")?.addEventListener("click", async () => {
    const button = $("raffle-draw-btn");
    button.disabled = true;
    try {
      await drawWinner();
    } catch (error) {
      setAdminStatus(error.message || "Draw failed.", "error");
    } finally {
      button.disabled = false;
    }
  });

  $("raffle-clear-btn")?.addEventListener("click", async () => {
    if (!window.confirm("Clear the current raffle winner?")) return;
    const button = $("raffle-clear-btn");
    button.disabled = true;
    try {
      await clearWinner();
    } catch (error) {
      setAdminStatus(error.message || "Could not clear winner.", "error");
    } finally {
      button.disabled = false;
    }
  });

  fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      currentUser = data.user || null;
      updateAccess();
    })
    .catch(() => {
      currentUser = null;
      updateAccess();
    });

  loadStatus()
    .then(() => schedulePoll())
    .catch((error) => {
      setPageStatus(error.message || "Could not load weekly raffle.", "error");
      schedulePoll();
    });
})();
