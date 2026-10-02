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

function cleanSessionTitle(raw, fallback) {
  const first = String(raw || "")
    .split("|")[0]
    .replace(/\s+/g, " ")
    .trim();
  return first || fallback;
}

function formatStreamAge(timestamp) {
  if (!timestamp) return "";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function setLiveStripStream(mode, label) {
  const item = document.getElementById("live-strip-stream");
  const text = document.getElementById("live-strip-stream-label");
  const dot = document.getElementById("live-strip-dot");
  if (text) text.textContent = label;
  item?.classList.toggle("is-live", mode === "live");
  dot?.classList.toggle("is-live", mode === "live");
}

function updatePlayerHeader({ watchTitle, watchSubtitle, watchAge = "" }) {
  const watchTitleEl = document.getElementById("watch-title");
  const watchSubtitleEl = document.getElementById("watch-subtitle");
  const watchAgeEl = document.getElementById("watch-age");

  if (watchTitleEl) watchTitleEl.textContent = watchTitle;
  if (watchSubtitleEl) watchSubtitleEl.textContent = watchSubtitle;
  if (watchAgeEl) watchAgeEl.textContent = watchAge;
}

function showLivePlayer(livestream) {
  hideAllPlayers();
  destroyVodPlayer();

  const iframe = document.getElementById("kick-player");
  if (!iframe) return;

  iframe.src = buildLivePlayerUrl();
  iframe.classList.remove("is-hidden");

  const sessionTitle = cleanSessionTitle(livestream?.session_title, "Live on Kick");
  updatePlayerHeader({
    watchTitle: "Live Stream",
    watchSubtitle: sessionTitle,
    watchAge: "Live now",
  });
  setLiveStripStream("live", "Live now");
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

  const sessionTitle = cleanSessionTitle(vod.session_title, "Latest VOD");
  updatePlayerHeader({
    watchTitle: "Latest VOD",
    watchSubtitle: sessionTitle,
    watchAge: formatStreamAge(getVodTimestamp(vod)),
  });
  setLiveStripStream("vod", "Latest VOD");
}

function showOfflineState() {
  hideAllPlayers();
  destroyVodPlayer();
  document.getElementById("player-offline")?.classList.remove("is-hidden");

  updatePlayerHeader({
    watchTitle: "Offline",
    watchSubtitle: "No stream or VOD right now.",
    watchAge: "",
  });
  setLiveStripStream("offline", "Offline");
}

async function fetchKickJson(path) {
  const url = new URL(`https://kick.com/api/v2/channels/${KICK_USERNAME}${path}`);
  // Kick sends Cache-Control: max-age=14400; bypass so latest VOD stays fresh.
  url.searchParams.set("_ts", String(Date.now()));

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error(`Kick API failed: ${path}`);
  return response.json();
}

function getVodTimestamp(item) {
  const candidates = [
    item?.start_time,
    item?.created_at,
    item?.video?.created_at,
    item?.video?.updated_at,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const normalized = String(raw).trim().replace(" ", "T");
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
      ? normalized
      : `${normalized}Z`;
    const time = Date.parse(withZone);
    if (Number.isFinite(time)) return time;
  }

  return 0;
}

function normalizeVideosPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.videos)) return payload.videos;
  return [];
}

function getLatestPublicVod(videos) {
  const entries = normalizeVideosPayload(videos)
    .filter((item) => {
      const video = item?.video;
      return (
        Boolean(item?.source) &&
        Boolean(video) &&
        !video.is_private &&
        !video.is_pruned &&
        !video.deleted_at &&
        video.status === "public"
      );
    })
    .sort((a, b) => getVodTimestamp(b) - getVodTimestamp(a));

  return entries[0] || null;
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

function ensureMenuSubnav() {
  const header = document.querySelector("header.header");
  if (!header) return;

  const tabs = [
    ["/leaderboard/", "Leaderboard"],
    ["/weekly-raffles/", "Weekly Raffles"],
    ["/level-up-rewards/", "Level Up"],
    ["/giveaways/", "Giveaways"],
    ["/guess-the-balance/", "Guess Balance"],
    ["/bonus-hunt/", "Bonus Hunt"],
    ["/slot-tournaments/", "Tournaments"],
    ["/store/", "Store"],
  ];
  let nav = header.querySelector(".menu-subnav");
  if (!nav) {
    nav = document.createElement("nav");
    nav.className = "menu-subnav";
    nav.id = "menu";
    nav.setAttribute("aria-label", "Menu");
    const row = document.createElement("div");
    row.className = "container menu-subnav-row";
    for (const [href, label] of tabs) {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      row.appendChild(link);
    }
    nav.appendChild(row);
    header.appendChild(nav);
  }

  const path = window.location.pathname;
  nav.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (href !== "/" && (path === href || path.startsWith(href))) {
      link.setAttribute("aria-current", "page");
    }
  });
}

function ensureFooterContact() {
  const footerInner = document.querySelector(".footer-inner");
  if (!footerInner || document.getElementById("footer-contact")) return;

  const contact = document.createElement("p");
  contact.id = "footer-contact";
  contact.className = "footer-contact";
  contact.innerHTML =
    'Contact: email <a href="mailto:blakjac21kick@gmail.com">blakjac21kick@gmail.com</a>' +
    ' · <a href="/privacy/">Privacy Policy</a>';

  const brand = footerInner.querySelector(".footer-brand");
  if (brand) {
    brand.appendChild(contact);
    return;
  }

  const disclaimer = footerInner.querySelector(".disclaimer");
  if (disclaimer) {
    footerInner.insertBefore(contact, disclaimer);
  } else {
    footerInner.appendChild(contact);
  }
}

const yearEl = document.getElementById("year");
if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}
ensureMenuSubnav();
ensureFooterContact();

initMobileNav();
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

async function loadLiveStrip() {
  const giveawayEl = document.getElementById("live-strip-giveaway-label");
  const raffleEl = document.getElementById("live-strip-raffle-label");
  const pointsItem = document.getElementById("live-strip-points");
  const pointsEl = document.getElementById("live-strip-points-label");
  if (!giveawayEl && !raffleEl && !pointsItem) return;

  try {
    const response = await fetch("/api/giveaways/status", { cache: "no-store" });
    if (response.ok && giveawayEl) {
      const data = await response.json();
      if (data.open) {
        const keyword = data.keyword ? ` · ${data.keyword}` : "";
        const count = Number(data.entryCount) || 0;
        giveawayEl.textContent = `Giveaway${keyword} · ${count}`;
      } else {
        giveawayEl.textContent = "Giveaway closed";
      }
    }
  } catch {
    /* keep the last label */
  }

  try {
    const response = await fetch("/api/weekly-raffles/status", { cache: "no-store" });
    if (response.ok && raffleEl) {
      const data = await response.json();
      const week = data.week || {};
      if (week.active && week.remainingMs > 0) {
        raffleEl.textContent = `Raffle · ${formatCountdown(week.remainingMs)}`;
      } else if (week.started && !week.active) {
        raffleEl.textContent = "Raffle ended";
      } else {
        raffleEl.textContent = "Raffle closed";
      }
    }
  } catch {
    /* keep the last label */
  }

  try {
    const response = await fetch("/api/points/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok && pointsItem && pointsEl) {
      const data = await response.json();
      const points = Number(data.balance?.points);
      if (Number.isFinite(points)) {
        pointsEl.textContent = `${points.toLocaleString()} UncCoins`;
        pointsItem.classList.remove("is-hidden");
      }
    } else {
      pointsItem?.classList.add("is-hidden");
    }
  } catch {
    pointsItem?.classList.add("is-hidden");
  }
}

if (document.getElementById("player-container")) {
  loadPlayer();
}

if (document.getElementById("live-strip")) {
  loadLiveStrip();
  window.setInterval(loadLiveStrip, 60000);
}
