(() => {
  const POLL_MS = 2000;
  let currentUser = null;
  let messages = [];
  let pollTimer = null;
  let sending = false;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text, type = "") {
    const status = $("site-chat-status");
    if (!status) return;

    if (!text) {
      status.textContent = "";
      status.classList.add("is-hidden");
      status.classList.remove("is-error", "is-success");
      return;
    }

    status.textContent = text;
    status.classList.remove("is-hidden", "is-error", "is-success");
    if (type) {
      status.classList.add(`is-${type}`);
    }
  }

  function initials(name) {
    const parts = String(name || "U")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function updateAuthUi() {
    const form = $("site-chat-form");
    const signin = $("site-chat-signin");
    const signedIn = Boolean(currentUser);

    form?.classList.toggle("is-hidden", !signedIn);
    signin?.classList.toggle("is-hidden", signedIn);
  }

  function updateToggleLabel() {
    const root = $("site-chat");
    const toggle = $("site-chat-toggle");
    if (!toggle || !root) return;

    const open = root.classList.contains("is-open");
    toggle.textContent = open ? "Close chat" : "Open chat";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function renderMessages() {
    const list = $("site-chat-messages");
    const empty = $("site-chat-empty");
    if (!list || !empty) return;

    const wasNearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 48;

    list.replaceChildren();
    empty.classList.toggle("is-hidden", messages.length > 0);

    const isAdmin = Boolean(currentUser?.isAdmin);

    for (const message of messages) {
      const row = document.createElement("article");
      row.className = "site-chat-message";
      row.dataset.id = message.id;

      if (message.profilePicture) {
        const avatar = document.createElement("img");
        avatar.className = "site-chat-avatar";
        avatar.src = message.profilePicture;
        avatar.alt = "";
        avatar.width = 30;
        avatar.height = 30;
        avatar.loading = "lazy";
        avatar.referrerPolicy = "no-referrer";
        row.append(avatar);
      } else {
        const avatar = document.createElement("div");
        avatar.className = "site-chat-avatar is-fallback";
        avatar.textContent = initials(message.username);
        row.append(avatar);
      }

      const main = document.createElement("div");
      main.className = "site-chat-message-main";

      const meta = document.createElement("div");
      meta.className = "site-chat-message-meta";

      const username = document.createElement("span");
      username.className = "site-chat-username";
      if (message.isAdmin) {
        username.classList.add("is-admin");
      }
      username.textContent = message.username || "User";

      const time = document.createElement("span");
      time.className = "site-chat-time";
      time.textContent = formatTime(message.createdAt);

      meta.append(username, time);

      const text = document.createElement("p");
      text.className = "site-chat-text";
      text.textContent = message.text;

      main.append(meta, text);
      row.append(main);

      if (isAdmin) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "site-chat-delete";
        removeBtn.title = "Remove message";
        removeBtn.setAttribute("aria-label", "Remove message");
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          void removeMessage(message.id, removeBtn);
        });
        row.append(removeBtn);
      }

      list.append(row);
    }

    if (wasNearBottom || document.activeElement?.id === "site-chat-input") {
      list.scrollTop = list.scrollHeight;
    }
  }

  function messagesUnchanged(next) {
    if (messages.length !== next.length) {
      return false;
    }

    for (let index = 0; index < messages.length; index += 1) {
      const current = messages[index];
      const incoming = next[index];
      if (
        current.id !== incoming.id ||
        current.text !== incoming.text ||
        current.username !== incoming.username
      ) {
        return false;
      }
    }

    return true;
  }

  async function loadMessages() {
    try {
      const response = await fetch("/api/chat", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;

      const data = await response.json();
      const next = Array.isArray(data.messages) ? data.messages : [];
      if (messagesUnchanged(next)) {
        return;
      }

      messages = next;
      renderMessages();
    } catch {
      // Keep last known messages.
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!currentUser || sending) return;

    const input = $("site-chat-input");
    const button = $("site-chat-send");
    const text = input?.value?.trim() || "";
    if (!text) {
      setStatus("Enter a message.", "error");
      return;
    }

    sending = true;
    if (button) button.disabled = true;
    setStatus("Sending...");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not send message.", "error");
        return;
      }

      if (input) input.value = "";
      setStatus("");
      await loadMessages();
      const list = $("site-chat-messages");
      if (list) list.scrollTop = list.scrollHeight;
    } catch {
      setStatus("Could not send message. Try again.", "error");
    } finally {
      sending = false;
      if (button) button.disabled = false;
      input?.focus();
    }
  }

  async function removeMessage(id, button) {
    if (!currentUser?.isAdmin || button?.disabled) return;

    if (button) button.disabled = true;

    try {
      const response = await fetch("/api/chat/remove", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not remove message.", "error");
        return;
      }

      setStatus("Message removed.", "success");
      await loadMessages();
    } catch {
      setStatus("Could not remove message. Try again.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadCurrentUser() {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        currentUser = null;
        return;
      }

      const data = await response.json();
      currentUser = data.authenticated ? data.user : null;
    } catch {
      currentUser = null;
    }
  }

  function schedulePolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    pollTimer = setInterval(() => {
      void loadMessages();
    }, POLL_MS);
  }

  function initToggle() {
    const root = $("site-chat");
    const toggle = $("site-chat-toggle");
    if (!root || !toggle) return;

    toggle.addEventListener("click", () => {
      root.classList.toggle("is-open");
      updateToggleLabel();
    });

    updateToggleLabel();
  }

  function initForm() {
    const form = $("site-chat-form");
    form?.addEventListener("submit", (event) => {
      void sendMessage(event);
    });
  }

  window.addEventListener("auth:change", (event) => {
    currentUser = event.detail?.user || null;
    updateAuthUi();
    renderMessages();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void loadMessages();
    }
  });

  async function bootstrap() {
    if (!$("site-chat")) return;

    initToggle();
    initForm();
    await loadCurrentUser();
    updateAuthUi();
    await loadMessages();
    schedulePolling();
  }

  void bootstrap();
})();
