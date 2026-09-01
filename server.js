import { loadProjectEnv } from "./lib/load-dotenv.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  handleCallback,
  handleLogin,
  handleLogout,
  handleMe,
} from "./lib/auth-handlers.js";
import {
  handleBonusHuntAdd,
  handleBonusHuntClear,
  handleBonusHuntGet,
  handleBonusHuntSettings,
  handleBonusHuntRemove,
  handleBonusHuntUpdate,
  handleBonusHuntRequestRemove,
  handleBonusHuntRequestBet,
  handleBonusHuntRequestSubmit,
  handleBonusHuntRequestsClear,
  handleBonusHuntRequestsList,
  handleBonusHuntRequestsToggle,
  handleBonusHuntSlots,
  handleBonusHuntSlotsRefresh,
  handleBonusHuntSlotsImport,
  handleBonusHuntSlotsSyncToken,
  handleBonusHuntSlotsSyncStatus,
  handleBonusHuntSlotsImportSync,
  handleKickChatSubscribe,
  handleKickChatStatus,
  handleKickTestSlotCommand,
} from "./lib/bonus-hunt-handlers.js";
import { handleKickWebhook } from "./lib/kick-webhook.js";
import { handleKickBotLogin, handleKickBotStatus } from "./lib/kick-bot-auth-handlers.js";
import { handleKickCredentialsCheck } from "./lib/kick-credentials-check.js";
import { handleKickSetupStatus } from "./lib/kick-setup-status.js";
import {
  handleGuessStatus,
  handleGuessList,
  handleGuessSetEndingBalance,
  handleGuessSubmit,
  handleGuessToggle,
} from "./lib/guess-handlers.js";
import { handleLeaderboardGet } from "./lib/leaderboard-handlers.js";
import { handleUsersList, handleStakeLink } from "./lib/user-handlers.js";
import {
  handleGiveawayEntriesClear,
  handleGiveawayKeyword,
  handleGiveawayReveal,
  handleGiveawayStatus,
  handleGiveawayToggle,
} from "./lib/giveaway-handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadProjectEnv(__dirname);
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.post(
  "/api/kick/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => handleKickWebhook(req, res)
);

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/auth/login", (req, res) => handleLogin(req, res));
app.get("/api/auth/callback", (req, res) => handleCallback(req, res));
app.get("/api/auth/me", (req, res) => handleMe(req, res));
app.post("/api/auth/logout", (req, res) => handleLogout(req, res));
app.post("/api/guess-the-balance/submit", (req, res) => handleGuessSubmit(req, res));
app.get("/api/guess-the-balance/status", (req, res) => handleGuessStatus(req, res));
app.post("/api/guess-the-balance/toggle", (req, res) => handleGuessToggle(req, res));
app.get("/api/guess-the-balance/guesses", (req, res) => handleGuessList(req, res));
app.post("/api/guess-the-balance/ending-balance", (req, res) =>
  handleGuessSetEndingBalance(req, res)
);
app.get("/api/bonus-hunt", (req, res) => handleBonusHuntGet(req, res));
app.post("/api/bonus-hunt/settings", (req, res) =>
  handleBonusHuntSettings(req, res)
);
app.post("/api/bonus-hunt/add", (req, res) => handleBonusHuntAdd(req, res));
app.post("/api/bonus-hunt/update", (req, res) => handleBonusHuntUpdate(req, res));
app.post("/api/bonus-hunt/remove", (req, res) => handleBonusHuntRemove(req, res));
app.post("/api/bonus-hunt/clear", (req, res) => handleBonusHuntClear(req, res));
app.get("/api/bonus-hunt/slots", (req, res) => handleBonusHuntSlots(req, res));
app.post("/api/bonus-hunt/slots/refresh", (req, res) =>
  handleBonusHuntSlotsRefresh(req, res)
);
app.post("/api/bonus-hunt/slots/import", (req, res) =>
  handleBonusHuntSlotsImport(req, res)
);
app.post("/api/bonus-hunt/slots/sync-token", (req, res) =>
  handleBonusHuntSlotsSyncToken(req, res)
);
app.get("/api/bonus-hunt/slots/sync-status", (req, res) =>
  handleBonusHuntSlotsSyncStatus(req, res)
);
app.post("/api/bonus-hunt/slots/import-sync", (req, res) =>
  handleBonusHuntSlotsImportSync(req, res)
);
app.options("/api/bonus-hunt/slots/import-sync", (req, res) =>
  handleBonusHuntSlotsImportSync(req, res)
);
app.get("/api/bonus-hunt/requests", (req, res) =>
  handleBonusHuntRequestsList(req, res)
);
app.post("/api/bonus-hunt/request", (req, res) =>
  handleBonusHuntRequestSubmit(req, res)
);
app.post("/api/bonus-hunt/requests/remove", (req, res) =>
  handleBonusHuntRequestRemove(req, res)
);
app.post("/api/bonus-hunt/requests/bet", (req, res) =>
  handleBonusHuntRequestBet(req, res)
);
app.post("/api/bonus-hunt/requests/clear", (req, res) =>
  handleBonusHuntRequestsClear(req, res)
);
app.post("/api/bonus-hunt/requests/toggle", (req, res) =>
  handleBonusHuntRequestsToggle(req, res)
);
app.post("/api/kick/subscribe", (req, res) => handleKickChatSubscribe(req, res));
app.get("/api/kick/chat-status", (req, res) => handleKickChatStatus(req, res));
app.post("/api/kick/test-command", (req, res) => handleKickTestSlotCommand(req, res));
app.get("/api/kick/bot/login", (req, res) => handleKickBotLogin(req, res));
app.get("/api/kick/bot/status", (req, res) => handleKickBotStatus(req, res));
app.get("/api/kick/credentials-check", (req, res) => handleKickCredentialsCheck(req, res));
app.get("/api/kick/setup-status", (req, res) => handleKickSetupStatus(req, res));
app.get("/api/leaderboard", (req, res) => handleLeaderboardGet(req, res));
app.get("/api/users", (req, res) => handleUsersList(req, res));
app.post("/api/users/link-stake", (req, res) => handleStakeLink(req, res));
app.get("/api/giveaways/status", (req, res) => handleGiveawayStatus(req, res));
app.post("/api/giveaways/toggle", (req, res) => handleGiveawayToggle(req, res));
app.post("/api/giveaways/keyword", (req, res) => handleGiveawayKeyword(req, res));
app.post("/api/giveaways/entries/clear", (req, res) =>
  handleGiveawayEntriesClear(req, res)
);
app.post("/api/giveaways/reveal", (req, res) => handleGiveawayReveal(req, res));

app.listen(PORT, () => {
  console.log(`BLAKJAC21 site running at http://localhost:${PORT}`);
  console.log(`Kick redirect URI: ${process.env.KICK_REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`}`);
});
