# wa2shell ⚡

> **WhatsApp to Shell** — Autonomous Linux Server & Antigravity Agent Controller over WhatsApp.

`wa2shell` menghubungkan WhatsApp secara langsung ke **Antigravity CLI (`agy`)** dan shell Linux Anda. Mengontrol VPS/server, menjalankan command bash, menginspeksi file, coding, hingga interaksi AI multimodal dapat dilakukan langsung dari ruang obrolan WhatsApp secara aman dan real-time.

---

## 🌟 Fitur Utama

- **Autonomous Agent Integration**: Menggunakan engine CLI Antigravity (`agy`) dengan eksekusi headless (`stream-json`).
- **Headless VPS Pairing Code**: Tidak perlu repot scan QR di layar terminal VPS. Cukup masukkan nomor HP bot, dan bot akan menghasilkan 8-digit Pairing Code resmi WhatsApp.
- **Direct Shell Execution**: Eksekusi perintah bash instan menggunakan prefix `$` atau `.sh` (misal: `$ ls -la`, `$ df -h`).
- **Session & Context Management**: Menjaga konteks percakapan secara otomatis per chat dengan auto-expiration cerdas.
- **Dynamic Model Switching**: Ganti model AI kapan saja langsung lewat WhatsApp menggunakan perintah `.model <nama-model>`.
- **Media Action Tags**: Mendukung pengiriman file/gambar/audio/video otomatis dari server ke WhatsApp menggunakan tag `[[SEND_FILE:/path]]` dsb.
- **Owner Security Guard**: Whitelist nomor Owner agar hanya pemilik yang berhak mengeksekusi shell atau perintah sistem.

---

## 📋 Prasyarat

1. **Node.js**: Versi `>= 20.0.0`
2. **Antigravity CLI**: Pastikan binary `agy` terinstall di server/VPS Anda dan dapat dijalankan via terminal.
3. **Akun WhatsApp**: Nomor WhatsApp khusus untuk dijadikan bot.

---

## 🚀 Panduan Instalasi

### 1. Clone Repositori
```bash
git clone https://github.com/username/wa2shell.git
cd wa2shell
```

### 2. Install Dependensi
```bash
npm install
```

### 3. Konfigurasi Environment
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
nano .env
```

Sesuaikan variabel berikut di dalam `.env`:
- `OWNER_NUMBER`: Nomor WhatsApp Anda (contoh: `6281234567890`)
- `USE_PAIRING_CODE`: `true` jika ingin login via kode pairing, atau `false` untuk QR code.
- `BOT_PHONE_NUMBER`: Nomor bot WhatsApp jika menggunakan pairing code.
- `AGY_PATH`: Path ke executable `agy` (default: `agy` atau `/root/.local/bin/agy`).
- `AGY_DEFAULT_MODEL`: Model default (misal: `gemini-3.8-flash-low`).

### 4. Jalankan Bot
```bash
npm start
```

---

## 📱 Cara Menghubungkan ke WhatsApp

Jika `USE_PAIRING_CODE=true`:
1. Saat pertama kali dijalankan, bot akan menampilkan **8-digit Pairing Code** di terminal (contoh: `ABCD-1234`).
2. Buka aplikasi WhatsApp di HP Anda.
3. Buka menu **Titik Tiga** / **Pengaturan** -> **Perangkat Tertaut** -> **Tautkan Perangkat**.
4. Pilih **Tautkan dengan nomor telepon saja**.
5. Masukkan 8-digit kode yang muncul di terminal.
6. Selesai! Bot langsung aktif dan terhubung.

---

## 💬 Daftar Perintah (Commands)

| Perintah | Deskripsi |
|---|---|
| `$ <command>` | Eksekusi perintah shell/bash langsung di VPS (misal: `$ free -m`) |
| `.sh <command>` | Alternatif eksekusi perintah shell/bash |
| `.reset` / `.clear` | Reset sesi percakapan agent di chat tersebut |
| `.model` | Menampilkan model Antigravity yang sedang aktif |
| `.model <nama>` | Mengganti model agent yang aktif (misal: `.model gemini-3.8-flash-high`) |
| `.status` / `.ping` | Mengecek uptime, memori, dan ruang disk VPS |
| Obrolan langsung / DM | Otomatis direspons oleh AI agent Antigravity |
| `.ai <pesan>` (di grup) | Menjalankan prompt AI agent di dalam grup WhatsApp |

---

## 📁 Struktur Proyek

```
wa2shell/
├── index.js          # Entry point utama & koneksi Baileys
├── config.js         # Loader konfigurasi dari .env
├── package.json      # Metadata dependensi & script
├── .env.example      # Template konfigurasi environment
├── lib/
│   ├── agy_bridge.js # Bridge komunikasi ke binary agy
│   ├── handler.js    # Pengolah pesan, filter izin, & action tags
│   └── shell.js      # Eksekutor perintah bash server
├── session/          # Tempat penyimpanan sesi autentikasi Baileys (diabaikan git)
└── tmp/              # Direktori temporary untuk output/file
```

---

## 📄 Lisensi

Proyek ini dirilis di bawah lisensi **MIT**. Silakan gunakan, modifikasi, dan kembangkan sesuai kebutuhan Anda.
