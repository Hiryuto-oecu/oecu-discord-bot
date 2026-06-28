# Repository Guidelines

## Project Structure & Module Organization
The project is organized as a single-package Node.js application:
- `src/index.js`: Entry point. Initializes the Discord client and command modules.
- `src/config.js`: Loads configuration from environmental variables via `.env`.
- `src/modules/`: Bot feature modules (e.g., `core.js`, `janken.js`). Each module exports a name and an array of `commands` or `contextMenus`.
- `src/utils/`: Common helper scripts (e.g., `commands.js`, `jsonStore.js`).
- `data/`: Storage for application state JSON files (e.g., `verify.json`, `janken_leaderboard.json`).
- `sounds/`: Contains MP3 audio files used for voice commands.
- `deploy/`: Systemd services and shell scripts (`install-updater.sh`) to automate updates.

## Build, Test, and Development Commands
Manage dependencies and run the bot with the following npm commands:
- `npm install` / `npm ci`: Install required Node dependencies.
- `npm start` / `npm run dev`: Starts the bot server pointing directly to `src/index.js`.
- `npm run healthcheck`: Run the local bot health check (`src/healthcheck.js`).
- `npm run loop`: Runs `start.sh` which executes the bot in a crash-recovery loop.
- `docker compose up -d --build`: Starts the application in a local Docker container.

## Coding Style & Naming Conventions
- **Module System**: Standard CommonJS (`require` / `module.exports`).
- **Formatting Rules**:
  - Use 2-space indentation.
  - Semicolons are required.
  - Use single quotes `'` for JavaScript strings unless template literals are required.
- **Naming Conventions**:
  - Module / utility files: camelCase (e.g., `roleAssigner.js`).
  - Variables / functions: camelCase (e.g., `registerGuildCommands`).
  - Constants & Env Variables: UPPER_SNAKE_CASE (e.g., `DISCORD_BOT_TOKEN`).

## Testing Guidelines
No automated testing frameworks (e.g., Jest) are configured.
- **Manual Verification**: Test slash commands and reactions within a dedicated Discord test server. Set `DISCORD_GUILD_IDS` in `.env` to target your testing server.
- **Connectivity Check**: Run `npm run healthcheck` to verify the bot can connect to the target healthcheck API.

## Commit & Pull Request Guidelines
- **Commit Messages**: Follow Conventional Commits format in lowercase:
  - `feat`: new feature or command (e.g., `feat: add janken module`).
  - `fix`: bug fix (e.g., `fix: resolve voice connection timeout`).
  - `chore`: repository maintenance (e.g., `chore: update dependencies`).
- **Pull Requests**: Provide a summary of the change, confirm configuration settings (e.g., new variables in `.env.example`), and reference any resolved issues.
