import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const GUESSES_FILE = path.join(DATA_DIR, "guesses.json");

async function readStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(GUESSES_FILE);
  } catch {
    await fs.writeFile(GUESSES_FILE, JSON.stringify({ guesses: [] }, null, 2));
  }

  const raw = await fs.readFile(GUESSES_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeStore(store) {
  await fs.writeFile(GUESSES_FILE, JSON.stringify(store, null, 2));
}

export async function saveGuess({ kickUserId, username, amount }) {
  const guess = {
    id: crypto.randomUUID(),
    kickUserId: String(kickUserId),
    username,
    amount: Number(amount.toFixed(2)),
    submittedAt: new Date().toISOString(),
  };

  if (process.env.VERCEL === "1") {
    return guess;
  }

  try {
    const store = await readStore();
    store.guesses.push(guess);
    await writeStore(store);
  } catch {
    // Local storage failed; still accept the submission for the user.
  }

  return guess;
}
