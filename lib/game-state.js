import fs from "fs/promises";
import path from "path";
import { getCookie, buildCookie } from "./session.js";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "game-state.json");
const TMP_STATE_FILE = path.join("/tmp", "blakjac21-game-state.json");
const DEFAULT_REPO = "mikeconnally25/blakjac21-website";
const STATE_PATH = "data/game-state.json";
const STATE_COOKIE = "gtb_enabled";

const DEFAULT_STATE = {
  enabled: false,
};

let memoryState = null;

function getRepo() {
  return process.env.GITHUB_REPO || DEFAULT_REPO;
}

function getStateFromCookie(req) {
  if (!req) return null;

  const value = getCookie(req, STATE_COOKIE);
  if (value === "1") return { enabled: true };
  if (value === "0") return { enabled: false };
  return null;
}

export function buildGameStateCookie(enabled) {
  return buildCookie(STATE_COOKIE, enabled ? "1" : "0", 60 * 60 * 24);
}

async function fetchRemoteState() {
  const repo = getRepo();
  const url = `https://raw.githubusercontent.com/${repo}/main/${STATE_PATH}?t=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("remote state fetch failed");
  }

  const parsed = await response.json();
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

function useMemoryState() {
  return memoryState !== null;
}

export async function getGuessTheBalanceState(req) {
  const cookieState = getStateFromCookie(req);
  if (cookieState) {
    return { ...cookieState };
  }

  if (useMemoryState()) {
    return { ...memoryState };
  }

  if (process.env.VERCEL === "1") {
    try {
      memoryState = await fetchRemoteState();
      return { ...memoryState };
    } catch {
      try {
        memoryState = await readLocalStateFile();
        return { ...memoryState };
      } catch {
        return { ...DEFAULT_STATE };
      }
    }
  }

  memoryState = await readLocalStateFile();
  return { ...memoryState };
}

export async function setGuessTheBalanceEnabled(enabled) {
  const nextState = { enabled: Boolean(enabled) };
  memoryState = nextState;

  try {
    await writeLocalStateFile(nextState);
  } catch {
    // Local file write is optional on Vercel.
  }

  await writeRemoteState(nextState.enabled);

  return nextState;
}

export function isGuessTheBalanceEnabled(state) {
  return Boolean(state?.enabled);
}
