const fs = require("fs");
const file = "/root/wa2shell/lib/handler.js";
let content = fs.readFileSync(file, "utf8");

// 1. Update top docblock
content = content.replace("Message Handler (v1.7.0)", "Message Handler (v1.8.0)");
content = content.replace(
  "Features:\n * - Strict Reply-to-Bot Isolation",
  "Features:\n * - Full-Spectrum Action Tag Dispatcher (SEND_VN, POST_SALURAN, JOIN/LEAVE_GROUP, RESTART_BOT) (v1.8.0)\n * - VPS IP Privacy Shield & Sanitizer (v1.8.0)\n * - Line Slicing for File Inspection (.cat [n] <path>) (v1.8.0)\n * - Strict Reply-to-Bot Isolation"
);

// 2. Update .help / .menu
content = content.replace(
  "`⏰ *Cron & Service Ops (v1.7.0)*\\n`",
  "`⏰ *Cron & Service Ops (v1.8.0)*\\n`"
);
content = content.replace(
  "`• \\`.cat <path>\\` — Display text file with auto-spillover\\n`",
  "`• \\`.cat [lines] <path>\\` — Display text file or line slice with auto-spillover\\n`"
);

// 3. Update .version notes
const oldV = `    const git = getCurrentGitInfo();
    const notes =
      \`🚀 *wa2shell v\${pkg.version}* (\`\${git.branch || "main"}@\${git.shortHash || "local"}\`)\\n\\n\` +
      \`*What's New in v1.7.0:*\\n\` +
      \`• 🛡️ *Strict Reply-to-Bot Isolation:* Bot hanya merespons reply ke pesan bot sendiri — reply antar user lain tidak akan membajak AI tanpa prefix.\\n\` +
      \`• 🖼️ *Media-Without-Prefix Guard:* Foto/video/dokumen tanpa prefix tidak akan memicu sistem secara tidak sengaja.\\n\` +
      \`• 👁️ *Multimodal Vision Context:* Kirim atau reply gambar dengan \\\`.ai <prompt>\\\` untuk analisa visual langsung.\\n\` +
      \`• ⏰ *Autonomous Cron Scheduler:* Jadwalkan perintah shell/AI berkala via \\\`.cron\\\`.\\n\` +
      \`• ⚙️ *Quick Service & Net Ops:* Kontrol PM2 instan (\\\`.pm2\\\`) & diagnosa jaringan (\\\`.net\\\`).\`;`;

const newV = `    const git = getCurrentGitInfo();
    const notes =
      \`🚀 *wa2shell v\${pkg.version}* (\`\${git.branch || "main"}@\${git.shortHash || "local"}\`)\\n\\n\` +
      \`*What's New in v1.8.0:*\\n\` +
      \`• 🎙️ *Full-Spectrum Action Tags:* Dukungan tag \\\`[[SEND_VN]]\\\` (otomatis convert Opus PTT), \\\`[[POST_SALURAN]]\\\`, \\\`[[JOIN_GROUP]]\\\`, \\\`[[LEAVE_GROUP]]\\\`, dan \\\`[[RESTART_BOT]]\\\`.\\n\` +
      \`• 🛡️ *VPS IP Privacy Shield:* Sensor otomatis alamat IP publik VPS menjadi \\\`[IP disembunyikan]\\\` di seluruh respon shell dan output AI.\\n\` +
      \`• 📄 *Smart Line Slicing:* Perintah \\\`.cat [lines] <path>\\\` kini dapat membaca N baris pertama tanpa repot tail/head manual.\\n\` +
      \`• ⚡ *Upgraded Typography & Stability:* Penyelarasan format WhatsApp native dan ketahanan eksekusi perintah.\`;`;

if (content.includes(oldV)) {
  content = content.replace(oldV, newV);
  fs.writeFileSync(file, content, "utf8");
  console.log("Successfully updated handler.js metadata & version notes!");
} else {
  console.error("oldV not found in handler.js!");
  process.exit(1);
}
