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
const config = require("./config");
const { handleMessage } = require("./lib/handler");

const logger = pino({ level: "silent" });

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

  console.log(`[wa2shell] Starting WhatsApp engine... (Baileys v${version.join(".")}, Latest: ${isLatest})`);

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: !config.usePairingCode,
    auth: state,
    browser: ["Ubuntu", "Chrome", "120.0.0.0"],
    syncFullHistory: false,
  });

  // Pairing Code Support (Headless VPS friendly)
  if (config.usePairingCode && !sock.authState.creds.registered) {
    let phoneNumber = config.botPhoneNumber;
    if (!phoneNumber) {
      phoneNumber = await askQuestion("[wa2shell] Masukkan nomor WhatsApp Bot Anda (format: 628xxxxxxxxxx): ");
    }
    phoneNumber = phoneNumber.replace(/[^0-9]/g, "");

    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log("\n=======================================================");
        console.log(`  KODE PAIRING WHATSAPP ANDA:  ${code}`);
        console.log("=======================================================\n");
        console.log("Buka WhatsApp di HP Anda -> Titik Tiga / Pengaturan -> Perangkat Tertaut -> Tautkan Perangkat -> Tautkan dengan nomor telepon saja -> Masukkan kode di atas.\n");
      } catch (err) {
        console.error("[wa2shell] Gagal meminta Pairing Code:", err.message);
      }
    }, 3000);
  }

  // Save authentication credentials whenever updated
  sock.ev.on("creds.update", saveCreds);

  // Connection events
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !config.usePairingCode) {
      console.log("[wa2shell] Silakan scan QR Code di bawah ini untuk menghubungkan bot:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[wa2shell] Koneksi terputus: ${lastDisconnect?.error?.message || "Unknown"}. Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log("[wa2shell] Logout terdeteksi. Silakan hapus folder session/ dan jalankan ulang untuk pairing baru.");
      }
    } else if (connection === "open") {
      console.log("=======================================================");
      console.log(`  WA2SHELL BERHASIL TERHUBUNG KE WHATSAPP!`);
      console.log(`  Nomor Akun : ${sock.user?.id?.split(":")[0]}`);
      console.log(`  Model AGY  : ${config.agy.defaultModel}`);
      console.log(`  Dir Kerja  : ${config.agy.workDir}`);
      console.log("=======================================================");
    }
  });

  // Message events
  sock.ev.on("messages.upsert", async (m) => {
    try {
      await handleMessage(sock, m);
    } catch (err) {
      console.error("[wa2shell] Error processing message:", err);
    }
  });
}

startBot().catch((err) => {
  console.error("[wa2shell] Fatal error starting bot:", err);
});
