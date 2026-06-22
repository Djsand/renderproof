import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import { autoScrollPage, type AutoScrollReport } from "./browser.js";
import type { RuntimeConfig } from "./config.js";
import { nowIso, type Evidence, WebRouterError } from "./types.js";
import { assertAllowedHttpUrl } from "./url.js";

export interface CloneWebsiteInput {
  url: string;
  outputDir?: string;
  allowPrivateNetwork?: boolean;
  desktopWidth?: number;
  desktopHeight?: number;
  mobileWidth?: number;
  mobileHeight?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  settleMs?: number;
  maxSections?: number;
  maxElementsPerSection?: number;
  maxAssets?: number;
  maxAssetBytes?: number;
  downloadAssets?: boolean;
  includeSectionScreenshots?: boolean;
  autoScroll?: boolean;
  scrollStepPx?: number;
  scrollDelayMs?: number;
  scrollMaxSteps?: number;
}

export interface CloneWebsiteData {
  url: string;
  finalUrl: string;
  title: string;
  generatedAt: string;
  outputDir: string;
  manifestPath: string;
  briefPath: string;
  designTokensPath: string;
  topologyPath: string;
  behaviorsPath: string;
  assetManifestPath: string;
  screenshots: {
    desktop: string;
    mobile: string;
  };
  componentSpecPaths: string[];
  desktop: ViewportProfile;
  mobile: ViewportProfile;
  assetDownloads: AssetDownloadReport;
  cloneReadiness: {
    sectionsDetected: number;
    componentSpecsWritten: number;
    assetsDiscovered: number;
    assetsDownloaded: number;
    behaviorFindings: number;
    recommendedNextSteps: string[];
  };
  limitations: string[];
}

export interface ViewportProfile {
  viewport: ViewportSize;
  screenshotPath: string;
  scroll?: AutoScrollReport;
  profile: PageProfile;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PageProfile {
  finalUrl: string;
  title: string;
  meta: PageMeta;
  document: {
    width: number;
    height: number;
    scrollHeight: number;
    bodyClassName?: string;
    htmlClassName?: string;
  };
  designTokens: DesignTokens;
  assets: DiscoveredAssets;
  sections: SectionProfile[];
  behaviors: BehaviorProfile;
}

export interface PageMeta {
  description?: string;
  viewport?: string;
  canonical?: string;
  openGraph: Record<string, string>;
}

export interface DesignTokens {
  colors: TokenCount[];
  fontFamilies: TokenCount[];
  fontSizes: TokenCount[];
  fontWeights: TokenCount[];
  lineHeights: TokenCount[];
  radii: TokenCount[];
  shadows: TokenCount[];
  spacing: TokenCount[];
}

export interface TokenCount {
  value: string;
  count: number;
}

export interface DiscoveredAssets {
  images: ImageAsset[];
  videos: VideoAsset[];
  backgroundImages: BackgroundAsset[];
  favicons: FaviconAsset[];
  stylesheets: StylesheetAsset[];
  inlineSvgCount: number;
}

export interface ImageAsset {
  src: string;
  alt?: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  selector: string;
  parentSelector?: string;
}

export interface VideoAsset {
  src?: string;
  poster?: string;
  sources: string[];
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  selector: string;
}

export interface BackgroundAsset {
  url: string;
  selector: string;
  tagName: string;
  text?: string;
}

export interface FaviconAsset {
  href: string;
  rel: string;
  sizes?: string;
  type?: string;
}

export interface StylesheetAsset {
  href: string;
  rel: string;
  media?: string;
}

export interface SectionProfile {
  index: number;
  name: string;
  selector: string;
  tagName: string;
  id?: string;
  className?: string;
  rect: RectData;
  styles: Record<string, string>;
  text: string;
  counts: {
    children: number;
    links: number;
    buttons: number;
    inputs: number;
    images: number;
    videos: number;
    svgs: number;
  };
  interactionModel: "static" | "click-hover" | "scroll-linked" | "time-motion" | "mixed";
  assets: SectionAssetReference[];
  outline: ElementOutline;
  screenshotPath?: string;
  screenshotError?: string;
}

export interface SectionAssetReference {
  kind: "image" | "video" | "background" | "svg";
  url?: string;
  alt?: string;
  selector: string;
}

export interface ElementOutline {
  tagName: string;
  selector: string;
  id?: string;
  className?: string;
  text?: string;
  styles: Record<string, string>;
  children: ElementOutline[];
}

export interface RectData {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BehaviorProfile {
  fixedOrSticky: BehaviorElement[];
  scrollSnapContainers: BehaviorElement[];
  animatedElements: AnimationElement[];
  transitionElements: BehaviorElement[];
  interactiveElements: InteractiveElement[];
  forms: BehaviorElement[];
  scrollChanges: ScrollChangeReport[];
}

export interface BehaviorElement {
  selector: string;
  tagName: string;
  text?: string;
  styles: Record<string, string>;
}

export interface AnimationElement extends BehaviorElement {
  animationCount: number;
  animations: Array<Record<string, unknown>>;
}

export interface InteractiveElement extends BehaviorElement {
  role?: string;
  href?: string;
  ariaLabel?: string;
  type?: string;
}

export interface ScrollChangeReport {
  selector: string;
  tagName: string;
  text?: string;
  triggerScrollY: number;
  changedStyles: Record<string, { before: string; after: string }>;
}

export interface AssetCandidate {
  url: string;
  kind: "image" | "background" | "video" | "poster" | "favicon" | "stylesheet";
  source: string;
}

export interface AssetDownload {
  sourceUrl: string;
  kind: AssetCandidate["kind"];
  path: string;
  contentType?: string;
  bytes: number;
}

export interface AssetSkip {
  sourceUrl: string;
  kind: AssetCandidate["kind"];
  reason: string;
}

export interface AssetDownloadReport {
  enabled: boolean;
  attempted: number;
  downloaded: AssetDownload[];
  skipped: AssetSkip[];
  failed: AssetSkip[];
  maxAssets: number;
  maxAssetBytes: number;
}

interface ExtractPageProfileOptions {
  maxSections: number;
  maxElementsPerSection: number;
}

interface CaptureResult {
  profile: PageProfile;
  screenshotPath: string;
  scroll?: AutoScrollReport;
}

const DEFAULT_DESKTOP: ViewportSize = { width: 1440, height: 900 };
const DEFAULT_MOBILE: ViewportSize = { width: 390, height: 844 };

export async function cloneWebsite(
  input: CloneWebsiteInput,
  config: RuntimeConfig
): Promise<{ data: CloneWebsiteData; evidence: Evidence[] }> {
  const url = await assertAllowedHttpUrl(input.url, config, {
    allowPrivateNetwork: input.allowPrivateNetwork
  });

  const generatedAt = nowIso();
  const outputRoot = path.resolve(input.outputDir ?? config.outputDir);
  const cloneDir = path.join(outputRoot, "clones", `${safeTimestamp()}-${safeHost(url.hostname)}`);
  const referencesDir = path.join(cloneDir, "design-references");
  const researchDir = path.join(cloneDir, "research");
  const componentsDir = path.join(researchDir, "components");
  const assetsDir = path.join(cloneDir, "assets");

  await Promise.all([
    mkdir(referencesDir, { recursive: true }),
    mkdir(componentsDir, { recursive: true }),
    mkdir(assetsDir, { recursive: true })
  ]);

  const desktop = {
    width: boundedInt(input.desktopWidth, DEFAULT_DESKTOP.width, 320, 3840),
    height: boundedInt(input.desktopHeight, DEFAULT_DESKTOP.height, 240, 2160)
  };
  const mobile = {
    width: boundedInt(input.mobileWidth, DEFAULT_MOBILE.width, 320, 1200),
    height: boundedInt(input.mobileHeight, DEFAULT_MOBILE.height, 240, 2160)
  };
  const maxSections = boundedInt(input.maxSections, 24, 1, 80);
  const maxElementsPerSection = boundedInt(input.maxElementsPerSection, 80, 10, 500);
  const maxAssets = boundedInt(input.maxAssets, 60, 0, 300);
  const maxAssetBytes = boundedInt(input.maxAssetBytes, 10 * 1024 * 1024, 1024, 50 * 1024 * 1024);
  const waitUntil = input.waitUntil ?? "networkidle";
  const timeoutMs = boundedInt(input.timeoutMs, 45000, 1000, 120000);

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const desktopResult = await captureViewport({
        page: await browser.newPage({ viewport: desktop }),
        url,
        viewportName: "desktop",
        viewport: desktop,
        referencesDir,
        waitUntil,
        timeoutMs,
        input,
        profileOptions: { maxSections, maxElementsPerSection }
      });

      const mobileResult = await captureViewport({
        page: await browser.newPage({ viewport: mobile, isMobile: true }),
        url,
        viewportName: "mobile",
        viewport: mobile,
        referencesDir,
        waitUntil,
        timeoutMs,
        input,
        profileOptions: { maxSections, maxElementsPerSection }
      });

      const sectionScreenshots = input.includeSectionScreenshots === false
        ? []
        : await captureSectionScreenshots({
            page: await browser.newPage({ viewport: desktop }),
            url,
            sections: desktopResult.profile.sections,
            referencesDir,
            waitUntil,
            timeoutMs,
            settleMs: boundedInt(input.settleMs, 500, 0, 10000)
          });

      const sections = desktopResult.profile.sections.map((section) => {
        const screenshot = sectionScreenshots.find((item) => item.index === section.index);
        return {
          ...section,
          ...(screenshot?.path ? { screenshotPath: screenshot.path } : {}),
          ...(screenshot?.error ? { screenshotError: screenshot.error } : {})
        };
      });

      desktopResult.profile.sections = sections;

      const assetCandidates = collectAssetCandidates(desktopResult.profile, mobileResult.profile);
      const assetDownloads = input.downloadAssets === false
        ? {
            enabled: false,
            attempted: 0,
            downloaded: [],
            skipped: [],
            failed: [],
            maxAssets,
            maxAssetBytes
          }
        : await downloadAssets(assetCandidates, {
            assetsDir,
            config,
            allowPrivateNetwork: input.allowPrivateNetwork,
            maxAssets,
            maxAssetBytes
          });

      const manifestPath = path.join(cloneDir, "clone-manifest.json");
      const briefPath = path.join(researchDir, "CLONE_BRIEF.md");
      const designTokensPath = path.join(researchDir, "DESIGN_TOKENS.md");
      const topologyPath = path.join(researchDir, "PAGE_TOPOLOGY.md");
      const behaviorsPath = path.join(researchDir, "BEHAVIORS.md");
      const assetManifestPath = path.join(researchDir, "assets.json");

      const componentSpecPaths = await writeComponentSpecs({
        componentsDir,
        sections,
        desktopScreenshotPath: desktopResult.screenshotPath,
        mobileProfile: mobileResult.profile
      });

      const data: CloneWebsiteData = {
        url: url.toString(),
        finalUrl: desktopResult.profile.finalUrl,
        title: desktopResult.profile.title,
        generatedAt,
        outputDir: cloneDir,
        manifestPath,
        briefPath,
        designTokensPath,
        topologyPath,
        behaviorsPath,
        assetManifestPath,
        screenshots: {
          desktop: desktopResult.screenshotPath,
          mobile: mobileResult.screenshotPath
        },
        componentSpecPaths,
        desktop: {
          viewport: desktop,
          screenshotPath: desktopResult.screenshotPath,
          ...(desktopResult.scroll ? { scroll: desktopResult.scroll } : {}),
          profile: desktopResult.profile
        },
        mobile: {
          viewport: mobile,
          screenshotPath: mobileResult.screenshotPath,
          ...(mobileResult.scroll ? { scroll: mobileResult.scroll } : {}),
          profile: mobileResult.profile
        },
        assetDownloads,
        cloneReadiness: {
          sectionsDetected: sections.length,
          componentSpecsWritten: componentSpecPaths.length,
          assetsDiscovered: assetCandidates.length,
          assetsDownloaded: assetDownloads.downloaded.length,
          behaviorFindings: behaviorFindingCount(desktopResult.profile.behaviors),
          recommendedNextSteps: [
            "Use CLONE_BRIEF.md as the implementation prompt for the coding agent.",
            "Build foundation tokens first from DESIGN_TOKENS.md before section components.",
            "Implement sections one spec at a time from research/components.",
            "Run visual QA against the desktop and mobile screenshots before calling the clone complete."
          ]
        },
        limitations: [
          "RenderProof captures public rendered state and does not bypass login walls, paywalls, CAPTCHA, or bot checks.",
          "Hover and click states are inferred from DOM and CSS signals; complex widgets may still need manual browser interaction.",
          "Asset downloads are capped by maxAssets and maxAssetBytes to avoid unexpectedly large local captures.",
          "The generated artifacts are clone instructions and evidence, not a completed application."
        ]
      };

      await Promise.all([
        writeFile(manifestPath, `${JSON.stringify(data, null, 2)}\n`),
        writeFile(assetManifestPath, `${JSON.stringify({ candidates: assetCandidates, downloads: assetDownloads }, null, 2)}\n`),
        writeFile(briefPath, buildCloneBrief(data)),
        writeFile(designTokensPath, buildDesignTokensMarkdown(data)),
        writeFile(topologyPath, buildTopologyMarkdown(data)),
        writeFile(behaviorsPath, buildBehaviorsMarkdown(data))
      ]);

      return {
        data,
        evidence: [
          {
            kind: "clone",
            method: "playwright_chromium_clone_brief",
            url: data.finalUrl,
            timestamp: generatedAt,
            details: {
              outputDir: cloneDir,
              manifestPath,
              desktopScreenshotPath: desktopResult.screenshotPath,
              mobileScreenshotPath: mobileResult.screenshotPath,
              sections: sections.length,
              componentSpecs: componentSpecPaths.length,
              assetsDiscovered: assetCandidates.length,
              assetsDownloaded: assetDownloads.downloaded.length
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
    throw new WebRouterError("clone_website_failed", "Website clone capture failed.", {
      url: url.toString(),
      cause: message,
      hint: message.includes("Executable doesn't exist")
        ? "Run `npx playwright install chromium` in this project."
        : undefined
    });
  }
}

async function captureViewport(input: {
  page: Page;
  url: URL;
  viewportName: "desktop" | "mobile";
  viewport: ViewportSize;
  referencesDir: string;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  timeoutMs: number;
  input: CloneWebsiteInput;
  profileOptions: ExtractPageProfileOptions;
}): Promise<CaptureResult> {
  const settleMs = boundedInt(input.input.settleMs, 500, 0, 10000);

  try {
    await input.page.goto(input.url.toString(), { waitUntil: input.waitUntil, timeout: input.timeoutMs });
    await installEvaluateNameShim(input.page);
    if (settleMs > 0) {
      await input.page.waitForTimeout(settleMs);
    }

    const scroll = input.input.autoScroll === false
      ? undefined
      : await autoScrollPage(input.page, {
          stepPx: input.input.scrollStepPx,
          delayMs: input.input.scrollDelayMs,
          maxSteps: input.input.scrollMaxSteps,
          restoreScrollPosition: true
        });

    const scrollChanges = await detectScrollChanges(input.page);
    const profile = await extractPageProfile(input.page, input.profileOptions);
    profile.behaviors.scrollChanges = scrollChanges;

    const screenshotPath = path.join(input.referencesDir, `${input.viewportName}-${input.viewport.width}x${input.viewport.height}.png`);
    const buffer = await input.page.screenshot({ type: "png", fullPage: true, timeout: input.timeoutMs });
    await writeFile(screenshotPath, buffer);

    return { profile, screenshotPath, ...(scroll ? { scroll } : {}) };
  } finally {
    await input.page.close();
  }
}

async function captureSectionScreenshots(input: {
  page: Page;
  url: URL;
  sections: SectionProfile[];
  referencesDir: string;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  timeoutMs: number;
  settleMs: number;
}): Promise<Array<{ index: number; path?: string; error?: string }>> {
  const sectionDir = path.join(input.referencesDir, "sections");
  await mkdir(sectionDir, { recursive: true });

  try {
    await input.page.goto(input.url.toString(), { waitUntil: input.waitUntil, timeout: input.timeoutMs });
    await installEvaluateNameShim(input.page);
    if (input.settleMs > 0) {
      await input.page.waitForTimeout(input.settleMs);
    }

    const results: Array<{ index: number; path?: string; error?: string }> = [];
    for (const section of input.sections) {
      const screenshotPath = path.join(sectionDir, `${String(section.index + 1).padStart(2, "0")}-${slug(section.name)}.png`);
      try {
        await input.page.locator(section.selector).first().screenshot({
          path: screenshotPath,
          timeout: Math.min(input.timeoutMs, 15000)
        });
        results.push({ index: section.index, path: screenshotPath });
      } catch (error) {
        results.push({
          index: section.index,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  } finally {
    await input.page.close();
  }
}

async function installEvaluateNameShim(page: Page): Promise<void> {
  await page.evaluate("globalThis.__name = globalThis.__name || ((target) => target)");
}

async function extractPageProfile(page: Page, options: ExtractPageProfileOptions): Promise<PageProfile> {
  return page.evaluate((profileOptions) => {
    const styleProps = [
      ["fontSize", "font-size"],
      ["fontWeight", "font-weight"],
      ["fontFamily", "font-family"],
      ["lineHeight", "line-height"],
      ["letterSpacing", "letter-spacing"],
      ["color", "color"],
      ["backgroundColor", "background-color"],
      ["background", "background"],
      ["padding", "padding"],
      ["margin", "margin"],
      ["width", "width"],
      ["height", "height"],
      ["maxWidth", "max-width"],
      ["display", "display"],
      ["flexDirection", "flex-direction"],
      ["justifyContent", "justify-content"],
      ["alignItems", "align-items"],
      ["gap", "gap"],
      ["gridTemplateColumns", "grid-template-columns"],
      ["borderRadius", "border-radius"],
      ["border", "border"],
      ["boxShadow", "box-shadow"],
      ["overflow", "overflow"],
      ["position", "position"],
      ["top", "top"],
      ["zIndex", "z-index"],
      ["opacity", "opacity"],
      ["transform", "transform"],
      ["transition", "transition"],
      ["animation", "animation"],
      ["objectFit", "object-fit"],
      ["filter", "filter"],
      ["backdropFilter", "backdrop-filter"]
    ] as const;

    function round(value: number): number {
      return Math.round(value * 100) / 100;
    }

    function rectData(element: Element): RectData {
      const rect = element.getBoundingClientRect();
      return {
        x: round(rect.x),
        y: round(rect.y + window.scrollY),
        width: round(rect.width),
        height: round(rect.height),
        top: round(rect.top + window.scrollY),
        right: round(rect.right),
        bottom: round(rect.bottom + window.scrollY),
        left: round(rect.left)
      };
    }

    function classNameOf(element: Element): string | undefined {
      const className = element.getAttribute("class")?.replace(/\s+/g, " ").trim();
      return className || undefined;
    }

    function textOf(element: Element, maxLength: number): string {
      return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
    }

    function directTextOf(element: Element, maxLength: number): string | undefined {
      const text = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
      return text || undefined;
    }

    function escapeCss(value: string): string {
      return typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }

    function selectorFor(element: Element): string {
      if (element.id) {
        return `#${escapeCss(element.id)}`;
      }

      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && parts.length < 5) {
        const tag = current.tagName.toLowerCase();
        const className = classNameOf(current)?.split(" ").filter(Boolean).slice(0, 2);
        const classSelector = className && className.length > 0 ? `.${className.map(escapeCss).join(".")}` : "";
        const parent = current.parentElement;
        const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current?.tagName) : [];
        const nth = siblings.length > 1 && parent ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${classSelector}${nth}`);
        current = current.parentElement;
      }

      return parts.join(" > ");
    }

    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return (
        rect.width > 2 &&
        rect.height > 2 &&
        styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        styles.opacity !== "0"
      );
    }

    function usefulStyleValue(name: string, value: string): boolean {
      if (!value || value === "normal" || value === "none" || value === "auto" || value === "initial") {
        return false;
      }
      if (value === "0px" && !["top", "borderRadius"].includes(name)) {
        return false;
      }
      if (value === "rgba(0, 0, 0, 0)" || value === "transparent") {
        return false;
      }
      return true;
    }

    function extractStyles(element: Element): Record<string, string> {
      const styles = getComputedStyle(element);
      const output: Record<string, string> = {};
      for (const [name, cssName] of styleProps) {
        const value = styles.getPropertyValue(cssName).trim();
        if (usefulStyleValue(name, value)) {
          output[name] = value;
        }
      }
      return output;
    }

    function addCount(map: Map<string, number>, value: string | null | undefined): void {
      const normalized = value?.replace(/\s+/g, " ").trim();
      if (!normalized || normalized === "rgba(0, 0, 0, 0)" || normalized === "transparent" || normalized === "none") {
        return;
      }
      map.set(normalized, (map.get(normalized) ?? 0) + 1);
    }

    function topCounts(map: Map<string, number>, limit: number): TokenCount[] {
      return Array.from(map.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));
    }

    function absoluteUrl(raw: string | null | undefined): string | undefined {
      if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) {
        return undefined;
      }
      try {
        return new URL(raw, document.baseURI).toString();
      } catch {
        return undefined;
      }
    }

    function urlsFromBackground(value: string): string[] {
      return Array.from(value.matchAll(/url\((['"]?)(.*?)\1\)/g))
        .map((match) => absoluteUrl(match[2]))
        .filter((url): url is string => Boolean(url));
    }

    const allElements = Array.from(document.querySelectorAll("*"));
    const visibleElements = allElements.filter(isVisible);
    const colorCounts = new Map<string, number>();
    const fontFamilies = new Map<string, number>();
    const fontSizes = new Map<string, number>();
    const fontWeights = new Map<string, number>();
    const lineHeights = new Map<string, number>();
    const radii = new Map<string, number>();
    const shadows = new Map<string, number>();
    const spacing = new Map<string, number>();

    for (const element of visibleElements.slice(0, 700)) {
      const styles = getComputedStyle(element);
      addCount(colorCounts, styles.color);
      addCount(colorCounts, styles.backgroundColor);
      addCount(colorCounts, styles.borderTopColor);
      addCount(fontFamilies, styles.fontFamily);
      addCount(fontSizes, styles.fontSize);
      addCount(fontWeights, styles.fontWeight);
      addCount(lineHeights, styles.lineHeight);
      addCount(radii, styles.borderRadius);
      addCount(shadows, styles.boxShadow);
      addCount(spacing, styles.paddingTop);
      addCount(spacing, styles.paddingRight);
      addCount(spacing, styles.marginTop);
      addCount(spacing, styles.gap);
    }

    const images: ImageAsset[] = Array.from(document.images)
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return {
          src: absoluteUrl(image.currentSrc || image.src) ?? "",
          alt: image.alt || undefined,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          selector: selectorFor(image),
          parentSelector: image.parentElement ? selectorFor(image.parentElement) : undefined
        };
      })
      .filter((image) => Boolean(image.src));

    const videos: VideoAsset[] = Array.from(document.querySelectorAll("video")).map((video) => ({
      src: absoluteUrl(video.currentSrc || video.src),
      poster: absoluteUrl(video.poster),
      sources: Array.from(video.querySelectorAll("source"))
        .map((source) => absoluteUrl(source.src))
        .filter((source): source is string => Boolean(source)),
      autoplay: video.autoplay,
      loop: video.loop,
      muted: video.muted,
      selector: selectorFor(video)
    }));

    const backgroundImages: BackgroundAsset[] = [];
    for (const element of visibleElements.slice(0, 1000)) {
      const background = getComputedStyle(element).backgroundImage;
      for (const url of urlsFromBackground(background)) {
        backgroundImages.push({
          url,
          selector: selectorFor(element),
          tagName: element.tagName.toLowerCase(),
          text: textOf(element, 80) || undefined
        });
      }
    }

    const favicons: FaviconAsset[] = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"], link[rel="apple-touch-icon"]'))
      .map((link) => ({
        href: absoluteUrl(link.href) ?? "",
        rel: link.rel,
        sizes: link.sizes?.toString() || undefined,
        type: link.type || undefined
      }))
      .filter((link) => Boolean(link.href));

    const stylesheets: StylesheetAsset[] = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="preload"][as="style"]'))
      .map((link) => ({
        href: absoluteUrl(link.href) ?? "",
        rel: link.rel,
        media: link.media || undefined
      }))
      .filter((link) => Boolean(link.href));

    function outline(element: Element, depth: number, counter: { count: number }): ElementOutline {
      counter.count += 1;
      const children =
        depth >= 2 || counter.count >= profileOptions.maxElementsPerSection
          ? []
          : Array.from(element.children)
              .filter(isVisible)
              .slice(0, 10)
              .map((child) => outline(child, depth + 1, counter));

      return {
        tagName: element.tagName.toLowerCase(),
        selector: selectorFor(element),
        id: element.id || undefined,
        className: classNameOf(element),
        text: directTextOf(element, 160),
        styles: extractStyles(element),
        children
      };
    }

    function sectionAssets(element: Element): SectionAssetReference[] {
      const refs: SectionAssetReference[] = [];
      for (const image of Array.from(element.querySelectorAll("img")).slice(0, 20)) {
        refs.push({
          kind: "image",
          url: absoluteUrl(image.currentSrc || image.src),
          alt: image.alt || undefined,
          selector: selectorFor(image)
        });
      }
      for (const video of Array.from(element.querySelectorAll("video")).slice(0, 10)) {
        refs.push({
          kind: "video",
          url: absoluteUrl(video.currentSrc || video.src || video.querySelector("source")?.src),
          selector: selectorFor(video)
        });
      }
      for (const backgroundElement of Array.from(element.querySelectorAll("*")).filter(isVisible).slice(0, 80)) {
        const urls = urlsFromBackground(getComputedStyle(backgroundElement).backgroundImage);
        for (const url of urls) {
          refs.push({
            kind: "background",
            url,
            selector: selectorFor(backgroundElement)
          });
        }
      }
      for (const svg of Array.from(element.querySelectorAll("svg")).slice(0, 20)) {
        refs.push({
          kind: "svg",
          selector: selectorFor(svg)
        });
      }
      return refs;
    }

    function inferInteractionModel(element: Element): SectionProfile["interactionModel"] {
      const styles = getComputedStyle(element);
      const interactive = element.querySelectorAll('a, button, input, select, textarea, summary, [role="button"], [tabindex]').length;
      const animated = element.getAnimations({ subtree: true }).length;
      const scrollLinked =
        styles.position === "sticky" ||
        styles.position === "fixed" ||
        styles.scrollSnapType !== "none" ||
        Array.from(element.querySelectorAll("*")).some((child) => {
          const childStyles = getComputedStyle(child);
          return childStyles.position === "sticky" || childStyles.scrollSnapType !== "none";
        });

      if (scrollLinked && (interactive > 0 || animated > 0)) {
        return "mixed";
      }
      if (scrollLinked) {
        return "scroll-linked";
      }
      if (animated > 0) {
        return interactive > 0 ? "mixed" : "time-motion";
      }
      if (interactive > 0) {
        return "click-hover";
      }
      return "static";
    }

    const rawCandidates = Array.from(
      document.querySelectorAll("header, nav, main > section, section, main > div, main > article, article, footer")
    ).filter(isVisible);
    const fallbackCandidates = Array.from(document.body.children).filter(isVisible);
    const candidateElements = (rawCandidates.length >= 2 ? rawCandidates : fallbackCandidates).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.height >= 60 || ["HEADER", "NAV", "FOOTER"].includes(element.tagName);
    });

    const selectedSections: Element[] = [];
    for (const element of candidateElements) {
      if (selectedSections.some((selected) => selected.contains(element))) {
        continue;
      }
      selectedSections.push(element);
      if (selectedSections.length >= profileOptions.maxSections) {
        break;
      }
    }

    const sections: SectionProfile[] = selectedSections.map((element, index) => {
      const styles = extractStyles(element);
      const text = textOf(element, 1200);
      const heading = element.querySelector("h1, h2, h3, [role='heading']");
      const name = textOf(heading ?? element, 60) || `${element.tagName.toLowerCase()}-${index + 1}`;
      return {
        index,
        name,
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        id: element.id || undefined,
        className: classNameOf(element),
        rect: rectData(element),
        styles,
        text,
        counts: {
          children: element.children.length,
          links: element.querySelectorAll("a").length,
          buttons: element.querySelectorAll("button, [role='button']").length,
          inputs: element.querySelectorAll("input, textarea, select").length,
          images: element.querySelectorAll("img").length,
          videos: element.querySelectorAll("video").length,
          svgs: element.querySelectorAll("svg").length
        },
        interactionModel: inferInteractionModel(element),
        assets: sectionAssets(element),
        outline: outline(element, 0, { count: 0 })
      };
    });

    const fixedOrSticky: BehaviorElement[] = visibleElements
      .filter((element) => {
        const position = getComputedStyle(element).position;
        return position === "fixed" || position === "sticky";
      })
      .slice(0, 30)
      .map((element) => ({
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        text: textOf(element, 120) || undefined,
        styles: extractStyles(element)
      }));

    const scrollSnapContainers: BehaviorElement[] = visibleElements
      .filter((element) => getComputedStyle(element).scrollSnapType !== "none")
      .slice(0, 30)
      .map((element) => ({
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        text: textOf(element, 120) || undefined,
        styles: extractStyles(element)
      }));

    const transitionElements: BehaviorElement[] = visibleElements
      .filter((element) => {
        const styles = getComputedStyle(element);
        return styles.transitionDuration !== "0s" || styles.animationName !== "none";
      })
      .slice(0, 60)
      .map((element) => ({
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        text: textOf(element, 120) || undefined,
        styles: extractStyles(element)
      }));

    const animatedElements: AnimationElement[] = visibleElements
      .map((element) => {
        const animations = element.getAnimations({ subtree: false });
        return { element, animations };
      })
      .filter((entry) => entry.animations.length > 0)
      .slice(0, 40)
      .map((entry) => ({
        selector: selectorFor(entry.element),
        tagName: entry.element.tagName.toLowerCase(),
        text: textOf(entry.element, 120) || undefined,
        styles: extractStyles(entry.element),
        animationCount: entry.animations.length,
        animations: entry.animations.slice(0, 5).map((animation) => {
          const effect = animation.effect instanceof KeyframeEffect ? animation.effect : undefined;
          return {
            playState: animation.playState,
            playbackRate: animation.playbackRate,
            currentTime: animation.currentTime,
            timing: effect ? effect.getTiming() : undefined,
            keyframes: effect ? effect.getKeyframes().slice(0, 5) : []
          };
        })
      }));

    const interactiveElements: InteractiveElement[] = Array.from(
      document.querySelectorAll('a, button, input, textarea, select, summary, [role="button"], [tabindex]')
    )
      .filter(isVisible)
      .slice(0, 100)
      .map((element) => ({
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        text: textOf(element, 120) || undefined,
        styles: extractStyles(element),
        role: element.getAttribute("role") || undefined,
        href: element instanceof HTMLAnchorElement ? absoluteUrl(element.href) : undefined,
        ariaLabel: element.getAttribute("aria-label") || undefined,
        type: element.getAttribute("type") || undefined
      }));

    const forms: BehaviorElement[] = Array.from(document.querySelectorAll("form"))
      .filter(isVisible)
      .map((element) => ({
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        text: textOf(element, 120) || undefined,
        styles: extractStyles(element)
      }));

    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content;
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
    const openGraph: Record<string, string> = {};
    for (const meta of Array.from(document.querySelectorAll<HTMLMetaElement>('meta[property^="og:"], meta[name^="twitter:"]'))) {
      const key = meta.getAttribute("property") || meta.getAttribute("name");
      if (key && meta.content) {
        openGraph[key] = meta.content;
      }
    }

    return {
      finalUrl: window.location.href,
      title: document.title,
      meta: {
        description: description || undefined,
        viewport: viewport || undefined,
        canonical: canonical || undefined,
        openGraph
      },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.clientHeight,
        scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        bodyClassName: document.body.className || undefined,
        htmlClassName: document.documentElement.className || undefined
      },
      designTokens: {
        colors: topCounts(colorCounts, 24),
        fontFamilies: topCounts(fontFamilies, 12),
        fontSizes: topCounts(fontSizes, 20),
        fontWeights: topCounts(fontWeights, 12),
        lineHeights: topCounts(lineHeights, 20),
        radii: topCounts(radii, 16),
        shadows: topCounts(shadows, 16),
        spacing: topCounts(spacing, 24)
      },
      assets: {
        images,
        videos,
        backgroundImages,
        favicons,
        stylesheets,
        inlineSvgCount: document.querySelectorAll("svg").length
      },
      sections,
      behaviors: {
        fixedOrSticky,
        scrollSnapContainers,
        animatedElements,
        transitionElements,
        interactiveElements,
        forms,
        scrollChanges: []
      }
    };
  }, options);
}

async function detectScrollChanges(page: Page): Promise<ScrollChangeReport[]> {
  const before = await captureWatchedStyles(page);
  const scrollY = await page.evaluate(() => {
    const target = Math.min(900, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    window.scrollTo(0, target);
    return window.scrollY;
  });
  await page.waitForTimeout(350);
  const after = await captureWatchedStyles(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);

  const afterBySelector = new Map(after.map((item) => [item.selector, item]));
  const changes: ScrollChangeReport[] = [];

  for (const item of before) {
    const changed = afterBySelector.get(item.selector);
    if (!changed) {
      continue;
    }

    const changedStyles: Record<string, { before: string; after: string }> = {};
    for (const [key, value] of Object.entries(item.styles)) {
      const next = changed.styles[key];
      if (next && next !== value) {
        changedStyles[key] = { before: value, after: next };
      }
    }

    if (Object.keys(changedStyles).length > 0) {
      changes.push({
        selector: item.selector,
        tagName: item.tagName,
        text: item.text,
        triggerScrollY: scrollY,
        changedStyles
      });
    }
  }

  return changes.slice(0, 20);
}

async function captureWatchedStyles(page: Page): Promise<BehaviorElement[]> {
  return page.evaluate(() => {
    const cssProps = [
      "background-color",
      "box-shadow",
      "border-radius",
      "height",
      "opacity",
      "padding",
      "position",
      "top",
      "transform",
      "transition",
      "z-index"
    ];

    function escapeCss(value: string): string {
      return typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }

    function classNameOf(element: Element): string | undefined {
      const className = element.getAttribute("class")?.replace(/\s+/g, " ").trim();
      return className || undefined;
    }

    function selectorFor(element: Element): string {
      if (element.id) {
        return `#${escapeCss(element.id)}`;
      }
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const classes = classNameOf(current)?.split(" ").filter(Boolean).slice(0, 2);
        const classSelector = classes && classes.length > 0 ? `.${classes.map(escapeCss).join(".")}` : "";
        const parent = current.parentElement;
        const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current?.tagName) : [];
        const nth = siblings.length > 1 && parent ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${classSelector}${nth}`);
        current = current.parentElement;
      }
      return parts.join(" > ");
    }

    function textOf(element: Element): string | undefined {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
      return text || undefined;
    }

    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return rect.width > 2 && rect.height > 2 && styles.display !== "none" && styles.visibility !== "hidden";
    }

    return Array.from(document.querySelectorAll("header, nav, [style], [class], body > *"))
      .filter((element) => {
        if (!isVisible(element)) {
          return false;
        }
        const styles = getComputedStyle(element);
        return (
          styles.position === "fixed" ||
          styles.position === "sticky" ||
          ["HEADER", "NAV"].includes(element.tagName) ||
          Number.parseFloat(styles.transitionDuration) > 0
        );
      })
      .slice(0, 40)
      .map((element) => {
        const computed = getComputedStyle(element);
        const styles: Record<string, string> = {};
        for (const prop of cssProps) {
          styles[prop] = computed.getPropertyValue(prop);
        }
        return {
          selector: selectorFor(element),
          tagName: element.tagName.toLowerCase(),
          text: textOf(element),
          styles
        };
      });
  });
}

function collectAssetCandidates(...profiles: PageProfile[]): AssetCandidate[] {
  const candidates: AssetCandidate[] = [];

  for (const profile of profiles) {
    for (const image of profile.assets.images) {
      candidates.push({ url: image.src, kind: "image", source: image.selector });
    }
    for (const background of profile.assets.backgroundImages) {
      candidates.push({ url: background.url, kind: "background", source: background.selector });
    }
    for (const video of profile.assets.videos) {
      if (video.src) {
        candidates.push({ url: video.src, kind: "video", source: video.selector });
      }
      if (video.poster) {
        candidates.push({ url: video.poster, kind: "poster", source: video.selector });
      }
      for (const source of video.sources) {
        candidates.push({ url: source, kind: "video", source: video.selector });
      }
    }
    for (const favicon of profile.assets.favicons) {
      candidates.push({ url: favicon.href, kind: "favicon", source: favicon.rel });
    }
    for (const stylesheet of profile.assets.stylesheets) {
      candidates.push({ url: stylesheet.href, kind: "stylesheet", source: stylesheet.rel });
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.url || candidate.url.startsWith("data:") || candidate.url.startsWith("blob:")) {
      return false;
    }
    const key = `${candidate.kind}:${candidate.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function downloadAssets(
  candidates: AssetCandidate[],
  options: {
    assetsDir: string;
    config: RuntimeConfig;
    allowPrivateNetwork?: boolean;
    maxAssets: number;
    maxAssetBytes: number;
  }
): Promise<AssetDownloadReport> {
  const attempted = candidates.slice(0, options.maxAssets);
  const overflow = candidates.slice(options.maxAssets).map((candidate) => ({
    sourceUrl: candidate.url,
    kind: candidate.kind,
    reason: "Skipped because maxAssets was reached."
  }));
  const downloaded: AssetDownload[] = [];
  const skipped: AssetSkip[] = [...overflow];
  const failed: AssetSkip[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < attempted.length) {
      const index = cursor;
      cursor += 1;
      const candidate = attempted[index];
      if (!candidate) {
        return;
      }

      const result = await downloadOneAsset(candidate, {
        index,
        assetsDir: options.assetsDir,
        config: options.config,
        allowPrivateNetwork: options.allowPrivateNetwork,
        maxAssetBytes: options.maxAssetBytes
      });

      if (result.status === "downloaded") {
        downloaded.push(result.asset);
      } else if (result.status === "skipped") {
        skipped.push(result.asset);
      } else {
        failed.push(result.asset);
      }
    }
  }

  const concurrency = Math.min(4, Math.max(1, attempted.length));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    enabled: true,
    attempted: attempted.length,
    downloaded: downloaded.sort((left, right) => left.path.localeCompare(right.path)),
    skipped,
    failed,
    maxAssets: options.maxAssets,
    maxAssetBytes: options.maxAssetBytes
  };
}

async function downloadOneAsset(
  candidate: AssetCandidate,
  options: {
    index: number;
    assetsDir: string;
    config: RuntimeConfig;
    allowPrivateNetwork?: boolean;
    maxAssetBytes: number;
  }
): Promise<
  | { status: "downloaded"; asset: AssetDownload }
  | { status: "skipped"; asset: AssetSkip }
  | { status: "failed"; asset: AssetSkip }
> {
  let url: URL;
  try {
    url = await assertAllowedHttpUrl(
      candidate.url,
      { ...options.config, allowedHosts: ["*"] },
      { allowPrivateNetwork: options.allowPrivateNetwork }
    );
  } catch (error) {
    return {
      status: "skipped",
      asset: {
        sourceUrl: candidate.url,
        kind: candidate.kind,
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": options.config.userAgent,
        accept: "*/*"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        status: "failed",
        asset: {
          sourceUrl: candidate.url,
          kind: candidate.kind,
          reason: `HTTP ${response.status} ${response.statusText}`
        }
      };
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > options.maxAssetBytes) {
      return {
        status: "skipped",
        asset: {
          sourceUrl: candidate.url,
          kind: candidate.kind,
          reason: `Asset is ${contentLength} bytes, above maxAssetBytes.`
        }
      };
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > options.maxAssetBytes) {
      return {
        status: "skipped",
        asset: {
          sourceUrl: candidate.url,
          kind: candidate.kind,
          reason: `Asset is ${buffer.byteLength} bytes, above maxAssetBytes.`
        }
      };
    }

    const subdir = assetSubdir(candidate.kind);
    const dir = path.join(options.assetsDir, subdir);
    await mkdir(dir, { recursive: true });
    const fileName = assetFileName(url, contentType, options.index);
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, buffer);

    return {
      status: "downloaded",
      asset: {
        sourceUrl: candidate.url,
        kind: candidate.kind,
        path: filePath,
        contentType,
        bytes: buffer.byteLength
      }
    };
  } catch (error) {
    return {
      status: "failed",
      asset: {
        sourceUrl: candidate.url,
        kind: candidate.kind,
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeComponentSpecs(input: {
  componentsDir: string;
  sections: SectionProfile[];
  desktopScreenshotPath: string;
  mobileProfile: PageProfile;
}): Promise<string[]> {
  const paths: string[] = [];
  for (const section of input.sections) {
    const specPath = path.join(input.componentsDir, `${String(section.index + 1).padStart(2, "0")}-${slug(section.name)}.spec.md`);
    await writeFile(specPath, buildSectionSpecMarkdown(section, input.desktopScreenshotPath, input.mobileProfile));
    paths.push(specPath);
  }
  return paths;
}

function buildCloneBrief(data: CloneWebsiteData): string {
  return `# Clone Brief: ${data.title || data.finalUrl}

Source: ${data.finalUrl}
Generated: ${data.generatedAt}

## References

- Desktop screenshot: ${data.screenshots.desktop}
- Mobile screenshot: ${data.screenshots.mobile}
- Manifest: ${data.manifestPath}
- Design tokens: ${data.designTokensPath}
- Page topology: ${data.topologyPath}
- Behaviors: ${data.behaviorsPath}
- Asset manifest: ${data.assetManifestPath}

## Build Order

1. Create the project foundation from DESIGN_TOKENS.md: fonts, colors, radii, shadows, spacing, global scroll behavior, and metadata.
2. Copy or import downloaded assets from ${path.join(data.outputDir, "assets")}.
3. Implement one section at a time from research/components, preserving real text and assets.
4. Wire sections in the order listed in PAGE_TOPOLOGY.md.
5. Compare against both screenshots and fix visual differences before calling the clone complete.

## Clone Readiness

- Sections detected: ${data.cloneReadiness.sectionsDetected}
- Component specs written: ${data.cloneReadiness.componentSpecsWritten}
- Assets discovered: ${data.cloneReadiness.assetsDiscovered}
- Assets downloaded: ${data.cloneReadiness.assetsDownloaded}
- Behavior findings: ${data.cloneReadiness.behaviorFindings}

## Safety

Use this output only for sites you own, have permission to rebuild, or are studying for legitimate learning/migration work. Do not use it for phishing, impersonation, bypassing access controls, or violating a site's terms.

## Known Limits

${data.limitations.map((item) => `- ${item}`).join("\n")}
`;
}

function buildDesignTokensMarkdown(data: CloneWebsiteData): string {
  const tokens = data.desktop.profile.designTokens;
  return `# Design Tokens

Source: ${data.finalUrl}

## Colors

${tokenTable(tokens.colors)}

## Font Families

${tokenTable(tokens.fontFamilies)}

## Type Scale

### Font Sizes

${tokenTable(tokens.fontSizes)}

### Font Weights

${tokenTable(tokens.fontWeights)}

### Line Heights

${tokenTable(tokens.lineHeights)}

## Shape And Elevation

### Border Radii

${tokenTable(tokens.radii)}

### Shadows

${tokenTable(tokens.shadows)}

## Spacing Signals

${tokenTable(tokens.spacing)}
`;
}

function buildTopologyMarkdown(data: CloneWebsiteData): string {
  const rows = data.desktop.profile.sections
    .map(
      (section) => `| ${section.index + 1} | ${escapeMarkdown(section.name)} | ${section.tagName} | ${section.interactionModel} | ${Math.round(
        section.rect.top
      )} | ${Math.round(section.rect.height)} | ${section.screenshotPath ?? "n/a"} |`
    )
    .join("\n");

  return `# Page Topology

Source: ${data.finalUrl}

| # | Name | Tag | Interaction | Top | Height | Screenshot |
| --- | --- | --- | --- | ---: | ---: | --- |
${rows || "| n/a | n/a | n/a | n/a | n/a | n/a | n/a |"}

## Assembly Notes

- Preserve the section order above.
- Treat fixed and sticky elements from BEHAVIORS.md as page-level layout, not ordinary flow content.
- Use mobile profile data in clone-manifest.json to verify responsive stacking and hidden/showing sections.
`;
}

function buildBehaviorsMarkdown(data: CloneWebsiteData): string {
  const behaviors = data.desktop.profile.behaviors;
  return `# Behaviors

Source: ${data.finalUrl}

## Scroll Changes

${behaviors.scrollChanges.length > 0 ? behaviors.scrollChanges.map(formatScrollChange).join("\n\n") : "No scroll-triggered style changes detected in the automated sweep."}

## Fixed Or Sticky Elements

${behaviorList(behaviors.fixedOrSticky)}

## Scroll Snap Containers

${behaviorList(behaviors.scrollSnapContainers)}

## Animated Elements

${behaviors.animatedElements.length > 0 ? behaviors.animatedElements.map((item) => `- ${item.selector}: ${item.animationCount} animation(s), text: ${item.text ?? "n/a"}`).join("\n") : "None detected through document.getAnimations()."}

## Transition Elements

${behaviorList(behaviors.transitionElements.slice(0, 30))}

## Interactive Elements

${behaviors.interactiveElements.length > 0 ? behaviors.interactiveElements.slice(0, 60).map((item) => `- ${item.selector}: ${item.text ?? item.ariaLabel ?? item.href ?? "interactive element"}`).join("\n") : "No visible interactive elements detected."}

## Forms

${behaviorList(behaviors.forms)}
`;
}

function buildSectionSpecMarkdown(section: SectionProfile, desktopScreenshotPath: string, mobileProfile: PageProfile): string {
  const mobileSection = mobileProfile.sections[section.index];
  return `# ${section.name} Specification

## Overview

- Target component: ${pascalCase(section.name)}Section
- Source selector: ${section.selector}
- Desktop screenshot: ${section.screenshotPath ?? desktopScreenshotPath}
- Interaction model: ${section.interactionModel}

## DOM Structure

${formatOutline(section.outline, 0)}

## Computed Styles

### Container

${styleList(section.styles)}

## Text Content

${section.text || "N/A"}

## Assets

${section.assets.length > 0 ? section.assets.map((asset) => `- ${asset.kind}: ${asset.url ?? asset.selector}${asset.alt ? `, alt: ${asset.alt}` : ""}`).join("\n") : "N/A"}

## Counts

- Children: ${section.counts.children}
- Links: ${section.counts.links}
- Buttons: ${section.counts.buttons}
- Inputs: ${section.counts.inputs}
- Images: ${section.counts.images}
- Videos: ${section.counts.videos}
- Inline SVGs: ${section.counts.svgs}

## States And Behaviors

- Interaction model: ${section.interactionModel}
- If this section contains buttons, links, forms, tabs, carousels, accordions, or hoverable cards, inspect those states before implementation.
- If this section is marked scroll-linked or mixed, use BEHAVIORS.md to implement scroll thresholds and style changes.

## Responsive Behavior

- Desktop rect: top ${Math.round(section.rect.top)}px, width ${Math.round(section.rect.width)}px, height ${Math.round(section.rect.height)}px.
- Mobile rect: ${
    mobileSection
      ? `top ${Math.round(mobileSection.rect.top)}px, width ${Math.round(mobileSection.rect.width)}px, height ${Math.round(mobileSection.rect.height)}px.`
      : "No matching mobile section by index."
  }
`;
}

function formatOutline(outline: ElementOutline, depth: number): string {
  const indent = "  ".repeat(depth);
  const text = outline.text ? ` - "${escapeMarkdown(outline.text)}"` : "";
  const className = outline.className ? ` .${outline.className.split(" ").slice(0, 3).join(".")}` : "";
  const current = `${indent}- ${outline.tagName}${outline.id ? `#${outline.id}` : ""}${className}${text}`;
  if (outline.children.length === 0) {
    return current;
  }
  return [current, ...outline.children.map((child) => formatOutline(child, depth + 1))].join("\n");
}

function styleList(styles: Record<string, string>): string {
  const entries = Object.entries(styles);
  if (entries.length === 0) {
    return "N/A";
  }
  return entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function tokenTable(tokens: TokenCount[]): string {
  if (tokens.length === 0) {
    return "No tokens detected.";
  }
  return ["| Value | Count |", "| --- | ---: |", ...tokens.map((token) => `| ${escapeMarkdown(token.value)} | ${token.count} |`)].join(
    "\n"
  );
}

function behaviorList(items: BehaviorElement[]): string {
  if (items.length === 0) {
    return "None detected.";
  }
  return items.map((item) => `- ${item.selector}: ${item.text ?? item.styles.position ?? "detected"}`).join("\n");
}

function formatScrollChange(change: ScrollChangeReport): string {
  const rows = Object.entries(change.changedStyles)
    .map(([key, values]) => `  - ${key}: ${values.before} -> ${values.after}`)
    .join("\n");
  return `- ${change.selector} at scrollY ${change.triggerScrollY}px${change.text ? `, text: ${change.text}` : ""}\n${rows}`;
}

function assetSubdir(kind: AssetCandidate["kind"]): string {
  if (kind === "video") {
    return "videos";
  }
  if (kind === "favicon") {
    return "seo";
  }
  if (kind === "stylesheet") {
    return "stylesheets";
  }
  return "images";
}

function assetFileName(url: URL, contentType: string | undefined, index: number): string {
  const parsedName = safeFileName(path.posix.basename(url.pathname) || "asset");
  const ext = path.extname(parsedName) || extensionFromContentType(contentType) || ".bin";
  const base = parsedName.endsWith(ext) ? parsedName.slice(0, -ext.length) : parsedName;
  return `${String(index + 1).padStart(3, "0")}-${base.slice(0, 70) || "asset"}${ext}`;
}

function extensionFromContentType(contentType: string | undefined): string | undefined {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "text/css":
      return ".css";
    case "font/woff":
      return ".woff";
    case "font/woff2":
      return ".woff2";
    default:
      return undefined;
  }
}

function behaviorFindingCount(behaviors: BehaviorProfile): number {
  return (
    behaviors.fixedOrSticky.length +
    behaviors.scrollSnapContainers.length +
    behaviors.animatedElements.length +
    behaviors.transitionElements.length +
    behaviors.interactiveElements.length +
    behaviors.forms.length +
    behaviors.scrollChanges.length
  );
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeHost(host: string): string {
  return host.replace(/[^a-z0-9.-]/gi, "_").slice(0, 80);
}

function slug(value: string): string {
  return safeFileName(value.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-+|-+$/g, "").slice(0, 60) || "section";
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}

function pascalCase(value: string): string {
  const words = value.match(/[a-zA-Z0-9]+/g) ?? ["Section"];
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
