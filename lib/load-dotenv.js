import fs from "fs";
import path from "path";

const PLACEHOLDER_VALUES = new Set([
  "",
  "[SENSITIVE]",
  "your_stake_access_token",
  "your_stake_token",
]);

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function isPlaceholder(value) {
  const trimmed = String(value || "").trim();
  return PLACEHOLDER_VALUES.has(trimmed);
}

function parseEnvFile(envPath) {
  let raw = fs.readFileSync(envPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }

  const entries = new Map();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = stripQuotes(trimmed.slice(equalsIndex + 1).trim());

    if (key) {
      entries.set(key, value);
    }
  }

  return entries;
}

function applyEntries(entries, { override = false } = {}) {
  for (const [key, value] of entries) {
    if (isPlaceholder(value)) {
      continue;
    }

    if (!override && process.env[key] && !isPlaceholder(process.env[key])) {
      continue;
    }

    process.env[key] = value;
  }
}

export function getProjectRoots(startDir) {
  const roots = [];
  const seen = new Set();

  for (const candidate of [startDir, process.cwd()]) {
    const resolved = path.resolve(candidate);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      roots.push(resolved);
    }
  }

  return roots;
}

export function loadProjectEnv(startDir) {
  const loadedFiles = [];

  for (const root of getProjectRoots(startDir)) {
    for (const name of [".env", ".env.local"]) {
      const envPath = path.join(root, name);
      if (!fs.existsSync(envPath)) {
        continue;
      }

      applyEntries(parseEnvFile(envPath), {
        override: name === ".env.local",
      });
      loadedFiles.push(envPath);
    }
  }

  return loadedFiles;
}

export function readEnvKeyFromFiles(startDir, key) {
  for (const root of getProjectRoots(startDir)) {
    for (const name of [".env", ".env.local"]) {
      const envPath = path.join(root, name);
      if (!fs.existsSync(envPath)) {
        continue;
      }

      const value = parseEnvFile(envPath).get(key);
      if (value && !isPlaceholder(value)) {
        return { envPath, value };
      }
    }
  }

  return null;
}
