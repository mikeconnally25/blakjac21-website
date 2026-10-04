let oneVOneIsAdmin = false;
let oneVOneChatters = [];

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
    empty.textContent = side ? "No slot calls right now." : "Waiting for a chatter.";
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

function fillSelect(select, selectedId) {
  if (!select) return;
  const current = selectedId || select.value;
  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = oneVOneChatters.length ? "Choose a chatter" : "No slot calls yet";
  select.appendChild(placeholder);

  for (const chatter of oneVOneChatters) {
    const option = document.createElement("option");
    option.value = chatter.kickUserId;
    option.textContent = `${chatter.username} · ${chatter.callCount}`;
    select.appendChild(option);
  }

  if (current && [...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function renderOneVOne(data) {
  oneVOneIsAdmin = Boolean(data?.isAdmin);
  oneVOneChatters = Array.isArray(data?.chatters) ? data.chatters : [];

  document.getElementById("one-v-one-admin")?.classList.toggle("is-hidden", !oneVOneIsAdmin);

  const leftSelect = document.getElementById("one-v-one-left");
  const rightSelect = document.getElementById("one-v-one-right");
  const editing = document.activeElement === leftSelect || document.activeElement === rightSelect;
  if (oneVOneIsAdmin && !editing) {
    fillSelect(leftSelect, data?.selection?.leftKickUserId);
    fillSelect(rightSelect, data?.selection?.rightKickUserId);
  }

  renderSide(document.getElementById("one-v-one-side-left"), data?.matchup?.left, "Chatter 1");
  renderSide(document.getElementById("one-v-one-side-right"), data?.matchup?.right, "Chatter 2");
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
  const leftKickUserId = document.getElementById("one-v-one-left")?.value || "";
  const rightKickUserId = document.getElementById("one-v-one-right")?.value || "";
  setOneVOneNote("");

  try {
    const response = await fetch("/api/one-v-one/set", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leftKickUserId, rightKickUserId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not set the 1v1.");
    renderOneVOne(data);
    setOneVOneNote("1v1 is live.");
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
