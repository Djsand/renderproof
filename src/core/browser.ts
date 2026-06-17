import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import type { RuntimeConfig } from "./config.js";
import { assertAllowedHttpUrl } from "./url.js";
import { nowIso, type Evidence, WebRouterError } from "./types.js";

export interface CapturePageInput {
  url: string;
  fullPage?: boolean;
  includeImage?: boolean;
  includeAccessibilitySnapshot?: boolean;
  width?: number;
  height?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  outputDir?: string;
  allowPrivateNetwork?: boolean;
  autoScrollBeforeCapture?: boolean;
  scrollStepPx?: number;
  scrollDelayMs?: number;
  scrollMaxSteps?: number;
}

export interface CapturePageData {
  url: string;
  finalUrl: string;
  title: string;
  screenshotPath: string;
  mimeType: "image/png";
  width: number;
  height: number;
  fullPage: boolean;
  autoScroll?: AutoScrollReport;
  accessibilitySnapshot?: unknown;
}

export interface CaptureMotionInput {
  url: string;
  durationMs?: number;
  includeVideo?: boolean;
  includeKeyframes?: boolean;
  keyframeCount?: number;
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
}

export interface CaptureMotionFrame {
  index: number;
  timestampMs: number;
  path: string;
  mimeType: "image/png";
  width: number;
  height: number;
}

export interface CaptureMotionData {
  url: string;
  finalUrl: string;
  title: string;
  videoPath: string;
  mimeType: "video/webm";
  width: number;
  height: number;
  durationMs: number;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  keyframes: CaptureMotionFrame[];
  scroll?: AutoScrollReport;
}

export interface CaptureMotionResource {
  path: string;
  mimeType: "image/png" | "video/webm";
  base64: string;
}

export interface AutoScrollReport {
  enabled: true;
  steps: number;
  reachedBottom: boolean;
  restoredScrollPosition: boolean;
  startScrollY: number;
  endScrollY: number;
  documentHeight: number;
  viewportHeight: number;
  durationMs: number;
}

export async function capturePage(
  input: CapturePageInput,
  config: RuntimeConfig
): Promise<{ data: CapturePageData; imageBase64?: string; evidence: Evidence[] }> {
  const url = await assertAllowedHttpUrl(input.url, config, {
    allowPrivateNetwork: input.allowPrivateNetwork
  });

  const width = input.width ?? 1280;
  const height = input.height ?? 720;
  const fullPage = input.fullPage ?? false;
  const waitUntil = input.waitUntil ?? "networkidle";
  const timeoutMs = input.timeoutMs ?? 30000;
  const outputDir = path.resolve(input.outputDir ?? config.outputDir);

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(url.toString(), { waitUntil, timeout: timeoutMs });

      const autoScroll = input.autoScrollBeforeCapture
        ? await autoScrollPage(page, {
            stepPx: input.scrollStepPx,
            delayMs: input.scrollDelayMs,
            maxSteps: input.scrollMaxSteps,
            restoreScrollPosition: true
          })
        : undefined;

      const [title, finalUrl, screenshotBuffer, accessibilitySnapshot] = await Promise.all([
        page.title().catch(() => ""),
        Promise.resolve(page.url()),
        page.screenshot({ type: "png", fullPage, timeout: timeoutMs }),
        input.includeAccessibilitySnapshot
          ? maybeAriaSnapshot(page).catch((error: unknown) => ({
              error: error instanceof Error ? error.message : String(error)
            }))
          : Promise.resolve(undefined)
      ]);

      await mkdir(outputDir, { recursive: true });
      const screenshotPath = path.join(outputDir, `${safeTimestamp()}-${safeHost(url.hostname)}.png`);
      await writeFile(screenshotPath, screenshotBuffer);

      const data: CapturePageData = {
        url: url.toString(),
        finalUrl,
        title,
        screenshotPath,
        mimeType: "image/png",
        width,
        height,
        fullPage,
        ...(autoScroll ? { autoScroll } : {}),
        ...(accessibilitySnapshot ? { accessibilitySnapshot } : {})
      };

      return {
        data,
        imageBase64: input.includeImage === false ? undefined : screenshotBuffer.toString("base64"),
        evidence: [
          {
            kind: "screenshot",
            method: "playwright_chromium",
            url: finalUrl,
            timestamp: nowIso(),
            details: {
              screenshotPath,
              width,
              height,
              fullPage,
              autoScroll,
              waitUntil,
              title
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
    throw new WebRouterError("browser_capture_failed", "Playwright page capture failed.", {
      url: url.toString(),
      cause: message,
      hint: message.includes("Executable doesn't exist")
        ? "Run `npx playwright install chromium` in this project."
        : undefined
    });
  }
}

export async function captureMotion(
  input: CaptureMotionInput,
  config: RuntimeConfig
): Promise<{
  data: CaptureMotionData;
  videoBase64?: string;
  frameImages: CaptureMotionResource[];
  evidence: Evidence[];
}> {
  const url = await assertAllowedHttpUrl(input.url, config, {
    allowPrivateNetwork: input.allowPrivateNetwork
  });

  const width = input.width ?? 1280;
  const height = input.height ?? 720;
  const durationMs = boundedInt(input.durationMs, 5000, 500, 30000);
  const waitUntil = input.waitUntil ?? "load";
  const timeoutMs = input.timeoutMs ?? 30000;
  const outputDir = path.resolve(input.outputDir ?? config.outputDir);
  const includeKeyframes = input.includeKeyframes !== false;
  const keyframeCount = includeKeyframes ? boundedInt(input.keyframeCount, 3, 1, 8) : 0;

  try {
    await mkdir(outputDir, { recursive: true });

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const baseName = `${safeTimestamp()}-${safeHost(url.hostname)}`;
    const videoPath = path.join(outputDir, `${baseName}.webm`);

    try {
      const context = await browser.newContext({
        viewport: { width, height },
        recordVideo: {
          dir: outputDir,
          size: { width, height }
        }
      });
      const page = await context.newPage();

      await page.goto(url.toString(), { waitUntil, timeout: timeoutMs });

      const video = page.video();
      const motionStartedAt = Date.now();
      const frames: CaptureMotionFrame[] = [];
      const frameImages: CaptureMotionResource[] = [];

      let scroll: AutoScrollReport | undefined;

      if (input.scrollDuringCapture) {
        await captureKeyframe({
          page,
          frames,
          frameImages,
          outputDir,
          baseName,
          width,
          height,
          motionStartedAt,
          index: frames.length,
          timeoutMs,
          enabled: includeKeyframes && frames.length < keyframeCount
        });

        scroll = await autoScrollPage(page, {
          stepPx: input.scrollStepPx,
          delayMs: input.scrollDelayMs,
          maxSteps: input.scrollMaxSteps,
          restoreScrollPosition: false
        });

        await captureKeyframe({
          page,
          frames,
          frameImages,
          outputDir,
          baseName,
          width,
          height,
          motionStartedAt,
          index: frames.length,
          timeoutMs,
          enabled: includeKeyframes && frames.length < keyframeCount
        });

        const remainingMs = durationMs - (Date.now() - motionStartedAt);
        if (remainingMs > 0) {
          await page.waitForTimeout(remainingMs);
        }

        await captureKeyframe({
          page,
          frames,
          frameImages,
          outputDir,
          baseName,
          width,
          height,
          motionStartedAt,
          index: frames.length,
          timeoutMs,
          enabled: includeKeyframes && frames.length < keyframeCount
        });
      } else {
        await captureKeyframesAtTimes({
          page,
          frames,
          frameImages,
          outputDir,
          baseName,
          width,
          height,
          durationMs,
          motionStartedAt,
          keyframeCount,
          timeoutMs
        });
      }

      const [title, finalUrl] = await Promise.all([page.title().catch(() => ""), Promise.resolve(page.url())]);

      await context.close();

      if (!video) {
        throw new WebRouterError("browser_video_unavailable", "Playwright did not expose a video object for this page.", {
          url: url.toString()
        });
      }

      await video.saveAs(videoPath);
      await removeTemporaryVideo(video, videoPath);

      const data: CaptureMotionData = {
        url: url.toString(),
        finalUrl,
        title,
        videoPath,
        mimeType: "video/webm",
        width,
        height,
        durationMs,
        waitUntil,
        keyframes: frames,
        ...(scroll ? { scroll } : {})
      };

      return {
        data,
        videoBase64: input.includeVideo === false ? undefined : (await readFile(videoPath)).toString("base64"),
        frameImages,
        evidence: [
          {
            kind: "motion",
            method: "playwright_chromium_video",
            url: finalUrl,
            timestamp: nowIso(),
            details: {
              videoPath,
              width,
              height,
              durationMs,
              waitUntil,
              title,
              keyframeCount: frames.length,
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
    throw new WebRouterError("browser_motion_capture_failed", "Playwright motion capture failed.", {
      url: url.toString(),
      cause: message,
      hint: message.includes("Executable doesn't exist")
        ? "Run `npx playwright install chromium` in this project."
        : undefined
    });
  }
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeHost(host: string): string {
  return host.replace(/[^a-z0-9.-]/gi, "_").slice(0, 80);
}

async function maybeAriaSnapshot(page: unknown): Promise<unknown> {
  const candidate = page as { ariaSnapshot?: (options: { mode: "ai"; timeout: number }) => Promise<unknown> };
  if (typeof candidate.ariaSnapshot !== "function") {
    return { unavailable: "Playwright Page.ariaSnapshot is not available in this runtime." };
  }

  return candidate.ariaSnapshot({ mode: "ai", timeout: 5000 });
}

export async function autoScrollPage(
  page: Page,
  options: {
    stepPx?: number;
    delayMs?: number;
    maxSteps?: number;
    restoreScrollPosition: boolean;
  }
): Promise<AutoScrollReport> {
  const startedAt = Date.now();
  const initial = await getScrollState(page);
  const stepPx = boundedInt(options.stepPx, Math.max(300, Math.floor(initial.viewportHeight * 0.8)), 100, 8000);
  const delayMs = boundedInt(options.delayMs, 250, 0, 5000);
  const maxSteps = boundedInt(options.maxSteps, 40, 1, 200);

  let steps = 0;
  let reachedBottom = initial.scrollY + initial.viewportHeight >= initial.documentHeight;
  let previousScrollY = initial.scrollY;

  for (let index = 0; index < maxSteps && !reachedBottom; index += 1) {
    const state = await page.evaluate((step) => {
      window.scrollBy(0, step);
      const documentHeight = Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement?.scrollHeight ?? 0
      );
      return {
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        documentHeight
      };
    }, stepPx);

    steps += 1;
    reachedBottom = Math.ceil(state.scrollY + state.viewportHeight) >= state.documentHeight;

    if (delayMs > 0) {
      await page.waitForTimeout(delayMs);
    }

    if (state.scrollY === previousScrollY) {
      reachedBottom = true;
      break;
    }

    previousScrollY = state.scrollY;
  }

  if (options.restoreScrollPosition) {
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), initial.scrollY);
    if (delayMs > 0) {
      await page.waitForTimeout(Math.min(delayMs, 1000));
    }
  }

  const final = await getScrollState(page);

  return {
    enabled: true,
    steps,
    reachedBottom,
    restoredScrollPosition: options.restoreScrollPosition,
    startScrollY: initial.scrollY,
    endScrollY: final.scrollY,
    documentHeight: final.documentHeight,
    viewportHeight: final.viewportHeight,
    durationMs: Date.now() - startedAt
  };
}

async function getScrollState(page: Page): Promise<{
  scrollY: number;
  viewportHeight: number;
  documentHeight: number;
}> {
  return page.evaluate(() => ({
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
    documentHeight: Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0)
  }));
}

async function captureKeyframesAtTimes(input: {
  page: Page;
  frames: CaptureMotionFrame[];
  frameImages: CaptureMotionResource[];
  outputDir: string;
  baseName: string;
  width: number;
  height: number;
  durationMs: number;
  motionStartedAt: number;
  keyframeCount: number;
  timeoutMs: number;
}): Promise<void> {
  if (input.keyframeCount <= 0) {
    await input.page.waitForTimeout(input.durationMs);
    return;
  }

  const frameTimes =
    input.keyframeCount === 1
      ? [0]
      : Array.from({ length: input.keyframeCount }, (_, index) =>
          Math.round((input.durationMs * index) / (input.keyframeCount - 1))
        );

  for (let index = 0; index < frameTimes.length; index += 1) {
    const targetMs = frameTimes[index] ?? 0;
    const elapsedMs = Date.now() - input.motionStartedAt;
    if (targetMs > elapsedMs) {
      await input.page.waitForTimeout(targetMs - elapsedMs);
    }

    await captureKeyframe({
      page: input.page,
      frames: input.frames,
      frameImages: input.frameImages,
      outputDir: input.outputDir,
      baseName: input.baseName,
      width: input.width,
      height: input.height,
      motionStartedAt: input.motionStartedAt,
      index,
      timeoutMs: input.timeoutMs,
      enabled: true
    });
  }

  const remainingMs = input.durationMs - (Date.now() - input.motionStartedAt);
  if (remainingMs > 0) {
    await input.page.waitForTimeout(remainingMs);
  }
}

async function captureKeyframe(input: {
  page: Page;
  frames: CaptureMotionFrame[];
  frameImages: CaptureMotionResource[];
  outputDir: string;
  baseName: string;
  width: number;
  height: number;
  motionStartedAt: number;
  index: number;
  timeoutMs: number;
  enabled: boolean;
}): Promise<void> {
  if (!input.enabled) {
    return;
  }

  const timestampMs = Date.now() - input.motionStartedAt;
  const buffer = await input.page.screenshot({ type: "png", fullPage: false, timeout: input.timeoutMs });
  const framePath = path.join(input.outputDir, `${input.baseName}-frame-${input.index}.png`);
  await writeFile(framePath, buffer);

  input.frames.push({
    index: input.index,
    timestampMs,
    path: framePath,
    mimeType: "image/png",
    width: input.width,
    height: input.height
  });
  input.frameImages.push({
    path: framePath,
    mimeType: "image/png",
    base64: buffer.toString("base64")
  });
}

async function removeTemporaryVideo(video: { path: () => Promise<string> }, finalPath: string): Promise<void> {
  try {
    const temporaryPath = await video.path();
    if (path.resolve(temporaryPath) !== path.resolve(finalPath)) {
      await unlink(temporaryPath);
    }
  } catch {
    // The final saved video is the evidence artifact; cleanup failure should not fail the tool.
  }
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
