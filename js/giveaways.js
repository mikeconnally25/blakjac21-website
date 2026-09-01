let currentUser = null;
let giveawaysOpen = false;
let pollTimer = null;

function updateToggleLabel() {
  const label = document.getElementById("giveaways-toggle-status");
  const toggle = document.getElementById("giveaways-toggle");

  if (label) {
    label.textContent = giveawaysOpen
      ? "Giveaways are open"
      : "Giveaways are closed";
  }

  if (toggle && currentUser?.isAdmin) {
    toggle.checked = giveawaysOpen;
  }
}

function updatePanels() {
  const adminPanel = document.getElementById("giveaways-admin-panel");
  const empty = document.getElementById("giveaways-empty");
  const openPanel = document.getElementById("giveaways-open");
  const count = document.getElementById("giveaways-count");

  adminPanel?.classList.toggle("is-hidden", !currentUser?.isAdmin);
  empty?.classList.toggle("is-hidden", giveawaysOpen);
  openPanel?.classList.toggle("is-hidden", !giveawaysOpen);

  if (count) {
    count.textContent = giveawaysOpen ? "1 live" : "0 live";
  }
}

function schedulePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(loadGiveawayStatus, 5000);
}

async function loadGiveawayStatus() {
  try {
    const response = await fetch("/api/giveaways/status", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    giveawaysOpen = Boolean(data.open);
    updateToggleLabel();
    updatePanels();
  } catch {
    // Keep the last known state.
  }
}

async function setGiveawaysOpen(open) {
  const response = await fetch("/api/giveaways/toggle", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ open }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not update giveaway status.");
  }

  giveawaysOpen = Boolean(data.open);
  updateToggleLabel();
  updatePanels();
}

function initAdminToggle() {
  const toggle = document.getElementById("giveaways-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    const nextOpen = toggle.checked;

    toggle.disabled = true;

    try {
      await setGiveawaysOpen(nextOpen);
    } catch (error) {
      toggle.checked = !nextOpen;
      window.alert(error.message);
    } finally {
      toggle.disabled = false;
    }
  });
}

window.addEventListener("auth:change", async (event) => {
  currentUser = event.detail?.user || null;
  updateToggleLabel();
  updatePanels();
  await loadGiveawayStatus();
  schedulePolling();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadGiveawayStatus();
  }
});

initAdminToggle();
loadGiveawayStatus();
schedulePolling();
