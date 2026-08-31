import "dotenv/config";
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
  handleBonusHuntRemove,
  handleBonusHuntUpdate,
  handleBonusHuntRequestRemove,
  handleBonusHuntRequestSubmit,
  handleBonusHuntRequestsClear,
  handleBonusHuntRequestsList,
  handleBonusHuntSlots,
  handleBonusHuntSlotsRefresh,
} from "./lib/bonus-hunt-handlers.js";
import {
  handleGuessStatus,
  handleGuessList,
  handleGuessSetEndingBalance,
  handleGuessSubmit,
  handleGuessToggle,
} from "./lib/guess-handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

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
app.post("/api/bonus-hunt/add", (req, res) => handleBonusHuntAdd(req, res));
app.post("/api/bonus-hunt/update", (req, res) => handleBonusHuntUpdate(req, res));
app.post("/api/bonus-hunt/remove", (req, res) => handleBonusHuntRemove(req, res));
app.post("/api/bonus-hunt/clear", (req, res) => handleBonusHuntClear(req, res));
app.get("/api/bonus-hunt/slots", (req, res) => handleBonusHuntSlots(req, res));
app.post("/api/bonus-hunt/slots/refresh", (req, res) =>
  handleBonusHuntSlotsRefresh(req, res)
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
app.post("/api/bonus-hunt/requests/clear", (req, res) =>
  handleBonusHuntRequestsClear(req, res)
);

app.listen(PORT, () => {
  console.log(`BLAKJAC21 site running at http://localhost:${PORT}`);
  console.log(`Kick redirect URI: ${process.env.KICK_REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`}`);
});
