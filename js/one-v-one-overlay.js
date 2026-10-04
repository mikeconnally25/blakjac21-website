const demoMode = new URLSearchParams(window.location.search).has("demo");
const demoMatchup = {
  left: {
    username: "alice",
    slot: {
      slotName: "Sweet Bonanza",
      provider: "Pragmatic Play",
      thumbnailUrl: "https://mediumrare.imgix.net/1cabb5679a1c6696240aad6a354d55da7c28b1823f6bd4400c0c12936d2ce688",
    },
  },
  right: {
    username: "bob",
    slot: {
      slotName: "Gates of Olympus",
      provider: "Pragmatic Play",
      thumbnailUrl: "https://mediumrare.imgix.net/8d65cf820966127b539cf791e750399a35d3f8d9cab99ac3c5e78ca8e0f333b1",
    },
  },
};

let overlaySignature = "";

function slotInitials(name) {
  return String(name || "Slot")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function renderOverlaySide(element, side) {
  if (!element) return;
  element.replaceChildren();

  const logo = document.createElement("div");
  logo.className = "ovo-logo";
  const copy = document.createElement("div");
  copy.className = "ovo-copy";
  const name = document.createElement("h2");
  name.className = "ovo-name";
  name.textContent = side?.username || "Open seat";
  copy.appendChild(name);

  const slot = side?.slot;
  if (!slot) {
    logo.textContent = side ? "?" : "—";
    const empty = document.createElement("p");
    empty.className = "ovo-empty";
    empty.textContent = side ? "Request a slot in chat." : "Waiting for a draw.";
    copy.appendChild(empty);
  } else {
    const initials = slotInitials(slot.slotName);
    if (slot.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = slot.thumbnailUrl;
      image.alt = "";
      image.addEventListener("error", () => {
        image.remove();
        logo.textContent = initials;
      });
      logo.appendChild(image);
    } else {
      logo.textContent = initials;
    }

    const title = document.createElement("p");
    title.className = "ovo-slot";
    title.textContent = slot.slotName || "Slot";
    copy.appendChild(title);

    if (slot.provider) {
      const meta = document.createElement("p");
      meta.className = "ovo-meta";
      meta.textContent = slot.provider;
      copy.appendChild(meta);
    }
  }

  element.append(logo, copy);
}

function matchupSignature(matchup) {
  const sideKey = (side) =>
    [side?.username || "", side?.slot?.slotName || "", side?.slot?.provider || "", side?.slot?.thumbnailUrl || ""].join("|");
  return `${sideKey(matchup?.left)}::${sideKey(matchup?.right)}`;
}

function renderOverlay(data) {
  const widget = document.getElementById("ovo-widget");
  const matchup = data?.matchup;
  const hasMatch = Boolean(matchup?.left || matchup?.right);
  if (widget) widget.hidden = !hasMatch;
  if (!hasMatch) {
    overlaySignature = "";
    return;
  }

  const signature = matchupSignature(matchup);
  if (signature === overlaySignature) return;
  overlaySignature = signature;
  renderOverlaySide(document.getElementById("ovo-left"), matchup.left);
  renderOverlaySide(document.getElementById("ovo-right"), matchup.right);
}

async function loadOverlay() {
  const response = await fetch("/api/one-v-one/status", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load the 1v1.");
  if (demoMode && !data?.matchup?.left && !data?.matchup?.right) {
    renderOverlay({ matchup: demoMatchup });
    return;
  }
  renderOverlay(data);
}

loadOverlay().catch(() => {});
window.setInterval(() => {
  loadOverlay().catch(() => {});
}, 3000);
