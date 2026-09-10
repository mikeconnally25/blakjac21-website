(() => {
  let currentUser = null;
  let config = null;
  let clips = [];
  let uploadMode = "local";
  let uploadBusy = false;
  let blobUploadFn = null;

  const SOURCES = [
    {
      id: "starting-soon",
      title: "Starting Soon",
      path: "/overlay/starting-soon/source.html",
      size: "1920 × 1080",
      note: "Full-screen intro with rotating clip URLs.",
    },
    {
      id: "brb",
      title: "BRB",
      path: "/overlay/brb/source.html",
      size: "1920 × 1080",
      note: "Be right back scene.",
    },
    {
      id: "ending",
      title: "Ending",
      path: "/overlay/ending/source.html",
      size: "1920 × 1080",
      note: "Thanks for watching outro.",
    },
    {
      id: "intermission",
      title: "Intermission",
      path: "/overlay/intermission/source.html",
      size: "1920 × 1080",
      note: "Short break scene.",
    },
    {
      id: "hud",
      title: "In-stream HUD",
      path: "/overlay/hud/source.html",
      size: "1920 × 1080",
      note: "Transparent LIVE badge, corners, socials, ticker.",
    },
    {
      id: "alerts",
      title: "Alerts",
      path: "/overlay/alerts/source.html",
      size: "1920 × 1080",
      note: "Sub / resub / gift popups (transparent).",
    },
  ];

  const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v)$/i;
  const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message, isError = false) {
    const el = $("overlay-status");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError));
  }

  function absoluteUrl(path) {
    return new URL(path, window.location.origin).href;
  }

  function sanitizeUploadName(name) {
    const base = String(name || "clip.mp4").split(/[/\\]/).pop() || "clip.mp4";
    return base.replace(/[^\w.\-()+ ]+/g, "_").replace(/\s+/g, "-").slice(0, 80) || "clip.mp4";
  }

  function isVideoFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith("video/")) return true;
    return VIDEO_EXTENSIONS.test(file.name || "");
  }

  function addClipUrl(url, label = "") {
    clips.push({
      id: crypto.randomUUID(),
      url,
      type: "video",
      label,
      enabled: true,
    });
    renderClips();
  }

  async function loadBlobUpload() {
    if (blobUploadFn) return blobUploadFn;
    const mod = await import("https://esm.sh/@vercel/blob@2.8.0/client");
    if (typeof mod.upload !== "function") {
      throw new Error("Could not load Blob uploader.");
    }
    blobUploadFn = mod.upload;
    return blobUploadFn;
  }

  async function refreshUploadMode() {
    try {
      const response = await fetch("/api/stream-overlay/clip-upload", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      uploadMode = data.mode || "local";
    } catch {
      uploadMode = "local";
    }
  }

  async function uploadLocalFile(file) {
    const response = await fetch(
      `/api/stream-overlay/clip-upload?filename=${encodeURIComponent(file.name || "clip.mp4")}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": file.type || "video/mp4",
        },
        body: file,
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }
    return data.url;
  }

  async function uploadBlobFile(file) {
    const upload = await loadBlobUpload();
    const pathname = `starting-soon/${Date.now()}-${sanitizeUploadName(file.name)}`;
    const result = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/stream-overlay/clip-upload",
      multipart: file.size > 8 * 1024 * 1024,
      contentType: file.type || "video/mp4",
    });
    return result.url;
  }

  async function uploadClipFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;

    if (uploadMode === "unavailable") {
      setStatus(
        "Connect Vercel Blob in the Vercel dashboard (BLOB_READ_WRITE_TOKEN) to upload clips.",
        true
      );
      return;
    }

    const videos = files.filter(isVideoFile);
    if (!videos.length) {
      setStatus("Drop MP4 / WebM / MOV video files only.", true);
      return;
    }

    const tooBig = videos.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (tooBig) {
      setStatus(`${tooBig.name} is over 150MB.`, true);
      return;
    }

    uploadBusy = true;
    $("overlay-clip-dropzone")?.classList.add("is-uploading");

    try {
      for (let index = 0; index < videos.length; index += 1) {
        const file = videos[index];
        setStatus(`Uploading ${file.name} (${index + 1}/${videos.length})…`);
        const url =
          uploadMode === "blob" ? await uploadBlobFile(file) : await uploadLocalFile(file);
        addClipUrl(url, file.name);
      }
      setStatus(
        videos.length === 1
          ? "Clip uploaded — hit Save to push it live."
          : `${videos.length} clips uploaded — hit Save to push them live.`
      );
    } catch (error) {
      setStatus(error.message || "Upload failed.", true);
    } finally {
      uploadBusy = false;
      $("overlay-clip-dropzone")?.classList.remove("is-uploading");
      const input = $("field-clip-file");
      if (input) input.value = "";
    }
  }

  function bindDropzone() {
    const zone = $("overlay-clip-dropzone");
    const input = $("field-clip-file");
    if (!zone || !input) return;

    const setDragging = (on) => zone.classList.toggle("is-dragging", on);

    zone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      setDragging(true);
    });
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      setDragging(true);
    });
    zone.addEventListener("dragleave", (event) => {
      if (event.target === zone) setDragging(false);
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      setDragging(false);
      if (uploadBusy) return;
      void uploadClipFiles(event.dataTransfer?.files);
    });

    input.addEventListener("change", () => {
      if (uploadBusy) return;
      void uploadClipFiles(input.files);
    });
  }

  function renderSources() {
    const root = $("overlay-sources");
    if (!root) return;

    root.innerHTML = SOURCES.map((source) => {
      const url = absoluteUrl(source.path);
      return `
        <article class="stream-overlay-source" data-source="${source.id}">
          <h3>${source.title}</h3>
          <p>${source.note} OBS size: <strong>${source.size}</strong></p>
          <div class="stream-overlay-source-row">
            <input type="text" readonly value="${url}" aria-label="${source.title} URL" />
            <button type="button" class="btn btn-sm btn-outline" data-copy="${url}">Copy</button>
            <a class="btn btn-sm btn-outline" href="${source.path}" target="_blank" rel="noopener">Open</a>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderPreviewTabs() {
    const tabs = $("overlay-preview-tabs");
    if (!tabs) return;
    tabs.innerHTML = SOURCES.map(
      (source, index) =>
        `<button type="button" data-preview="${source.path}" class="${index === 0 ? "is-active" : ""}">${source.title}</button>`
    ).join("");
  }

  function setPreview(path) {
    const frame = $("overlay-preview-frame");
    if (frame) frame.src = path;
    document.querySelectorAll("[data-preview]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-preview") === path);
    });
  }

  function fillForm(next) {
    config = next;
    clips = Array.isArray(next.startingSoon?.clips)
      ? next.startingSoon.clips.map((c) => ({ ...c }))
      : [];

    $("field-brand").value = next.brandName || "";
    $("field-tagline").value = next.tagline || "";
    $("field-kick").value = next.socials?.kick || "";
    $("field-twitter").value = next.socials?.twitter || "";
    $("field-youtube").value = next.socials?.youtube || "";
    $("field-discord").value = next.socials?.discord || "";

    $("field-ss-headline").value = next.startingSoon?.headline || "";
    $("field-ss-sub").value = next.startingSoon?.subheadline || "";
    $("field-ss-duration").value = next.startingSoon?.clipDurationSec || 14;
    $("field-ss-golive").value = next.startingSoon?.goLiveAt
      ? next.startingSoon.goLiveAt.slice(0, 16)
      : "";

    $("field-brb-headline").value = next.brb?.headline || "";
    $("field-brb-sub").value = next.brb?.subheadline || "";
    $("field-ending-headline").value = next.ending?.headline || "";
    $("field-ending-sub").value = next.ending?.subheadline || "";
    $("field-inter-headline").value = next.intermission?.headline || "";
    $("field-inter-sub").value = next.intermission?.subheadline || "";

    $("field-hud-ticker").value = next.hud?.tickerText || "";
    $("field-hud-live").checked = next.hud?.showLiveBadge === true;
    $("field-hud-socials").checked = next.hud?.showSocials === true;
    $("field-hud-corners").checked = next.hud?.showCorners !== false;

    $("field-alerts-enabled").checked = next.alerts?.enabled !== false;
    $("field-alerts-duration").value = next.alerts?.durationMs || 6500;
    $("field-alerts-sub").value = next.alerts?.subMessage || "";
    $("field-alerts-resub").value = next.alerts?.resubMessage || "";
    $("field-alerts-gift").value = next.alerts?.giftMessage || "";

    renderClips();
  }

  function renderClips() {
    const list = $("overlay-clip-list");
    if (!list) return;

    if (!clips.length) {
      list.innerHTML =
        '<p class="stream-overlay-panel-lead">No clips yet. Drop an MP4 above or paste a YouTube / Streamable / .mp4 URL.</p>';
      return;
    }

    list.innerHTML = clips
      .map(
        (clip, index) => `
      <article class="stream-overlay-clip">
        <div class="stream-overlay-clip-meta">
          <span class="stream-overlay-clip-type">${clip.type || "link"}</span>
          <label class="stream-overlay-check">
            <input type="checkbox" data-clip-enabled="${index}" ${clip.enabled !== false ? "checked" : ""} />
            Enabled
          </label>
          <button type="button" class="btn btn-sm btn-outline" data-clip-remove="${index}">Remove</button>
        </div>
        <div class="stream-overlay-clip-url">${clip.label ? `${clip.label} · ` : ""}${clip.url}</div>
      </article>
    `
      )
      .join("");
  }

  function readFormConfig() {
    const goLiveRaw = $("field-ss-golive").value;
    return {
      brandName: $("field-brand").value,
      tagline: $("field-tagline").value,
      socials: {
        kick: $("field-kick").value,
        twitter: $("field-twitter").value,
        youtube: $("field-youtube").value,
        discord: $("field-discord").value,
      },
      startingSoon: {
        headline: $("field-ss-headline").value,
        subheadline: $("field-ss-sub").value,
        clipDurationSec: Number($("field-ss-duration").value) || 14,
        goLiveAt: goLiveRaw ? new Date(goLiveRaw).toISOString() : null,
        clips,
      },
      brb: {
        headline: $("field-brb-headline").value,
        subheadline: $("field-brb-sub").value,
      },
      ending: {
        headline: $("field-ending-headline").value,
        subheadline: $("field-ending-sub").value,
      },
      intermission: {
        headline: $("field-inter-headline").value,
        subheadline: $("field-inter-sub").value,
      },
      hud: {
        tickerText: $("field-hud-ticker").value,
        showLiveBadge: $("field-hud-live").checked,
        showSocials: $("field-hud-socials").checked,
        showCorners: $("field-hud-corners").checked,
      },
      alerts: {
        enabled: $("field-alerts-enabled").checked,
        durationMs: Number($("field-alerts-duration").value) || 6500,
        subMessage: $("field-alerts-sub").value,
        resubMessage: $("field-alerts-resub").value,
        giftMessage: $("field-alerts-gift").value,
      },
    };
  }

  async function loadConfig() {
    const response = await fetch("/api/stream-overlay", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load overlay config.");
    const data = await response.json();
    fillForm(data.config);
  }

  async function saveConfig() {
    setStatus("Saving…");
    const response = await fetch("/api/stream-overlay/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ config: readFormConfig() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Save failed.");
    }
    fillForm(data.config);
    setStatus("Saved. Previews and OBS sources will update shortly.");
    const frame = $("overlay-preview-frame");
    if (frame?.src) frame.src = frame.src;
  }

  async function testAlert(type) {
    const response = await fetch("/api/stream-overlay/alerts/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ type }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Test alert failed.");
    }
    setStatus(`Queued ${type} alert — watch the Alerts preview / OBS source.`);
    setPreview("/overlay/alerts/source.html");
  }

  function updateAccess() {
    const isAdmin = Boolean(currentUser?.isAdmin);
    $("overlay-denied")?.classList.toggle("is-hidden", isAdmin);
    $("overlay-content")?.classList.toggle("is-hidden", !isAdmin);
    $("overlay-admin")?.classList.toggle("is-hidden", !isAdmin);
    if (isAdmin) {
      void refreshUploadMode();
    }
  }

  function onAuthChange(event) {
    currentUser = event.detail?.user || null;
    updateAccess();
  }

  document.addEventListener("auth:change", onAuthChange);

  document.addEventListener("click", async (event) => {
    const copyBtn = event.target.closest("[data-copy]");
    if (copyBtn) {
      const url = copyBtn.getAttribute("data-copy");
      try {
        await navigator.clipboard.writeText(url);
        setStatus("Copied OBS URL.");
      } catch {
        setStatus("Could not copy — select the URL manually.", true);
      }
      return;
    }

    const previewBtn = event.target.closest("[data-preview]");
    if (previewBtn) {
      setPreview(previewBtn.getAttribute("data-preview"));
      return;
    }

    const removeBtn = event.target.closest("[data-clip-remove]");
    if (removeBtn) {
      const index = Number(removeBtn.getAttribute("data-clip-remove"));
      clips.splice(index, 1);
      renderClips();
      return;
    }
  });

  document.addEventListener("change", (event) => {
    const enabled = event.target.closest("[data-clip-enabled]");
    if (enabled) {
      const index = Number(enabled.getAttribute("data-clip-enabled"));
      if (clips[index]) clips[index].enabled = enabled.checked;
    }
  });

  $("overlay-add-clip")?.addEventListener("click", () => {
    const input = $("field-clip-url");
    const url = input?.value?.trim();
    if (!url) {
      setStatus("Paste a clip URL first.", true);
      return;
    }

    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      setStatus("That doesn’t look like a valid URL.", true);
      return;
    }

    if (host === "kick.com" || host.endsWith(".kick.com")) {
      setStatus(
        "Kick clip links can’t autoplay in OBS. Drop an MP4 instead, or use YouTube / Streamable.",
        true
      );
      return;
    }

    clips.push({
      id: crypto.randomUUID(),
      url,
      label: "",
      enabled: true,
    });
    input.value = "";
    renderClips();
    setStatus("Clip added — hit Save to push it live.");
  });

  $("overlay-save")?.addEventListener("click", async () => {
    try {
      await saveConfig();
    } catch (error) {
      setStatus(error.message || "Save failed.", true);
    }
  });

  $("overlay-test-sub")?.addEventListener("click", async () => {
    try {
      await testAlert("sub");
    } catch (error) {
      setStatus(error.message || "Test failed.", true);
    }
  });

  $("overlay-test-gift")?.addEventListener("click", async () => {
    try {
      await testAlert("gift");
    } catch (error) {
      setStatus(error.message || "Test failed.", true);
    }
  });

  bindDropzone();
  renderSources();
  renderPreviewTabs();
  setPreview(SOURCES[0].path);

  loadConfig()
    .then(() => setStatus("Config loaded."))
    .catch((error) => setStatus(error.message || "Could not load config.", true));

  // auth.js may have already resolved before this listener attached
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
})();
