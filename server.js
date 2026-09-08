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
  handleBonusHuntEnd,
  handleBonusHuntGet,
  handleBonusHuntHistory,
  handleBonusHuntHistoryRemove,
  handleBonusHuntSettings,
  handleBonusHuntRemove,
  handleBonusHuntUpdate,
  handleBonusHuntRequestRemove,
  handleBonusHuntRequestBet,
  handleBonusHuntRequestSubmit,
  handleBonusHuntRequestsClear,
  handleBonusHuntRequestsList,
  handleBonusHuntRequestsToggle,
  handleBonusHuntRequestsAffSubOnly,
  handleBonusHuntSlots,
  handleBonusHuntSlotsImport,
  handleBonusHuntSlotsAutoSync,
  handleBonusHuntSlotsRefresh,
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
  handleGuessAffiliatesOnly,
  handleGuessSubscribersOnly,
} from "./lib/guess-handlers.js";
import { handleLeaderboardGet } from "./lib/leaderboard-handlers.js";
import {
  handleUsersList,
  handleStakeLink,
  handleUserAffGrant,
  handleUserSetStake,
} from "./lib/user-handlers.js";
import {
  handleGiveawayAffiliatesOnly,
  handleGiveawaySubscribersOnly,
  handleGiveawayEntriesClear,
  handleGiveawayKeyword,
  handleGiveawayReveal,
  handleGiveawayStatus,
  handleGiveawayToggle,
} from "./lib/giveaway-handlers.js";
import {
  handleChatList,
  handleChatRemove,
  handleChatSend,
} from "./lib/chat-handlers.js";
import {
  handlePointsAward,
  handlePointsAwardChat,
  handlePointsCatalogGet,
  handlePointsCatalogUpsert,
  handlePointsMe,
  handlePointsRedeem,
  handlePointsRedemptionCancel,
  handlePointsRedemptionDelete,
  handlePointsRedemptionFulfill,
  handlePointsRedemptionsList,
} from "./lib/points-handlers.js";
import {
  handleSlotTournamentAffiliatesOnly,
  handleSlotTournamentBracketClear,
  handleSlotTournamentBracketGenerate,
  handleSlotTournamentBracketScore,
  handleSlotTournamentEntriesBots,
  handleSlotTournamentEntriesClear,
  handleSlotTournamentJoin,
  handleSlotTournamentPhase,
  handleSlotTournamentPredictionsSave,
  handleSlotTournamentPredictionsToggle,
  handleSlotTournamentResults,
  handleSlotTournamentSettings,
  handleSlotTournamentSlots,
  handleSlotTournamentStatus,
  handleSlotTournamentSubscribersOnly,
  handleSlotTournamentToggle,
} from "./lib/slot-tournament-handlers.js";

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
app.post("/api/guess-the-balance/affiliates-only", (req, res) =>
  handleGuessAffiliatesOnly(req, res)
);
app.post("/api/guess-the-balance/subscribers-only", (req, res) =>
  handleGuessSubscribersOnly(req, res)
);
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
app.post("/api/bonus-hunt/end", (req, res) => handleBonusHuntEnd(req, res));
app.get("/api/bonus-hunt/history", (req, res) => handleBonusHuntHistory(req, res));
app.post("/api/bonus-hunt/history/remove", (req, res) =>
  handleBonusHuntHistoryRemove(req, res)
);
app.get("/api/bonus-hunt/slots", (req, res) => handleBonusHuntSlots(req, res));
app.get("/api/bonus-hunt/slots-auto-sync", (req, res) =>
  handleBonusHuntSlotsAutoSync(req, res)
);
app.post("/api/bonus-hunt/slots-auto-sync", (req, res) =>
  handleBonusHuntSlotsAutoSync(req, res)
);
app.post("/api/bonus-hunt/slots/refresh", (req, res) =>
  handleBonusHuntSlotsRefresh(req, res)
);
app.post("/api/bonus-hunt/slots/import", (req, res) =>
  handleBonusHuntSlotsImport(req, res)
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
app.post("/api/bonus-hunt/requests/aff-sub-only", (req, res) =>
  handleBonusHuntRequestsAffSubOnly(req, res)
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
app.post("/api/users/aff-grant", (req, res) => handleUserAffGrant(req, res));
app.post("/api/users/set-stake", (req, res) => handleUserSetStake(req, res));
app.get("/api/points/me", (req, res) => handlePointsMe(req, res));
app.get("/api/points/catalog", (req, res) => handlePointsCatalogGet(req, res));
app.post("/api/points/catalog", (req, res) => handlePointsCatalogUpsert(req, res));
app.post("/api/points/award", (req, res) => handlePointsAward(req, res));
app.post("/api/points/award-chat", (req, res) => handlePointsAwardChat(req, res));
app.post("/api/points/redeem", (req, res) => handlePointsRedeem(req, res));
app.get("/api/points/redemptions", (req, res) =>
  handlePointsRedemptionsList(req, res)
);
app.post("/api/points/redemptions/fulfill", (req, res) =>
  handlePointsRedemptionFulfill(req, res)
);
app.post("/api/points/fulfill-redemption", (req, res) =>
  handlePointsRedemptionFulfill(req, res)
);
app.post("/api/points/redemptions/cancel", (req, res) =>
  handlePointsRedemptionCancel(req, res)
);
app.post("/api/points/cancel-redemption", (req, res) =>
  handlePointsRedemptionCancel(req, res)
);
app.post("/api/points/delete-redemption", (req, res) =>
  handlePointsRedemptionDelete(req, res)
);
app.get("/api/slot-tournaments/status", (req, res) =>
  handleSlotTournamentStatus(req, res)
);
app.post("/api/slot-tournaments/toggle", (req, res) =>
  handleSlotTournamentToggle(req, res)
);
app.post("/api/slot-tournaments/settings", (req, res) =>
  handleSlotTournamentSettings(req, res)
);
app.post("/api/slot-tournaments/phase", (req, res) =>
  handleSlotTournamentPhase(req, res)
);
app.post("/api/slot-tournaments/affiliates-only", (req, res) =>
  handleSlotTournamentAffiliatesOnly(req, res)
);
app.post("/api/slot-tournaments/subscribers-only", (req, res) =>
  handleSlotTournamentSubscribersOnly(req, res)
);
app.post("/api/slot-tournaments/entries/clear", (req, res) =>
  handleSlotTournamentEntriesClear(req, res)
);
app.post("/api/slot-tournaments/entries/bots", (req, res) =>
  handleSlotTournamentEntriesBots(req, res)
);
app.post("/api/slot-tournaments/slots", (req, res) =>
  handleSlotTournamentSlots(req, res)
);
app.post("/api/slot-tournaments/bracket/generate", (req, res) =>
  handleSlotTournamentBracketGenerate(req, res)
);
app.post("/api/slot-tournaments/bracket/score", (req, res) =>
  handleSlotTournamentBracketScore(req, res)
);
app.post("/api/slot-tournaments/bracket/clear", (req, res) =>
  handleSlotTournamentBracketClear(req, res)
);
app.post("/api/slot-tournaments/predictions/toggle", (req, res) =>
  handleSlotTournamentPredictionsToggle(req, res)
);
app.post("/api/slot-tournaments/predictions/save", (req, res) =>
  handleSlotTournamentPredictionsSave(req, res)
);
app.post("/api/slot-tournaments/results", (req, res) =>
  handleSlotTournamentResults(req, res)
);
app.post("/api/slot-tournaments/join", (req, res) =>
  handleSlotTournamentJoin(req, res)
);
app.get("/api/giveaways/status", (req, res) => handleGiveawayStatus(req, res));
app.post("/api/giveaways/toggle", (req, res) => handleGiveawayToggle(req, res));
app.post("/api/giveaways/affiliates-only", (req, res) =>
  handleGiveawayAffiliatesOnly(req, res)
);
app.post("/api/giveaways/subscribers-only", (req, res) =>
  handleGiveawaySubscribersOnly(req, res)
);
app.post("/api/giveaways/keyword", (req, res) => handleGiveawayKeyword(req, res));
app.post("/api/giveaways/entries/clear", (req, res) =>
  handleGiveawayEntriesClear(req, res)
);
app.post("/api/giveaways/reveal", (req, res) => handleGiveawayReveal(req, res));
app.get("/api/chat", (req, res) => handleChatList(req, res));
app.post("/api/chat", (req, res) => handleChatSend(req, res));
app.post("/api/chat/remove", (req, res) => handleChatRemove(req, res));

app.listen(PORT, () => {
  console.log(`BLAKJAC21 site running at http://localhost:${PORT}`);
  console.log(`Kick redirect URI: ${process.env.KICK_REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`}`);
});
