# wa2shell ⚡

> **Bridge WhatsApp to Your Linux Terminal and Autonomous AI Agents.**  
> Control your remote servers, execute bash commands, inspect codebases, and interact with headless Antigravity AI agents directly from any WhatsApp chat.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/WhatsApp-Baileys-25D366?style=flat&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

**wa2shell** turns your WhatsApp account into an interactive DevOps terminal and AI copilot. Built on top of **Baileys** and the **Antigravity CLI (`agy`)**, it provides a secure, low-latency bridge between WhatsApp chats and your Linux VPS. 

Whether you need to monitor server health on the go, kick off deployment scripts, debug services in production, or let an autonomous agent edit files and run automated workflows, `wa2shell` handles it right from your mobile device without requiring SSH open to the public internet.

---

## Key Features

- **Autonomous Agent Integration**  
  Communicates with the Antigravity agent CLI in headless JSON-streaming mode (`stream-json`), providing structured agent thoughts, tool execution tracking, and conversational responses.
- **Headless VPS Pairing Code**  
  No painful ASCII QR code rendering over messy SSH terminals. Simply enter your bot's phone number and receive an official 8-digit WhatsApp pairing code to link instantly.
- **Instant Direct Shell Execution**  
  Run shell commands directly on your server using the `$` or `.sh` prefix (e.g., `$ htop`, `$ git status`, `$ systemctl status nginx`) with exit codes and execution runtimes.
- **Stateful Per-Chat Sessions**  
  Keeps multi-turn conversational context intact for each chat thread, backed by automatic memory management and TTL expiration.
- **Hot Model Switching**  
  Switch active agent models on the fly (e.g., Gemini, Claude) via `.model <model-name>` without taking down the daemon or interrupting connected clients.
- **Automated Media & Artifact Delivery**  
  Dispatches files, diagnostic logs, generated images, voice notes, and reports straight into WhatsApp using structured action tags (`[[SEND_FILE:/path]]`).
- **Owner Security Guard**  
  Enforces strict phone number whitelisting so only verified server administrators can trigger shell commands and sensitive tool actions.

---

## Architecture

```
┌─────────────────────────────────┐
│     WhatsApp Mobile Client      │
└────────────────┬────────────────┘
                 │ (E2EE WebSocket)
┌────────────────▼────────────────────────────────────────┐
│                        wa2shell                         │
│                                                         │
│  ┌────────────────────┐      ┌───────────────────────┐  │
│  │ Baileys Connection │ ───► │  Dispatcher & Guard   │  │
│  └────────────────────┘      └───────────┬───────────┘  │
│                                          │              │
│                 ┌────────────────────────┴─────────┐    │
│                 ▼                                  ▼    │
│        [ Direct Bash Exec ]             [ Antigravity ] │
│        /bin/bash runner                 CLI Subprocess  │
│        (Exit code, time)                (stream-json)   │
└─────────────────┬──────────────────────────────────┬────┘
                  │                                  │
                  ▼                                  ▼
      ┌───────────────────────┐          ┌───────────────────────┐
      │   Linux Host System   │          │  AI Agent Subsystems  │
      │  (Files, Docker, PM2) │          │  (Tools, Memory, SDK) │
      └───────────────────────┘          └───────────────────────┘
```

---

## Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Antigravity CLI (`agy`)**: Installed and accessible in your system `PATH` or at `/root/.local/bin/agy`
- **Linux Environment**: Ubuntu, Debian, CentOS, or any modern POSIX-compliant system
- **Dedicated WhatsApp Account**: A secondary or business SIM card recommended for the bot

---

## Quickstart

### 1. Clone the Repository
```bash
git clone https://github.com/PantherCloud12/wa2shell.git
cd wa2shell
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy the template configuration file:
```bash
cp .env.example .env
nano .env
```

Set the essential keys in `.env`:
```env
# International phone number of the administrator (no leading + or dashes)
OWNER_NUMBER="14155552671"

# Headless pairing mode
USE_PAIRING_CODE=true
BOT_PHONE_NUMBER="14155559876"

# Antigravity CLI path and default model
AGY_PATH="agy"
AGY_DEFAULT_MODEL="gemini-3.8-flash-low"
AGY_WORKDIR="/root"
```

### 4. Run the Daemon
```bash
npm start
```

If `USE_PAIRING_CODE=true` is enabled:
1. The terminal prints an 8-digit code (e.g., `ABCD-1234`).
2. Open WhatsApp on your mobile phone: **Settings** -> **Linked Devices** -> **Link a Device**.
3. Select **Link with phone number instead** and enter the terminal pairing code.
4. Once authenticated, session credentials are saved under `./session/`. Subsequent restarts reconnect automatically.

---

## Command Reference

| Command | Description | Example |
|---|---|---|
| `$ <cmd>` | Execute a bash command on the VPS | `$ free -m` |
| `.sh <cmd>` | Alternative syntax for bash execution | `.sh systemctl restart caddy` |
| `.status` / `.ping` | Show uptime, memory stats, and disk usage | `.status` |
| `.model` | Display currently loaded Antigravity agent model | `.model` |
| `.model <id>` | Switch the agent backend model on the fly | `.model claude-sonnet-5-5-high` |
| `.reset` / `.clear` | Purge active conversation context for this chat | `.reset` |
| Direct Message | Queries the Antigravity agent directly | `Inspect why memory jumped to 90%` |
| `.ai <prompt>` | Query the Antigravity agent inside a WhatsApp group | `.ai Review the latest commit diff` |

---

## Action Tags (Agent-to-WhatsApp Media)

When interacting with Antigravity, the agent can output special action tags to deliver media directly into the chat:

- `[[SEND_FILE:/path/to/report.pdf]]` — Sends any file as a downloadable document.
- `[[SEND_IMAGE:/path/to/plot.png]]` — Sends an image with automatic thumbnail preview.
- `[[SEND_AUDIO:/path/to/voice.mp3]]` — Sends an audio note.
- `[[SEND_VIDEO:/path/to/output.mp4]]` — Sends a video clip.

Tags are parsed and stripped from the agent's textual response before dispatching the requested media assets asynchronously.

---

## Project Structure

```
wa2shell/
├── index.js          # Main process entry point and Baileys socket lifecycle
├── config.js         # Centralized environment variable loader and paths
├── package.json      # Project dependencies and operational scripts
├── .env.example      # Detailed environment template
├── lib/
│   ├── agy_bridge.js # Antigravity CLI streaming IPC bridge and session cache
│   ├── handler.js    # Inbound message parsing, access control, and tag dispatch
│   └── shell.js      # Child process runner for privileged bash commands
├── session/          # Persistent Baileys multi-device auth state (git-ignored)
└── tmp/              # Temporary scratch space for media and transient files
```

---

## Production Deployment (PM2)

To keep `wa2shell` running persistently across reboots, use [PM2](https://pm2.keymetrics.io/):

```bash
# Install PM2 globally
npm install -g pm2

# Start the bot daemon
pm2 start index.js --name "wa2shell"

# Save process list for system reboot
pm2 save
pm2 startup
```

To inspect live operational logs:
```bash
pm2 logs wa2shell
```

---

## Security & Best Practices

1. **Restrict Owner Numbers**: Always keep `OWNER_ONLY=true` in production to prevent unauthorized users from executing bash commands on your infrastructure.
2. **Protect the Session Directory**: The `./session` folder contains sensitive WhatsApp cryptographic tokens. Keep directory permissions restricted (`chmod 700 session`).
3. **Audit Shell History**: Sensitive environmental tokens or passwords should never be typed directly into plain group chats. Use 1-on-1 private messaging for sensitive server operations.

---

## Contributing

Contributions, bug reports, and pull requests are welcome. Feel free to open an issue to discuss enhancements, feature ideas, or protocol compatibility updates.

---

## License

This project is open-source software licensed under the **[MIT License](LICENSE)**.
