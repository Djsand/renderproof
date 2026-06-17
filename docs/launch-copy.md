# RenderProof Launch Copy

## GitHub Description

Rendered web evidence for coding agents: screenshots, motion analysis, CSS animation metadata, and audit trails via MCP.

## One-Liners

- The browser receipt for coding agents.
- Stop guessing what the web rendered. Capture proof.
- Screenshots, motion, and CSS animation evidence for agents.
- A local-first MCP server for what Chromium actually saw.
- Playwright is the engine. RenderProof is the evidence layer.

## Short Pitch

RenderProof is a local-first MCP server that lets coding agents capture what Chromium actually rendered. It turns screenshots, motion, CSS animations, pixel diffs, gates, modals, and loading states into auditable evidence that agents can use before they make claims or recreate UI.

## Longer Pitch

Coding agents are great at reading source, but modern web pages often hide the real state behind JavaScript rendering, cookie modals, consent walls, skeleton loaders, canvas, video, maps, iframes, and animation.

RenderProof gives agents a grounded visual evidence layer. It can read a page when text is enough, capture screenshots when rendered state matters, record short motion clips for humans, and analyze animation into contact sheets, pixel diffs, CSS keyframes, easing, duration, direction, and design notes.

It is not a scraper or a bypass tool. It is the receipt for what the browser actually saw.

## Social Post

I built RenderProof: a local-first MCP server for coding agents that need to know what the web actually rendered.

It captures:
- screenshots
- full-page screenshots with pre-scroll
- WebM motion clips
- keyframes
- contact sheets
- pixel diffs
- CSS animation metadata
- evidence for consent walls, login walls, skeleton loaders, canvas, video, maps, and other rendered states

It does not bypass gates. It shows them.

The useful framing: Playwright is the engine. RenderProof is the evidence layer.

## Launch Thread

1. Coding agents can read source, but source often lies about what users actually see.

2. Modern pages are full of rendered state: consent walls, cookie modals, skeleton loaders, maps, canvas, iframes, video players, animations, and bot checks.

3. So I built RenderProof: a local-first MCP server that captures what Chromium actually rendered.

4. It can read text when text is enough, capture screenshots when pixels matter, and record short motion evidence when animation or loading states matter.

5. The fun part is `analyze_motion`: it samples frames, creates a contact sheet, computes pixel diffs, extracts `document.getAnimations()`, and returns CSS keyframes, easing, duration, direction, changed regions, and design notes.

6. It is not a scraper. It is not a bypass tool. It is the receipt for what the browser saw.

7. Playwright is the engine. RenderProof is the evidence layer.
