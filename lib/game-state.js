import fs from "fs/promises";
import path from "path";
import { buildCookie, clearCookie } from "./session.js";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "game-state.json");
const TMP_STATE_FILE = path.join("/tmp", "blakjac21-game-state.json");
const DEFAULT_REPO = "mikeconnally25/blakjac21-website";
const STATE_PATH = "data/game-state.json";
const STATE_COOKIE = "gtb_enabled";
const STATE_KEY = "gtb:state";
const LEGACY_ENABLED_KEY = "gtb:enabled";
const DEFAULT_ROUND_MINUTES = 5;
const MIN_ROUND_MINUTES = 1;
const MAX_ROUND_MINUTES = 120;

const DEFAULT_STATE = {
  enabled: false,
  endingBalance: null,
  endsAt: null,
  roundMinutes: DEFAULT_ROUND_MINUTES,
  affiliatesOnly: false,
  subscribersOnly: false,
};

function normalizeRoundMinutes(value) {
  const minutes = Number(value);

  if (!Number.isFinite(minutes)) {
    return DEFAULT_ROUND_MINUTES;
  }

  return Math.min(
    MAX_ROUND_MINUTES,
    Math.max(MIN_ROUND_MINUTES, Math.round(minutes))
  );
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_STATE };
  }

  const endingBalance = raw.endingBalance;
  const endsAt = raw.endsAt;

  return {
    enabled: Boolean(raw.enabled),
    endingBalance:
      endingBalance === null || endingBalance === undefined
        ? null
        : Number.isFinite(Number(endingBalance))
          ? Number(endingBalance)
          : null,
    endsAt:
      endsAt && !Number.isNaN(Date.parse(endsAt)) ? String(endsAt) : null,
    roundMinutes: normalizeRoundMinutes(raw.roundMinutes),
    affiliatesOnly: Boolean(raw.affiliatesOnly),
    subscribersOnly: Boolean(raw.subscribersOnly),
  };
}

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

  const headers = { Authorization: `Bearer ${config.token}` };

  const response = await fetch(`${config.url}/get/${STATE_KEY}`, {
    headers,
    cache: "no-store",
  });

  if (response.ok) {
    const data = await response.json();
    if (data.result !== null && data.result !== undefined) {
      try {
        return normalizeState(JSON.parse(data.result));
      } catch {
        // Fall through to legacy key.
      }
    }
  }

  const legacyResponse = await fetch(`${config.url}/get/${LEGACY_ENABLED_KEY}`, {
    headers,
    cache: "no-store",
  });

  if (!legacyResponse.ok) return null;

  const legacyData = await legacyResponse.json();
  if (legacyData.result === null || legacyData.result === undefined) return null;

  return normalizeState({ enabled: legacyData.result === "1" });
}

async function writeRedisState(state) {
  const config = getRedisConfig();
  if (!config) return false;

  const payload = encodeURIComponent(JSON.stringify(normalizeState(state)));
  const response = await fetch(`${config.url}/set/${STATE_KEY}/${payload}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

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
    return normalizeState(parsed);
  }

  const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${STATE_PATH}?t=${Date.now()}`;
  const rawResponse = await fetch(rawUrl, { cache: "no-store" });

  if (!rawResponse.ok) {
    throw new Error("remote state fetch failed");
  }

  const parsed = await rawResponse.json();
  return normalizeState(parsed);
}

async function writeRemoteState(state) {
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
  const normalized = normalizeState(state);
  const content = Buffer.from(
    `${JSON.stringify(normalized, null, 2)}\n`
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
      message: `Update Guess the Balance state (${normalized.enabled ? "on" : "off"})`,
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
    return normalizeState(JSON.parse(raw));
  } catch {
    if (process.env.VERCEL === "1") {
      return { ...DEFAULT_STATE };
    }

    try {
      const raw = await fs.readFile(STATE_FILE, "utf8");
      return normalizeState(JSON.parse(raw));
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

  await fs.writeFile(filePath, JSON.stringify(normalizeState(state), null, 2));
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
  const state = normalizeState(await fetchSharedState());

  if (state.enabled && state.endsAt && Date.now() >= Date.parse(state.endsAt)) {
    return persistGameState({
      ...state,
      enabled: false,
      endsAt: null,
    });
  }

  return state;
}

export function getTimeRemainingMs(state) {
  const normalized = normalizeState(state);

  if (!normalized.enabled || !normalized.endsAt) {
    return 0;
  }

  return Math.max(0, Date.parse(normalized.endsAt) - Date.now());
}

export function isGuessTheBalanceEnabled(state) {
  const normalized = normalizeState(state);

  if (!normalized.enabled || !normalized.endsAt) {
    return false;
  }

  return Date.now() < Date.parse(normalized.endsAt);
}

async function persistGameState(nextState) {
  const normalized = normalizeState(nextState);
  memoryState = normalized;

  if (getRedisConfig()) {
    const saved = await writeRedisState(normalized);
    if (!saved) {
      memoryState = null;
      throw new Error("Could not save game state to Redis.");
    }

    return normalized;
  }

  if (process.env.VERCEL === "1") {
    const saved = await writeRemoteState(normalized);
    if (!saved) {
      memoryState = null;
      throw new Error(
        "Game state needs shared storage. Add Upstash Redis in Vercel, or set GITHUB_TOKEN."
      );
    }

    return normalized;
  }

  await writeLocalStateFile(normalized);
  return normalized;
}

export async function setGuessTheBalanceEnabled(enabled, minutes) {
  const current = normalizeState(await fetchSharedState());
  const nextEnabled = Boolean(enabled);

  if (nextEnabled) {
    if (minutes === null || minutes === undefined) {
      throw new Error("Round length is required to start a round.");
    }

    const roundMinutes = normalizeRoundMinutes(minutes);

    return persistGameState({
      ...current,
      enabled: true,
      roundMinutes,
      endsAt: new Date(Date.now() + roundMinutes * 60 * 1000).toISOString(),
      endingBalance: null,
    });
  }

  return persistGameState({
    ...current,
    enabled: false,
    endsAt: null,
    endingBalance: null,
  });
}

export async function setGuessTheBalanceEndingBalance(amount) {
  const current = await fetchSharedState();
  const endingBalance =
    amount === null || amount === undefined ? null : Number(amount);

  return persistGameState({
    ...normalizeState(current),
    endingBalance,
  });
}

export async function setGuessTheBalanceAffiliatesOnly(affiliatesOnly) {
  const current = normalizeState(await fetchSharedState());
  return persistGameState({
    ...current,
    affiliatesOnly: Boolean(affiliatesOnly),
  });
}

export async function setGuessTheBalanceSubscribersOnly(subscribersOnly) {
  const current = normalizeState(await fetchSharedState());
  return persistGameState({
    ...current,
    subscribersOnly: Boolean(subscribersOnly),
  });
}

export function getDefaultRoundMinutes() {
  return DEFAULT_ROUND_MINUTES;
}

export { MAX_ROUND_MINUTES, MIN_ROUND_MINUTES, normalizeRoundMinutes };
