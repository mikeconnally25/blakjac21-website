let oneVOneIsAdmin = false;

function formatBet(bet) {
  if (bet === null || bet === undefined || Number.isNaN(Number(bet))) return "";
  return `$${Number(bet).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function renderSide(element, side, label) {
  if (!element) return;
  element.replaceChildren();

  const heading = document.createElement("h2");
  heading.className = "one-v-one-name";
  heading.textContent = side?.username || label;

  const list = document.createElement("ul");
  list.className = "one-v-one-calls";

  const calls = side?.calls || [];
  if (!calls.length) {
    const empty = document.createElement("li");
    empty.className = "one-v-one-empty";
    empty.textContent = side ? "No slot calls right now." : "Waiting for a draw.";
    list.appendChild(empty);
  } else {
    for (const call of calls) {
      const item = document.createElement("li");
      item.className = "one-v-one-call";

      if (call.thumbnailUrl) {
        const image = document.createElement("img");
        image.className = "one-v-one-thumb";
        image.src = call.thumbnailUrl;
        image.alt = "";
        item.appendChild(image);
      }

      const copy = document.createElement("div");
      const title = document.createElement("p");
      title.className = "one-v-one-slot";
      title.textContent = call.slotName || "Slot";
      copy.appendChild(title);

      const meta = [call.provider, formatBet(call.bet)].filter(Boolean).join(" · ");
      if (meta) {
        const detail = document.createElement("p");
        detail.className = "one-v-one-meta";
        detail.textContent = meta;
        copy.appendChild(detail);
      }

      item.appendChild(copy);
      list.appendChild(item);
    }
  }

  element.append(heading, list);
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

  const pool = document.getElementById("one-v-one-pool");
  if (pool) {
    const count = Number(data?.activeCount) || 0;
    const minutes = Number(data?.activeMinutes) || 5;
    const label = count === 1 ? "viewer" : "viewers";
    pool.textContent = `${count} active ${label} in the last ${minutes} minutes`;
  }

  renderSide(document.getElementById("one-v-one-side-left"), data?.matchup?.left, "Viewer 1");
  renderSide(document.getElementById("one-v-one-side-right"), data?.matchup?.right, "Viewer 2");
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

  try {
    const response = await fetch("/api/one-v-one/set", {
      method: "POST",
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not draw the 1v1.");
    renderOneVOne(data);
    setOneVOneNote("Drew 2 viewers.");
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
    if (!response.ok) throw new Error(data.error || "Could not clear the 1v1.");
    renderOneVOne(data);
    setOneVOneNote("1v1 cleared.");
  } catch (error) {
    setOneVOneNote(error.message, true);
  }
}

document.getElementById("one-v-one-admin")?.addEventListener("submit", saveOneVOne);
document.getElementById("one-v-one-clear")?.addEventListener("click", clearOneVOne);
window.addEventListener("auth:change", () => {
  loadOneVOne().catch((error) => setOneVOneNote(error.message, true));
});

loadOneVOne().catch((error) => setOneVOneNote(error.message, true));
window.setInterval(() => {
  loadOneVOne().catch(() => {});
}, 5000);
