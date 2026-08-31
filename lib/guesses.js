import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const GUESSES_FILE = path.join(DATA_DIR, "guesses.json");
const GUESSES_KEY = "gtb:guesses";

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

function sortGuesses(guesses) {
  return [...guesses].sort(
    (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
  );
}

function toPublicGuess(guess) {
  return {
    username: guess.username,
    amount: guess.amount,
    submittedAt: guess.submittedAt,
  };
}

async function readRedisStore() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${GUESSES_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) {
    return { guesses: [] };
  }

  try {
    const parsed = JSON.parse(data.result);
    return { guesses: Array.isArray(parsed.guesses) ? parsed.guesses : [] };
  } catch {
    return { guesses: [] };
  }
}

async function writeRedisStore(store) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(store));
  const response = await fetch(`${config.url}/set/${GUESSES_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return false;

  const data = await response.json();
  return data.result === "OK";
}

async function readFileStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(GUESSES_FILE);
  } catch {
    await fs.writeFile(GUESSES_FILE, JSON.stringify({ guesses: [] }, null, 2));
  }

  const raw = await fs.readFile(GUESSES_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return { guesses: Array.isArray(parsed.guesses) ? parsed.guesses : [] };
}

async function writeFileStore(store) {
  await fs.writeFile(GUESSES_FILE, JSON.stringify(store, null, 2));
}

async function readStore() {
  const redisStore = await readRedisStore();
  if (redisStore) {
    return redisStore;
  }

  if (process.env.VERCEL === "1") {
    return { guesses: [] };
  }

  return readFileStore();
}

async function writeStore(store) {
  if (getRedisConfig()) {
    const saved = await writeRedisStore(store);
    if (!saved) {
      throw new Error("Could not save guesses to Redis.");
    }
    return;
  }

  if (process.env.VERCEL === "1") {
    throw new Error(
      "Guesses need shared storage. Add Upstash Redis in Vercel."
    );
  }

  await writeFileStore(store);
}

export async function listGuesses() {
  const store = await readStore();
  return sortGuesses(store.guesses).map(toPublicGuess);
}

export function getClosestGuesses(guesses, endingBalance, limit = 3) {
  if (endingBalance === null || endingBalance === undefined) {
    return [];
  }

  const target = Number(endingBalance);
  if (!Number.isFinite(target)) {
    return [];
  }

  return [...guesses]
    .map((guess) => ({
      ...guess,
      difference: Math.abs(guess.amount - target),
    }))
    .sort((a, b) => {
      if (a.difference !== b.difference) {
        return a.difference - b.difference;
      }

      return new Date(a.submittedAt) - new Date(b.submittedAt);
    })
    .slice(0, limit)
    .map((entry, index) => ({
      place: index + 1,
      username: entry.username,
      amount: entry.amount,
      difference: Number(entry.difference.toFixed(2)),
    }));
}

export async function saveGuess({ kickUserId, username, amount }) {
  const guess = {
    id: crypto.randomUUID(),
    kickUserId: String(kickUserId),
    username,
    amount: Number(amount.toFixed(2)),
    submittedAt: new Date().toISOString(),
  };

  const store = await readStore();
  const userId = String(kickUserId);
  const existingIndex = store.guesses.findIndex(
    (entry) => entry.kickUserId === userId
  );

  if (existingIndex >= 0) {
    store.guesses[existingIndex] = {
      ...store.guesses[existingIndex],
      username: guess.username,
      amount: guess.amount,
      submittedAt: guess.submittedAt,
    };
  } else {
    store.guesses.push(guess);
  }

  await writeStore(store);

  return toPublicGuess(
    existingIndex >= 0 ? store.guesses[existingIndex] : guess
  );
}
