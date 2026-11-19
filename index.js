/**
 * wa2shell — Main Entry Point
 * Initializes Baileys WhatsApp Socket and links message handlers.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const readline = require("readline");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
let config = require("./config");
let handlerModule = require("./lib/handler");
const pkg = require("./package.json");

const logger = pino({ level: "silent" });

// Dynamic Module Reloader (Zero-Downtime Hot Reload)
function reloadModules() {
  const libDir = path.join(__dirname, "lib");
  const configPath = path.join(__dirname, "config.js");

  Object.keys(require.cache).forEach((key) => {
    if (key === configPath || key.startsWith(libDir)) {
      delete require.cache[key];
    }
  });

  config = require("./config");
  handlerModule = require("./lib/handler");
  return true;
}

// Watch lib/ and config.js for file modifications
function initHotReload() {
  const watchTargets = [
    path.join(__dirname, "config.js"),
    path.join(__dirname, "lib"),
  ];

  let debounceTimer = null;
  watchTargets.forEach((target) => {
    if (!fs.existsSync(target)) return;
    try {
      fs.watch(target, { recursive: true }, (eventType, filename) => {
        if (!filename || (!filename.endsWith(".js") && !filename.endsWith(".json"))) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          try {
            reloadModules();
            console.log(`[wa2shell] [HOT-RELOAD] Successfully refreshed modules after change in ${filename}`);
          } catch (err) {
            console.error(`[wa2shell] [HOT-RELOAD ERROR] Failed to reload ${filename}:`, err.message);
          }
        }, 150);
      });
    } catch (e) {
      console.warn(`[wa2shell] Watcher error on ${target}:`, e.message);
    }
  });
}

async function askQuestion(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.paths.session);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`[wa2shell] Initializing WhatsApp socket... (Baileys v${version.join(".")}, Latest: ${isLatest})`);

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: !config.usePairingCode,
    auth: state,
    browser: ["Ubuntu", "Chrome", "120.0.0.0"],
    syncFullHistory: false,
  });

  // Pairing code registration for headless servers
  if (config.usePairingCode && !sock.authState.creds.registered) {
    let phoneNumber = config.botPhoneNumber;
    if (!phoneNumber) {
      phoneNumber = await askQuestion("[wa2shell] Enter bot WhatsApp phone number (international format, e.g. 14155552671): ");
    }
    phoneNumber = phoneNumber.replace(/[^0-9]/g, "");

    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log("\n=======================================================");
        console.log(`  WHATSAPP PAIRING CODE:  ${code}`);
        console.log("=======================================================\n");
        console.log("Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device -> Link with phone number instead -> Enter the code above.\n");
      } catch (err) {
        console.error("[wa2shell] Failed to request pairing code:", err.message);
      }
    }, 3000);
  }

  // Persist session credentials whenever updated
  sock.ev.on("creds.update", saveCreds);

  // Connection state listeners
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !config.usePairingCode) {
      console.log("[wa2shell] Scan the QR code below to authenticate the bot:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[wa2shell] Connection closed: ${lastDisconnect?.error?.message || "Unknown reason"}. Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log("[wa2shell] Device logged out. Remove the ./session directory and restart to pair a new device.");
      }
    } else if (connection === "open") {
      console.log("=======================================================");
      console.log(`  WA2SHELL CONNECTED SUCCESSFULLY! (v${pkg.version})`);
      console.log(`  Bot Account   : ${sock.user?.id?.split(":")[0]}`);
      console.log(`  Active Model  : ${config.agy.defaultModel}`);
      console.log(`  Working Dir   : ${config.agy.workDir}`);
      console.log("=======================================================");

      const ownerJid = config.ownerNumber ? config.ownerNumber + "@s.whatsapp.net" : null;
      try {
        const { startAutoUpdater } = require("./lib/updater");
        startAutoUpdater(sock, ownerJid, reloadModules);
      } catch (e) {
        console.warn("[wa2shell] Auto-updater init warning:", e.message);
      }
      try {
        const { startHealthWatchdog } = require("./lib/health");
        startHealthWatchdog(sock, ownerJid, reloadModules);
      } catch (e) {
        console.warn("[wa2shell] Health watchdog init warning:", e.message);
      }
      try {
        const { startScheduler } = require("./lib/scheduler");
        startScheduler(sock);
      } catch (e) {
        console.warn("[wa2shell] Scheduler init warning:", e.message);
      }
    }
  });

  // Initialize Zero-Downtime Hot Reload watcher
  initHotReload();

  // Inbound message stream
  sock.ev.on("messages.upsert", async (m) => {
    try {
      await handlerModule.handleMessage(sock, m, { reloadModules });
    } catch (err) {
      console.error("[wa2shell] Error processing inbound message:", err);
    }
  });
}

startBot().catch((err) => {
  console.error("[wa2shell] Fatal error starting daemon:", err);
});
