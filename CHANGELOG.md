# Changelog

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
