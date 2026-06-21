import express from "express";
import fs from "fs-extra";
import path from "path";
import { fork } from "child_process";
import http from "http";
import { Server } from "socket.io";

const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.resolve();
const USERS_DIR = path.join(__dirname, "users");
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });

// ============================================
// 🔐 PANEL PASSWORD CONFIGURATION
// ============================================
const PANEL_PASSWORD = "ANURAG MISHRA";
// ============================================

// ---- Middlewares ----
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/bot-assets", express.static(path.join(__dirname, "assets")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const procs = {};
// UID jinhe MANUALLY panel se roka gaya — ye crash pe restart NAHI honge
const manuallyStopped = new Set();

function appendLog(uid, text) {
  try {
    const userDir = path.join(USERS_DIR, String(uid));
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    fs.appendFileSync(
      path.join(userDir, "logs.txt"),
      `[${new Date().toISOString()}] ${text}\n`
    );
  } catch (e) {
    console.error("appendLog failed:", e.message);
  }
}

function spawnBot(admin) {
  const child = fork(path.join(__dirname, "bot.js"), [String(admin)], { silent: true });
  setupChild(child, admin);
  procs[admin] = child;
  return child;
}

function setupChild(child, admin) {
  const blockedPatterns = [
    'anuragxarohi-fca [LOG]',
    '[LOG] Logging in...',
    'info login ',
    'warn login ',
  ];
  const blockedStderr = ['anuragxarohi-fca', '[LOG]', 'ExperimentalWarning', 'DeprecationWarning'];

  child.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (!text) return;
    if (blockedPatterns.some(p => text.includes(p))) return;
    appendLog(admin, text);
    io.to(String(admin)).emit("botlog", text);
  });

  child.stderr.on("data", (d) => {
    const text = d.toString().trim();
    if (!text) return;
    if (blockedStderr.some(p => text.includes(p))) return;
    appendLog(admin, "[ERR] " + text);
    io.to(String(admin)).emit("botlog", "[ERR] " + text);
  });

  child.on("exit", (code, sig) => {
    const msg = `🔴 Bot process exited (code=${code}, sig=${sig})`;
    appendLog(admin, msg);
    io.to(String(admin)).emit("botlog", msg);
    delete procs[admin];

    // ============================================
    // 🔄 AUTO-RESTART ON CRASH
    // Manual stop se ruka ho toh restart NAHI
    // Appstate valid ho toh 5s baad khud restart
    // ============================================
    if (manuallyStopped.has(String(admin))) {
      manuallyStopped.delete(String(admin));
      const stopMsg = `🛑 Bot manually stopped — auto-restart disabled.`;
      appendLog(admin, stopMsg);
      io.to(String(admin)).emit("botlog", stopMsg);
      return;
    }

    const appstatePath = path.join(USERS_DIR, String(admin), "appstate.json");
    if (!fs.existsSync(appstatePath)) {
      const noStateMsg = `⚠️ Auto-restart skipped — appstate.json nahi mila.`;
      appendLog(admin, noStateMsg);
      io.to(String(admin)).emit("botlog", noStateMsg);
      return;
    }

    // Appstate valid hai — 5 second baad restart
    const retryMsg = `🔄 Crash detected! 5s baad auto-restart ho raha hai...`;
    appendLog(admin, retryMsg);
    io.to(String(admin)).emit("botlog", retryMsg);

    setTimeout(() => {
      // Check again: manually stopped nahi kiya meanwhile
      if (manuallyStopped.has(String(admin))) {
        manuallyStopped.delete(String(admin));
        return;
      }
      const restartMsg = `🚀 Auto-restarting bot for ${admin}...`;
      appendLog(admin, restartMsg);
      io.to(String(admin)).emit("botlog", restartMsg);
      spawnBot(admin);
    }, 5000);
    // ============================================
  });
}

io.on("connection", (socket) => {
  socket.on("join", (uid) => socket.join(String(uid)));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ============================================
// 🔐 PASSWORD VERIFICATION ENDPOINT
// ============================================
app.post("/verify-password", (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: "Password required" });

  if (password === PANEL_PASSWORD) {
    return res.json({ success: true, message: "Access granted" });
  } else {
    return res.status(401).json({ success: false, message: "Invalid password" });
  }
});
// ============================================

app.post("/start-bot", (req, res) => {
  const { appstate, admin } = req.body;
  if (!appstate || !admin)
    return res.status(400).send("❌ appstate or admin missing");

  const userDir = path.join(USERS_DIR, String(admin));
  fs.ensureDirSync(userDir);

  try {
    const appObj = typeof appstate === "string" ? JSON.parse(appstate) : appstate;
    fs.writeJsonSync(path.join(userDir, "appstate.json"), appObj, { spaces: 2 });
    fs.writeFileSync(path.join(userDir, "admin.txt"), String(admin));
  } catch (e) {
    return res.status(400).send("❌ Invalid appstate JSON");
  }

  if (procs[admin]) {
    try { procs[admin].kill(); } catch {}
  }

  // Manual start — manuallyStopped hata do taaki crash pe auto-restart kaam kare
  manuallyStopped.delete(String(admin));
  spawnBot(admin);

  appendLog(admin, `✅ Bot started for admin ${admin}`);
  io.to(String(admin)).emit("botlog", `✅ Bot started for ${admin}`);
  res.send(`✅ started ${admin}`);
});

app.get("/stop-bot", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("❌ uid missing");
  if (!procs[uid]) return res.send("⚠️ Bot not running");
  try {
    // Manual stop — auto-restart band karo
    manuallyStopped.add(String(uid));
    const proc = procs[uid];
    delete procs[uid];
    proc.kill("SIGTERM");
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, 3000);
    appendLog(uid, "🔴 Bot stopped by panel");
    io.to(String(uid)).emit("botlog", "🔴 Bot stopped by panel");
    res.send("🔴 stopped");
  } catch (e) {
    manuallyStopped.delete(String(uid));
    res.status(500).send("❌ Failed to stop: " + e.message);
  }
});

app.get("/logs", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("❌ uid missing");
  const lf = path.join(USERS_DIR, String(uid), "logs.txt");
  if (!fs.existsSync(lf)) return res.send("(No logs yet)");
  res.send(fs.readFileSync(lf, "utf8"));
});

// ============================================
// 📡 TELEGRAM CONFIG — PANEL SE SAVE/LOAD
// ============================================
app.post("/save-telegram-config", (req, res) => {
  const { admin, token, chatId } = req.body;
  if (!admin) return res.status(400).json({ success: false, message: "admin UID required" });
  const userDir = path.join(USERS_DIR, String(admin));
  fs.ensureDirSync(userDir);
  try {
    fs.writeJsonSync(path.join(userDir, "telegram_config.json"), { token: token || "", chatId: chatId || "" }, { spaces: 2 });
    res.json({ success: true, message: "✅ Telegram config saved!" });
  } catch (e) {
    res.status(500).json({ success: false, message: "❌ Save failed: " + e.message });
  }
});

app.get("/get-telegram-config", (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).json({ success: false });
  const cfgPath = path.join(USERS_DIR, String(uid), "telegram_config.json");
  if (!fs.existsSync(cfgPath)) return res.json({ token: "", chatId: "" });
  try {
    res.json(fs.readJsonSync(cfgPath));
  } catch {
    res.json({ token: "", chatId: "" });
  }
});
// ============================================

server.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 ANURAG PANEL running on http://0.0.0.0:${PORT}`)
);
