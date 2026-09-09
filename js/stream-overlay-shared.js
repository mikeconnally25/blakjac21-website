(() => {
  const OVERLAY_POLL_MS = 5000;

  async function fetchOverlayConfig() {
    const response = await fetch("/api/stream-overlay", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not load overlay config.");
    }
    const data = await response.json();
    return data.config;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "";
  }

  function toggleHidden(id, hidden) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("is-hidden", Boolean(hidden));
  }

  function formatCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "00:00";
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderSocialLine(socials = {}) {
    const parts = [];
    if (socials.kick) parts.push(`Kick <span>/${socials.kick}</span>`);
    if (socials.twitter) parts.push(`X <span>@${socials.twitter}</span>`);
    if (socials.youtube) parts.push(`YT <span>${socials.youtube}</span>`);
    if (socials.discord) parts.push(`Discord <span>${socials.discord}</span>`);
    return parts.join(" · ");
  }

  function startConfigPolling(onConfig, intervalMs = OVERLAY_POLL_MS) {
    let stopped = false;

    async function tick() {
      if (stopped) return;
      try {
        const config = await fetchOverlayConfig();
        onConfig(config);
      } catch {
        // Keep last good frame.
      }
    }

    tick();
    const timer = setInterval(tick, intervalMs);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  function applySceneCopy(config, sceneKey) {
    const scene = config?.[sceneKey] || {};
    setText("so-brand-name", config?.brandName || "BLAKJAC21");
    setText("so-headline", scene.headline || "");
    setText("so-subheadline", scene.subheadline || config?.tagline || "");

    const socialsEl = document.getElementById("so-socials");
    if (socialsEl) {
      socialsEl.innerHTML = renderSocialLine(config?.socials);
    }
  }

  function bindCountdown(goLiveAt) {
    const wrap = document.getElementById("so-countdown");
    const value = document.getElementById("so-countdown-value");
    if (!wrap || !value) return () => {};

    if (!goLiveAt) {
      wrap.classList.add("is-hidden");
      return () => {};
    }

    const target = Date.parse(goLiveAt);
    if (Number.isNaN(target)) {
      wrap.classList.add("is-hidden");
      return () => {};
    }

    wrap.classList.remove("is-hidden");

    function tick() {
      const remaining = target - Date.now();
      value.textContent = remaining <= 0 ? "00:00" : formatCountdown(remaining);
    }

    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }

  window.StreamOverlay = {
    fetchOverlayConfig,
    setText,
    toggleHidden,
    formatCountdown,
    renderSocialLine,
    startConfigPolling,
    applySceneCopy,
    bindCountdown,
  };
})();
