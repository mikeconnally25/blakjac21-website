const KICK_USERNAME = "blakjac21";

let hlsInstance = null;

function getParentHostname() {
  const hostname = window.location.hostname;
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    return null;
  }

  return hostname;
}

function buildLivePlayerUrl() {
  const url = new URL(`https://player.kick.com/${KICK_USERNAME}`);
  url.searchParams.set("muted", "false");

  const parent = getParentHostname();
  if (parent) {
    url.searchParams.set("parent", parent);
  }

  return url.toString();
}

function hideAllPlayers() {
  document.getElementById("kick-player")?.classList.add("is-hidden");
  document.getElementById("vod-player")?.classList.add("is-hidden");
  document.getElementById("player-offline")?.classList.add("is-hidden");
}

function destroyVodPlayer() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  const video = document.getElementById("vod-player");
  if (!video) return;

  video.pause();
  video.removeAttribute("src");
  video.load();
}

function updatePlayerHeader({ watchTitle, watchSubtitle }) {
  const watchTitleEl = document.getElementById("watch-title");
  const watchSubtitleEl = document.getElementById("watch-subtitle");

  if (watchTitleEl) watchTitleEl.textContent = watchTitle;
  if (watchSubtitleEl) watchSubtitleEl.textContent = watchSubtitle;
}

function showLivePlayer(livestream) {
  hideAllPlayers();
  destroyVodPlayer();

  const iframe = document.getElementById("kick-player");
  if (!iframe) return;

  iframe.src = buildLivePlayerUrl();
  iframe.classList.remove("is-hidden");

  const sessionTitle = livestream?.session_title || "Live on Kick";
  updatePlayerHeader({
    watchTitle: "Live Stream",
    watchSubtitle: sessionTitle,
  });
}

function showVodPlayer(vod) {
  hideAllPlayers();
  destroyVodPlayer();

  const video = document.getElementById("vod-player");
  if (!video || !vod?.source) {
    showOfflineState();
    return;
  }

  video.classList.remove("is-hidden");

  if (window.Hls && window.Hls.isSupported()) {
    hlsInstance = new window.Hls();
    hlsInstance.loadSource(vod.source);
    hlsInstance.attachMedia(video);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = vod.source;
  } else {
    showOfflineState();
    return;
  }

  const sessionTitle = vod.session_title || "Latest VOD";
  updatePlayerHeader({
    watchTitle: "Latest VOD",
    watchSubtitle: sessionTitle,
  });
}

function showOfflineState() {
  hideAllPlayers();
  destroyVodPlayer();
  document.getElementById("player-offline")?.classList.remove("is-hidden");

  updatePlayerHeader({
    watchTitle: "Offline",
    watchSubtitle: "Check back soon or follow on Kick for notifications.",
  });
}

async function fetchKickJson(path) {
  const response = await fetch(`https://kick.com/api/v2/channels/${KICK_USERNAME}${path}`);
  if (!response.ok) throw new Error(`Kick API failed: ${path}`);
  return response.json();
}

function getLatestPublicVod(videos) {
  if (!Array.isArray(videos)) return null;

  return videos.find((item) => {
    const video = item?.video;
    return item?.source && video && !video.is_private && video.status === "public";
  }) || null;
}

async function loadPlayer() {
  try {
    const channel = await fetchKickJson("");
    const isLive = Boolean(channel?.livestream);

    if (isLive) {
      showLivePlayer(channel.livestream);
      return;
    }

    const videos = await fetchKickJson("/videos");
    const latestVod = getLatestPublicVod(videos);

    if (latestVod) {
      showVodPlayer(latestVod);
      return;
    }

    showOfflineState();
  } catch {
    showOfflineState();
  }
}

function initMobileNav() {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");

  if (!toggle || !links) return;

  toggle.addEventListener("click", () => {
    const isOpen = links.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  });

  links.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      links.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
    });
  });
}

document.getElementById("year").textContent = String(new Date().getFullYear());

initMobileNav();
loadPlayer();
