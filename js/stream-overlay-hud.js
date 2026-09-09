(() => {
  const { startConfigPolling, setText, toggleHidden, renderSocialLine } =
    window.StreamOverlay;

  startConfigPolling((config) => {
    const hud = config?.hud || {};
    setText("so-hud-brand", config?.brandName || "BLAKJAC21");
    setText("so-hud-ticker", hud.tickerText || "");

    const socials = document.getElementById("so-hud-socials");
    if (socials) {
      socials.innerHTML = renderSocialLine(config?.socials).replaceAll(
        "<span>",
        "<strong>"
      ).replaceAll("</span>", "</strong>");
    }

    toggleHidden("so-hud-live", hud.showLiveBadge === false);
    toggleHidden("so-hud-socials", hud.showSocials === false);
    toggleHidden("so-hud-ticker", !hud.tickerText);
    toggleHidden("so-corners", hud.showCorners === false);
  });
})();
