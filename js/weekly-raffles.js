(() => {
  let currentUser = null;
  let pollTimer = null;
  let countdownTimer = null;
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

  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (days > 0) {
      return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateAccess() {
    const isAdmin = Boolean(currentUser?.isAdmin);
    $("raffle-admin-panel")?.classList.toggle("is-hidden", !isAdmin);
  }

  function renderTimer(week) {
    const el = $("raffle-timer");
    if (!el) return;

    if (!week?.started) {
      el.textContent = "Week not started — tickets are paused";
      el.classList.remove("is-active", "is-ended");
      return;
    }

    const endsAt = Date.parse(week.endsAt || "");
    const remaining = Number.isFinite(endsAt) ? endsAt - Date.now() : 0;

    if (remaining <= 0 || week.ended) {
      el.textContent = `Week ended ${formatWhen(week.endsAt)} — reset to start next week`;
      el.classList.remove("is-active");
      el.classList.add("is-ended");
      return;
    }

    el.textContent = `Time left: ${formatCountdown(remaining)}`;
    el.classList.add("is-active");
    el.classList.remove("is-ended");
  }

  function scheduleCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (!lastPayload?.week) return;
      renderTimer(lastPayload.week);
    }, 1000);
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
    const weekStarted = Boolean(payload?.week?.started);

    if (period) {
      const parts = [];
      if (payload?.week?.startedAt && payload?.week?.endsAt) {
        parts.push(
          `Raffle window ${formatWhen(payload.week.startedAt)} → ${formatWhen(payload.week.endsAt)}`
        );
      }
      if (payload?.periodStart || payload?.periodEnd) {
        parts.push(
          `Sheet ${[payload.periodStart, payload.periodEnd].filter(Boolean).join(" → ")}`
        );
      }
      if (parts.length) {
        period.classList.remove("is-hidden");
        period.textContent = parts.join(" · ");
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

    if (!weekStarted) {
      empty?.classList.remove("is-hidden");
      if (empty) {
        empty.textContent =
          "Admin has not started this week yet. Tickets stay at 0 until the 7-day timer begins.";
      }
      list?.classList.add("is-hidden");
      list?.replaceChildren();
    } else if (!entries.length) {
      empty?.classList.remove("is-hidden");
      if (empty) {
        empty.textContent =
          "No ticket holders yet. Wager on code BLAKJAC21 during this week to earn tickets.";
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
        `1 ticket per $${rate} wagered this week`,
        `${payload?.eligibleTickets || 0} eligible tickets in the draw pool`,
        updated ? `sheet synced ${updated}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }

  function applyPayload(payload) {
    lastPayload = payload;
    renderTimer(payload.week);
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

  async function postAction(url, label) {
    setAdminStatus(label);
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }
    applyPayload(data);
    return data;
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

  $("raffle-start-week-btn")?.addEventListener("click", async () => {
    if (
      lastPayload?.week?.started &&
      !window.confirm(
        "Start a new 7-day week? This snapshots new baselines and clears the current winner."
      )
    ) {
      return;
    }
    const button = $("raffle-start-week-btn");
    button.disabled = true;
    try {
      await postAction("/api/weekly-raffles/start-week", "Starting week…");
      setAdminStatus("7-day week started. Tickets now track new wagering.", "success");
    } catch (error) {
      setAdminStatus(error.message || "Could not start week.", "error");
    } finally {
      button.disabled = false;
    }
  });

  $("raffle-reset-week-btn")?.addEventListener("click", async () => {
    if (
      !window.confirm(
        "Reset this week? Clears the timer, ticket baselines, and current winner."
      )
    ) {
      return;
    }
    const button = $("raffle-reset-week-btn");
    button.disabled = true;
    try {
      await postAction("/api/weekly-raffles/reset-week", "Resetting week…");
      setAdminStatus("Week reset. Start again when ready.", "success");
    } catch (error) {
      setAdminStatus(error.message || "Could not reset week.", "error");
    } finally {
      button.disabled = false;
    }
  });

  $("raffle-draw-btn")?.addEventListener("click", async () => {
    const button = $("raffle-draw-btn");
    button.disabled = true;
    try {
      const data = await postAction("/api/weekly-raffles/reveal", "Drawing…");
      setAdminStatus(
        data.winner
          ? `Winner: ${data.winner.kickUsername || data.winner.stakeUsername}`
          : "Draw complete.",
        "success"
      );
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
      await postAction("/api/weekly-raffles/clear-winner", "Clearing…");
      setAdminStatus("Winner cleared.", "success");
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
    .then(() => {
      schedulePoll();
      scheduleCountdown();
    })
    .catch((error) => {
      setPageStatus(error.message || "Could not load weekly raffle.", "error");
      schedulePoll();
      scheduleCountdown();
    });
})();
