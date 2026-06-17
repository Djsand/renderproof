import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PNG } from "pngjs";
import type { Browser, Page } from "playwright";

import { autoScrollPage, type AutoScrollReport, type CaptureMotionFrame, type CaptureMotionResource } from "./browser.js";
import type { RuntimeConfig } from "./config.js";
import { nowIso, type Evidence, WebRouterError } from "./types.js";
import { assertAllowedHttpUrl } from "./url.js";

export interface AnalyzeMotionInput {
  url: string;
  durationMs?: number;
  sampleCount?: number;
  includeImages?: boolean;
  includeFrameImages?: boolean;
  includeCssAnimations?: boolean;
  includePixelDiff?: boolean;
  scrollDuringCapture?: boolean;
  scrollStepPx?: number;
  scrollDelayMs?: number;
  scrollMaxSteps?: number;
  width?: number;
  height?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  outputDir?: string;
  allowPrivateNetwork?: boolean;
  changeThreshold?: number;
  diffSampleStride?: number;
}

export interface CssAnimationReport {
  index: number;
  type: string;
  name?: string;
  playState: string;
  playbackRate: number;
  currentTimeMs?: number;
  target: {
    selector: string;
    tagName: string;
    id?: string;
    className?: string;
    text?: string;
  };
  timing: Record<string, unknown>;
  animatedProperties: string[];
  keyframes: Array<Record<string, unknown>>;
}

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelDiffReport {
  fromFrame: number;
  toFrame: number;
  fromTimestampMs: number;
  toTimestampMs: number;
  changedPixelRatio: number;
  changedPixels: number;
  sampledPixels: number;
  bounds?: PixelBounds;
  centroid?: { x: number; y: number };
  movementFromPrevious?: {
    dx: number;
    dy: number;
    distance: number;
    direction: MotionDirection;
  };
}

export type MotionDirection =
  | "none"
  | "left"
  | "right"
  | "up"
  | "down"
  | "up-left"
  | "up-right"
  | "down-left"
  | "down-right";

export interface AnalyzeMotionData {
  url: string;
  finalUrl: string;
  title: string;
  width: number;
  height: number;
  durationMs: number;
  sampleCount: number;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  frames: CaptureMotionFrame[];
  contactSheetPath?: string;
  diffImagePath?: string;
  cssAnimations: CssAnimationReport[];
  pixelDiffs: PixelDiffReport[];
  overallMotion: {
    likelyMotion: boolean;
    averageChangedPixelRatio: number;
    maxChangedPixelRatio: number;
    dominantDirection: MotionDirection;
    animatedElementCount: number;
    changedRegionCount: number;
  };
  designNotes: string[];
  limitations: string[];
  scroll?: AutoScrollReport;
}

export async function analyzeMotion(
  input: AnalyzeMotionInput,
  config: RuntimeConfig
): Promise<{
  data: AnalyzeMotionData;
  resources: CaptureMotionResource[];
  evidence: Evidence[];
}> {
  const url = await assertAllowedHttpUrl(input.url, config, {
    allowPrivateNetwork: input.allowPrivateNetwork
  });

  const width = boundedInt(input.width, 1280, 320, 3840);
  const height = boundedInt(input.height, 720, 240, 2160);
  const durationMs = boundedInt(input.durationMs, 3000, 500, 30000);
  const sampleCount = boundedInt(input.sampleCount, 5, 2, 12);
  const waitUntil = input.waitUntil ?? "load";
  const timeoutMs = boundedInt(input.timeoutMs, 30000, 1000, 120000);
  const outputDir = path.resolve(input.outputDir ?? config.outputDir);
  const includeImages = input.includeImages !== false;
  const includeFrameImages = input.includeFrameImages === true;
  const includeCssAnimations = input.includeCssAnimations !== false;
  const includePixelDiff = input.includePixelDiff !== false;
  const changeThreshold = boundedInt(input.changeThreshold, 40, 1, 255);
  const diffSampleStride = boundedInt(input.diffSampleStride, 2, 1, 16);

  try {
    await mkdir(outputDir, { recursive: true });

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage({ viewport: { width, height } });
      const baseName = `${safeTimestamp()}-${safeHost(url.hostname)}`;

      await page.goto(url.toString(), { waitUntil, timeout: timeoutMs });

      const cssAnimations = includeCssAnimations ? await extractCssAnimations(page) : [];
      const startedAt = Date.now();
      const frameCaptures: Array<CaptureMotionFrame & { buffer: Buffer }> = [];
      let scroll: AutoScrollReport | undefined;

      if (input.scrollDuringCapture) {
        await captureAnalysisFrame({
          page,
          frameCaptures,
          outputDir,
          baseName,
          width,
          height,
          startedAt,
          index: frameCaptures.length,
          timeoutMs
        });

        scroll = await autoScrollPage(page, {
          stepPx: input.scrollStepPx,
          delayMs: input.scrollDelayMs,
          maxSteps: input.scrollMaxSteps,
          restoreScrollPosition: false
        });

        await captureAnalysisFrame({
          page,
          frameCaptures,
          outputDir,
          baseName,
          width,
          height,
          startedAt,
          index: frameCaptures.length,
          timeoutMs
        });

        await waitForRemaining(page, startedAt, durationMs);

        while (frameCaptures.length < sampleCount) {
          await captureAnalysisFrame({
            page,
            frameCaptures,
            outputDir,
            baseName,
            width,
            height,
            startedAt,
            index: frameCaptures.length,
            timeoutMs
          });
        }
      } else {
        const frameTimes = evenlySpacedTimes(durationMs, sampleCount);

        for (let index = 0; index < frameTimes.length; index += 1) {
          const targetMs = frameTimes[index] ?? 0;
          const elapsedMs = Date.now() - startedAt;
          if (targetMs > elapsedMs) {
            await page.waitForTimeout(targetMs - elapsedMs);
          }

          await captureAnalysisFrame({
            page,
            frameCaptures,
            outputDir,
            baseName,
            width,
            height,
            startedAt,
            index,
            timeoutMs
          });
        }

        await waitForRemaining(page, startedAt, durationMs);
      }

      const frames = frameCaptures.map(({ buffer: _buffer, ...frame }) => frame);
      const pixelDiffs = includePixelDiff
        ? analyzeFrameDiffs(frameCaptures, {
            threshold: changeThreshold,
            sampleStride: diffSampleStride
          })
        : [];

      const contactSheet = includeImages
        ? await createContactSheet(browser, {
            frames: frameCaptures,
            outputDir,
            baseName,
            width,
            height
          })
        : undefined;
      const diffImage = includeImages && includePixelDiff
        ? await createDiffImage({
            firstFrame: frameCaptures[0],
            lastFrame: frameCaptures[frameCaptures.length - 1],
            outputDir,
            baseName,
            threshold: changeThreshold
          })
        : undefined;

      const [title, finalUrl] = await Promise.all([page.title().catch(() => ""), Promise.resolve(page.url())]);
      const overallMotion = summarizeOverallMotion(pixelDiffs, cssAnimations);
      const designNotes = buildDesignNotes(cssAnimations, pixelDiffs, overallMotion, scroll);

      const resources: CaptureMotionResource[] = [];
      if (contactSheet) {
        resources.push(contactSheet);
      }
      if (diffImage) {
        resources.push(diffImage);
      }
      if (includeFrameImages) {
        for (const frame of frameCaptures) {
          resources.push({
            path: frame.path,
            mimeType: "image/png",
            base64: frame.buffer.toString("base64")
          });
        }
      }

      const data: AnalyzeMotionData = {
        url: url.toString(),
        finalUrl,
        title,
        width,
        height,
        durationMs,
        sampleCount: frames.length,
        waitUntil,
        frames,
        ...(contactSheet ? { contactSheetPath: contactSheet.path } : {}),
        ...(diffImage ? { diffImagePath: diffImage.path } : {}),
        cssAnimations,
        pixelDiffs,
        overallMotion,
        designNotes,
        limitations: [
          "Pixel diff identifies changed regions, not semantic object identity.",
          "CSS animation extraction covers Web Animations, CSS animations, and CSS transitions exposed by document.getAnimations().",
          "Video playback itself is not required for the agent; the contact sheet and structured diff are the agent-readable evidence."
        ],
        ...(scroll ? { scroll } : {})
      };

      return {
        data,
        resources,
        evidence: [
          {
            kind: "motion_analysis",
            method: "playwright_chromium_frames_css_pixel_diff",
            url: finalUrl,
            timestamp: nowIso(),
            details: {
              contactSheetPath: contactSheet?.path,
              diffImagePath: diffImage?.path,
              frameCount: frames.length,
              cssAnimationCount: cssAnimations.length,
              averageChangedPixelRatio: overallMotion.averageChangedPixelRatio,
              maxChangedPixelRatio: overallMotion.maxChangedPixelRatio,
              dominantDirection: overallMotion.dominantDirection,
              scroll
            }
          }
        ]
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    if (error instanceof WebRouterError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new WebRouterError("motion_analysis_failed", "Playwright motion analysis failed.", {
      url: url.toString(),
      cause: message,
      hint: message.includes("Executable doesn't exist")
        ? "Run `npx playwright install chromium` in this project."
        : undefined
    });
  }
}

async function extractCssAnimations(page: Page): Promise<CssAnimationReport[]> {
  return page.evaluate(() => {
    function selectorForElement(element: Element | null): string {
      if (!element) {
        return "unknown";
      }

      const parts: string[] = [];
      let current: Element | null = element;

      while (current && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const id = current.id ? `#${CSS.escape(current.id)}` : "";
        const classes =
          current.classList.length > 0
            ? `.${Array.from(current.classList)
                .slice(0, 3)
                .map((className) => CSS.escape(className))
                .join(".")}`
            : "";
        parts.unshift(`${tag}${id}${classes}`);
        current = current.parentElement;
      }

      return parts.join(" > ");
    }

    function animationType(animation: Animation): string {
      const candidate = animation as Animation & { animationName?: string; transitionProperty?: string };
      if (typeof candidate.animationName === "string") {
        return "css_animation";
      }
      if (typeof candidate.transitionProperty === "string") {
        return "css_transition";
      }
      return "web_animation";
    }

    function animationName(animation: Animation): string | undefined {
      const candidate = animation as Animation & { animationName?: string; id?: string };
      return candidate.animationName || candidate.id || undefined;
    }

    function serializeValue(value: unknown): unknown {
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean" || value === null) {
        return value;
      }

      if (Array.isArray(value)) {
        return value.map(serializeValue);
      }

      if (typeof value === "object" && value) {
        return String(value);
      }

      return undefined;
    }

    const getAnimations = document.getAnimations as unknown as (options?: { subtree?: boolean }) => Animation[];

    return getAnimations.call(document, { subtree: true }).slice(0, 30).map((animation, index) => {
      const effect = animation.effect instanceof KeyframeEffect ? animation.effect : undefined;
      const target = effect?.target instanceof Element ? effect.target : null;
      const keyframes = effect
        ? effect.getKeyframes().slice(0, 8).map((keyframe) => {
            const serialized: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(keyframe)) {
              serialized[key] = serializeValue(value);
            }
            return serialized;
          })
        : [];
      const animatedProperties = Array.from(
        new Set(
          keyframes.flatMap((keyframe) =>
            Object.keys(keyframe).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key))
          )
        )
      );

      const text = target?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80);

      return {
        index,
        type: animationType(animation),
        name: animationName(animation),
        playState: animation.playState,
        playbackRate: animation.playbackRate,
        currentTimeMs: typeof animation.currentTime === "number" ? animation.currentTime : undefined,
        target: {
          selector: selectorForElement(target),
          tagName: target?.tagName.toLowerCase() ?? "unknown",
          id: target?.id || undefined,
          className: target instanceof HTMLElement ? target.className || undefined : undefined,
          text: text || undefined
        },
        timing: effect ? serializeTiming(effect.getTiming()) : {},
        animatedProperties,
        keyframes
      };
    });

    function serializeTiming(timing: EffectTiming): Record<string, unknown> {
      return {
        delay: timing.delay,
        direction: timing.direction,
        duration: timing.duration,
        easing: timing.easing,
        endDelay: timing.endDelay,
        fill: timing.fill,
        iterationStart: timing.iterationStart,
        iterations: timing.iterations
      };
    }
  });
}

async function captureAnalysisFrame(input: {
  page: Page;
  frameCaptures: Array<CaptureMotionFrame & { buffer: Buffer }>;
  outputDir: string;
  baseName: string;
  width: number;
  height: number;
  startedAt: number;
  index: number;
  timeoutMs: number;
}): Promise<void> {
  const timestampMs = Date.now() - input.startedAt;
  const buffer = await input.page.screenshot({ type: "png", fullPage: false, timeout: input.timeoutMs });
  const framePath = path.join(input.outputDir, `${input.baseName}-analysis-frame-${input.index}.png`);
  await writeFile(framePath, buffer);

  input.frameCaptures.push({
    index: input.index,
    timestampMs,
    path: framePath,
    mimeType: "image/png",
    width: input.width,
    height: input.height,
    buffer
  });
}

function analyzeFrameDiffs(
  frames: Array<CaptureMotionFrame & { buffer: Buffer }>,
  options: { threshold: number; sampleStride: number }
): PixelDiffReport[] {
  const decoded = frames.map((frame) => ({ frame, image: PNG.sync.read(frame.buffer) }));
  const diffs: PixelDiffReport[] = [];
  let previousCentroid: { x: number; y: number } | undefined;

  for (let index = 1; index < decoded.length; index += 1) {
    const previous = decoded[index - 1];
    const current = decoded[index];
    if (!previous || !current) {
      continue;
    }

    const diff = comparePngs(previous.image, current.image, {
      threshold: options.threshold,
      sampleStride: options.sampleStride
    });
    const movementFromPrevious =
      previousCentroid && diff.centroid
        ? vectorToDirection(diff.centroid.x - previousCentroid.x, diff.centroid.y - previousCentroid.y)
        : undefined;

    if (diff.centroid) {
      previousCentroid = diff.centroid;
    }

    diffs.push({
      fromFrame: previous.frame.index,
      toFrame: current.frame.index,
      fromTimestampMs: previous.frame.timestampMs,
      toTimestampMs: current.frame.timestampMs,
      changedPixelRatio: diff.changedPixelRatio,
      changedPixels: diff.changedPixels,
      sampledPixels: diff.sampledPixels,
      ...(diff.bounds ? { bounds: diff.bounds } : {}),
      ...(diff.centroid ? { centroid: diff.centroid } : {}),
      ...(movementFromPrevious ? { movementFromPrevious } : {})
    });
  }

  return diffs;
}

function comparePngs(
  first: PNG,
  second: PNG,
  options: { threshold: number; sampleStride: number }
): {
  changedPixelRatio: number;
  changedPixels: number;
  sampledPixels: number;
  bounds?: PixelBounds;
  centroid?: { x: number; y: number };
} {
  const width = Math.min(first.width, second.width);
  const height = Math.min(first.height, second.height);
  let sampledPixels = 0;
  let changedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < height; y += options.sampleStride) {
    for (let x = 0; x < width; x += options.sampleStride) {
      sampledPixels += 1;
      const firstOffset = (y * first.width + x) * 4;
      const secondOffset = (y * second.width + x) * 4;
      const delta =
        Math.abs(first.data[firstOffset] - second.data[secondOffset]) +
        Math.abs(first.data[firstOffset + 1] - second.data[secondOffset + 1]) +
        Math.abs(first.data[firstOffset + 2] - second.data[secondOffset + 2]) +
        Math.abs(first.data[firstOffset + 3] - second.data[secondOffset + 3]);

      if (delta <= options.threshold) {
        continue;
      }

      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
    }
  }

  return {
    changedPixelRatio: sampledPixels > 0 ? round4(changedPixels / sampledPixels) : 0,
    changedPixels,
    sampledPixels,
    ...(changedPixels > 0
      ? {
          bounds: {
            x: minX,
            y: minY,
            width: maxX - minX + options.sampleStride,
            height: maxY - minY + options.sampleStride
          },
          centroid: {
            x: Math.round(sumX / changedPixels),
            y: Math.round(sumY / changedPixels)
          }
        }
      : {})
  };
}

async function createContactSheet(
  browser: Browser,
  input: {
    frames: Array<CaptureMotionFrame & { buffer: Buffer }>;
    outputDir: string;
    baseName: string;
    width: number;
    height: number;
  }
): Promise<CaptureMotionResource> {
  const columns = Math.min(3, input.frames.length);
  const thumbWidth = 360;
  const sheetWidth = columns * thumbWidth + (columns + 1) * 16;
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        margin: 0;
        padding: 16px;
        background: #111;
        color: #f8fafc;
        font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(${columns}, ${thumbWidth}px);
        gap: 16px;
      }
      figure {
        margin: 0;
        background: #1f2937;
        border: 1px solid #334155;
      }
      img {
        display: block;
        width: ${thumbWidth}px;
        height: auto;
      }
      figcaption {
        padding: 8px 10px;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <div class="grid">
      ${input.frames
        .map(
          (frame) => `<figure>
        <img src="data:image/png;base64,${frame.buffer.toString("base64")}" alt="Frame ${frame.index}">
        <figcaption>frame ${frame.index} · ${frame.timestampMs}ms</figcaption>
      </figure>`
        )
        .join("")}
    </div>
  </body>
</html>`;

  const page = await browser.newPage({ viewport: { width: sheetWidth, height: 900 } });
  try {
    await page.setContent(html, { waitUntil: "load" });
    const buffer = await page.screenshot({ type: "png", fullPage: true });
    const contactSheetPath = path.join(input.outputDir, `${input.baseName}-contact-sheet.png`);
    await writeFile(contactSheetPath, buffer);

    return {
      path: contactSheetPath,
      mimeType: "image/png",
      base64: buffer.toString("base64")
    };
  } finally {
    await page.close();
  }
}

async function createDiffImage(input: {
  firstFrame: (CaptureMotionFrame & { buffer: Buffer }) | undefined;
  lastFrame: (CaptureMotionFrame & { buffer: Buffer }) | undefined;
  outputDir: string;
  baseName: string;
  threshold: number;
}): Promise<CaptureMotionResource | undefined> {
  if (!input.firstFrame || !input.lastFrame) {
    return undefined;
  }

  const first = PNG.sync.read(input.firstFrame.buffer);
  const last = PNG.sync.read(input.lastFrame.buffer);
  const width = Math.min(first.width, last.width);
  const height = Math.min(first.height, last.height);
  const diff = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const firstOffset = (y * first.width + x) * 4;
      const lastOffset = (y * last.width + x) * 4;
      const delta =
        Math.abs(first.data[firstOffset] - last.data[lastOffset]) +
        Math.abs(first.data[firstOffset + 1] - last.data[lastOffset + 1]) +
        Math.abs(first.data[firstOffset + 2] - last.data[lastOffset + 2]) +
        Math.abs(first.data[firstOffset + 3] - last.data[lastOffset + 3]);

      if (delta > input.threshold) {
        diff.data[offset] = 239;
        diff.data[offset + 1] = 68;
        diff.data[offset + 2] = 68;
        diff.data[offset + 3] = 255;
      } else {
        const gray = Math.round(
          (first.data[firstOffset] + first.data[firstOffset + 1] + first.data[firstOffset + 2]) / 3
        );
        diff.data[offset] = gray;
        diff.data[offset + 1] = gray;
        diff.data[offset + 2] = gray;
        diff.data[offset + 3] = 90;
      }
    }
  }

  const buffer = PNG.sync.write(diff);
  const diffPath = path.join(input.outputDir, `${input.baseName}-diff.png`);
  await writeFile(diffPath, buffer);

  return {
    path: diffPath,
    mimeType: "image/png",
    base64: buffer.toString("base64")
  };
}

function summarizeOverallMotion(pixelDiffs: PixelDiffReport[], cssAnimations: CssAnimationReport[]): AnalyzeMotionData["overallMotion"] {
  const changedRatios = pixelDiffs.map((diff) => diff.changedPixelRatio);
  const averageChangedPixelRatio =
    changedRatios.length > 0 ? round4(changedRatios.reduce((sum, value) => sum + value, 0) / changedRatios.length) : 0;
  const maxChangedPixelRatio = changedRatios.length > 0 ? Math.max(...changedRatios) : 0;
  const directionCounts = new Map<MotionDirection, number>();

  for (const diff of pixelDiffs) {
    const direction = diff.movementFromPrevious?.direction;
    if (!direction || direction === "none") {
      continue;
    }
    directionCounts.set(direction, (directionCounts.get(direction) ?? 0) + 1);
  }

  const dominantDirection =
    Array.from(directionCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "none";

  return {
    likelyMotion: cssAnimations.length > 0 || maxChangedPixelRatio > 0.002,
    averageChangedPixelRatio,
    maxChangedPixelRatio: round4(maxChangedPixelRatio),
    dominantDirection,
    animatedElementCount: cssAnimations.length,
    changedRegionCount: pixelDiffs.filter((diff) => diff.changedPixelRatio > 0.002).length
  };
}

function buildDesignNotes(
  cssAnimations: CssAnimationReport[],
  pixelDiffs: PixelDiffReport[],
  overallMotion: AnalyzeMotionData["overallMotion"],
  scroll: AutoScrollReport | undefined
): string[] {
  const notes: string[] = [];

  if (cssAnimations.length > 0) {
    const animatedProperties = Array.from(new Set(cssAnimations.flatMap((animation) => animation.animatedProperties)));
    notes.push(
      `Detected ${cssAnimations.length} CSS/Web Animation target(s), affecting ${animatedProperties.slice(0, 8).join(", ") || "unknown properties"}.`
    );

    const primaryAnimation = cssAnimations[0];
    const timing = primaryAnimation?.timing;
    if (timing) {
      const firstKeyframeEasing =
        primaryAnimation?.keyframes
          .map((keyframe) => keyframe.easing)
          .find((easing) => typeof easing === "string" && easing !== "linear") ?? timing.easing;
      notes.push(
        `Primary timing appears to use duration ${String(timing.duration)}ms, easing ${String(firstKeyframeEasing)}, direction ${String(timing.direction)}.`
      );
    }
  } else {
    notes.push("No CSS/Web Animations were exposed through document.getAnimations().");
  }

  if (overallMotion.maxChangedPixelRatio > 0) {
    notes.push(
      `Pixel sampling saw up to ${(overallMotion.maxChangedPixelRatio * 100).toFixed(2)}% of sampled pixels change between adjacent frames.`
    );
  }

  if (overallMotion.dominantDirection !== "none") {
    notes.push(`The changed region centroid trends ${overallMotion.dominantDirection} across sampled frames.`);
  }

  const prominentDiff = [...pixelDiffs].sort((left, right) => right.changedPixelRatio - left.changedPixelRatio)[0];
  if (prominentDiff?.bounds) {
    notes.push(
      `Most prominent changed region is around x=${prominentDiff.bounds.x}, y=${prominentDiff.bounds.y}, ${prominentDiff.bounds.width}x${prominentDiff.bounds.height}.`
    );
  }

  if (scroll) {
    notes.push(`Scroll capture ran ${scroll.steps} step(s) and ${scroll.reachedBottom ? "reached" : "did not reach"} the page bottom.`);
  }

  if (!overallMotion.likelyMotion) {
    notes.push("Motion signal is weak; the page may be static or the sampled window may have missed the animation.");
  }

  return notes;
}

function vectorToDirection(dx: number, dy: number): PixelDiffReport["movementFromPrevious"] {
  const distance = Math.round(Math.hypot(dx, dy));
  return {
    dx: Math.round(dx),
    dy: Math.round(dy),
    distance,
    direction: directionFromVector(dx, dy)
  };
}

function directionFromVector(dx: number, dy: number): MotionDirection {
  const threshold = 8;
  if (Math.hypot(dx, dy) < threshold) {
    return "none";
  }

  const horizontal = Math.abs(dx) >= threshold ? (dx > 0 ? "right" : "left") : "";
  const vertical = Math.abs(dy) >= threshold ? (dy > 0 ? "down" : "up") : "";

  if (horizontal && vertical) {
    return `${vertical}-${horizontal}` as MotionDirection;
  }
  if (horizontal) {
    return horizontal as MotionDirection;
  }
  return vertical as MotionDirection;
}

function evenlySpacedTimes(durationMs: number, sampleCount: number): number[] {
  if (sampleCount <= 1) {
    return [0];
  }

  return Array.from({ length: sampleCount }, (_value, index) => Math.round((durationMs * index) / (sampleCount - 1)));
}

async function waitForRemaining(page: Page, startedAt: number, durationMs: number): Promise<void> {
  const remainingMs = durationMs - (Date.now() - startedAt);
  if (remainingMs > 0) {
    await page.waitForTimeout(remainingMs);
  }
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeHost(host: string): string {
  return host.replace(/[^a-z0-9.-]/gi, "_").slice(0, 80);
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
