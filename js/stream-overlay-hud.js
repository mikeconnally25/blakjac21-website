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
    const brand = config?.brandName || "BLAKJAC21";
    setText("so-hud-brand", brand);
    setText("so-hud-promo-name", brand);
    setText("so-hud-watermark", brand);

    const ticker = document.getElementById("so-hud-ticker");
    const tickerText = hud.tickerText || "";
    if (ticker) {
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

    // LIVE / socials / ticker stay optional extras; frames follow showCorners.
    toggleHidden("so-hud-live", hud.showLiveBadge !== true);
    toggleHidden("so-hud-socials", hud.showSocials !== true);
    toggleHidden("so-hud-ticker-wrap", !hud.tickerText);
    toggleHidden("so-hud-main", hud.showCorners === false);
    toggleHidden("so-hud-cam", hud.showCorners === false);
  });
})();
