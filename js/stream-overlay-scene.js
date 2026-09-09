(() => {
  const { startConfigPolling, applySceneCopy } = window.StreamOverlay;
  const sceneKey = document.body.dataset.scene || "brb";

  startConfigPolling((config) => {
    applySceneCopy(config, sceneKey);
  });
})();
