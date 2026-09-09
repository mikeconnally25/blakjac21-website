(() => {
  const { startConfigPolling, setText, toggleHidden } = window.StreamOverlay;

  function renderSocialChips(socials = {}) {
    const items = [];
    if (socials.kick) {
      items.push({ label: "Kick", value: `/${socials.kick}` });
    }
    if (socials.twitter) {
      items.push({ label: "X", value: `@${socials.twitter}` });
    }
    if (socials.youtube) {
      items.push({ label: "YT", value: socials.youtube });
    }
    if (socials.discord) {
      items.push({ label: "Discord", value: socials.discord });
    }

    return items
      .map(
        (item) =>
          `<span class="so-hud-chip"><span>${item.label}</span> <strong>${item.value}</strong></span>`
      )
      .join("");
  }

  startConfigPolling((config) => {
    const hud = config?.hud || {};
    setText("so-hud-brand", config?.brandName || "BLAKJAC21");

    const ticker = document.getElementById("so-hud-ticker");
    const tickerText = hud.tickerText || "";
    if (ticker) {
      // Duplicate text so the marquee feels continuous when long enough.
      const loopText =
        tickerText.length > 0
          ? `${tickerText}   ·   ${tickerText}   ·   ${tickerText}`
          : "";
      ticker.textContent = loopText;
    }

    const socials = document.getElementById("so-hud-socials");
    if (socials) {
      socials.innerHTML = renderSocialChips(config?.socials);
    }

    toggleHidden("so-hud-live", hud.showLiveBadge === false);
    toggleHidden("so-hud-socials", hud.showSocials === false);
    toggleHidden("so-hud-ticker-wrap", !hud.tickerText);
    toggleHidden("so-corners", hud.showCorners === false);
    toggleHidden("so-hud-cam", hud.showCorners === false);
  });
})();
