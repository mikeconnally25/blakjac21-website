function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function setGuessStatus(message, type = "") {
  const status = document.getElementById("guess-status");
  if (!status) return;

  status.textContent = message;
  status.classList.remove("is-hidden", "is-success", "is-error");
  status.classList.toggle("is-success", type === "success");
  status.classList.toggle("is-error", type === "error");

  if (!message) {
    status.classList.add("is-hidden");
  }
}

function initGuessForm() {
  const form = document.getElementById("guess-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = document.getElementById("guess-amount");
    const submitBtn = document.getElementById("guess-submit");
    const amount = Number(input?.value);

    if (!Number.isFinite(amount) || amount < 0) {
      setGuessStatus("Enter a valid balance amount.", "error");
      return;
    }

    submitBtn.disabled = true;
    setGuessStatus("Submitting your guess...");

    try {
      const response = await fetch("/api/guess-the-balance/submit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      const data = await response.json();

      if (!response.ok) {
        setGuessStatus(data.error || "Could not submit your guess.", "error");
        return;
      }

      setGuessStatus(
        `Guess submitted: ${formatCurrency(data.guess.amount)}`,
        "success"
      );
      form.reset();
    } catch {
      setGuessStatus("Could not submit your guess. Try again.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

initGuessForm();
