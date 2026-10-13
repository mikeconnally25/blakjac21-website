const params = new URLSearchParams(window.location.search);
const demoMode = params.has("demo");
const headOnly = params.has("head") || window.AVGX_OVERLAY_HEAD === true;
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
const demoHead = {
  status: "open",
  winner: "",
  left: {
    slot: {
      name: "Sweet Bonanza",
      provider: "Pragmatic Play",
      thumbnailUrl: "https://mediumrare.imgix.net/1cabb5679a1c6696240aad6a354d55da7c28b1823f6bd4400c0c12936d2ce688",
    },
    averageX: 2.4,
  },
  right: {
    slot: {
      name: "Gates of Olympus",
      provider: "Pragmatic Play",
      thumbnailUrl: "https://mediumrare.imgix.net/8d65cf820966127b539cf791e750399a35d3f8d9cab99ac3c5e78ca8e0f333b1",
    },
    averageX: 1.15,
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

function formatPrize(pool) {
  const payout = Math.max(0, Math.floor(Number(pool) || 0)) * 2;
  return `Prize · ${payout.toLocaleString("en-US")} UncCoins`;
}

function formatAverage(value) {
  if (value == null || !Number.isFinite(Number(value))) return "Avg —";
  return `${Number(value).toFixed(2)}x`;
}

function setTitle(text) {
  const title = document.querySelector(".ovo-title");
  if (title) title.textContent = text;
}

function renderLogo(logo, name, thumbnailUrl) {
  const initials = slotInitials(name);
  if (thumbnailUrl) {
    const image = document.createElement("img");
    image.src = thumbnailUrl;
    image.alt = "";
    image.addEventListener("error", () => {
      image.remove();
      logo.textContent = initials;
    });
    logo.appendChild(image);
    return;
  }
  logo.textContent = initials;
}

function renderOverlaySide(element, side, seatLabel, pool) {
  if (!element) return;
  element.classList.remove("is-winner");
  element.replaceChildren();

  const seat = document.createElement("p");
  seat.className = "ovo-seat";
  seat.textContent = seatLabel;

  const logo = document.createElement("div");
  logo.className = "ovo-logo";
  const copy = document.createElement("div");
  copy.className = "ovo-copy";
  const name = document.createElement("h2");
  name.className = "ovo-name";
  name.textContent = side?.username || "Open seat";
  copy.append(seat, name);

  const slot = side?.slot;
  if (!slot) {
    logo.textContent = side ? "?" : "—";
    const empty = document.createElement("p");
    empty.className = "ovo-empty";
    empty.textContent = side ? "Request a slot in chat." : "Waiting for a draw.";
    copy.appendChild(empty);
  } else {
    renderLogo(logo, slot.slotName, slot.thumbnailUrl);

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

  const prize = document.createElement("p");
  prize.className = "ovo-prize";
  prize.textContent = formatPrize(pool);
  copy.appendChild(prize);

  element.append(logo, copy);
}

function renderHeadSide(element, side, seatLabel, isWinner) {
  if (!element) return;
  element.classList.toggle("is-winner", Boolean(isWinner));
  element.replaceChildren();

  const slot = side?.slot || null;
  const seat = document.createElement("p");
  seat.className = "ovo-seat";
  seat.textContent = seatLabel;

  const logo = document.createElement("div");
  logo.className = "ovo-logo";
  const copy = document.createElement("div");
  copy.className = "ovo-copy";
  const name = document.createElement("h2");
  name.className = "ovo-name";
  name.textContent = slot?.name || "Open slot";
  copy.append(seat, name);

  if (!slot) {
    logo.textContent = "—";
    const empty = document.createElement("p");
    empty.className = "ovo-empty";
    empty.textContent = "Pick a slot on Average X.";
    copy.appendChild(empty);
  } else {
    renderLogo(logo, slot.name, slot.thumbnailUrl);
    if (slot.provider) {
      const meta = document.createElement("p");
      meta.className = "ovo-meta";
      meta.textContent = slot.provider;
      copy.appendChild(meta);
    }
  }

  const average = document.createElement("p");
  average.className = "ovo-prize";
  average.textContent = formatAverage(side?.averageX);
  copy.appendChild(average);
  element.append(logo, copy);
}

function matchupSignature(matchup, pools) {
  const sideKey = (side) =>
    [side?.username || "", side?.slot?.slotName || "", side?.slot?.provider || "", side?.slot?.thumbnailUrl || ""].join("|");
  const prizeKey = `${Number(pools?.one) || 0}|${Number(pools?.two) || 0}`;
  return `ovo:${sideKey(matchup?.left)}::${sideKey(matchup?.right)}::${prizeKey}`;
}

function headSignature(head) {
  const sideKey = (side) =>
    [side?.slot?.name || "", side?.slot?.provider || "", side?.slot?.thumbnailUrl || "", side?.averageX ?? ""].join("|");
  return `head:${head?.winner || ""}::${sideKey(head?.left)}::${sideKey(head?.right)}`;
}

function headVisible(head) {
  if (!head || head.status === "idle") return false;
  return Boolean(head.left?.slot || head.right?.slot);
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

  const pools = data?.pools || { one: 0, two: 0 };
  const signature = matchupSignature(matchup, pools);
  if (signature === overlaySignature) return;
  overlaySignature = signature;
  setTitle("1v1");
  renderOverlaySide(document.getElementById("ovo-left"), matchup.left, "1", pools.one);
  renderOverlaySide(document.getElementById("ovo-right"), matchup.right, "2", pools.two);
}

function renderHead(head) {
  const widget = document.getElementById("ovo-widget");
  if (!headVisible(head)) {
    if (widget) widget.hidden = true;
    overlaySignature = "";
    return;
  }

  const signature = headSignature(head);
  if (signature === overlaySignature) return;
  overlaySignature = signature;
  if (widget) widget.hidden = false;
  setTitle("AVG X");
  renderHeadSide(document.getElementById("ovo-left"), head.left, "1", head.winner === "left");
  renderHeadSide(document.getElementById("ovo-right"), head.right, "2", head.winner === "right");
}

async function loadHead() {
  const response = await fetch("/api/average-x", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load Average X.");
  if (demoMode && !headVisible(data?.head)) {
    renderHead(demoHead);
    return;
  }
  renderHead(data?.head);
}

async function loadOverlay() {
  if (headOnly) {
    await loadHead();
    return;
  }

  const response = await fetch("/api/one-v-one/status", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load the 1v1.");
  const hasMatch = Boolean(data?.matchup?.left || data?.matchup?.right);
  if (demoMode && !hasMatch) {
    setTitle("1v1");
    renderOverlay({ matchup: demoMatchup, pools: { one: 800, two: 450 } });
    return;
  }
  if (hasMatch) {
    renderOverlay(data);
    return;
  }

  try {
    const averageResponse = await fetch("/api/average-x", { cache: "no-store" });
    if (averageResponse.ok) {
      const average = await averageResponse.json();
      if (headVisible(average?.head)) {
        renderHead(average.head);
        return;
      }
    }
  } catch {
    // A missing Average X response leaves the 1v1 overlay empty.
  }

  renderOverlay(data);
}

loadOverlay().catch(() => {});
window.setInterval(() => {
  loadOverlay().catch(() => {});
}, 3000);
