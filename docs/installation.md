# Installing RenderProof In Coding Agents

RenderProof runs as a local stdio MCP server. The fastest reliable setup is:

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
