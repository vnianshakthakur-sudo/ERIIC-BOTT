import "dotenv/config";
// 🎨 USING ERIICXANURAG PACKAGE FOR THEME SUPPORT
import login from "eriicxanurag";
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import crypto from "crypto";
import TelegramBot from "node-telegram-bot-api";

// 🔕 Suppress all FCA internal logs (they bypass logLevel and print directly)
const FCA_FILTER = /eriicxanurag|^\[ERR\]|^\[LOG\]|Connecting to MQTT|Successfully connected to MQTT|Scheduled reconnect|Fetching account info|Hello,/i;
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
const _origWarn = console.warn.bind(console);
console.log = (...a) => { if (!a.some(x => FCA_FILTER.test(String(x)))) _origLog(...a); };
console.error = (...a) => { if (!a.some(x => FCA_FILTER.test(String(x)))) _origErr(...a); };
console.warn = (...a) => { if (!a.some(x => FCA_FILTER.test(String(x)))) _origWarn(...a); };

// ============================================
// ⚙️ BOT CONFIGURATION - YAHAN BOT KA NICKNAME SET KARO
// ============================================
const BOT_NICKNAME = "😘 फातिमा की बुर ❤";
// ============================================

const ADMIN_ARG = process.argv[2];
if (!ADMIN_ARG) {
  console.error("❌ Missing admin UID arg. Usage: node bot.js <adminUID>");
  process.exit(1);
}

const ROOT = process.cwd();
const USER_DIR = path.join(ROOT, "users", String(ADMIN_ARG));
const APPSTATE_PATH = path.join(USER_DIR, "appstate.json");
const ADMIN_PATH = path.join(USER_DIR, "admin.txt");
const LOCKS_PATH = path.join(USER_DIR, "locks.json");
const PHOTOS_DIR = path.join(USER_DIR, "photos");
const CACHE_DIR = path.join(ROOT, "cache");
const THEMES_DIR = path.join(USER_DIR, "themes");
const CUSTOM_PHOTO_PATH = path.join(ROOT, "assets", "custom_bot_photo.jpg");
const BLANK_PHOTO_PATH = path.join(ROOT, "assets", "blank.jpg");
const RANDOM_PHOTOS_DIR = path.join(ROOT, "assets", "random");
const REPLIT_DOMAIN = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || "";

// ============================================
// TELEGRAM CONFIG - RENDER ENV SE AAYEGA
// Render Dashboard → Environment → Add Variable
// ============================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ALLOWED_CHAT_ID = process.env.TELEGRAM_ALLOWED_CHAT_ID || "";
const TELEGRAM_GROUP_LIMIT = Number(process.env.TELEGRAM_GROUP_LIMIT || 80);
const TELEGRAM_LOG_EVERY_MS = 3_600_000; // 1 hour — fixed
const TELEGRAM_LOG_MAX_LINES = Number(process.env.TELEGRAM_LOG_MAX_LINES || 40);

if (!fs.existsSync(USER_DIR)) {
  console.error("❌ User folder not found:", USER_DIR);
  process.exit(1);
}
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(THEMES_DIR)) fs.mkdirSync(THEMES_DIR, { recursive: true });
if (!fs.existsSync(RANDOM_PHOTOS_DIR)) fs.mkdirSync(RANDOM_PHOTOS_DIR, { recursive: true });

// 🖼️ Blank 1x1 white JPEG — anti-pic ke liye group photo remove karne hetu
if (!fs.existsSync(BLANK_PHOTO_PATH)) {
  const BLANK_JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APvSiigD/9k=";
  fs.writeFileSync(BLANK_PHOTO_PATH, Buffer.from(BLANK_JPEG_B64, "base64"));
}

let appState;
try {
  appState = JSON.parse(fs.readFileSync(APPSTATE_PATH, "utf8"));
} catch (e) {
  console.error("❌ Failed reading appstate.json:", e.message);
  process.exit(1);
}

let BOSS_UID = ADMIN_ARG;
try {
  if (fs.existsSync(ADMIN_PATH)) {
    const t = fs.readFileSync(ADMIN_PATH, "utf8").trim();
    if (t) BOSS_UID = t;
  }
} catch {}

let locks = {
  groupNames: {},
  nicknames: {},
  emojis: {},
  antiOut: {},
  groupPics: {},
  themes: {},
  antiPic: {}
};
try {
  if (fs.existsSync(LOCKS_PATH)) {
    const saved = JSON.parse(fs.readFileSync(LOCKS_PATH, "utf8"));
    locks = { ...locks, ...saved };
    delete locks.autoRemove;
    if (!locks.antiPic) locks.antiPic = {};
  }
} catch (e) {
  console.warn("⚠️ Could not load locks.json, using defaults.");
}

function saveLocks() {
  try {
    fs.writeFileSync(LOCKS_PATH, JSON.stringify(locks, null, 2));
  } catch (e) {
    console.error("❌ Failed saving locks:", e.message);
  }
}

const telegramLogQueue = [];

function isTelegramForwardLog(msg) {
  const text = String(msg || "").toLowerCase();
  return (
    text.includes("[telegram command]") ||
    text.includes("[groupname]") ||
    text.includes("group name") ||
    text.includes("name lock") ||
    text.includes("reverted name")
  );
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (isTelegramForwardLog(msg)) {
    telegramLogQueue.push(line);
    while (telegramLogQueue.length > TELEGRAM_LOG_MAX_LINES * 3) telegramLogQueue.shift();
  }
}

function downloadToFileSingle(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));
    try {
      const lib = url.startsWith("https") ? https : http;
      const options = {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Connection": "keep-alive"
        }
      };
      const req = lib.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return downloadToFileSingle(redirectUrl, dest, redirectCount + 1).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) return reject(new Error("Download failed, status " + res.statusCode));
        const fileStream = fs.createWriteStream(dest);
        res.pipe(fileStream);
        fileStream.on("finish", () => fileStream.close(() => resolve(dest)));
        fileStream.on("error", (err) => reject(err));
      });
      req.setTimeout(30000, () => { req.destroy(); reject(new Error("Download timeout (30s)")); });
      req.on("error", (err) => reject(err));
    } catch (e) { reject(e); }
  });
}

async function downloadToFile(url, dest, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      await downloadToFileSingle(url, dest);
      return dest;
    } catch (e) {
      lastErr = e;
      log(`⚠️ Download attempt ${i + 1}/${retries} failed: ${e.message}`);
      if (i < retries - 1) await sleep(1500);
    }
  }
  throw lastErr;
}

// 🔐 Compute MD5 hash of a local file (for photo change detection)
function computeFileHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash("md5").update(buf).digest("hex");
  } catch { return null; }
}

// 🌐 Download URL to buffer and return MD5 hash (for polling comparison)
function downloadToBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));
    try {
      const lib = url.startsWith("https") ? https : http;
      const options = {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "image/webp,image/apng,image/*,*/*;q=0.8"
        }
      };
      const req = lib.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redir = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return downloadToBuffer(redir, redirectCount + 1).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) return reject(new Error("Status " + res.statusCode));
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      });
      req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
      req.on("error", reject);
    } catch (e) { reject(e); }
  });
}

async function computeUrlHash(url) {
  try {
    const buf = await downloadToBuffer(url);
    return crypto.createHash("md5").update(buf).digest("hex");
  } catch { return null; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ⚡ ULTRA FAST QUEUES
const nickQueue = [];
let nickProcessing = false;
const NICK_DELAY_MS = 600;

const nameQueue = [];
let nameProcessing = false;
const NAME_DELAY_MS = 600;

const themeQueue = [];
let themeProcessing = false;
const THEME_DELAY_MS = 400;

function enqueueNickTask(fn) {
  return new Promise(resolve => {
    nickQueue.push({ fn, resolve });
    if (!nickProcessing) processNickQueue();
  });
}

function enqueueNameTask(fn) {
  return new Promise(resolve => {
    nameQueue.push({ fn, resolve });
    if (!nameProcessing) processNameQueue();
  });
}

function enqueueThemeTask(fn) {
  return new Promise(resolve => {
    themeQueue.push({ fn, resolve });
    if (!themeProcessing) processThemeQueue();
  });
}

async function processNickQueue() {
  nickProcessing = true;
  while (nickQueue.length) {
    const item = nickQueue.shift();
    try { await item.fn(); } catch (e) { log('❌ nick queue task failed: ' + errStr(e)); }
    try { item.resolve(); } catch {}
    await sleep(NICK_DELAY_MS);
  }
  nickProcessing = false;
}

async function processNameQueue() {
  nameProcessing = true;
  while (nameQueue.length) {
    const item = nameQueue.shift();
    try { await item.fn(); } catch (e) { log('❌ name queue task failed: ' + errStr(e)); }
    try { item.resolve(); } catch {}
    await sleep(NAME_DELAY_MS);
  }
  nameProcessing = false;
}

async function processThemeQueue() {
  themeProcessing = true;
  while (themeQueue.length) {
    const item = themeQueue.shift();
    try { await item.fn(); } catch (e) { log('❌ theme queue task failed: ' + errStr(e)); }
    try { item.resolve(); } catch {}
    await sleep(THEME_DELAY_MS);
  }
  themeProcessing = false;
}

// 🎨 THEME COLOR IDs
const THEME_COLORS = {
  blue: "196241301102133",
  purple: "370940413392601",
  green: "169463077092846",
  pink: "230032715012014",
  orange: "175615189761153",
  red: "2136751179887052",
  yellow: "2058653964378557",
  teal: "417639218648241",
  black: "539927563794799",
  white: "2873642392710980",
  default: "196241301102133"
};

// 🔧 THEME CHANGE FUNCTION USING ERIICXANURAG API
async function setThreadThemeDirect(api, threadID, themeId, emoji = "👍") {
  return new Promise((resolve) => {
    try {
      // 🎨 Try changeThreadColor first (simpler API)
      if (api.changeThreadColor) {
        log(`🎨 Using changeThreadColor with theme: ${themeId}`);
        
        api.changeThreadColor(themeId, threadID, (err) => {
          if (err) {
            log(`⚠️ changeThreadColor failed: ${err.message || err}`);
            // Fallback to setThreadTheme
            trySetThreadTheme();
          } else {
            log(`✅ Theme set via changeThreadColor: ${themeId}`);
            resolve(true);
          }
        });
      } else {
        trySetThreadTheme();
      }
      
      function trySetThreadTheme() {
        // Fallback: Use eriicxanurag's built-in setThreadTheme function
        if (api.setThreadTheme) {
          // Thread ID ko sahi format mein convert karo
          let formattedThreadID = threadID.toString();
          
          // Theme data - pass theme ID as string directly
          // eriicxanurag supports string theme ID
          log(`🎨 Calling setThreadTheme with threadID: ${formattedThreadID}, theme: ${themeId}`);
          
          api.setThreadTheme(formattedThreadID, themeId, (err, res) => {
            if (err) {
              log(`❌ setThreadTheme error: ${err.message || err}`);
              resolve(false);
            } else {
              log(`✅ Theme set via setThreadTheme: ${themeId}`);
              resolve(true);
            }
          });
        } else {
          log(`❌ No theme method available!`);
          resolve(false);
        }
      }
    } catch (e) {
      log(`❌ setThreadThemeDirect exception: ${e.message}`);
      resolve(false);
    }
  });
}

async function retryChangeNick(api, threadID, uid, nick, retries = 5) {
  // 🔍 Try multiple API names — different FCA packages name it differently
  let changeNickname = null;
  let apiName = '';

  if (typeof api.setNickname === 'function') {
    changeNickname = api.setNickname.bind(api);
    apiName = 'setNickname';
  } else if (typeof api.changeNickname === 'function') {
    changeNickname = api.changeNickname.bind(api);
    apiName = 'changeNickname';
  } else if (typeof api.nickname === 'function') {
    changeNickname = api.nickname.bind(api);
    apiName = 'nickname';
  } else if (typeof api.changeNick === 'function') {
    changeNickname = api.changeNick.bind(api);
    apiName = 'changeNick';
  }

  if (!changeNickname) {
    const apiKeys = Object.keys(api || {}).filter(k => k.toLowerCase().includes('nick')).join(', ') || 'none found';
    log(`❌ Nickname API not found! Tried: setNickname, changeNickname, nickname, changeNick. Available nick-related: ${apiKeys}`);
    return false;
  }

  let success = false;
  await enqueueNickTask(async () => {
    for (let i = 0; i < retries; i++) {
      try {
        log(`📝 [${apiName}] Setting nickname for ${uid}: "${nick}" in ${threadID} (attempt ${i + 1})`);
        // eriicxanurag setNickname is Promise-based: (nickname, threadID, participantID, initiatorID)
        // DO NOT pass callback — 4th param is initiatorID (BOSS_UID), not a callback
        const result = changeNickname(nick, threadID, uid, String(BOSS_UID));
        if (result && typeof result.then === 'function') {
          await result;
        }
        log(`✅ [${apiName}] success for ${uid}: "${nick}"`);
        success = true;
        return;
      } catch (e) {
        log(`⚠️ [${apiName}] attempt ${i + 1} failed: ${errStr(e)}`);
      }
      if (i < retries - 1) await sleep(300 + i * 150);
    }
  });

  if (!success) {
    log(`❌ [${apiName}] failed for ${uid} after ${retries} retries`);
    return false;
  }
  return true;
}

async function retrySetTitle(api, threadID, name, retries = 6) {
  if (typeof api.gcname !== 'function') {
    log('❌ api.gcname is not available!');
    return false;
  }

  let lastErr = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      lastErr = null;
      log(`📝 Setting group name: "${name}" (attempt ${i + 1})`);
      
      await new Promise((res) => {
        api.gcname(name, threadID, (err, data) => {
          if (err) {
            lastErr = err;
            log(`⚠️ gcname() attempt ${i + 1} failed: ${errStr(err)}`);
          } else {
            log(`✅ gcname() success: "${name}"`);
          }
          res();
        }, BOSS_UID);
      });
      
      if (!lastErr) return true;
    } catch (e) { 
      lastErr = e; 
      log(`⚠️ gcname() exception: ${errStr(e)}`);
    }
    if (i < retries - 1) await sleep(600 + i * 200);
  }
  
  return false;
}

// 🎨 SET THEME FUNCTION
async function setTheme(api, threadID, themeId, emoji = "👍", retries = 5) {
  for (let i = 0; i < retries; i++) {
    log(`🎨 Setting theme ${themeId} (attempt ${i + 1})`);
    
    const success = await setThreadThemeDirect(api, threadID, themeId, emoji);
    
    if (success) return true;
    
    if (i < retries - 1) await sleep(400 + i * 200);
  }
  
  return false;
}

async function revertSingleNick(api, threadID, uid) {
  const locked = locks.nicknames?.[threadID]?.[uid];
  if (!locked) return;
  const success = await retryChangeNick(api, threadID, uid, locked, 5);
  if (success) {
    log(`🔁 Reverted nick for ${uid} in ${threadID}`);
  }
}

async function enforceNickLockForThread(api, threadID, nick) {
  try {
    const info = await api.getThreadInfo(threadID);
    const members = (info && Array.isArray(info.participantIDs) && info.participantIDs.length > 0)
      ? info.participantIDs
      : Object.keys(locks.nicknames?.[threadID] || {});

    if (members.length === 0) {
      log(`⚠️ enforceNickLockForThread: No members found for ${threadID}`);
      return false;
    }

    log(`🔐 Enforcing nicklock for ${members.length} members in ${threadID}...`);

    // — First pass — no extra sleep, queue handles 30ms spacing
    const failed = [];
    for (const uid of members) {
      const success = await retryChangeNick(api, threadID, uid, nick, 3);
      if (!success) failed.push(uid);
    }

    // — Second pass for failed members —
    if (failed.length > 0) {
      log(`⚠️ ${failed.length} member(s) failed first pass — retrying in 1s...`);
      await sleep(1000);
      for (const uid of failed) {
        await retryChangeNick(api, threadID, uid, nick, 5);
      }
    }

    // Lock sab members ko — chahe set hua ya nahi,
    // taaki koi bhi change kare toh revert ho
    locks.nicknames[threadID] = {};
    members.forEach(uid => { locks.nicknames[threadID][uid] = nick; });
    saveLocks();
    log(`✅ Nicklock enforced for ${threadID} (${members.length - failed.length}/${members.length} first pass, retried ${failed.length})`);
    return true;
  } catch (e) {
    log(`❌ Error in enforceNickLockForThread: ${e.message}`);
    return false;
  }
}

async function revertGroupNameLocked(api, threadID) {
  const lockedName = locks.groupNames?.[threadID];
  if (!lockedName) return;
  
  await enqueueNameTask(async () => {
    const success = await retrySetTitle(api, threadID, lockedName, 6);
    if (success) {
      log(`🔒 REVERTED name in ${threadID} to: ${lockedName}`);
    }
  });
}

// 📸 GROUP PHOTO SET FUNCTION - Custom photo uthao aur laga do
// pendingRevert: agar revert chal raha hai aur naya event aaya toh revert ke baad dobara try karo
const pendingRevert = new Set();

// 🔁 SINGLE REVERT — photo change detect hone par ek baar revert
async function burstRevertPhoto(api, threadID) {
  log(`🔁 Photo revert triggered for ${threadID}`);
  await applyLockedPhoto(api, threadID);
  log(`🔁 Photo revert complete for ${threadID}`);
}

async function applyLockedPhoto(api, threadID) {
  // Agar already revert ho raha hai — pending mark karo, skip mat karo
  if (revertInProgress.has(threadID)) {
    log(`⏩ Revert in progress for ${threadID} — marking pending retry`);
    pendingRevert.add(threadID);
    return false;
  }

  const locked = locks.groupPics?.[threadID];
  if (!locked?.file) {
    log(`⚠️ No locked photo for ${threadID}`);
    return false;
  }

  if (!fs.existsSync(locked.file)) {
    log(`⚠️ Locked photo file not found: ${locked.file}`);
    return false;
  }

  const fileSize = fs.statSync(locked.file).size;
  if (fileSize === 0) {
    log(`⚠️ Locked photo file is empty: ${locked.file}`);
    return false;
  }

  revertInProgress.add(threadID);
  pendingRevert.delete(threadID);

  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        log(`📸 ⚡ REVERT attempt ${attempt}/5 in ${threadID}`);
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("gcphoto timeout")), 20000);
          const stream = fs.createReadStream(locked.file);
          const maybePromise = api.gcphoto(stream, threadID, (err) => {
            clearTimeout(t);
            if (err) reject(err); else resolve();
          });
          // Agar gcphoto Promise return kare (Promise-based API)
          if (maybePromise && typeof maybePromise.then === 'function') {
            clearTimeout(t);
            maybePromise.then(resolve).catch(reject);
          }
        });
        // ✅ SUCCESS
        photoCooldown[threadID] = Date.now();
        log(`✅ Locked photo SET in ${threadID}`);
        // CDN URL background mein update karo
        setTimeout(async () => {
          try {
            const inf = await api.getThreadInfo(threadID);
            const newUrl = inf?.imageSrc || inf?.threadImage || inf?.image || "";
            if (newUrl && locks.groupPics?.[threadID]) {
              locks.groupPics[threadID].lastVerifiedUrl = newUrl;
              saveLocks();
            }
          } catch {}
        }, 4000);
        return true;
      } catch (e) {
        log(`❌ Photo set attempt ${attempt} failed in ${threadID}: ${errStr(e)}`);
        if (attempt < 5) await sleep(500 + attempt * 300);
      }
    }
  } finally {
    revertInProgress.delete(threadID);
    // Agar pending retry hai — 500ms baad dobara try karo
    if (pendingRevert.has(threadID)) {
      pendingRevert.delete(threadID);
      log(`🔄 Pending revert found for ${threadID} — retrying in 500ms`);
      setTimeout(() => applyLockedPhoto(api, threadID), 500);
    }
  }

  log(`❌ All photo set attempts FAILED for ${threadID}`);
  return false;
}

// backward compat alias
const revertGroupPhoto = applyLockedPhoto;

// 🎨 THEME REVERT FUNCTION
async function revertThemeLocked(api, threadID) {
  const lockedTheme = locks.themes?.[threadID];
  if (!lockedTheme) return;
  
  await enqueueThemeTask(async () => {
    let success = false;

    if (lockedTheme.byName && typeof api.theme === 'function') {
      try {
        await new Promise((resolve, reject) => {
          api.theme(lockedTheme.color, threadID, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        success = true;
        log(`🔒 REVERTED named theme "${lockedTheme.color}" in ${threadID}`);
      } catch (e) {
        log(`⚠️ Named theme revert failed: ${e.message}, trying by ID...`);
        if (lockedTheme.themeId && /^\d+$/.test(String(lockedTheme.themeId))) {
          success = await setTheme(api, threadID, lockedTheme.themeId, lockedTheme.emoji || "👍", 5);
        }
      }
    } else {
      success = await setTheme(api, threadID, lockedTheme.themeId, lockedTheme.emoji || "👍", 5);
    }
    
    if (success) {
      // Cooldown set karo taaki apna event ignore ho
      themeCooldown[threadID] = Date.now();
      log(`🔒 REVERTED theme in ${threadID}`);
      // Silent revert - koi message nahi
    } else {
      log(`⚠️ Failed to revert theme in ${threadID}`);
    }
  });
}

async function setBotNickname(api, threadID, botUID) {
  if (!BOT_NICKNAME || BOT_NICKNAME.trim() === "") return;
  
  try {
    const info = await api.getThreadInfo(threadID);
    const currentNick = getThreadNickname(info, botUID);
    
    if (currentNick !== BOT_NICKNAME) {
      log(`🤖 Bot nickname changed in ${threadID}: "${currentNick}" → restoring to "${BOT_NICKNAME}"`);
      const success = await retryChangeNick(api, threadID, botUID, BOT_NICKNAME, 5);
      if (success) {
        log(`✅ Bot nickname restored to "${BOT_NICKNAME}" in ${threadID}`);
      }
    }
  } catch (e) {
    log(`❌ Error setting bot nickname: ${e.message}`);
  }
}

async function handleBotNicknameChange(api, threadID, uid, newNick, botUID) {
  if (String(uid) !== String(botUID)) return false;
  if (newNick === BOT_NICKNAME) return false;
  
  log(`⚠️ Bot nickname changed by someone to "${newNick}" in ${threadID} → restoring to "${BOT_NICKNAME}"`);
  await sleep(600);
  const success = await retryChangeNick(api, threadID, botUID, BOT_NICKNAME, 5);
  if (success) {
    log(`🔒 Bot nickname restored to "${BOT_NICKNAME}"`);
  }
  return success;
}

// 🎲 Get random photo from assets/random/ folder
function getRandomPhoto() {
  try {
    const IMG_EXT = /\.(jpg|jpeg|png|webp)$/i;
    const files = fs.readdirSync(RANDOM_PHOTOS_DIR).filter(f => IMG_EXT.test(f));
    if (files.length === 0) return CUSTOM_PHOTO_PATH; // fallback
    const pick = files[Math.floor(Math.random() * files.length)];
    return path.join(RANDOM_PHOTOS_DIR, pick);
  } catch {
    return CUSTOM_PHOTO_PATH;
  }
}

function errStr(e) {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  if (e instanceof Error) {
    const pieces = [];
    if (e.message && e.message !== "[object Object]") pieces.push(e.message);
    for (const key of ["error", "response", "body", "data", "code"]) {
      const value = e[key];
      if (!value) continue;
      if (typeof value === "string") pieces.push(value);
      else {
        try { pieces.push(JSON.stringify(value)); } catch { pieces.push(String(value)); }
      }
    }
    const base = pieces.length ? pieces.join(" | ") : String(e);
    return base + (e.stack ? "\n" + e.stack.split("\n").slice(1, 3).join("\n") : "");
  }
  try { return JSON.stringify(e); } catch { return String(e); }
}

function getThreadNickname(info, userID) {
  const nicknames = info?.nicknames;
  const uid = String(userID || "");
  if (!nicknames || !uid) return "";

  if (Array.isArray(nicknames)) {
    const found = nicknames.find(n =>
      String(n?.userID || n?.participant_id || n?.participantID || "") === uid
    );
    return found?.nickname || "";
  }

  if (typeof nicknames === "object") {
    return nicknames[uid] || "";
  }

  return "";
}

process.on("uncaughtException", e => {
  log("⛔ uncaughtException: " + errStr(e));
});
process.on("unhandledRejection", e => {
  log("⛔ unhandledRejection: " + errStr(e));
});

let botHealthy = false;
let lastEventTime = Date.now();
let mqttRestarting = false;

// ⏱️ COOLDOWN MAPS - Bot ki apni actions ko ignore karne ke liye
const themeCooldown = {};  // threadID -> timestamp (bot ne khud theme set kiya)
const photoCooldown = {};  // threadID -> timestamp (bot ne khud photo set kiya)

// 🗂️ Active threads — jahan se koi bhi event aaya ho (bot nick polling ke liye)
const activeThreads = new Set();
const telegramGroupCache = new Map();

// ⚡ RAM CACHE — instant revert ke liye photo data memory mein
const photoCache = {};  // threadID -> { path, data }
const revertInProgress = new Set(); // concurrent revert guard
const BOT_START_TIME = Date.now(); // startup time — grace period ke liye
const HASH_GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 min baad hash comparison shuru

function loadPhotoCache(threadID, filePath) {
  try {
    if (fs.existsSync(filePath)) {
      photoCache[threadID] = { path: filePath };
      log(`⚡ Photo cached for ${threadID}`);
    }
  } catch (e) {
    log(`⚠️ Cache load failed for ${threadID}: ${e.message}`);
  }
}

function normalizeTelegramName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function threadTitleFromInfo(info, fallback) {
  const title = info?.threadName || info?.name || info?.title || info?.threadTitle;
  if (title) return String(title);
  const names = Array.isArray(info?.participantNames) ? info.participantNames.filter(Boolean).slice(0, 4) : [];
  if (names.length) return names.join(", ");
  return `Group ${fallback}`;
}

function rememberTelegramGroup(threadID, info = null) {
  const id = String(threadID || "");
  if (!id) return;
  const existing = telegramGroupCache.get(id) || {};
  const title = info ? threadTitleFromInfo(info, id) : (existing.title || `Group ${id}`);
  telegramGroupCache.set(id, {
    id,
    title,
    alias: normalizeTelegramName(title) || id,
    updatedAt: Date.now()
  });
}

async function callThreadList(api) {
  if (typeof api.getThreadList !== "function") return [];
  return await new Promise((resolve) => {
    let done = false;
    const finish = (items) => {
      if (done) return;
      done = true;
      resolve(Array.isArray(items) ? items : []);
    };
    const cb = (err, data) => finish(err ? [] : data);
    try {
      const ret = api.getThreadList(Math.max(20, TELEGRAM_GROUP_LIMIT), null, ["INBOX"], cb);
      if (ret && typeof ret.then === "function") ret.then(finish).catch(() => finish([]));
    } catch {
      finish([]);
    }
    setTimeout(() => finish([]), 8000);
  });
}

async function refreshTelegramGroups(api) {
  const ids = new Set([
    ...activeThreads,
    ...Object.keys(locks.groupNames || {}),
    ...Object.keys(locks.nicknames || {}),
    ...Object.keys(locks.groupPics || {}),
    ...Object.keys(locks.antiPic || {}),
    ...Object.keys(locks.themes || {})
  ]);

  const threadList = await callThreadList(api);
  for (const item of threadList) {
    const id = String(item?.threadID || item?.threadId || item?.id || "");
    if (!id) continue;
    const isGroup = item?.isGroup === true || item?.isGroupThread === true || item?.threadType === 2 || item?.type === "group";
    if (isGroup || item?.threadName || item?.name) {
      ids.add(id);
      rememberTelegramGroup(id, item);
    }
  }

  const limitedIds = Array.from(ids).slice(0, TELEGRAM_GROUP_LIMIT);
  for (const id of limitedIds) {
    if (telegramGroupCache.has(id) && !telegramGroupCache.get(id)?.title?.startsWith("Group ")) continue;
    try {
      const info = await api.getThreadInfo(id);
      rememberTelegramGroup(id, info);
      await sleep(150);
    } catch {
      rememberTelegramGroup(id);
    }
  }

  return Array.from(telegramGroupCache.values())
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, TELEGRAM_GROUP_LIMIT);
}

function resolveTelegramGroupTarget(target, groups) {
  const raw = String(target || "").trim().replace(/^@+/, "");
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber > 0 && groups[asNumber - 1]) return groups[asNumber - 1];
  const normalized = normalizeTelegramName(raw);
  return groups.find(g =>
    g.id === raw ||
    g.alias === normalized ||
    normalizeTelegramName(g.title) === normalized ||
    normalizeTelegramName(g.title).includes(normalized)
  ) || null;
}

async function sendTelegramLong(bot, chatId, text) {
  const message = String(text || "");
  if (message.length <= 3900) return bot.sendMessage(chatId, message);
  for (let i = 0; i < message.length; i += 3900) {
    await bot.sendMessage(chatId, message.slice(i, i + 3900));
  }
}

function stripTelegramCommandName(text) {
  return String(text || "").replace(/^\/([a-z0-9_]+)@[^\s]+/i, "/$1");
}

function startTelegramBridge(api, runFacebookCommand) {
  if (!TELEGRAM_BOT_TOKEN) {
    log("ℹ️ Telegram bridge disabled: TELEGRAM_BOT_TOKEN missing.");
    return;
  }

  const tg = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  log("✅ Telegram bridge polling started.");

  tg.on("polling_error", (e) => log("⚠️ Telegram polling error: " + errStr(e)));
  tg.on("error", (e) => log("⚠️ Telegram error: " + errStr(e)));

  const help = [
    "🤖 Telegram control ready.",
    "",
    "/whoami - apna Telegram chat ID dekho",
    "/groups - Facebook groups list refresh karo",
    "/logs - pending logs abhi bhejo",
    "/stop - bot band karo",
    "/run @1 /groupname on New Name",
    "/g 1 /themelock on blue",
    "/g 1 /photolock on",
    "",
    "@1 ki jagah list number, group ID, ya group alias use kar sakte ho."
  ].join("\n");

  async function flushTelegramLogs(force = false) {
    if (!TELEGRAM_ALLOWED_CHAT_ID) return;
    if (!force && telegramLogQueue.length === 0) return;
    const lines = telegramLogQueue.splice(0, TELEGRAM_LOG_MAX_LINES);
    if (!lines.length) {
      if (force) await tg.sendMessage(String(TELEGRAM_ALLOWED_CHAT_ID), "📭 Abhi koi pending bot log nahi hai.");
      return;
    }
    const more = telegramLogQueue.length ? `\n\n...${telegramLogQueue.length} aur pending logs agle batch me aayenge.` : "";
    await sendTelegramLong(
      tg,
      String(TELEGRAM_ALLOWED_CHAT_ID),
      `📜 Bot logs (${lines.length})\n\n${lines.join("\n")}${more}`
    );
  }

  setInterval(() => {
    flushTelegramLogs(false).catch(e => log("⚠️ Telegram log send failed: " + errStr(e)));
  }, TELEGRAM_LOG_EVERY_MS);

  tg.on("message", async (msg) => {
    try {
      const chatId = String(msg.chat?.id || "");
      const text = stripTelegramCommandName(msg.text || "").trim();
      if (!text) return;

      if (text === "/whoami") {
        return tg.sendMessage(chatId, `Telegram chat ID: ${chatId}`);
      }

      if (!TELEGRAM_ALLOWED_CHAT_ID) {
        return tg.sendMessage(chatId, `Security ke liye TELEGRAM_ALLOWED_CHAT_ID set karo.\nAapka chat ID: ${chatId}`);
      }

      if (chatId !== String(TELEGRAM_ALLOWED_CHAT_ID)) {
        return tg.sendMessage(chatId, "⛔ Is Telegram chat ko permission nahi hai.");
      }

      if (text === "/start" || text === "/help") {
        return tg.sendMessage(chatId, help);
      }

      if (text === "/groups") {
        const groups = await refreshTelegramGroups(api);
        if (!groups.length) return tg.sendMessage(chatId, "Abhi group list empty hai. Facebook group me activity aane do ya bot ko groups me add rakho.");
        await tg.sendMessage(chatId,
          `📋 Facebook groups (${groups.length}):\n\n` +
          `💡 Kisi group ka number tap karo → command type karo → send!\n` +
          `Format: /run @NUMBER /command args`
        );
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          const num = i + 1;
          const safeTitle = g.title.replace(/[*_`[\]()~>#+=|{}.!-]/g, '\\$&');
          const msgText =
            `${num}\\. *${safeTitle}*\n` +
            `\`/run @${num} /groupname on NAME\`\n` +
            `\`/run @${num} /nicknames on NICK\`\n` +
            `\`/run @${num} /photolock on\`\n` +
            `\`/run @${num} /themelock on blue\`\n` +
            `ID: \`${g.id}\``;
          await tg.sendMessage(chatId, msgText, { parse_mode: "MarkdownV2" });
          await new Promise(r => setTimeout(r, 100)); // Small delay to avoid rate limit
        }
        await tg.sendMessage(chatId, `✅ ${groups.length} groups listed. Use: /run @1 /command`);
        return;
      }

      if (text === "/logs") {
        return flushTelegramLogs(true);
      }

      if (text === "/stop") {
        await tg.sendMessage(chatId, "🔴 Bot band ho raha hai...\nDobara start karne ke liye /start bhejo.");
        log("[Telegram command] /stop received — shutting down bot");
        saveLocks();
        setTimeout(() => process.exit(0), 1500);
        return;
      }

      const parts = text.split(/\s+/);
      const action = (parts[0] || "").toLowerCase();
      if (!["/run", "/g", "/cmd"].includes(action)) return;

      const target = parts[1];
      const command = parts.slice(2).join(" ").trim();
      if (!target || !command) {
        return tg.sendMessage(chatId, "Format use karo: /run @1 /command args\nExample: /run @1 /themelock on blue");
      }

      const groups = await refreshTelegramGroups(api);
      const selected = resolveTelegramGroupTarget(target, groups);
      if (!selected) {
        return tg.sendMessage(chatId, "Group match nahi hua. Pehle /groups bhejo, phir list number ya @alias use karo.");
      }

      await tg.sendMessage(chatId, `⏳ Running in "${selected.title}": ${command}`);
      log(`[Telegram command] ${selected.title} (${selected.id}) <= ${command}`);
      try {
        await runFacebookCommand(selected.id, command);
      } catch (commandError) {
        console.error(`[Telegram command ignored error] ${selected.title}: ${errStr(commandError)}`);
      }
      await tg.sendMessage(chatId, `✅ Command process ho gaya: ${selected.title}`);
    } catch (e) {
      console.error("[Telegram handler ignored error]", errStr(e));
      try { await tg.sendMessage(String(msg.chat?.id || ""), "Command receive ho gaya."); } catch {}
    }
  });
}


setInterval(() => {
  const now = Date.now();
  const lastEvent = Math.floor((now - lastEventTime) / 1000);
  if (botHealthy) {
    log(`💓 Bot heartbeat - Last event ${lastEvent}s ago`);
  }
}, 30 * 1000);

const loginFunc = typeof login === 'function' ? login : (login.default || login.login || login);

if (typeof loginFunc !== 'function') {
    console.error("❌ login is not a function. Check package export structure.");
    process.exit(1);
}

loginFunc({ appState, logLevel: "silent" }, async (err, api) => {
  if (err) {
    console.error("❌ Login failed:", err?.message || err);
    log("❌ CRITICAL: Login failed - " + (err?.message || JSON.stringify(err)));
    return;
  }

  // ✅ FIXED: selfListen: true (same UID se commands ke liye)
  api.setOptions({ listenEvents: true, selfListen: true, logLevel: "silent" });
  
  console.log("");
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║     👑 YOU ARE LOGGED IN TO ANURAG TH3 L3G3ND 👑      ║");
  console.log("║              🎨 THEME LOCK ENABLED 🎨                  ║");
  console.log("║                    🚀 LET'S GO! 🚀                     ║");
  console.log("╚════════════════════════════════════════════════════════╝");
  console.log("");
  
  botHealthy = true;
  const BOT_UID = api.getCurrentUserID ? api.getCurrentUserID() : null;

  log("📡 Listening for group events...");
  log("🎨 Theme protection ACTIVE!");
  log("🤖 Bot is now ACTIVE and monitoring all groups!");
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // ⚡ Startup mein sab locked groups ki photos RAM mein load karo
  const existingLocks = Object.keys(locks.groupPics || {});
  if (existingLocks.length > 0) {
    log(`⚡ Pre-loading ${existingLocks.length} locked photo(s) into RAM cache...`);
    for (const tid of existingLocks) {
      const lk = locks.groupPics[tid];
      if (lk?.file) loadPhotoCache(tid, lk.file);
      // Startup pe bada cooldown — 20s grace period taaki false trigger na ho
      photoCooldown[tid] = Date.now() + 16000; // extra 16s buffer on top of 4s check
    }
    log(`✅ Photo cache ready — 20s grace period active, then monitoring starts`);
    // Background mein baseline URLs refresh karo (CDN URLs rotate hoti hain)
    // Yeh non-blocking hai — bot ka normal flow block nahi hoga
    setTimeout(async () => {
      log(`📸 [BASELINE] Refreshing CDN URLs for ${existingLocks.length} locked thread(s)...`);
      for (const tid of existingLocks) {
        try {
          const info = await api.getThreadInfo(tid);
          const url = info?.imageSrc || info?.threadImage || info?.image || "";
          if (url && locks.groupPics?.[tid]) {
            locks.groupPics[tid].lastVerifiedUrl = url;
            saveLocks();
            log(`📸 [BASELINE] URL updated for ${tid}`);
          }
        } catch (e) {
          log(`⚠️ [BASELINE] Failed for ${tid}: ${e.message}`);
        }
        await sleep(1000);
      }
      // Baseline done — ab normal cooldown reset karo
      for (const tid of existingLocks) {
        photoCooldown[tid] = Date.now();
      }
      log(`✅ [BASELINE] All CDN URLs refreshed — photo lock monitoring ACTIVE!`);
    }, 8000); // Login ke 8s baad start karo
  }

  setInterval(saveLocks, 30 * 1000); // Har 30 sec — locks bhule nahi

  // 🔥 CONTINUOUS PHOTO SPAM — har 2 second custom locked groups mein photo set karo
  setInterval(async () => {
    const continuousThreads = Object.keys(locks.groupPics || {}).filter(tid => locks.groupPics[tid]?.continuous);
    if (continuousThreads.length === 0) return;
    for (const tid of continuousThreads) {
      const locked = locks.groupPics[tid];
      if (!locked) continue;
      if (!locked.randomMode && (!locked.file || !fs.existsSync(locked.file))) continue;
      if (revertInProgress.has(tid)) continue;
      // Startup grace period — future timestamp means still warming up
      if ((photoCooldown[tid] || 0) > Date.now()) continue;
      try {
        revertInProgress.add(tid);
        const picFile = locked.randomMode ? getRandomPhoto() : locked.file;
        const stream = fs.createReadStream(picFile);
        await api.gcphoto(stream, tid);
        photoCooldown[tid] = Date.now();
        log(`🎲 [CONTINUOUS] Set photo: ${path.basename(picFile)} in ${tid}`);
      } catch (e) {
        log(`⚠️ [CONTINUOUS] Failed for ${tid}: ${errStr(e)}`);
      } finally {
        revertInProgress.delete(tid);
      }
    }
  }, 2000);

  // 📸 PHOTO LOCK POLLING — har 5s mein check
  // DUAL detection:
  //   1. Removal → URL empty → turant revert
  //   2. Change  → URL badli → hash compare (download) → real change toh revert, CDN rotation toh skip
  // Sequential loop — concurrent downloads se bachne ke liye
  setInterval(async () => {
    const lockedThreads = Object.keys(locks.groupPics || {});
    if (lockedThreads.length === 0) return;

    for (const tid of lockedThreads) {
      const locked = locks.groupPics[tid];
      if (!locked?.file || !fs.existsSync(locked.file)) continue;
      if (locked.continuous) continue;
      if (revertInProgress.has(tid)) continue;
      const sinceSet = Date.now() - (photoCooldown[tid] || 0);
      if (sinceSet < 5000) continue;

      try {
        const info = await api.getThreadInfo(tid);
        const currentUrl = info?.imageSrc || info?.threadImage || info?.image || "";

        // ❌ Photo REMOVE hui — turant revert
        if (!currentUrl) {
          log(`📸 [POLL] Photo REMOVED in ${tid}! BURST reverting...`);
          photoCooldown[tid] = Date.now();
          burstRevertPhoto(api, tid);
          continue;
        }

        // ✅ URL same hai — koi change nahi, skip
        if (currentUrl === locked.lastVerifiedUrl) continue;

        // 🔍 URL badli — hash se verify karo (CDN rotation vs actual photo change)
        log(`📸 [POLL] URL changed in ${tid} — verifying via hash...`);
        try {
          const currentBuf = await downloadToBuffer(currentUrl);
          const currentHash = crypto.createHash("md5").update(currentBuf).digest("hex");

          // Locked photo ka hash — stored ya file se compute karo
          let lockedHash = locked.hash;
          if (!lockedHash) {
            lockedHash = computeFileHash(locked.file);
            if (lockedHash) {
              locks.groupPics[tid].hash = lockedHash;
              saveLocks();
            }
          }

          if (!lockedHash || currentHash !== lockedHash) {
            // Hash alag = photo sach mein badli — revert karo
            log(`🔒 [POLL-HASH] Photo CHANGED in ${tid}! Hash mismatch — BURST reverting!`);
            photoCooldown[tid] = Date.now();
            burstRevertPhoto(api, tid);
          } else {
            // Hash same = CDN ne URL rotate ki, photo same hai — URL update karo
            log(`📸 [POLL-HASH] CDN rotation in ${tid} — same photo, URL updated`);
            locks.groupPics[tid].lastVerifiedUrl = currentUrl;
            saveLocks();
          }
        } catch (hashErr) {
          log(`⚠️ [POLL-HASH] Hash check failed for ${tid}: ${hashErr.message} — reverting to be safe`);
          photoCooldown[tid] = Date.now();
          applyLockedPhoto(api, tid);
        }
      } catch (e) {
        log(`⚠️ [POLL] Check failed for ${tid}: ${errStr(e)}`);
      }
    }
  }, 5 * 1000);

  // 📸 RELIABLE PHOTO LOCK MONITOR — Har 3 min mein full hash check
  // Fallback: event miss ho ya poll fail kare, yeh pakad lega
  setInterval(async () => {
    const lockedThreads = Object.keys(locks.groupPics || {});
    if (lockedThreads.length === 0) return;

    for (const tid of lockedThreads) {
      const locked = locks.groupPics[tid];
      if (!locked?.file || !fs.existsSync(locked.file)) continue;
      if (locked.continuous) continue;
      if (revertInProgress.has(tid)) continue;

      try {
        const info = await api.getThreadInfo(tid);
        const currentUrl = info?.imageSrc || info?.threadImage || info?.image || "";

        // ❌ Photo completely remove hui
        if (!currentUrl) {
          log(`📸 [MONITOR] Photo MISSING in ${tid}! Reverting...`);
          photoCooldown[tid] = Date.now();
          await applyLockedPhoto(api, tid);
          await sleep(2000);
          continue;
        }

        // 🔍 Hash se verify karo — CDN rotation ignore, real change pakdo
        let lockedHash = locked.hash;
        if (!lockedHash) {
          lockedHash = computeFileHash(locked.file);
          if (lockedHash) { locks.groupPics[tid].hash = lockedHash; saveLocks(); }
        }

        if (!lockedHash) continue; // file hash nahi mila, skip

        try {
          const currentBuf = await downloadToBuffer(currentUrl);
          const currentHash = crypto.createHash("md5").update(currentBuf).digest("hex");

          if (currentHash !== lockedHash) {
            // Photo badal di ya hataya — revert karo
            log(`📸 [MONITOR] Photo CHANGED in ${tid}! Hash mismatch — reverting!`);
            photoCooldown[tid] = Date.now();
            locks.groupPics[tid].lastVerifiedUrl = currentUrl;
            await applyLockedPhoto(api, tid);
            await sleep(2000);
          } else {
            // Same photo hai — lastVerifiedUrl fresh rakho taaki 5s poll skip ho
            if (locks.groupPics[tid]) {
              locks.groupPics[tid].lastVerifiedUrl = currentUrl;
              saveLocks();
            }
          }
        } catch (hashErr) {
          log(`⚠️ [MONITOR] Hash check failed for ${tid}: ${hashErr.message}`);
        }
      } catch (e) {
        log(`⚠️ [MONITOR] Check failed for ${tid}: ${errStr(e)}`);
      }
      await sleep(1000); // Groups ke beech gap — rate limit se bachao
    }
  }, 3 * 60 * 1000); // Har 3 minutes — reliable fallback

  // 🤖🔄 BOT NICKNAME FORCE-SET — Har 5 min mein SABHI active threads mein bot ka naam SET karo
  // Event miss ho ya na ho — yeh timer guarantee karta hai ki nick hamesha sahi rahega
  setInterval(async () => {
    if (!BOT_UID || !BOT_NICKNAME) return;
    if (activeThreads.size === 0) return;

    log(`🤖 [NICK-TIMER] 5-min bot nick force-set starting for ${activeThreads.size} thread(s)...`);
    let setCount = 0;
    for (const tid of activeThreads) {
      try {
        const success = await retryChangeNick(api, tid, BOT_UID, BOT_NICKNAME, 3);
        if (success) setCount++;
      } catch (e) { /* silent */ }
    }
    log(`✅ [NICK-TIMER] Bot nick set in ${setCount}/${activeThreads.size} thread(s)`);
  }, 5 * 60 * 1000); // Har 5 minutes — force set

  // 🔄 24/7 RECONNECT — MQTT disconnect hone par turant restart
  function startMqttListen() {
    if (mqttRestarting) return;
    log("📡 Starting MQTT listener...");
    api.listenMqtt(handleMqttEvent);
  }

  async function handleMqttEvent(err, event) {
   try {
    if (err) {
      log("❌ MQTT Error: " + (err?.message || err) + " → Reconnecting in 5s...");
      botHealthy = false;
      if (!mqttRestarting) {
        mqttRestarting = true;
        await sleep(5000);
        mqttRestarting = false;
        log("🔄 Reconnecting MQTT now...");
        startMqttListen();
      }
      return;
    }
      if (!event) return;
      lastEventTime = Date.now();
      botHealthy = true;
      const threadID = String(event.threadID || "");
      const senderID = String(event.senderID || "");
      const body = (event.body || "").toString();
      const logType = event.logMessageType || "";

      // 🗂️ Track karo is thread mein activity hai — bot nick polling ke liye
      if (threadID) activeThreads.add(threadID);
      if (threadID) rememberTelegramGroup(threadID);

      if (event.type === "event") {
        const botUIDStr = String(BOT_UID || "");

        // 🎨 THEME CHANGE DETECTION
        if (["log:thread-theme", "log:thread-color", "log:thread-theme-update"].includes(logType)) {
          // Ignore agar bot ne khud yeh event trigger kiya (false revert prevention)
          if (botUIDStr && senderID === botUIDStr) {
            log(`🎨 Theme event in ${threadID} - SKIP (bot ka apna action)`);
            return;
          }
          const sinceLastRevert = Date.now() - (themeCooldown[threadID] || 0);
          if (sinceLastRevert < 2000) {
            log(`🎨 Theme event in ${threadID} - SKIP cooldown (${Math.floor(sinceLastRevert/1000)}s ago bot ne set kiya)`);
            return;
          }
          log(`🎨 Theme change detected in ${threadID} by ${senderID}`);
          const lockedTheme = locks.themes?.[threadID];
          if (lockedTheme) {
            log(`⚠️ Theme LOCK active! Reverting theme in ${threadID}...`);
            themeCooldown[threadID] = Date.now(); // Reserve cooldown pehle hi
            await sleep(50);
            await revertThemeLocked(api, threadID);
          }
          return;
        }

        if (logType === "log:thread-name") {
          const newName = event.logMessageData?.name || "";
          const lockedName = locks.groupNames?.[threadID];
          if (lockedName && newName !== lockedName) {
            log(`⚠️ Name change detected in ${threadID}: "${newName}" → reverting to "${lockedName}"`);
            await sleep(50);
            await revertGroupNameLocked(api, threadID);
          }
          return;
        }

        // 📸 PHOTO CHANGE/REMOVE DETECTION — sare photo related logTypes
        const PHOTO_EVENTS = [
          "log:thread-image", "log:thread-photo", "log:thread-image-update",
          "log:thread-icon", "log:thread-image-removed", "log:thread-photo-change",
          "log:thread-image-change"
        ];
        const isPhotoEvent = PHOTO_EVENTS.includes(logType) ||
          (logType && logType.includes("image") && !logType.includes("message")) ||
          (logType && logType.includes("photo"));

        if (isPhotoEvent) {
          log(`📸 Photo event in ${threadID}: "${logType}" by ${senderID}`);
          // Ignore agar bot ne khud photo set kiya
          if (botUIDStr && senderID === botUIDStr) {
            log(`📸 SKIP — bot ka apna action`);
            // Bot ka apna action — CDN URL background mein update karo
            setTimeout(async () => {
              try {
                const inf = await api.getThreadInfo(threadID);
                const newUrl = inf?.imageSrc || inf?.threadImage || inf?.image || "";
                if (newUrl && locks.groupPics?.[threadID]) {
                  locks.groupPics[threadID].lastVerifiedUrl = newUrl;
                  saveLocks();
                }
              } catch {}
            }, 4000);
            return;
          }
          // Safety cooldown — bot ke apne action ke turant baad false event ignore karo
          const sinceLastSet = Date.now() - (photoCooldown[threadID] || 0);
          if (sinceLastSet < 1500) {
            log(`📸 SKIP safety cooldown (${sinceLastSet}ms)`);
            return;
          }

          const locked = locks.groupPics?.[threadID];
          if (locked && locked.file) {
            // senderID ≠ bot → user ne photo change/remove kiya → TURANT REVERT
            // URL check nahi — Facebook CDN delayed update deta hai, false skip hoti thi
            log(`🔒 [EVENT] Photo change by user ${senderID} in ${threadID} — BURST reverting!`);
            photoCooldown[threadID] = Date.now();
            // 💥 Burst revert — 3 rapid attempts to ensure it sticks
            burstRevertPhoto(api, threadID).then(() => {
              // Revert ke baad background mein lastVerifiedUrl update karo
              setTimeout(async () => {
                try {
                  const inf = await api.getThreadInfo(threadID);
                  const newUrl = inf?.imageSrc || inf?.threadImage || inf?.image || "";
                  if (newUrl && locks.groupPics?.[threadID]) {
                    locks.groupPics[threadID].lastVerifiedUrl = newUrl;
                    saveLocks();
                  }
                } catch {}
              }, 5000);
            }).catch(() => {});
          } else if (locks.antiPic?.[threadID]) {
            // 🚫 ANTI-PIC: koi bhi photo set kare, turant hata do
            const sinceAnti = Date.now() - (photoCooldown[threadID] || 0);
            if (sinceAnti < 1500) {
              log(`🚫 [ANTI-PIC] Skip cooldown in ${threadID}`);
            } else {
              log(`🚫 [ANTI-PIC] Photo detected in ${threadID} by ${senderID} — REMOVING!`);
              photoCooldown[threadID] = Date.now();
              (async () => {
                try {
                  await sleep(50); // ⚡ Almost instant
                  const stream = fs.createReadStream(BLANK_PHOTO_PATH);
                  await api.gcphoto(stream, threadID);
                  log(`✅ [ANTI-PIC] Photo removed in ${threadID}`);
                } catch (e) {
                  log(`❌ [ANTI-PIC] Failed to remove photo in ${threadID}: ${errStr(e)}`);
                }
              })();
            }
          } else {
            log(`📸 Photo event in ${threadID} — no lock active, ignoring`);
          }
          return;
        }

        if (["log:user-nickname"].includes(logType)) {
          const data = event.logMessageData || {};
          const uid = String(
            data.participant_id || data.participantID || data.userID ||
            data.uid || data.id || ""
          );
          const newNick = data.nickname ?? data.newNickname ?? data.nick ?? null;

          log(`👤 [NICK-EVENT] uid="${uid}" sender="${senderID}" newNick="${newNick}" thread="${threadID}"`);

          const botUIDStr = String(BOT_UID || "");

          // Bot ka apna nickname badla — restore karo
          if (botUIDStr && uid === botUIDStr && BOT_NICKNAME) {
            await handleBotNicknameChange(api, threadID, uid, newNick, BOT_UID);
            return;
          }

          // Bot ne kisi member ka nick set kiya (bot action tha) — ignore karo
          if (botUIDStr && senderID === botUIDStr && uid !== botUIDStr) {
            log(`👤 [NICK-EVENT] Bot ne khud member ka nick set kiya — skip`);
            return;
          }

          // Normal member revert — koi member apna nick change kare
          const lockedNick = locks.nicknames?.[threadID]?.[uid];
          if (uid && lockedNick && lockedNick !== newNick) {
            log(`🔒 [NICK-REVERT] Member "${uid}" changed nick to "${newNick}" (locked: "${lockedNick}") — reverting!`);
            await revertSingleNick(api, threadID, uid);
          } else if (uid && !lockedNick) {
            log(`👤 [NICK-EVENT] uid="${uid}" has no nick lock in this thread — no action`);
          }
          return;
        }

        // 🔍 FAST PHOTO VERIFY — ANY thread event triggers quick photo check
        // Yeh detection trick hai: koi bhi group activity ho, photo verify karo
        if (locks.groupPics?.[threadID]?.file && !revertInProgress.has(threadID)) {
          const sinceLastPhotoCheck = Date.now() - (photoCooldown[threadID] || 0);
          // 8s+ hue hain since last set → quick verify karo
          if (sinceLastPhotoCheck > 8000) {
            (async () => {
              try {
                const info = await api.getThreadInfo(threadID);
                const currentUrl = info?.imageSrc || info?.threadImage || info?.image || "";
                const locked = locks.groupPics[threadID];
                if (!currentUrl && locked?.file) {
                  log(`📸 [FAST-VERIFY] Photo missing in ${threadID} after "${logType}" — BURST reverting!`);
                  photoCooldown[threadID] = Date.now();
                  burstRevertPhoto(api, threadID);
                } else if (currentUrl && currentUrl !== locked?.lastVerifiedUrl) {
                  // URL badli hai — hash verify karo (CDN rotation vs real change)
                  try {
                    const currentBuf = await downloadToBuffer(currentUrl);
                    const currentHash = crypto.createHash("md5").update(currentBuf).digest("hex");
                    let lockedHash = locked.hash || computeFileHash(locked.file);
                    if (!lockedHash) {
                      lockedHash = computeFileHash(locked.file);
                      if (lockedHash) { locks.groupPics[threadID].hash = lockedHash; saveLocks(); }
                    }
                    if (!lockedHash || currentHash !== lockedHash) {
                      log(`📸 [FAST-VERIFY] Photo CHANGED in ${threadID} after "${logType}" — BURST reverting!`);
                      photoCooldown[threadID] = Date.now();
                      burstRevertPhoto(api, threadID);
                    } else {
                      // Same photo, CDN rotation — update URL
                      locks.groupPics[threadID].lastVerifiedUrl = currentUrl;
                      saveLocks();
                    }
                  } catch {
                    // Hash check fail → revert to be safe
                    log(`📸 [FAST-VERIFY] Hash check failed in ${threadID} — BURST reverting!`);
                    photoCooldown[threadID] = Date.now();
                    burstRevertPhoto(api, threadID);
                  }
                }
              } catch (e) { /* silent */ }
            })();
          }
        }

        if (["log:subscribe"].includes(logType)) {
          const addedUsers = event.logMessageData?.addedParticipants || [];
          const wasBotAdded = addedUsers.some(u => u.userID === BOT_UID);
          if (wasBotAdded && BOT_NICKNAME) {
            log(`🤖 Bot added to group ${threadID}, setting nickname...`);
            await sleep(2000);
            await setBotNickname(api, threadID, BOT_UID);
          }
          return;
        }

        // 🔍 UNKNOWN EVENT — debug ke liye log karo (photo removal detect karne mein madad)
        if (logType && logType !== "") {
          log(`🔍 Unknown event: "${logType}" in ${threadID} by ${senderID} data:${JSON.stringify(event.logMessageData||{}).substring(0,120)}`);
        }
      }

      if (senderID !== BOSS_UID) return;
      if (!body) return;

      const parts = body.trim().split(/\s+/);
      const cmd = parts[0].replace(/^\//, "").toLowerCase();
      const args = parts.slice(1);

      if (cmd === "anurag") {
        const help = `
👑 ANURAG BOT COMMANDS 👑

🔤 /groupname on <name>
🔤 /groupname off

👤 /nicknames on <nick> (sab members)
👤 /nicknames @uid1:Raju @uid2:Bhai (alag nick)
👤 /nicknames @uid1 @uid2 Raju (same nick)
👤 /nicknames off

🤖 /botnick <name>
🤖 /botnick reset

📸 /photolock on
📸 /photolock url <link>
📸 /photolock custom
📸 /photolock off
📸 /photolock reset
📸 /photolock fastremove

🚫 /antipic on | off

🎨 /themelock on <color/name>
🎨 /themelock image <url>
🎨 /themelock ai <text>
🎨 /themelock list
🎨 /themelock off

👤 Admin: https://www.facebook.com/Anu.Anchal`.trim();
        return api.sendMessage(help, threadID);
      }

      if (cmd === "groupname") {
        const sub = (args[0] || "").toLowerCase();
        if (sub === "on") {
          const name = args.slice(1).join(" ");
          if (!name) return api.sendMessage("⚠️ Usage: /groupname on <Name>", threadID);
          log(`[Groupname] Lock ON requested in ${threadID}: ${name}`);
          locks.groupNames[threadID] = name;
          saveLocks();
          await enqueueNameTask(async () => {
            const success = await retrySetTitle(api, threadID, name, 6);
            try {
              if (success) {
                await api.sendMessage(`🔒 Name locked: "${name}"`, threadID);
                log(`✅ Group name locked: ${name} in ${threadID}`);
              } else {
                await api.sendMessage(`❌ Failed to lock name`, threadID);
              }
            } catch (msgErr) {
              log(`⚠️ Could not send name lock confirmation: ${errStr(msgErr)}`);
            }
          });
          return;
        }
        if (sub === "off") {
          delete locks.groupNames[threadID];
          saveLocks();
          log(`[Groupname] Lock OFF in ${threadID}`);
          try {
            return await api.sendMessage("🔓 Name lock off.", threadID);
          } catch (msgErr) {
            log(`[Groupname] Lock OFF done, but Facebook reply failed in ${threadID}: ${errStr(msgErr).split("\n")[0]}`);
            return;
          }
        }
      }

      if (cmd === "nicknames") {
        const sub = (args[0] || "").toLowerCase();

        // 🔥 @mention se specific UID ka nick lock — colon format for different nick per UID
        // Format 1: /nicknames @uid1:Raju @uid2:Bhai (har UID ka alag nick)
        // Format 2: /nicknames @uid1 @uid2 Raju (sabko same nick)
        const uidNickPairs = [];  // [{uid, nick}]
        const remainingArgs = [];

        for (const arg of args) {
          // Check colon format: @uid:nick or uid:nick
          const colonMatch = arg.match(/^@?(\d{4,}):(.+)$/);
          if (colonMatch) {
            uidNickPairs.push({ uid: colonMatch[1], nick: colonMatch[2] });
            continue;
          }
          // Check plain UID: @uid or uid
          const uidMatch = arg.match(/^@?(\d{4,})$/);
          if (uidMatch) {
            uidNickPairs.push({ uid: uidMatch[1], nick: null }); // nick baad mein set hoga
          } else {
            remainingArgs.push(arg);
          }
        }

        // Agar colon format nahi use hua, toh baaki args se nick lo (backward compat)
        const sharedNick = remainingArgs.join(" ");
        let colonMode = false;
        for (const pair of uidNickPairs) {
          if (pair.nick === null) {
            if (!sharedNick) {
              return api.sendMessage(
                `⚠️ Usage:\n` +
                `/nicknames @uid1:Raju @uid2:Bhai (alag nick)\n` +
                `/nicknames @uid1 @uid2 Raju (same nick)`,
                threadID
              );
            }
            pair.nick = sharedNick;
          } else {
            colonMode = true;
          }
        }

        if (uidNickPairs.length > 0) {
          const formatLabel = colonMode ? "alag-alag nick" : `"${sharedNick}"`;
          await api.sendMessage(`⏳ Setting ${formatLabel} for ${uidNickPairs.length} UID(s)...`, threadID);
          if (!locks.nicknames[threadID]) locks.nicknames[threadID] = {};
          let successCount = 0;
          let summary = [];
          for (const { uid, nick } of uidNickPairs) {
            const success = await retryChangeNick(api, threadID, uid, nick, 5);
            if (success) {
              locks.nicknames[threadID][uid] = nick;
              successCount++;
              summary.push(`${uid} → "${nick}"`);
            } else {
              summary.push(`${uid} → FAILED`);
            }
          }
          saveLocks();
          return api.sendMessage(
            `✅ Nick locked: ${successCount}/${uidNickPairs.length}\n🔒 ${summary.join("\n")}`,
            threadID
          );
        }

        if (sub === "on") {
          const nick = args.slice(1).join(" ");
          if (!nick) return api.sendMessage("⚠️ Usage: /nicknames on <Nick>", threadID);
          await api.sendMessage(`⏳ Setting nicknames...`, threadID);
          await enforceNickLockForThread(api, threadID, nick);
          return api.sendMessage(`✅ Nick locked: "${nick}"`, threadID);
        }
        if (sub === "off") {
          const existed = locks.nicknames[threadID];
          if (existed) {
            for (const uid of Object.keys(existed)) await retryChangeNick(api, threadID, uid, "", 5);
            delete locks.nicknames[threadID];
            saveLocks();
            return api.sendMessage("🔓 Nick lock off.", threadID);
          }
          return api.sendMessage("⚠️ No nick lock here.", threadID);
        }
      }
      
      if (cmd === "botnick") {
        if (!BOT_UID) return api.sendMessage("❌ Bot UID not available", threadID);
        
        const sub = (args[0] || "").toLowerCase();
        
        if (sub === "reset") {
          const success = await retryChangeNick(api, threadID, BOT_UID, BOT_NICKNAME, 5);
          if (success) {
            return api.sendMessage(`✅ Bot nick reset.`, threadID);
          } else {
            return api.sendMessage(`❌ Failed.`, threadID);
          }
        }
        
        const newNick = args.join(" ");
        if (!newNick) {
          return api.sendMessage(`⚠️ Usage: /botnick <name> | /botnick reset`, threadID);
        }
        
        const success = await retryChangeNick(api, threadID, BOT_UID, newNick, 5);
        if (success) {
          return api.sendMessage(`✅ Bot nick: "${newNick}"`, threadID);
        } else {
          return api.sendMessage(`❌ Failed.`, threadID);
        }
      }

      if (cmd === "photolock") {
        const sub = (args[0] || "").toLowerCase();

        const fetchThreadImageUrl = async () => {
          try {
            const info = await api.getThreadInfo(threadID);
            return info?.imageSrc || info?.threadImage || info?.image || "";
          } catch { return ""; }
        };

        const setGroupPhoto = async (filePath) => {
          if (typeof api.gcphoto === 'function') {
            await api.gcphoto(fs.createReadStream(filePath), threadID);
          } else {
            const fallback = api.changeGroupImage || api.setGroupImage;
            if (typeof fallback !== 'function') throw new Error("No group photo API available");
            await fallback.call(api, fs.createReadStream(filePath), threadID);
          }
        };

        if (sub === "on") {
          // ✅ Custom photo assets se uthao, group mein set karo, aur lock karo
          if (!fs.existsSync(CUSTOM_PHOTO_PATH)) {
            return api.sendMessage("❌ Custom photo not found in assets folder.", threadID);
          }
          const filename = path.join(PHOTOS_DIR, `${threadID}_locked.jpg`);
          try {
            await api.sendMessage(`⏳ Setting photo lock...`, threadID);
            fs.copyFileSync(CUSTOM_PHOTO_PATH, filename);
            // Group mein custom photo set karo
            await setGroupPhoto(filename);
            photoCooldown[threadID] = Date.now();
            // CDN URL fetch karo aur uska hash store karo (accurate change detection ke liye)
            await sleep(3000);
            let cdnHash = null;
            let cdnUrl = "";
            try {
              const tInfo = await api.getThreadInfo(threadID);
              cdnUrl = tInfo?.imageSrc || tInfo?.threadImage || tInfo?.image || "";
              if (cdnUrl) {
                const cdnBuf = await downloadToBuffer(cdnUrl);
                // CDN version bhi local mein save karo (future reverts ke liye consistent)
                fs.writeFileSync(filename, cdnBuf);
                cdnHash = crypto.createHash("md5").update(cdnBuf).digest("hex");
              }
            } catch (hashErr) {
              log(`⚠️ Could not fetch CDN hash: ${hashErr.message}`);
            }
            locks.groupPics[threadID] = { file: filename, url: "custom", hash: cdnHash, lastVerifiedUrl: cdnUrl };
            saveLocks();
            loadPhotoCache(threadID, filename);
            log(`✅ Photolock ON for ${threadID} — custom photo set from assets`);
            await api.sendMessage("🔒 Photo locked!", threadID);
          } catch (e) {
            log("❌ photolock on error: " + e.message);
            await api.sendMessage("❌ Failed to set photo lock: " + e.message, threadID);
          }
          return;
        }

        // 🔗 URL se photo download karke lock karo — instant revert
        if (sub === "url") {
          const photoUrl = args.slice(1).join("").trim();
          if (!photoUrl || !photoUrl.startsWith("http")) {
            return api.sendMessage(`⚠️ Usage: /photolock url <link>`, threadID);
          }
          const extMatch = photoUrl.match(/\.(jpg|jpeg|png|webp)/i);
          const ext = extMatch ? extMatch[1] : "jpg";
          const filename = path.join(PHOTOS_DIR, `${threadID}_url.${ext}`);
          await api.sendMessage(`⏳ Downloading...`, threadID);
          try {
            await downloadToFile(photoUrl, filename);
            // Group mein set karo
            await setGroupPhoto(filename);
            const urlPhotoHash = computeFileHash(filename);
            locks.groupPics[threadID] = { file: filename, url: photoUrl, hash: urlPhotoHash, lastVerifiedUrl: photoUrl };
            saveLocks();
            loadPhotoCache(threadID, filename);
            photoCooldown[threadID] = Date.now();
            log(`✅ URL photolock set in ${threadID}`);
            await api.sendMessage(`🔒 Photo locked.`, threadID);
          } catch (e) {
            log("❌ url photolock error: " + e.message);
            await api.sendMessage("❌ Photo download/set failed: " + e.message, threadID);
          }
          return;
        }

        if (sub === "custom") {
          if (!fs.existsSync(CUSTOM_PHOTO_PATH)) {
            return api.sendMessage("❌ Custom image not found on server.", threadID);
          }
          const filename = path.join(PHOTOS_DIR, `${threadID}_custom.jpg`);
          try {
            fs.copyFileSync(CUSTOM_PHOTO_PATH, filename);
            await setGroupPhoto(filename);
            locks.groupPics[threadID] = { file: filename, url: "custom", continuous: true, randomMode: true };
            saveLocks();
            loadPhotoCache(threadID, filename);
            photoCooldown[threadID] = Date.now();
            log(`✅ Custom RANDOM continuous lock in ${threadID}`);
            const randomCount = (() => { try { return fs.readdirSync(RANDOM_PHOTOS_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).length; } catch { return 0; } })();
            await api.sendMessage(`🎲 Random photo loop ON. (${randomCount > 0 ? randomCount + " photos" : "add pics to assets/random/"})`, threadID);
          } catch (e) {
            log("❌ custom photo error: " + e.message);
            await api.sendMessage("❌ Failed to set custom photo: " + e.message, threadID);
          }
          return;
        }

        if (sub === "off") {
          delete locks.groupPics[threadID];
          saveLocks();
          return api.sendMessage("🔓 Photo lock off.", threadID);
        }

        if (sub === "reset") {
          const locked = locks.groupPics?.[threadID];
          if (locked?.file && fs.existsSync(locked.file)) {
            try {
              await setGroupPhoto(locked.file);
              return api.sendMessage("🔁 Photo re-applied.", threadID);
            } catch (e) {
              return api.sendMessage("❌ Failed to reset photo: " + e.message, threadID);
            }
          } else return api.sendMessage("⚠️ No locked photo. Use /photolock on first.", threadID);
        }

        if (sub === "fastremove") {
          const lockedThreads = Object.keys(locks.groupPics || {});
          if (lockedThreads.length === 0) {
            return api.sendMessage("⚠️ No active photo locks to remove.", threadID);
          }
          let removed = 0;
          for (const tid of lockedThreads) {
            delete locks.groupPics[tid];
            delete photoCooldown[tid];
            removed++;
          }
          saveLocks();
          return api.sendMessage(`💥 ${removed} lock(s) removed.`, threadID);
        }

        const has = locks.groupPics?.[threadID] ? "ON 🟢" : "OFF 🔴";
        const lockedCount = Object.keys(locks.groupPics || {}).length;
        return api.sendMessage(
          `📸 Photo lock: ${has} | Groups: ${lockedCount}\n` +
          `/photolock on | url <link> | custom | off | reset | fastremove`,
          threadID
        );
      }

      // 🚫 ANTI-PIC COMMAND — Koi bhi photo set kare, automatically hata do
      if (cmd === "antipic") {
        const sub = (args[0] || "").toLowerCase();

        if (sub === "on") {
          locks.antiPic[threadID] = true;
          saveLocks();
          return api.sendMessage(`🚫 Anti-pic ON.`, threadID);
        }

        if (sub === "off") {
          delete locks.antiPic[threadID];
          saveLocks();
          return api.sendMessage(`✅ Anti-pic OFF.`, threadID);
        }

        const antiStatus = locks.antiPic?.[threadID] ? "ON 🟢" : "OFF 🔴";
        return api.sendMessage(`🚫 Anti-pic: ${antiStatus}\n/antipic on | off`, threadID);
      }

      // 🎨 THEMELOCK COMMAND
      if (cmd === "themelock") {
        const sub = (args[0] || "").toLowerCase();

        if (sub === "on") {
          const colorOrName = args.slice(1).join(" ").trim();
          
          if (!colorOrName) {
            return api.sendMessage(`⚠️ Usage: /themelock on <color/name>\nColors: blue purple green pink orange red yellow teal black white`, threadID);
          }

          const knownColorId = THEME_COLORS[colorOrName.toLowerCase()];

          if (knownColorId) {
            await api.sendMessage(`🎨 Setting color theme: ${colorOrName}...`, threadID);
            const success = await setTheme(api, threadID, knownColorId, "👍", 5);
            if (success) {
              locks.themes[threadID] = { themeId: knownColorId, color: colorOrName, emoji: "👍" };
              themeCooldown[threadID] = Date.now();
              saveLocks();
              return api.sendMessage(
                `THEMELOCK ${colorOrName.toUpperCase()}() 🔒`,
                threadID
              );
            } else {
              return api.sendMessage(`❌ Failed to set color theme`, threadID);
            }
          }

          // Try by theme name using api.theme
          if (typeof api.theme === 'function') {
            await api.sendMessage(`🎨 Searching theme: "${colorOrName}"...`, threadID);
            try {
              const result = await new Promise((resolve, reject) => {
                api.theme(colorOrName, threadID, (err, data) => {
                  if (err) reject(err);
                  else resolve(data);
                });
              });
              
              const themeId = result?.themeID || result?.themeId || result?.theme_id;
              const themeName = result?.themeName || colorOrName;

              locks.themes[threadID] = { themeId: themeId || colorOrName, color: themeName, emoji: "👍", byName: true };
              themeCooldown[threadID] = Date.now();
              saveLocks();
              return api.sendMessage(
                `THEMELOCK ${themeName.toUpperCase()}() 🔒`,
                threadID
              );
            } catch (e) {
              log(`❌ api.theme error: ${e.message}`);
              return api.sendMessage(`❌ Theme "${colorOrName}" not found. Use /themelock list.`, threadID);
            }
          } else {
            return api.sendMessage(`❌ Theme by name not supported in this package version.`, threadID);
          }
        }

        // 🖼️ CUSTOM IMAGE THEME - from URL or photo attachment
        if (sub === "image") {
          let imageUrl = args.slice(1).join(" ").trim();

          // Check message attachments if no URL provided
          if (!imageUrl && event.attachments && event.attachments.length > 0) {
            const att = event.attachments[0];
            imageUrl = att.url || att.largePreviewUrl || att.previewUrl || att.original_extension_url || att.previewUrlFallback || "";
            if (imageUrl) log(`📎 Got image URL from attachment: ${imageUrl}`);
          }

          // Use bot's preset custom image via public URL
          if (!imageUrl && REPLIT_DOMAIN) {
            imageUrl = `https://${REPLIT_DOMAIN}/bot-assets/custom_bot_photo.jpg`;
            log(`🖼️ Using preset custom image: ${imageUrl}`);
          }

          if (!imageUrl) {
            return api.sendMessage(`⚠️ Usage: /themelock image <url>`, threadID);
          }

          if (typeof api.produceMetaTheme !== 'function') {
            return api.sendMessage("❌ Not supported. Try /themelock list.", threadID);
          }

          await api.sendMessage("⏳ Generating theme...", threadID);

          try {
            const result = await new Promise((resolve, reject) => {
              api.produceMetaTheme("dark dramatic warrior style", { imageUrl, numThemes: 1 }, (err, data) => {
                if (err) reject(err);
                else resolve(data);
              });
            });

            log(`🎨 produceMetaTheme result: ${JSON.stringify(result).slice(0, 300)}`);

            const themeId = result?.themeId || result?.themes?.[0]?.themeId;
            const themeName = result?.name || result?.themes?.[0]?.name || "Custom AI Theme";
            const bgImage = result?.backgroundImage || result?.themes?.[0]?.backgroundImage || "";

            if (!themeId) throw new Error("No theme ID in response");

            await api.sendMessage(`⏳ Applying "${themeName}"...`, threadID);
            const success = await setTheme(api, threadID, themeId, "👊", 5);

            if (success) {
              locks.themes[threadID] = { themeId, color: themeName, emoji: "👊", byName: false, imageTheme: true };
              themeCooldown[threadID] = Date.now();
              saveLocks();
              return api.sendMessage(
                `THEMELOCK ${themeName.toUpperCase()}() 🔒`,
                threadID
              );
            } else {
              return api.sendMessage(`❌ Theme generated but failed to apply. Theme ID: ${themeId}`, threadID);
            }
          } catch (e) {
            log(`❌ produceMetaTheme error: ${errStr(e)}`);
            try {
              await api.sendMessage(`❌ Theme failed. Try /themelock list`, threadID);
            } catch (msgErr) {
              log(`⚠️ Could not send error message: ${errStr(msgErr)}`);
            }
          }
        }

        // 🤖 AI THEME FROM TEXT PROMPT
        if (sub === "ai") {
          const prompt = args.slice(1).join(" ").trim();
          if (!prompt) {
            return api.sendMessage(`⚠️ Usage: /themelock ai <description>`, threadID);
          }

          if (typeof api.produceMetaTheme !== 'function') {
            return api.sendMessage("❌ Not supported. Try /themelock list.", threadID);
          }

          await api.sendMessage(`⏳ Generating AI theme...`, threadID);

          try {
            const result = await new Promise((resolve, reject) => {
              api.produceMetaTheme(prompt, { numThemes: 1 }, (err, data) => {
                if (err) reject(err);
                else resolve(data);
              });
            });

            const themeId = result?.themeId || result?.themes?.[0]?.themeId;
            const themeName = result?.name || result?.themes?.[0]?.name || "AI Theme";

            if (!themeId) throw new Error("No theme ID returned");

            await api.sendMessage(`🎨 Applying "${themeName}"...`, threadID);
            const success = await setTheme(api, threadID, themeId, "🤖", 5);

            if (success) {
              locks.themes[threadID] = { themeId, color: themeName, emoji: "🤖", byName: false, imageTheme: true };
              themeCooldown[threadID] = Date.now();
              saveLocks();
              return api.sendMessage(
                `THEMELOCK ${themeName.toUpperCase()}() 🔒`,
                threadID
              );
            } else {
              return api.sendMessage(`❌ AI theme generated but failed to apply.`, threadID);
            }
          } catch (e) {
            log(`❌ AI theme error: ${errStr(e)}`);
            try {
              await api.sendMessage(`❌ AI theme generation failed. Try: /themelock list`, threadID);
            } catch {}
          }
        }

        if (sub === "list") {
          await api.sendMessage(`⏳ Fetching themes...`, threadID);
          if (typeof api.theme === 'function') {
            try {
              const themes = await new Promise((resolve, reject) => {
                api.theme("list", threadID, (err, data) => {
                  if (err) reject(err);
                  else resolve(data);
                });
              });

              if (Array.isArray(themes) && themes.length > 0) {
                const chunks = [];
                let chunk = "🎨 AVAILABLE FACEBOOK THEMES:\n\n";
                themes.forEach((t, i) => {
                  const line = `${i + 1}. ${t.name}${t.backgroundImage ? " 🖼️" : ""}\n`;
                  if (chunk.length + line.length > 1800) {
                    chunks.push(chunk);
                    chunk = "";
                  }
                  chunk += line;
                });
                if (chunk) chunks.push(chunk);
                chunks[chunks.length - 1] += `\n🖼️ = Has image background\n\nUse: /themelock on <theme name>`;
                for (const c of chunks) {
                  await api.sendMessage(c, threadID);
                }
              } else {
                await api.sendMessage("⚠️ No themes found or could not fetch.", threadID);
              }
            } catch (e) {
              log(`❌ theme list error: ${e.message}`);
              await api.sendMessage(`❌ Failed to fetch themes: ${e.message}`, threadID);
            }
          } else {
            await api.sendMessage(`🎨 Colors: blue purple green pink orange red yellow teal black white\nUse: /themelock on <color>`, threadID);
          }
          return;
        }

        if (sub === "off") {
          if (locks.themes?.[threadID]) {
            delete locks.themes[threadID];
            saveLocks();
            return api.sendMessage("🔓 Theme unlocked", threadID);
          }
          return api.sendMessage("⚠️ No theme locked in this group", threadID);
        }

        if (sub === "status") {
          const themeLock = locks.themes?.[threadID];
          if (themeLock) {
            return api.sendMessage(`🔒 Theme: ${themeLock.color || themeLock.themeId}`, threadID);
          }
          return api.sendMessage("🔓 Theme lock OFF.", threadID);
        }

        return api.sendMessage(
          `🎨 Themelock:\n` +
          `/themelock on <color/name>\n` +
          `/themelock image <url>\n` +
          `/themelock ai <text>\n` +
          `/themelock list | off | status`,
          threadID
        );
      }

    } catch (e) {
      log("❌ Handler error: " + errStr(e));
    }
  } // end handleMqttEvent

  startTelegramBridge(api, async (targetThreadID, commandText) => {
    const originalSendMessage = api.sendMessage;
    api.sendMessage = async (...args) => {
      try {
        return await originalSendMessage.apply(api, args);
      } catch (sendErr) {
        console.error("[Telegram safe sendMessage ignored]", errStr(sendErr));
        return null;
      }
    };
    try {
      await handleMqttEvent(null, {
        type: "message",
        threadID: String(targetThreadID),
        senderID: String(BOSS_UID),
        body: String(commandText || ""),
        attachments: [],
        fromTelegram: true
      });
    } finally {
      api.sendMessage = originalSendMessage;
    }
  });

  // ⚡ Start listening
  startMqttListen();

  // 🔄 WATCHDOG — agar 10 min se koi event nahi aaya toh MQTT restart karo
  setInterval(() => {
    const silentMs = Date.now() - lastEventTime;
    if (silentMs > 10 * 60 * 1000 && !mqttRestarting) {
      log(`⚠️ WATCHDOG: No event in ${Math.floor(silentMs/60000)}min — restarting MQTT...`);
      mqttRestarting = true;
      sleep(2000).then(() => {
        mqttRestarting = false;
        startMqttListen();
      });
    }
  }, 2 * 60 * 1000); // Har 2 min check

  // 🔥 10-MIN NICKNAME RE-ENFORCE — Sab locked UIDs ka naam barabar rakho
  setInterval(async () => {
    const threadLocks = locks.nicknames || {};
    const lockedThreads = Object.keys(threadLocks);
    if (lockedThreads.length === 0) return;

    log(`🔥 [NICK-10MIN] Re-enforcing nick locks for ${lockedThreads.length} thread(s)...`);
    for (const tid of lockedThreads) {
      const uidLocks = threadLocks[tid];
      if (!uidLocks || Object.keys(uidLocks).length === 0) continue;

      for (const [uid, lockedNick] of Object.entries(uidLocks)) {
        try {
          // Pehle current nick check karo - agar already sahi hai toh skip
          const info = await api.getThreadInfo(tid);
          const currentNick = getThreadNickname(info, uid);
          if (currentNick === lockedNick) continue; // Already sahi hai

          log(`🔥 [NICK-10MIN] ${uid} in ${tid}: "${currentNick}" → "${lockedNick}"`);
          await retryChangeNick(api, tid, uid, lockedNick, 3);
          await sleep(200);
        } catch (e) {
          log(`⚠️ [NICK-10MIN] Failed for ${uid} in ${tid}: ${e.message}`);
        }
      }
      await sleep(500);
    }
    log(`✅ [NICK-10MIN] Re-enforce complete`);
  }, 10 * 60 * 1000); // Har 10 minutes

});

process.on("SIGINT", () => {
  log("⚠️ SIGINT received - NOT exiting, keeping bot alive");
});
process.on("SIGTERM", () => {
  log("🔴 SIGTERM received - Shutting down bot gracefully...");
  saveLocks();
  process.exit(0);
});

setInterval(() => {}, 60000);
