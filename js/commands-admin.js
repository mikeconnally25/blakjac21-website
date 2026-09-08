(() => {
  const panel = document.getElementById("commands-admin-panel");
  const fieldsRoot = document.getElementById("commands-replies-fields");
  const form = document.getElementById("commands-replies-form");
  const statusEl = document.getElementById("commands-replies-status");
  const resetBtn = document.getElementById("commands-replies-reset");

  let fields = [];
  let replies = {};

  function setStatus(message, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-hidden", !message);
    statusEl.classList.toggle("is-error", tone === "error");
    statusEl.classList.toggle("is-success", tone === "success");
  }

  function renderFields() {
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
      heading.textContent = group;
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
        input.rows = 2;
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

  function collectReplies() {
    const next = {};
    for (const field of fields) {
      const input = document.getElementById(`bot-reply-${field.key}`);
      next[field.key] = (input?.value || "").trim();
    }
    return next;
  }

  async function loadReplies() {
    const response = await fetch("/api/commands/replies", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not load bot replies.");
    }
    fields = data.fields || [];
    replies = data.replies || {};
    renderFields();
  }

  async function initAdmin() {
    if (!panel) return;

    try {
      const me = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store",
      }).then((r) => r.json());

      if (!me?.user?.isAdmin) {
        panel.classList.add("is-hidden");
        return;
      }

      panel.classList.remove("is-hidden");
      await loadReplies();
    } catch (error) {
      panel.classList.add("is-hidden");
      console.error(error);
    }
  }

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
        body: JSON.stringify({ replies: collectReplies() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not save replies.");
      }
      replies = data.replies || collectReplies();
      setStatus("Bot replies saved.", "success");
    } catch (error) {
      setStatus(error.message || "Could not save replies.", "error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  resetBtn?.addEventListener("click", () => {
    if (!window.confirm("Reset all bot replies to the built-in defaults?")) {
      return;
    }
    for (const field of fields) {
      const input = document.getElementById(`bot-reply-${field.key}`);
      if (input) input.value = field.defaultValue || "";
    }
    setStatus("Defaults restored in the form — click Save replies to apply.");
  });

  void initAdmin();
})();
