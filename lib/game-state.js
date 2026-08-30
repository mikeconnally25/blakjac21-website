import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "game-state.json");
const TMP_STATE_FILE = path.join("/tmp", "blakjac21-game-state.json");

const DEFAULT_STATE = {
  enabled: false,
};

let memoryState = null;

function getStateFilePath() {
  return process.env.VERCEL === "1" ? TMP_STATE_FILE : STATE_FILE;
}

async function readStateFile() {
  const filePath = getStateFilePath();

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
    };
  } catch {
    if (process.env.VERCEL !== "1") {
      try {
        const raw = await fs.readFile(STATE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return {
          enabled: Boolean(parsed.enabled),
        };
      } catch {
        return { ...DEFAULT_STATE };
      }
    }

    return { ...DEFAULT_STATE };
  }
}

async function writeStateFile(state) {
  const filePath = getStateFilePath();

  if (process.env.VERCEL !== "1") {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }

  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

export async function getGuessTheBalanceState() {
  if (memoryState) {
    return { ...memoryState };
  }

  memoryState = await readStateFile();
  return { ...memoryState };
}

export async function setGuessTheBalanceEnabled(enabled) {
  memoryState = { enabled: Boolean(enabled) };

  try {
    await writeStateFile(memoryState);
  } catch {
    // Memory state still applies for the current server instance.
  }

  return { ...memoryState };
}

export function isGuessTheBalanceEnabled(state) {
  return Boolean(state?.enabled);
}
