# Koko Chat

Koko Chat is a fast, extensible AI chat client built with React + TypeScript + Tailwind. It runs fully client-side in the browser (chats and API keys stored in IndexedDB) and also ships as an Electron desktop app with an integrated coding agent.

Why Koko Chat
- Lightweight, client-first chat UI optimized for productivity and privacy.
- Use any OpenAI-compatible provider or a number of built-in providers (OpenAI Responses API, OpenRouter, Groq, Together, DeepSeek, Mistral, xAI, Gemini, Ollama, LM Studio, and more).
- Models are discovered and fetched live from /models so you can plug in custom endpoints or proxies.

Key features
- Multi-provider support: Add multiple providers and switch between them per-chat or per-session.
- Tooling: Built-in web search (Tavily) and a create_artifact tool that can generate HTML, charts, SVGs, Markdown, and code artifacts.
- Desktop "Chat | Code" mode: The same app runs in Electron with a Code mode — a coding agent that can read, search, edit and create files in a project, run shell commands (asked for approval), and save generated images straight into the project.
- Extensible: Add custom OpenAI-compatible provider URLs and custom tools. Providers must permit browser (CORS) requests; use a proxy for others.
- Local-first: Chat history and keys remain on your device (IndexedDB).

Security & permissions (desktop)
- File and shell operations require explicit approval. Safe, read-only commands (ls, git status) run without prompting; potentially destructive operations are flagged.
- You can enable per-session auto-approve for convenience, but it is not persisted.
- Code sessions and project edits are local by default; include CLAUDE.md or AGENTS.md in your project to instruct the coding agent.

Quick start
1. Install dependencies:
   npm install
2. Start the dev server:
   npm run dev

Run the desktop app (Electron)
- Dev: npm run electron:dev    # Vite dev server + app window
- Start (build + open): npm run electron:start
- Package/unpacked: npm run electron:pack
- Create installers: npm run electron:dist

Configuration
- Add provider API keys and tool keys in Settings → Providers / Tools.
- If a provider does not support CORS from the browser, run a small proxy in front of it or use the desktop app.

Notes
- The app expects providers to expose model metadata at /models (the project fetches model lists live).
- Sensitive files such as .env or .env.local should be in .gitignore. If secrets were accidentally committed, remove them and consider rewriting history.

Contributing
- Bug reports, feature requests and PRs are welcome. Run tests and linters where applicable and follow the project coding style.

License
- (Add your license here)

