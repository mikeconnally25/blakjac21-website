(() => {
  let currentUser = null;
  let pollTimer = null;
  let countdownTimer = null;
  let lastPayload = null;
  let lastWinnerId = null;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function pad2(value) {
    return String(Math.max(0, value)).padStart(2, "0");
  }

  function setDigits(remainingMs) {
    const total = Math.max(0, Math.floor(remainingMs / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const d = $("raffle-d");
    const h = $("raffle-h");
    const m = $("raffle-m");
    const s = $("raffle-s");
    if (d) d.textContent = pad2(days);
    if (h) h.textContent = pad2(hours);
    if (m) m.textContent = pad2(minutes);
    if (s) s.textContent = pad2(seconds);
  }

  function updateAccess() {
    const isAdmin = Boolean(currentUser?.isAdmin);
    $("raffle-admin-panel")?.classList.toggle("is-hidden", !isAdmin);
  }

  function renderTimer(week) {
    const shell = $("raffle-timer");
    const label = $("raffle-timer-label");
    const note = $("raffle-timer-note");
    if (!shell) return;

    if (!week?.started) {
      shell.dataset.state = "idle";
      if (label) label.textContent = "Week paused";
      if (note) note.textContent = "Tickets stay locked until admin starts the 7-day window";
      setDigits(0);
      return;
    }

    const endsAt = Date.parse(week.endsAt || "");
    const remaining = Number.isFinite(endsAt) ? endsAt - Date.now() : 0;

    if (remaining <= 0 || week.ended) {
      shell.dataset.state = "ended";
      if (label) label.textContent = "Week complete";
      if (note) {
        note.textContent = week.endsAt
          ? `Ended ${formatWhen(week.endsAt)} — draw when ready, then reset for next week`
          : "Week ended — reset to open the next raffle";
      }
      setDigits(0);
      return;
    }

    shell.dataset.state = "active";
    if (label) label.textContent = "Live countdown";
    if (note) {
      note.textContent = week.endsAt
        ? `Closes ${formatWhen(week.endsAt)} · keep wagering on BLAKJAC21`
        : "Keep wagering on BLAKJAC21 to stack tickets";
    }
    setDigits(remaining);
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
      card.classList.remove("is-celebrate");
      lastWinnerId = null;
      return;
    }

    const isNew = winner.id && winner.id !== lastWinnerId;
    lastWinnerId = winner.id || lastWinnerId;
    card.classList.remove("is-hidden");

    const name = $("raffle-winner-name");
    const sub = $("raffle-winner-sub");
    const meta = $("raffle-winner-meta");

    if (name) {
      name.textContent = winner.kickUsername || winner.stakeUsername || "Winner";
    }
    if (sub) {
      if (winner.kickUsername && winner.stakeUsername) {
        sub.textContent = `Stake · ${winner.stakeUsername}`;
      } else {
        sub.textContent = "This week’s raffle champion";
      }
    }
    if (meta) {
      const parts = [
        `${winner.tickets || 0} tickets in the pool`,
        formatMoney(winner.wagered),
      ];
      if (winner.revealedAt) {
        parts.push(`drawn ${formatWhen(winner.revealedAt)}`);
      }
      meta.textContent = parts.join(" · ");
    }

    if (isNew) {
      card.classList.remove("is-celebrate");
      void card.offsetWidth;
      card.classList.add("is-celebrate");
    }
  }

  function renderBoard(payload) {
    const list = $("raffle-list");
    const empty = $("raffle-empty");
    const footnote = $("raffle-footnote");
    const period = $("raffle-period");
    const entries = payload?.entries || [];
    const weekStarted = Boolean(payload?.week?.started);

    if (period) {
      const parts = [];
      if (payload?.week?.startedAt && payload?.week?.endsAt) {
        parts.push(
          `Raffle ${formatWhen(payload.week.startedAt)} → ${formatWhen(payload.week.endsAt)}`
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

    const ticketsEl = $("raffle-stat-tickets");
    const eligibleEl = $("raffle-stat-eligible");
    if (ticketsEl) ticketsEl.textContent = String(payload?.totalTickets || 0);
    if (eligibleEl) eligibleEl.textContent = String(payload?.eligibleCount || 0);

    if (!weekStarted) {
      empty?.classList.remove("is-hidden");
      if (empty) {
        empty.textContent =
          "The week hasn’t opened yet. Once the countdown starts, tickets will stack here live.";
      }
      list?.classList.add("is-hidden");
      list?.replaceChildren();
    } else if (!entries.length) {
      empty?.classList.remove("is-hidden");
      if (empty) {
        empty.textContent =
          "No tickets yet — be the first on the board with $50 wagered this week.";
      }
      list?.classList.add("is-hidden");
      list?.replaceChildren();
    } else {
      empty?.classList.add("is-hidden");
      list?.classList.remove("is-hidden");
      list.replaceChildren();

      entries.forEach((entry, index) => {
        const item = document.createElement("li");
        item.className = "weekly-raffle-row";
        if (!entry.eligible) item.classList.add("is-ineligible");
        if (index < 3) item.classList.add(`is-top-${index + 1}`);
        if (
          payload?.winner &&
          entry.stakeUsername?.toLowerCase() ===
            payload.winner.stakeUsername?.toLowerCase()
        ) {
          item.classList.add("is-winner");
        }

        const place = index + 1;
        item.innerHTML = `
          <span class="weekly-raffle-place">${place}</span>
          <span class="weekly-raffle-stake">${escapeHtml(entry.stakeUsername)}</span>
          <span class="weekly-raffle-kick">${escapeHtml(entry.kickUsername || "—")}</span>
          <span class="weekly-raffle-wagered">${escapeHtml(formatMoney(entry.wagered, entry.wageredLabel))}</span>
          <span class="weekly-raffle-tickets">${escapeHtml(entry.tickets)}</span>
        `;
        list.append(item);
      });
    }

    if (footnote) {
      const rate = payload?.ticketsPerDollars || 50;
      const updated = payload?.updatedAt ? formatWhen(payload.updatedAt) : "";
      footnote.textContent = [
        `1 ticket per $${rate} wagered this week`,
        `${payload?.eligibleTickets || 0} eligible tickets in the draw`,
        updated ? `synced ${updated}` : "",
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
