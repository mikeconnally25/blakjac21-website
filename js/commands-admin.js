(() => {
  const panel = document.getElementById("commands-admin-panel");
  const fieldsRoot = document.getElementById("commands-replies-fields");
  const triggerRoot = document.getElementById("commands-trigger-fields");
  const customRoot = document.getElementById("commands-custom-fields");
  const form = document.getElementById("commands-replies-form");
  const statusEl = document.getElementById("commands-replies-status");
  const resetBtn = document.getElementById("commands-replies-reset");
  const addCustomBtn = document.getElementById("commands-custom-add");

  let fields = [];
  let triggerFields = [];
  let replies = {};
  let triggers = {};
  let customCommands = [];
  let defaults = { replies: {}, triggers: {} };

  function setStatus(message, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-hidden", !message);
    statusEl.classList.toggle("is-error", tone === "error");
    statusEl.classList.toggle("is-success", tone === "success");
  }

  function newCustomId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function renderTriggers() {
    if (!triggerRoot) return;
    triggerRoot.replaceChildren();

    for (const field of triggerFields) {
      const wrap = document.createElement("div");
      wrap.className = "bonus-field commands-reply-field";

      const label = document.createElement("label");
      label.className = "guess-label";
      label.setAttribute("for", `bot-trigger-${field.key}`);
      label.textContent = field.label;

      const input = document.createElement("input");
      input.className = "guess-input";
      input.id = `bot-trigger-${field.key}`;
      input.name = `trigger-${field.key}`;
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.placeholder = field.defaultValue || "!command";
      const value = triggers[field.key];
      input.value = Array.isArray(value)
        ? value.join(", ")
        : value || field.defaultValue || "";

      wrap.append(label);
      if (field.description) {
        const hint = document.createElement("p");
        hint.className = "admin-panel-text";
        hint.textContent = field.description;
        wrap.append(hint);
      }
      wrap.append(input);
      triggerRoot.append(wrap);
    }
  }

  function renderCustomCommands() {
    if (!customRoot) return;
    customRoot.replaceChildren();

    if (!customCommands.length) {
      const empty = document.createElement("p");
      empty.className = "admin-panel-text";
      empty.textContent = "No custom commands yet.";
      customRoot.append(empty);
      return;
    }

    customCommands.forEach((command, index) => {
      const row = document.createElement("div");
      row.className = "commands-custom-row";
      row.dataset.id = command.id;

      const triggerField = document.createElement("div");
      triggerField.className = "bonus-field";
      const triggerLabel = document.createElement("label");
      triggerLabel.className = "guess-label";
      triggerLabel.textContent = "Trigger";
      const triggerInput = document.createElement("input");
      triggerInput.className = "guess-input";
      triggerInput.type = "text";
      triggerInput.value = command.trigger || "";
      triggerInput.placeholder = "!discord";
      triggerInput.dataset.role = "trigger";
      triggerField.append(triggerLabel, triggerInput);

      const replyField = document.createElement("div");
      replyField.className = "bonus-field";
      const replyLabel = document.createElement("label");
      replyLabel.className = "guess-label";
      replyLabel.textContent = "Reply";
      const replyInput = document.createElement("textarea");
      replyInput.className = "guess-input commands-reply-input";
      replyInput.rows = 1;
      replyInput.maxLength = 400;
      replyInput.value = command.reply || "";
      replyInput.placeholder = "Join the Discord: …";
      replyInput.dataset.role = "reply";
      replyField.append(replyLabel, replyInput);

      const actions = document.createElement("div");
      actions.className = "commands-custom-row-actions";
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-sm btn-outline";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        customCommands = customCommands.filter((entry) => entry.id !== command.id);
        renderCustomCommands();
      });
      actions.append(removeBtn);

      row.append(triggerField, replyField, actions);
      customRoot.append(row);

      triggerInput.addEventListener("input", () => {
        customCommands[index].trigger = triggerInput.value;
      });
      replyInput.addEventListener("input", () => {
        customCommands[index].reply = replyInput.value;
      });
    });
  }

  function renderReplyFields() {
    if (!fieldsRoot) return;
    fieldsRoot.replaceChildren();

    const groups = new Map();
    for (const field of fields) {
      const group = field.group || "Other";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(field);
    }

    for (const [group, groupFields] of groups) {
      const section = document.createElement("div");
      section.className = "commands-replies-group";

      const heading = document.createElement("p");
      heading.className = "admin-panel-label";
      heading.textContent = `${group} replies`;
      section.append(heading);

      for (const field of groupFields) {
        const wrap = document.createElement("div");
        wrap.className = "bonus-field commands-reply-field";

        const label = document.createElement("label");
        label.className = "guess-label";
        label.setAttribute("for", `bot-reply-${field.key}`);
        label.textContent = field.label;

        const input = document.createElement("textarea");
        input.className = "guess-input commands-reply-input";
        input.id = `bot-reply-${field.key}`;
        input.name = field.key;
        input.rows = 1;
        input.maxLength = 400;
        input.value = replies[field.key] || field.defaultValue || "";

        wrap.append(label);
        if (field.description) {
          const hint = document.createElement("p");
          hint.className = "admin-panel-text";
          hint.textContent = field.description;
          wrap.append(hint);
        }
        wrap.append(input);
        section.append(wrap);
      }

      fieldsRoot.append(section);
    }
  }

  function collectTriggers() {
    const next = {};
    for (const field of triggerFields) {
      const input = document.getElementById(`bot-trigger-${field.key}`);
      next[field.key] = (input?.value || "")
        .split(/[,\n]+/)
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return next;
  }

  function collectReplies() {
    const next = {};
    for (const field of fields) {
      const input = document.getElementById(`bot-reply-${field.key}`);
      next[field.key] = (input?.value || "").trim();
    }
    return next;
  }

  function collectCustomCommands() {
    if (!customRoot) return [];
    return [...customRoot.querySelectorAll(".commands-custom-row")].map((row) => ({
      id: row.dataset.id,
      trigger: row.querySelector('[data-role="trigger"]')?.value || "",
      reply: row.querySelector('[data-role="reply"]')?.value || "",
      enabled: true,
    }));
  }

  function renderAll() {
    renderTriggers();
    renderCustomCommands();
    renderReplyFields();
  }

  async function loadReplies() {
    const response = await fetch("/api/commands/replies", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not load bot commands.");
    }
    fields = data.fields || [];
    triggerFields = data.triggerFields || [];
    replies = data.replies || {};
    triggers = data.triggers || {};
    customCommands = Array.isArray(data.customCommands)
      ? data.customCommands.map((entry) => ({ ...entry }))
      : [];
    defaults = data.defaults || { replies: {}, triggers: {} };
    renderAll();
  }

  async function initAdmin() {
    const content = document.getElementById("commands-content");
    const denied = document.getElementById("commands-denied");

    try {
      const me = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store",
      }).then((r) => r.json());

      const isAdmin = Boolean(me?.user?.isAdmin);
      denied?.classList.toggle("is-hidden", isAdmin);
      content?.classList.toggle("is-hidden", !isAdmin);

      if (!isAdmin) {
        panel?.classList.add("is-hidden");
        return;
      }

      if (panel) panel.classList.remove("is-hidden");
      await loadReplies();
    } catch (error) {
      denied?.classList.remove("is-hidden");
      content?.classList.add("is-hidden");
      panel?.classList.add("is-hidden");
      console.error(error);
    }
  }

  addCustomBtn?.addEventListener("click", () => {
    customCommands.push({
      id: newCustomId(),
      trigger: "!",
      reply: "",
      enabled: true,
    });
    renderCustomCommands();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveBtn = document.getElementById("commands-replies-save");
    if (saveBtn) saveBtn.disabled = true;
    setStatus("Saving…");

    try {
      const response = await fetch("/api/commands/replies", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replies: collectReplies(),
          triggers: collectTriggers(),
          customCommands: collectCustomCommands(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not save commands.");
      }
      replies = data.replies || collectReplies();
      triggers = data.triggers || collectTriggers();
      customCommands = Array.isArray(data.customCommands)
        ? data.customCommands.map((entry) => ({ ...entry }))
        : collectCustomCommands();
      renderAll();
      setStatus("Bot commands saved.", "success");
    } catch (error) {
      setStatus(error.message || "Could not save commands.", "error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  resetBtn?.addEventListener("click", () => {
    if (
      !window.confirm(
        "Reset built-in triggers and replies to defaults? Custom commands will be kept."
      )
    ) {
      return;
    }

    replies = { ...(defaults.replies || {}) };
    triggers = {
      slot: [...(defaults.triggers?.slot || [])],
      points: [...(defaults.triggers?.points || [])],
      pointsAll: [...(defaults.triggers?.pointsAll || [])],
    };
    renderAll();
    setStatus("Defaults restored in the form — click Save commands to apply.");
  });

  void initAdmin();
})();
