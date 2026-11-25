# Koko Chat

React + TypeScript + Tailwind v4 AI chat. Fully client-side (chats/keys stored in IndexedDB).

    npm install && npm run dev

- Providers: OpenAI (Responses API), OpenRouter, Groq, Together, DeepSeek, Mistral, xAI, Gemini, Ollama, LM Studio, or any custom OpenAI-compatible URL. Models are fetched live from `/models`.
- Tools: Tavily web search (add key in Settings → Tools) and `create_artifact` (html, chart, svg, markdown, code).
- Providers must allow browser (CORS) requests; for others put a proxy in front.

## Desktop app (Chat + Code)

The same app runs as an Electron desktop app, with a **Chat | Code** switch. Code mode is a coding agent that works inside a project folder on your computer with any model you have added: it reads, searches, edits and creates files, runs shell commands, searches the web and generates images straight into the project (for example a logo saved to `public/logo.png`).

    npm run electron:dev      # Vite dev server + app window
    npm run electron:start    # build, then open the app
    npm run electron:pack     # unpacked app in release/
    npm run electron:dist     # installers (dmg/zip, nsis, AppImage)

Permissions: reading and searching inside the project folder is always allowed. Edits and commands ask first ("Allow", "Always allow `npm test`", "Deny"). Per session you can switch to *Auto-approve edits* or *Bypass permissions* (shown with a warning, never remembered after quitting). Obviously read-only commands (`ls`, `git status`, ...) run without asking; anything that looks dangerous (`rm -rf`, `sudo`, `git push`, ...) is flagged and never covered by an "always allow" rule. Paths outside the project folder always need approval.

Code sessions are stored on this computer only and are not synced. Put project rules in `CLAUDE.md` or `AGENTS.md` in the folder and the agent follows them.
