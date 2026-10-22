<div align="center">
  <img src="./images/9router.png?1" alt="9Router" width="700"/>

  # 9Router

  **Local AI Gateway & Token Saver.** Route traffic across 40+ upstream providers with format translation, multi-account fallback, and 12-engine token compression.

  [![npm](https://img.shields.io/npm/v/@dopaemon/9router.svg)](https://www.npmjs.com/package/@dopaemon/9router)
  [![License](https://img.shields.io/npm/l/@dopaemon/9router.svg)](./LICENSE)

  [Dashboard](http://localhost:20128/dashboard) • [Quick Start](#-quick-start) • [Features](#-features) • [Clients](#-client-setup) • [i18n](./i18n/)
</div>

---

## ⚡ Quick Start

### Global CLI
```bash
npm install -g @dopaemon/9router
9router
```
- **Dashboard:** `http://localhost:20128/dashboard`
- **OpenAI API:** `http://localhost:20128/v1`
- **System Tray:** Runs in background; right-click tray icon to manage or check updates.

### Run from Source
```bash
cp .env.example .env
npm install
PORT=20128 npm run dev     # Dev (port 20128)
npm run build && npm start # Production
```

---

## 🛠 Client Setup

Point any AI coding tool or SDK to the local endpoint:

| Tool | Base URL | API Key |
|---|---|---|
| **Claude Code** | `http://localhost:20128/v1` | Copy from Dashboard |
| **Cursor** | `http://localhost:20128/v1` | Copy from Dashboard |
| **OpenClaw / Cline** | `http://localhost:20128/v1` | Copy from Dashboard |
| **OpenAI SDK / Python** | `http://localhost:20128/v1` | Copy from Dashboard |

---

## 🚀 Key Features

- **Format Translation:** Automatic bidirectional translation between OpenAI (`/v1/chat/completions`), Anthropic Claude (`/v1/messages`), and Gemini formats.
- **12-Engine OmniRoute Compression:** Cut token costs by 20–75% (RTK tool filtering, Caveman prose condensation, Headroom tabular JSON, Session-Dedup, CCR retrieval, LLMLingua-2, Ultra, OmniGlyph).
- **Multi-Account & Combo Fallback:** Seamless failover across subscriptions, cheap tiers, and free providers (Pollinations, Requesty, OpenCode Zen, Kilo Code, SiliconFlow, Cerebras, Baidu ERNIE, Z.AI GLM).
- **Flexible Persistence:** Multi-driver support (SQLite, PostgreSQL / Supabase, Cloudflare D1) with full JSON & SQLite backup download and restore.
- **System Tray & Updater:** Background daemon with one-click update checking and in-tray installation.

---

## 💻 Development & Tests

```bash
# Run unit tests
cd tests && npx vitest run

# Run baseline verification
node tests/__baseline__/verify-providers.mjs
node tests/__baseline__/verify-alias.mjs
node tests/__baseline__/verify-oauth-urls.mjs
```

---

## 📄 License

MIT © [9Router Contributors](./LICENSE)
