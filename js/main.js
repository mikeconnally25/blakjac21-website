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
  if (!header || document.getElementById("site-drawer")) return;

  header.querySelector(".menu-subnav")?.remove();

  const tabs = [
    ["/leaderboard/", "Leaderboard"],
    ["/weekly-raffles/", "Weekly Raffles"],
    ["/level-up-rewards/", "Level Up"],
    ["/giveaways/", "Giveaways"],
    ["/guess-the-balance/", "Guess Balance"],
    ["/bonus-hunt/", "Bonus Hunt"],
    ["/average-x/", "Average X"],
    ["/slot-stats/", "Slot Stats"],
    ["/one-v-one/", "1v1"],
    ["/slot-tournaments/", "Tournaments"],
    ["/store/", "Store"],
  ];

  const root = document.createElement("div");
  root.className = "site-drawer";
  root.id = "site-drawer";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "site-drawer-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "site-drawer-panel");
  toggle.innerHTML =
    '<span class="site-drawer-toggle-icon" aria-hidden="true"><span></span><span></span><span></span></span>Menu';

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "site-drawer-backdrop";
  backdrop.tabIndex = -1;
  backdrop.setAttribute("aria-label", "Close menu");

  const panel = document.createElement("nav");
  panel.className = "site-drawer-panel";
  panel.id = "site-drawer-panel";
  panel.setAttribute("aria-label", "Menu");
  panel.setAttribute("aria-hidden", "true");

  const head = document.createElement("div");
  head.className = "site-drawer-head";
  const title = document.createElement("p");
  title.className = "site-drawer-title";
  title.textContent = "Menu";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "site-drawer-close";
  close.textContent = "Close";
  head.append(title, close);

  const list = document.createElement("div");
  list.className = "site-drawer-links";
  const path = window.location.pathname;
  for (const [href, label] of tabs) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    if (path === href || path.startsWith(href)) {
      link.setAttribute("aria-current", "page");
    }
    list.appendChild(link);
  }

  panel.append(head, list);
  root.append(toggle, backdrop, panel);

  const logo = header.querySelector(".nav .logo");
  const navBar = header.querySelector(".nav");
  if (logo) logo.after(toggle);
  else if (navBar) navBar.prepend(toggle);
  else header.prepend(toggle);
  document.body.append(backdrop, panel, root);

  function setOpen(open) {
    const wasOpen = root.classList.contains("is-open");
    root.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-open", open);
    panel.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("site-drawer-open", open);
    if (open) close.focus();
    else if (wasOpen) toggle.focus();
  }

  toggle.addEventListener("click", () => {
    setOpen(!root.classList.contains("is-open"));
  });
  close.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.classList.contains("is-open")) setOpen(false);
  });
  list.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
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

if (document.getElementById("player-container")) {
  loadPlayer();
}
