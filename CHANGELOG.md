# Changelog

## Unreleased

- Added `clone_website` MCP tool and `renderproof clone-website` CLI command for clone-ready evidence bundles.
- The clone workflow captures desktop/mobile screenshots, design tokens, page topology, behavior hints, per-section specs, and capped asset downloads.
- Updated routing so clone/rebuild/reverse-engineering tasks recommend the clone workflow.

## 0.4.5

- Reworked the Windows installer to run native commands inside scriptblocks so PowerShell cannot bind native flags as function parameters.

## 0.4.4

- Fixed Windows PowerShell installer argument parsing for native commands like `git -C`.

## 0.4.3

- Changed one-line Codex install to write `~/.codex/config.toml` directly instead of relying on `codex mcp add`.
- Added Codex `--write-user` support to the install helper.
- Improved Windows reliability when Codex CLI is not available in PowerShell PATH.

## 0.4.2

- Added native Windows PowerShell bootstrapper `install.ps1`.
- Added Windows one-liners for Codex, Claude Code, Cursor, Cline, Windsurf, Gemini CLI, and generic MCP JSON.
- Improved Windows setup docs for missing Node.js PATH issues.

## 0.4.1

- Added `install.sh` bootstrapper for curl-to-bash one-liner installs.
- Added one-liner docs for Codex, Claude Code, Cursor, Cline, Windsurf, Gemini CLI, and generic MCP JSON.
- Added package metadata so the bootstrapper is included in npm package output.

## 0.4.0

- Added `renderproof install` helper for Codex, Claude Code, Cursor, Windsurf, Cline, Gemini CLI, and generic MCP JSON.
- Added safe dry-run install output by default, with explicit `--apply`, `--write-project`, and `--write-user` mutation modes.
- Added `docs/installation.md` with agent-specific setup instructions.
- Added npm `prepare` build hook for easier package/GitHub installs.

## 0.3.0

- Renamed the project to RenderProof and package to `renderproof-mcp`.
- Added `analyze_motion` for agent-readable motion analysis.
- Added sampled keyframes, contact sheet output, pixel-diff summaries, and CSS animation metadata extraction.
- Updated motion routing to prefer analysis before raw motion recording.
- Added CLI support for `analyze-motion`.

## 0.2.0

- Added optional `autoScrollBeforeCapture` support to `capture_page`.
- Added `capture_motion` for short WebM recordings with keyframe PNG evidence.
- Added motion-aware routing for animation, transition, scrolling, and loading-state tasks.
- Added CLI support for `capture --auto-scroll` and `motion`.

## 0.1.0

- Initial local-first MCP and CLI scaffold.
- Added route, read, capture, and doctor tools.
- Added URL policy controls and evidence output.
