let oneVOneIsAdmin = false;

function renderSide(element, side, seatLabel) {
  if (!element) return;
  element.replaceChildren();

  const seat = document.createElement("p");
  seat.className = "one-v-one-seat";
  seat.textContent = seatLabel;

  const heading = document.createElement("h2");
  heading.className = "one-v-one-name";
  heading.textContent = side?.username || "Open seat";

  const list = document.createElement("ul");
  list.className = "one-v-one-calls";

  const slot = side?.slot;
  if (!slot) {
    const empty = document.createElement("li");
    empty.className = "one-v-one-empty";
    empty.textContent = side ? "Request a slot in chat." : "Waiting for a draw.";
    list.appendChild(empty);
  } else {
    const item = document.createElement("li");
    item.className = "one-v-one-pick";

    const logo = document.createElement("div");
    logo.className = "one-v-one-logo";
    const initials = String(slot.slotName || "Slot")
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

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
    title.className = "one-v-one-slot";
    title.textContent = slot.slotName || "Slot";

    item.append(logo, title);
    if (slot.provider) {
      const detail = document.createElement("p");
      detail.className = "one-v-one-meta";
      detail.textContent = slot.provider;
      item.appendChild(detail);
    }
    list.appendChild(item);
  }

  element.append(seat, heading, list);
}

let kickChatSignature = "";

function renderKickChat(messages, matchup) {
  const log = document.getElementById("one-v-one-chat");
  const empty = document.getElementById("one-v-one-chat-empty");
  if (!log) return;

  const items = Array.isArray(messages) ? messages : [];
  const signature = items.map((message) => message.id).join("|");
  empty?.classList.toggle("is-hidden", items.length > 0);
  if (signature === kickChatSignature) return;

  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  kickChatSignature = signature;
  log.replaceChildren();

  const drawn = new Set(
    [matchup?.left?.username, matchup?.right?.username]
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  );

  for (const message of items) {
    const row = document.createElement("article");
    const username = message.username || "viewer";
    row.className = "one-v-one-chat-row";
    if (drawn.has(username.toLowerCase())) row.classList.add("is-drawn");

    const name = document.createElement("span");
    name.className = "one-v-one-chat-name";
    name.textContent = username;

    const text = document.createElement("p");
    text.className = "one-v-one-chat-text";
    text.textContent = message.text || "";

    row.append(name, text);
    log.appendChild(row);
  }

  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function renderOneVOne(data) {
  oneVOneIsAdmin = Boolean(data?.isAdmin);
  document.getElementById("one-v-one-admin")?.classList.toggle("is-hidden", !oneVOneIsAdmin);

  const poolText = document.getElementById("one-v-one-pool-text");
  const poolDot = document.getElementById("one-v-one-pool-dot");
  const entriesToggle = document.getElementById("one-v-one-entries-toggle");
  const entriesOpen = Boolean(data?.entriesOpen);
  if (poolText) {
    const count = Number(data?.entryCount) || 0;
    const label = count === 1 ? "entrant" : "entrants";
    poolText.textContent = entriesOpen
      ? `${count} ${label} · type 1v1 in chat`
      : `${count} ${label} · entries closed`;
    poolDot?.classList.toggle("is-live", entriesOpen);
  }
  if (entriesToggle) entriesToggle.textContent = entriesOpen ? "Close entries" : "Open entries";

  renderSide(document.getElementById("one-v-one-side-left"), data?.matchup?.left, "Left");
  renderSide(document.getElementById("one-v-one-side-right"), data?.matchup?.right, "Right");
  const removeLeft = document.getElementById("one-v-one-remove-left");
  const removeRight = document.getElementById("one-v-one-remove-right");
  if (removeLeft) removeLeft.disabled = !data?.matchup?.left;
  if (removeRight) removeRight.disabled = !data?.matchup?.right;
  renderKickChat(data?.chat, data?.matchup);
}

function setOneVOneNote(message, isError) {
  const note = document.getElementById("one-v-one-admin-note");
  if (!note) return;
  note.textContent = message || "";
  note.classList.toggle("is-error", Boolean(isError));
}

async function loadOneVOne() {
  const response = await fetch("/api/one-v-one/status", { cache: "no-store", credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load the 1v1.");
  renderOneVOne(data);
}

async function saveOneVOne(event) {
  event.preventDefault();
  setOneVOneNote("");
  const count = Number(event.submitter?.value) === 1 ? 1 : 2;

  try {
    const response = await fetch("/api/one-v-one/set", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not draw the 1v1.");
    renderOneVOne(data);
    setOneVOneNote(count === 1 ? "Drew 1 viewer." : "Drew 2 viewers.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

async function removeOneVOne(side) {
  setOneVOneNote("");
  try {
    const response = await fetch("/api/one-v-one/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not remove that viewer.");
    renderOneVOne(data);
    setOneVOneNote(side === "left" ? "Removed the left viewer." : "Removed the right viewer.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

async function clearOneVOne() {
  setOneVOneNote("");
  try {
    const response = await fetch("/api/one-v-one/clear", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not reset the 1v1.");
    renderOneVOne(data);
    setOneVOneNote("1v1 reset.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

async function toggleOneVOneEntries() {
  setOneVOneNote("");
  const open = document.getElementById("one-v-one-entries-toggle")?.textContent !== "Close entries";
  try {
    const response = await fetch("/api/one-v-one/entries", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update entries.");
    renderOneVOne(data);
    setOneVOneNote(open ? "Entries are open. Chat 1v1 to join." : "Entries are closed.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

async function clearOneVOneEntries() {
  setOneVOneNote("");
  try {
    const response = await fetch("/api/one-v-one/entries/clear", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not clear entrants.");
    renderOneVOne(data);
    setOneVOneNote("Entrants cleared.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

document.getElementById("one-v-one-admin")?.addEventListener("submit", saveOneVOne);
document.getElementById("one-v-one-entries-toggle")?.addEventListener("click", toggleOneVOneEntries);
document.getElementById("one-v-one-entries-clear")?.addEventListener("click", clearOneVOneEntries);
document.getElementById("one-v-one-remove-left")?.addEventListener("click", () => removeOneVOne("left"));
document.getElementById("one-v-one-remove-right")?.addEventListener("click", () => removeOneVOne("right"));
document.getElementById("one-v-one-clear")?.addEventListener("click", clearOneVOne);
window.addEventListener("auth:change", () => {
  loadOneVOne().catch((error) => setOneVOneNote(error.message, true));
});

loadOneVOne().catch((error) => setOneVOneNote(error.message, true));
window.setInterval(() => {
  loadOneVOne().catch(() => {});
}, 5000);
