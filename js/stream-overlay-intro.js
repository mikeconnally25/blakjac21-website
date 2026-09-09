(() => {
  const { startConfigPolling, applySceneCopy, bindCountdown } = window.StreamOverlay;

  const mediaRoot = document.getElementById("so-media");
  let stopCountdown = () => {};
  let clipsKey = "";
  let clipIndex = 0;
  let advanceTimer = null;
  let activeClips = [];
  let clipDurationSec = 14;
  let ytApiReady = null;

  function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (ytApiReady) return ytApiReady;

    ytApiReady = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === "function") previous();
        resolve();
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    });

    return ytApiReady;
  }

  function clearAdvanceTimer() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  }

  function scheduleAdvance(ms) {
    clearAdvanceTimer();
    advanceTimer = setTimeout(() => {
      clipIndex = (clipIndex + 1) % Math.max(activeClips.length, 1);
      playCurrentClip();
    }, ms);
  }

  function showFallback(message) {
    if (!mediaRoot) return;
    mediaRoot.innerHTML = `<div class="so-scene-media-fallback">${message}</div>`;
  }

  function playVideoClip(clip) {
    if (!mediaRoot) return;
    mediaRoot.innerHTML = "";
    const video = document.createElement("video");
    video.src = clip.url;
    video.autoplay = true;
    video.muted = false;
    video.playsInline = true;
    video.controls = false;
    video.addEventListener("ended", () => {
      clipIndex = (clipIndex + 1) % activeClips.length;
      playCurrentClip();
    });
    video.addEventListener("error", () => {
      scheduleAdvance(2500);
    });
    mediaRoot.appendChild(video);
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => scheduleAdvance(2500));
    });
    scheduleAdvance(clipDurationSec * 1000);
  }

  async function playYouTubeClip(clip) {
    if (!mediaRoot || !clip.videoId) {
      showFallback("YouTube clip missing video id.");
      scheduleAdvance(2500);
      return;
    }

    await loadYouTubeApi();
    mediaRoot.innerHTML = "";
    const host = document.createElement("div");
    host.id = "so-yt-player";
    mediaRoot.appendChild(host);

    let advanced = false;
    const advanceOnce = () => {
      if (advanced) return;
      advanced = true;
      clipIndex = (clipIndex + 1) % activeClips.length;
      playCurrentClip();
    };

    // eslint-disable-next-line no-new
    new window.YT.Player("so-yt-player", {
      videoId: clip.videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        fs: 0,
      },
      events: {
        onReady(event) {
          try {
            event.target.unMute();
            event.target.setVolume(85);
            event.target.playVideo();
          } catch {
            // Ignore autoplay restrictions; timer still advances.
          }
          scheduleAdvance(clipDurationSec * 1000);
        },
        onStateChange(event) {
          if (event.data === window.YT.PlayerState.ENDED) {
            advanceOnce();
          }
        },
        onError() {
          scheduleAdvance(2000);
        },
      },
    });
  }

  function playStreamableClip(clip) {
    if (!mediaRoot || !clip.videoId) {
      showFallback("Streamable clip unavailable.");
      scheduleAdvance(2500);
      return;
    }
    mediaRoot.innerHTML = `<iframe src="https://streamable.com/e/${clip.videoId}?autoplay=1" allow="autoplay; fullscreen" allowfullscreen title="Streamable clip"></iframe>`;
    scheduleAdvance(clipDurationSec * 1000);
  }

  function playKickOrLink(clip) {
    showFallback(
      clip.type === "kick"
        ? "Kick clips can’t autoplay reliably in OBS — paste a YouTube or direct .mp4 link instead."
        : "This clip URL isn’t a supported video embed. Use YouTube, Streamable, or a direct .mp4."
    );
    scheduleAdvance(4000);
  }

  function playCurrentClip() {
    clearAdvanceTimer();
    if (!activeClips.length) {
      showFallback("Add clip URLs in the Stream Overlays admin page.");
      return;
    }

    const clip = activeClips[clipIndex % activeClips.length];
    if (!clip) return;

    if (clip.type === "youtube") {
      playYouTubeClip(clip);
      return;
    }
    if (clip.type === "video") {
      playVideoClip(clip);
      return;
    }
    if (clip.type === "streamable") {
      playStreamableClip(clip);
      return;
    }
    playKickOrLink(clip);
  }

  function syncClips(config) {
    const nextClips = (config?.startingSoon?.clips || []).filter((c) => c.enabled !== false);
    const nextKey = JSON.stringify(nextClips.map((c) => [c.id, c.url, c.type]));
    clipDurationSec = Number(config?.startingSoon?.clipDurationSec) || 14;

    if (nextKey === clipsKey) return;
    clipsKey = nextKey;
    activeClips = nextClips;
    clipIndex = 0;
    playCurrentClip();
  }

  startConfigPolling((config) => {
    applySceneCopy(config, "startingSoon");
    stopCountdown();
    stopCountdown = bindCountdown(config?.startingSoon?.goLiveAt);
    syncClips(config);
  });
})();
