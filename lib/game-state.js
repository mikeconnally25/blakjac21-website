import fs from "fs/promises";
import path from "path";
import { buildCookie, clearCookie } from "./session.js";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "game-state.json");
const TMP_STATE_FILE = path.join("/tmp", "blakjac21-game-state.json");
const DEFAULT_REPO = "mikeconnally25/blakjac21-website";
const STATE_PATH = "data/game-state.json";
const STATE_COOKIE = "gtb_enabled";
const STATE_KEY = "gtb:enabled";

const DEFAULT_STATE = {
  enabled: false,
};

let memoryState = null;

function getRepo() {
  return process.env.GITHUB_REPO || DEFAULT_REPO;
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url: url.replace(/\/$/, ""), token };
}

export function buildGameStateCookie(enabled) {
  if (enabled) {
    return buildCookie(STATE_COOKIE, "1", 60 * 60 * 24);
  }

  return clearCookie(STATE_COOKIE);
}

async function readRedisState() {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/get/${STATE_KEY}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (data.result === null || data.result === undefined) return null;

  return { enabled: data.result === "1" };
}

async function writeRedisState(enabled) {
  const config = getRedisConfig();
  if (!config) return false;

  const response = await fetch(
    `${config.url}/set/${STATE_KEY}/${enabled ? "1" : "0"}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      cache: "no-store",
    }
  );

  if (!response.ok) return false;

  const data = await response.json();
  return data.result === "OK";
}

async function fetchRemoteState() {
  const repo = getRepo();
  const [owner, name] = repo.split("/");
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${name}/contents/${STATE_PATH}?ref=main`;
  const apiResponse = await fetch(apiUrl, { headers, cache: "no-store" });

  if (apiResponse.ok) {
    const payload = await apiResponse.json();
    const parsed = JSON.parse(
      Buffer.from(payload.content, "base64").toString("utf8")
    );
    return { enabled: Boolean(parsed.enabled) };
  }

  const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${STATE_PATH}?t=${Date.now()}`;
  const rawResponse = await fetch(rawUrl, { cache: "no-store" });

  if (!rawResponse.ok) {
    throw new Error("remote state fetch failed");
  }

  const parsed = await rawResponse.json();
  return { enabled: Boolean(parsed.enabled) };
}

async function writeRemoteState(enabled) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return false;

  const [owner, repo] = getRepo().split("/");
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${STATE_PATH}`;

  const getRes = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!getRes.ok) return false;

  const existing = await getRes.json();
  const content = Buffer.from(
    `${JSON.stringify({ enabled }, null, 2)}\n`
  ).toString("base64");

  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Set Guess the Balance to ${enabled ? "on" : "off"}`,
      content,
      sha: existing.sha,
      branch: "main",
    }),
  });

  return putRes.ok;
}

async function readLocalStateFile() {
  const filePath = process.env.VERCEL === "1" ? TMP_STATE_FILE : STATE_FILE;

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { enabled: Boolean(parsed.enabled) };
  } catch {
    if (process.env.VERCEL === "1") {
      return { ...DEFAULT_STATE };
    }

    try {
      const raw = await fs.readFile(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      return { enabled: Boolean(parsed.enabled) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }
}

async function writeLocalStateFile(state) {
  const filePath = process.env.VERCEL === "1" ? TMP_STATE_FILE : STATE_FILE;

  if (process.env.VERCEL !== "1") {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }

  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

async function fetchSharedState() {
  const redisState = await readRedisState();
  if (redisState) {
    return redisState;
  }

  if (process.env.VERCEL === "1") {
    try {
      return await fetchRemoteState();
    } catch {
      if (memoryState !== null) {
        return { ...memoryState };
      }

      return { ...DEFAULT_STATE };
    }
  }

  if (memoryState !== null) {
    return { ...memoryState };
  }

  return readLocalStateFile();
}

export async function getGuessTheBalanceState() {
  return fetchSharedState();
}

export async function setGuessTheBalanceEnabled(enabled) {
  const nextState = { enabled: Boolean(enabled) };
  memoryState = nextState;

  if (getRedisConfig()) {
    const saved = await writeRedisState(nextState.enabled);
    if (!saved) {
      memoryState = null;
      throw new Error("Could not save guessing status to Redis.");
    }

    return nextState;
  }

  if (process.env.VERCEL === "1") {
    const saved = await writeRemoteState(nextState.enabled);
    if (!saved) {
      memoryState = null;
      throw new Error(
        "Guessing toggle needs shared storage. Add Upstash Redis in Vercel, or set GITHUB_TOKEN."
      );
    }

    return nextState;
  }

  await writeLocalStateFile(nextState);
  return nextState;
}

export function isGuessTheBalanceEnabled(state) {
  return Boolean(state?.enabled);
}
