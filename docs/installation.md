# Installing RenderProof In Coding Agents

RenderProof runs as a local stdio MCP server.

## One-Liner

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- codex
```

Swap the final target:

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- claude
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- cursor
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- cline
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- windsurf
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- gemini
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- generic
```

The one-liner installs or updates RenderProof in:

```text
~/.renderproof
```

Then it runs the matching install helper for the target agent. For `cursor`, the script writes `.cursor/mcp.json` in the directory where you ran the one-liner.

## Manual Install

The manual setup is:

```bash
git clone https://github.com/Djsand/renderproof.git
cd renderproof
npm install
npx playwright install chromium
```

Then use the install helper:

```bash
node dist/index.js install
```

The helper prints commands and JSON without changing anything. Add `--apply`, `--write-project`, or `--write-user` when you want it to modify client config.

## Codex

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- codex
```

Print the command:

```bash
node dist/index.js install codex
```

Install it:

```bash
node dist/index.js install codex --apply
```

Equivalent manual command:

```bash
codex mcp add renderproof -- node /absolute/path/to/renderproof/dist/index.js mcp
```

## Claude Code

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- claude
```

Print the command:

```bash
node dist/index.js install claude
```

Install project-locally:

```bash
node dist/index.js install claude --apply
```

Install user-wide:

```bash
node dist/index.js install claude --apply --scope user
```

Equivalent manual command:

```bash
claude mcp add renderproof -- node /absolute/path/to/renderproof/dist/index.js mcp
```

## Cursor

Run this from the project directory where you want `.cursor/mcp.json` written:

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- cursor
```

Print Cursor config:

```bash
node dist/index.js install cursor
```

Write project-local config:

```bash
node dist/index.js install cursor --write-project
```

This writes:

```text
.cursor/mcp.json
```

## Cline

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- cline
```

Print Cline config:

```bash
node dist/index.js install cline
```

Write user config:

```bash
node dist/index.js install cline --write-user
```

This writes:

```text
~/.cline/mcp.json
```

You can also paste the JSON through Cline's MCP Servers configuration UI.

## Windsurf / Cascade

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- windsurf
```

Print Windsurf config:

```bash
node dist/index.js install windsurf
```

Write user config:

```bash
node dist/index.js install windsurf --write-user
```

This writes:

```text
~/.codeium/windsurf/mcp_config.json
```

If your team uses an MCP whitelist, the whitelist server ID must match the key name, usually `renderproof`.

## Gemini CLI

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/Djsand/renderproof/main/install.sh | bash -s -- gemini
```

Print Gemini config and command:

```bash
node dist/index.js install gemini
```

Install with Gemini's MCP manager:

```bash
node dist/index.js install gemini --apply --scope user
```

Or write project config:

```bash
node dist/index.js install gemini --write-project
```

Project config path:

```text
.gemini/settings.json
```

User config path:

```text
~/.gemini/settings.json
```

## Generic MCP JSON

Print copy-paste JSON:

```bash
node dist/index.js install generic --json
```

Shape:

```json
{
  "mcpServers": {
    "renderproof": {
      "command": "node",
      "args": ["/absolute/path/to/renderproof/dist/index.js", "mcp"]
    }
  }
}
```

## npx Mode

After RenderProof is published to npm, you can generate configs that use `npx` instead of a local checkout:

```bash
node dist/index.js install generic --mode npx --json
```

This produces:

```json
{
  "mcpServers": {
    "renderproof": {
      "command": "npx",
      "args": ["-y", "renderproof-mcp@latest", "mcp"]
    }
  }
}
```

Local mode is faster and more predictable during development. npx mode is convenient for broad distribution after npm publish.
