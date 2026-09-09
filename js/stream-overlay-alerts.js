(() => {
  const POLL_MS = 1500;
  const seen = new Set();
  let queue = [];
  let showing = false;
  let durationMs = 6500;

  const root = document.getElementById("so-alert");
  const eyebrow = document.getElementById("so-alert-eyebrow");
  const message = document.getElementById("so-alert-message");

  function labelForType(type) {
    if (type === "gift") return "Gift subs";
    if (type === "resub") return "Resubscription";
    if (type === "sub") return "New subscriber";
    if (type === "test") return "Test alert";
    return "Alert";
  }

  async function ack(id) {
    try {
      await fetch("/api/stream-overlay/alerts/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // Non-fatal; alert may reappear briefly.
    }
  }

  function hideAlert() {
    if (!root) return;
    root.classList.add("is-out");
    setTimeout(() => {
      root.classList.add("is-hidden");
      root.classList.remove("is-out");
      showing = false;
      maybeShowNext();
    }, 320);
  }

  function showAlert(alert) {
    if (!root || !message || !eyebrow) return;
    showing = true;
    eyebrow.textContent = labelForType(alert.type);
    message.textContent = alert.message;
    root.classList.remove("is-hidden", "is-out");
    ack(alert.id);
    setTimeout(hideAlert, durationMs);
  }

  function maybeShowNext() {
    if (showing) return;
    const next = queue.shift();
    if (!next) return;
    showAlert(next);
  }

  async function poll() {
    try {
      const response = await fetch("/api/stream-overlay/alerts", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];

      for (const alert of alerts) {
        if (!alert?.id || seen.has(alert.id)) continue;
        seen.add(alert.id);
        queue.push(alert);
      }
      maybeShowNext();
    } catch {
      // Keep polling.
    }

    try {
      const configRes = await fetch("/api/stream-overlay", { cache: "no-store" });
      if (configRes.ok) {
        const data = await configRes.json();
        durationMs = Number(data.config?.alerts?.durationMs) || 6500;
      }
    } catch {
      // Ignore.
    }
  }

  poll();
  setInterval(poll, POLL_MS);
})();
