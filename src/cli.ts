import { captureMotion, capturePage } from "./core/browser.js";
import { cloneWebsite } from "./core/cloneWebsite.js";
import { getRuntimeConfig } from "./core/config.js";
import { doctor } from "./core/doctor.js";
import { printInstallHelp, runInstallAssistant, type InstallAgent, type InstallMode } from "./core/install.js";
import { analyzeMotion } from "./core/motionAnalysis.js";
import { readUrl, type ReadStrategy } from "./core/readers.js";
import { routeWebTask } from "./core/router.js";
import { fail, ok } from "./core/types.js";

export async function runCli(args: string[]): Promise<number> {
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  const config = getRuntimeConfig();

  try {
    if (command === "install") {
      const { positional, flags } = parseArgs(rest);
      const rawAgent = positional[0] ?? "all";

      if (rawAgent === "help" || flags.help || flags.h) {
        printInstallHelp();
        return 0;
      }

      return runInstallAssistant({
        agent: rawAgent as InstallAgent,
        apply: booleanFlag(flags.apply),
        writeProject: booleanFlag(flags["write-project"]),
        writeUser: booleanFlag(flags["write-user"]),
        jsonOnly: booleanFlag(flags.json),
        name: stringFlag(flags.name),
        entrypoint: stringFlag(flags.entry),
        mode: stringFlag(flags.mode) as InstallMode | undefined,
        scope: stringFlag(flags.scope) as "local" | "user" | "project" | undefined
      });
    }

    if (command === "route") {
      const { positional, flags } = parseArgs(rest);
      const task = positional.join(" ").trim();
      if (!task) {
        throw new Error("route requires a task string.");
      }
      writeJson(okResult(() => routeWebTask({ task, url: stringFlag(flags.url) })));
      return 0;
    }

    if (command === "read") {
      const { positional, flags } = parseArgs(rest);
      const url = positional[0];
      if (!url) {
        throw new Error("read requires a URL.");
      }
      const result = await readUrl(
        {
          url,
          strategy: stringFlag(flags.strategy) as ReadStrategy | undefined,
          maxChars: numberFlag(flags["max-chars"]),
          allowPrivateNetwork: booleanFlag(flags["allow-private-network"])
        },
        config
      );
      writeJson(ok(result.data, result.evidence));
      return 0;
    }

    if (command === "capture") {
      const { positional, flags } = parseArgs(rest);
      const url = positional[0];
      if (!url) {
        throw new Error("capture requires a URL.");
      }
      const result = await capturePage(
        {
          url,
          fullPage: booleanFlag(flags["full-page"]),
          includeImage: false,
          includeAccessibilitySnapshot: booleanFlag(flags["accessibility"]),
          width: numberFlag(flags.width),
          height: numberFlag(flags.height),
          waitUntil: stringFlag(flags["wait-until"]) as "load" | "domcontentloaded" | "networkidle" | undefined,
          timeoutMs: numberFlag(flags.timeout),
          outputDir: stringFlag(flags["output-dir"]),
          allowPrivateNetwork: booleanFlag(flags["allow-private-network"]),
          autoScrollBeforeCapture: booleanFlag(flags["auto-scroll"]),
          scrollStepPx: numberFlag(flags["scroll-step"]),
          scrollDelayMs: numberFlag(flags["scroll-delay"]),
          scrollMaxSteps: numberFlag(flags["scroll-max-steps"])
        },
        config
      );
      writeJson(ok(result.data, result.evidence));
      return 0;
    }

    if (command === "motion") {
      const { positional, flags } = parseArgs(rest);
      const url = positional[0];
      if (!url) {
        throw new Error("motion requires a URL.");
      }
      const result = await captureMotion(
        {
          url,
          durationMs: numberFlag(flags.duration),
          includeVideo: false,
          includeKeyframes: booleanFlag(flags.keyframes),
          keyframeCount: numberFlag(flags["keyframe-count"]),
          scrollDuringCapture: booleanFlag(flags.scroll),
          scrollStepPx: numberFlag(flags["scroll-step"]),
          scrollDelayMs: numberFlag(flags["scroll-delay"]),
          scrollMaxSteps: numberFlag(flags["scroll-max-steps"]),
          width: numberFlag(flags.width),
          height: numberFlag(flags.height),
          waitUntil: stringFlag(flags["wait-until"]) as "load" | "domcontentloaded" | "networkidle" | undefined,
          timeoutMs: numberFlag(flags.timeout),
          outputDir: stringFlag(flags["output-dir"]),
          allowPrivateNetwork: booleanFlag(flags["allow-private-network"])
        },
        config
      );
      writeJson(ok(result.data, result.evidence));
      return 0;
    }

    if (command === "analyze-motion") {
      const { positional, flags } = parseArgs(rest);
      const url = positional[0];
      if (!url) {
        throw new Error("analyze-motion requires a URL.");
      }
      const result = await analyzeMotion(
        {
          url,
          durationMs: numberFlag(flags.duration),
          sampleCount: numberFlag(flags.samples),
          includeImages: true,
          includeFrameImages: booleanFlag(flags.frames),
          includeCssAnimations: booleanFlag(flags.css),
          includePixelDiff: booleanFlag(flags.diff),
          scrollDuringCapture: booleanFlag(flags.scroll),
          scrollStepPx: numberFlag(flags["scroll-step"]),
          scrollDelayMs: numberFlag(flags["scroll-delay"]),
          scrollMaxSteps: numberFlag(flags["scroll-max-steps"]),
          width: numberFlag(flags.width),
          height: numberFlag(flags.height),
          waitUntil: stringFlag(flags["wait-until"]) as "load" | "domcontentloaded" | "networkidle" | undefined,
          timeoutMs: numberFlag(flags.timeout),
          outputDir: stringFlag(flags["output-dir"]),
          allowPrivateNetwork: booleanFlag(flags["allow-private-network"]),
          changeThreshold: numberFlag(flags["change-threshold"]),
          diffSampleStride: numberFlag(flags["diff-stride"])
        },
        config
      );
      writeJson(ok(result.data, result.evidence));
      return 0;
    }

    if (command === "clone-website" || command === "clone") {
      const { positional, flags } = parseArgs(rest);
      const url = positional[0];
      if (!url) {
        throw new Error("clone-website requires a URL.");
      }
      const result = await cloneWebsite(
        {
          url,
          outputDir: stringFlag(flags["output-dir"]),
          downloadAssets: flags["no-assets"] ? false : booleanFlag(flags["download-assets"]),
          includeSectionScreenshots: flags["no-section-screenshots"] ? false : booleanFlag(flags["section-screenshots"]),
          desktopWidth: numberFlag(flags["desktop-width"]),
          desktopHeight: numberFlag(flags["desktop-height"]),
          mobileWidth: numberFlag(flags["mobile-width"]),
          mobileHeight: numberFlag(flags["mobile-height"]),
          waitUntil: stringFlag(flags["wait-until"]) as "load" | "domcontentloaded" | "networkidle" | undefined,
          timeoutMs: numberFlag(flags.timeout),
          settleMs: numberFlag(flags.settle),
          maxSections: numberFlag(flags["max-sections"]),
          maxElementsPerSection: numberFlag(flags["max-elements-per-section"]),
          maxAssets: numberFlag(flags["max-assets"]),
          maxAssetBytes: numberFlag(flags["max-asset-bytes"]),
          autoScroll: flags["no-auto-scroll"] ? false : booleanFlag(flags["auto-scroll"]),
          scrollStepPx: numberFlag(flags["scroll-step"]),
          scrollDelayMs: numberFlag(flags["scroll-delay"]),
          scrollMaxSteps: numberFlag(flags["scroll-max-steps"]),
          allowPrivateNetwork: booleanFlag(flags["allow-private-network"])
        },
        config
      );
      writeJson(ok(result.data, result.evidence));
      return 0;
    }

    if (command === "doctor") {
      const { flags } = parseArgs(rest);
      const result = await doctor({ checkBrowserLaunch: booleanFlag(flags["check-browser-launch"]) }, config);
      writeJson(ok(result.data, result.evidence));
      return result.data.checks.every((check) => check.ok) ? 0 : 1;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    writeJson(fail(error));
    return 1;
  }
}

function printHelp(): void {
  process.stdout.write(`renderproof

Usage:
  renderproof mcp
  renderproof route "summarize this page" --url https://example.com
  renderproof read https://example.com [--strategy auto|direct|jina]
  renderproof capture https://example.com [--full-page] [--auto-scroll]
  renderproof motion https://example.com [--duration 5000] [--keyframes true] [--scroll]
  renderproof analyze-motion https://example.com [--duration 3000] [--samples 5] [--scroll]
  renderproof clone-website https://example.com [--no-assets] [--max-sections 24]
  renderproof doctor [--check-browser-launch]
  renderproof install [all|codex|claude|cursor|windsurf|cline|gemini|generic]

Environment:
  RENDERPROOF_ALLOWED_HOSTS=example.com,*.example.org
  RENDERPROOF_ALLOW_PRIVATE_NETWORK=1
  RENDERPROOF_ENABLE_REMOTE_READERS=1
  RENDERPROOF_OUTPUT_DIR=.renderproof/evidence
  JINA_API_KEY=...
`);
}

function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { positional, flags };
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanFlag(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return undefined;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function okResult<T>(fn: () => { data: T; evidence: unknown[] }) {
  try {
    const result = fn();
    return ok(result.data, result.evidence as never[]);
  } catch (error) {
    return fail(error);
  }
}
