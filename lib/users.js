import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function buildUser(kickProfile, existing = null) {
  const kickUserId = String(kickProfile.user_id);
  const now = new Date().toISOString();

  return {
    kickUserId,
    username: kickProfile.name || kickProfile.username || `user-${kickUserId}`,
    profilePicture: kickProfile.profile_picture || null,
    createdAt: existing?.createdAt || now,
    lastLoginAt: now,
    isNew: !existing,
  };
}

async function readStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
  }

  const raw = await fs.readFile(USERS_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeStore(store) {
  await fs.writeFile(USERS_FILE, JSON.stringify(store, null, 2));
}

export async function upsertKickUser(kickProfile) {
  const kickUserId = String(kickProfile.user_id);

  if (process.env.VERCEL === "1") {
    return buildUser(kickProfile);
  }

  try {
    const store = await readStore();
    const existing = store.users[kickUserId];
    const user = buildUser(kickProfile, existing);
    store.users[kickUserId] = {
      kickUserId: user.kickUserId,
      username: user.username,
      profilePicture: user.profilePicture,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
    await writeStore(store);
    return user;
  } catch {
    return buildUser(kickProfile);
  }
}

export async function getUserByKickId(kickUserId) {
  if (process.env.VERCEL === "1") {
    return null;
  }

  try {
    const store = await readStore();
    return store.users[String(kickUserId)] || null;
  } catch {
    return null;
  }
}
