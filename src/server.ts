import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { captureMotion, capturePage } from "./core/browser.js";
import { cloneWebsite } from "./core/cloneWebsite.js";
import { getRuntimeConfig } from "./core/config.js";
import { doctor } from "./core/doctor.js";
import { analyzeMotion } from "./core/motionAnalysis.js";
import { readUrl } from "./core/readers.js";
import { routeWebTask } from "./core/router.js";
import { fail, ok } from "./core/types.js";

export async function startMcpServer(): Promise<void> {
  const config = getRuntimeConfig();
  const server = new McpServer({
    name: "renderproof-mcp",
    version: "0.4.5"
  });

  server.registerTool(
    "route_web_task",
    {
      title: "Route Web Task",
      description:
        "Choose the cheapest reliable web perception route before reading, browsing, or using screenshots.",
      inputSchema: {
        task: z.string().min(1).describe("The user's web task or question."),
        url: z.string().url().optional().describe("Optional URL involved in the task.")
      }
    },
    async (input) =>
      jsonToolResult(
        okResult(() => {
          const result = routeWebTask(input);
          return ok(result.data, result.evidence);
        })
      )
  );

  server.registerTool(
    "read_url",
    {
      title: "Read URL",
      description:
        "Read a public http(s) URL as normalized text, using direct fetch first and optional remote readers only when configured.",
      inputSchema: {
        url: z.string().url().describe("The public http(s) URL to read."),
        strategy: z.enum(["auto", "direct", "jina"]).optional().describe("Reader strategy. Defaults to auto."),
        maxChars: z.number().int().min(500).max(60000).optional().describe("Maximum characters to return."),
        allowPrivateNetwork: z
          .boolean()
          .optional()
          .describe("Allow localhost/private network URLs for this call. Defaults to false.")
      }
    },
    async (input) =>
      jsonToolResult(
        await asyncOkResult(async () => {
          const result = await readUrl(input, config);
          return ok(result.data, result.evidence);
        })
      )
  );

  server.registerTool(
    "capture_page",
    {
      title: "Capture Page",
      description:
        "Capture rendered page evidence with Playwright when visual layout, screenshots, or browser state matter.",
      inputSchema: {
        url: z.string().url().describe("The public http(s) URL to render and capture."),
        fullPage: z.boolean().optional().describe("Capture the full scrollable page instead of the viewport."),
        includeImage: z.boolean().optional().describe("Embed the screenshot image in the MCP response. Defaults to true."),
        includeAccessibilitySnapshot: z
          .boolean()
          .optional()
          .describe("Include Playwright's accessibility snapshot as supporting text evidence."),
        width: z.number().int().min(320).max(3840).optional().describe("Viewport width in pixels."),
        height: z.number().int().min(240).max(2160).optional().describe("Viewport height in pixels."),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("Navigation wait condition."),
        timeoutMs: z.number().int().min(1000).max(120000).optional().describe("Navigation and screenshot timeout."),
        outputDir: z.string().optional().describe("Directory where screenshot evidence should be saved."),
        allowPrivateNetwork: z
          .boolean()
          .optional()
          .describe("Allow localhost/private network URLs for this call. Defaults to false."),
        autoScrollBeforeCapture: z
          .boolean()
          .optional()
          .describe("Scroll through the page before capture to trigger lazy-loaded content, then restore the original scroll position."),
        scrollStepPx: z.number().int().min(100).max(8000).optional().describe("Pixels to scroll per step when auto-scrolling."),
        scrollDelayMs: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .describe("Delay between auto-scroll steps in milliseconds."),
        scrollMaxSteps: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of auto-scroll steps.")
      }
    },
    async (input) => {
      let capture;
      try {
        capture = await capturePage(input, config);
      } catch (error) {
        return jsonToolResult(fail(error));
      }

      const envelope = ok(capture.data, capture.evidence);

      const content: Array<Record<string, unknown>> = [
        {
          type: "text" as const,
          text: JSON.stringify(envelope, null, 2)
        }
      ];

      if (capture.imageBase64 && input.includeImage !== false) {
        content.push({
          type: "resource",
          resource: {
            uri: `file://${capture.data.screenshotPath}`,
            mimeType: "image/png",
            blob: capture.imageBase64
          }
        });
      }

      return { content } as never;
    }
  );

  server.registerTool(
    "capture_motion",
    {
      title: "Capture Motion",
      description:
        "Record short rendered page motion evidence with Playwright video when animations, transitions, scrolling, or dynamic media matter.",
      inputSchema: {
        url: z.string().url().describe("The public http(s) URL to render and record."),
        durationMs: z
          .number()
          .int()
          .min(500)
          .max(30000)
          .optional()
          .describe("How long to record motion after navigation. Defaults to 5000 ms."),
        includeVideo: z.boolean().optional().describe("Embed the WebM video in the MCP response. Defaults to true."),
        includeKeyframes: z
          .boolean()
          .optional()
          .describe("Capture and embed PNG keyframes during the recording. Defaults to true."),
        keyframeCount: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("Number of keyframe screenshots to capture. Defaults to 3."),
        scrollDuringCapture: z
          .boolean()
          .optional()
          .describe("Scroll through the page while recording to capture scroll-driven motion and lazy loading."),
        scrollStepPx: z.number().int().min(100).max(8000).optional().describe("Pixels to scroll per step when recording scroll motion."),
        scrollDelayMs: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .describe("Delay between scroll steps in milliseconds."),
        scrollMaxSteps: z.number().int().min(1).max(200).optional().describe("Maximum number of scroll steps."),
        width: z.number().int().min(320).max(3840).optional().describe("Viewport width in pixels."),
        height: z.number().int().min(240).max(2160).optional().describe("Viewport height in pixels."),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("Navigation wait condition. Defaults to load for motion capture."),
        timeoutMs: z.number().int().min(1000).max(120000).optional().describe("Navigation and capture timeout."),
        outputDir: z.string().optional().describe("Directory where motion evidence should be saved."),
        allowPrivateNetwork: z
          .boolean()
          .optional()
          .describe("Allow localhost/private network URLs for this call. Defaults to false.")
      }
    },
    async (input) => {
      let motion;
      try {
        motion = await captureMotion(input, config);
      } catch (error) {
        return jsonToolResult(fail(error));
      }

      const envelope = ok(motion.data, motion.evidence);
      const content: Array<Record<string, unknown>> = [
        {
          type: "text" as const,
          text: JSON.stringify(envelope, null, 2)
        }
      ];

      if (motion.videoBase64 && input.includeVideo !== false) {
        content.push({
          type: "resource",
          resource: {
            uri: `file://${motion.data.videoPath}`,
            mimeType: "video/webm",
            blob: motion.videoBase64
          }
        });
      }

      if (input.includeKeyframes !== false) {
        for (const frame of motion.frameImages) {
          content.push({
            type: "resource",
            resource: {
              uri: `file://${frame.path}`,
              mimeType: frame.mimeType,
              blob: frame.base64
            }
          });
        }
      }

      return { content } as never;
    }
  );

  server.registerTool(
    "analyze_motion",
    {
      title: "Analyze Motion",
      description:
        "Analyze rendered page motion for coding agents using sampled keyframes, CSS animation metadata, pixel diffs, and a contact sheet.",
      inputSchema: {
        url: z.string().url().describe("The public http(s) URL to render and analyze."),
        durationMs: z
          .number()
          .int()
          .min(500)
          .max(30000)
          .optional()
          .describe("How long to sample motion after navigation. Defaults to 3000 ms."),
        sampleCount: z
          .number()
          .int()
          .min(2)
          .max(12)
          .optional()
          .describe("Number of screenshots to sample across the duration. Defaults to 5."),
        includeImages: z
          .boolean()
          .optional()
          .describe("Embed contact sheet and diff image resources in the MCP response. Defaults to true."),
        includeFrameImages: z
          .boolean()
          .optional()
          .describe("Also embed each raw sampled frame as an image resource. Defaults to false."),
        includeCssAnimations: z
          .boolean()
          .optional()
          .describe("Extract document.getAnimations() metadata from the page. Defaults to true."),
        includePixelDiff: z
          .boolean()
          .optional()
          .describe("Compute pixel-diff summaries across sampled frames. Defaults to true."),
        scrollDuringCapture: z
          .boolean()
          .optional()
          .describe("Scroll through the page while sampling to analyze scroll-driven motion and lazy loading."),
        scrollStepPx: z.number().int().min(100).max(8000).optional().describe("Pixels to scroll per step when sampling scroll motion."),
        scrollDelayMs: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .describe("Delay between scroll steps in milliseconds."),
        scrollMaxSteps: z.number().int().min(1).max(200).optional().describe("Maximum number of scroll steps."),
        width: z.number().int().min(320).max(3840).optional().describe("Viewport width in pixels."),
        height: z.number().int().min(240).max(2160).optional().describe("Viewport height in pixels."),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("Navigation wait condition. Defaults to load for motion analysis."),
        timeoutMs: z.number().int().min(1000).max(120000).optional().describe("Navigation and analysis timeout."),
        outputDir: z.string().optional().describe("Directory where motion analysis evidence should be saved."),
        allowPrivateNetwork: z
          .boolean()
          .optional()
          .describe("Allow localhost/private network URLs for this call. Defaults to false."),
        changeThreshold: z
          .number()
          .int()
          .min(1)
          .max(255)
          .optional()
          .describe("Per-pixel channel delta threshold for pixel-diff detection. Defaults to 40."),
        diffSampleStride: z
          .number()
          .int()
          .min(1)
          .max(16)
          .optional()
          .describe("Pixel sampling stride for diff analysis. Higher values are faster but less precise. Defaults to 2.")
      }
    },
    async (input) => {
      let analysis;
      try {
        analysis = await analyzeMotion(input, config);
      } catch (error) {
        return jsonToolResult(fail(error));
      }

      const envelope = ok(analysis.data, analysis.evidence);
      const content: Array<Record<string, unknown>> = [
        {
          type: "text" as const,
          text: JSON.stringify(envelope, null, 2)
        }
      ];

      if (input.includeImages !== false) {
        for (const resource of analysis.resources) {
          content.push({
            type: "resource",
            resource: {
              uri: `file://${resource.path}`,
              mimeType: resource.mimeType,
              blob: resource.base64
            }
          });
        }
      }

      return { content } as never;
    }
  );

  server.registerTool(
    "clone_website",
    {
      title: "Clone Website",
      description:
        "Generate a clone-ready evidence bundle for a public website: desktop/mobile screenshots, design tokens, assets, page topology, behaviors, and component specs. Use only for legitimate site migration, learning, or authorized rebuilds.",
      inputSchema: {
        url: z.string().url().describe("The public http(s) page to reverse-engineer into clone-ready artifacts."),
        outputDir: z.string().optional().describe("Directory where clone artifacts should be saved."),
        downloadAssets: z
          .boolean()
          .optional()
          .describe("Download discovered images, favicons, stylesheets, and videos within size limits. Defaults to true."),
        includeSectionScreenshots: z
          .boolean()
          .optional()
          .describe("Capture per-section screenshots for component specs. Defaults to true."),
        desktopWidth: z.number().int().min(320).max(3840).optional().describe("Desktop viewport width. Defaults to 1440."),
        desktopHeight: z.number().int().min(240).max(2160).optional().describe("Desktop viewport height. Defaults to 900."),
        mobileWidth: z.number().int().min(320).max(1200).optional().describe("Mobile viewport width. Defaults to 390."),
        mobileHeight: z.number().int().min(240).max(2160).optional().describe("Mobile viewport height. Defaults to 844."),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("Navigation wait condition. Defaults to networkidle."),
        timeoutMs: z.number().int().min(1000).max(120000).optional().describe("Navigation and screenshot timeout."),
        settleMs: z
          .number()
          .int()
          .min(0)
          .max(10000)
          .optional()
          .describe("Extra delay after navigation before extraction. Defaults to 500 ms."),
        maxSections: z.number().int().min(1).max(80).optional().describe("Maximum page sections to spec. Defaults to 24."),
        maxElementsPerSection: z
          .number()
          .int()
          .min(10)
          .max(500)
          .optional()
          .describe("Maximum DOM outline nodes per section spec. Defaults to 80."),
        maxAssets: z.number().int().min(0).max(300).optional().describe("Maximum assets to download. Defaults to 60."),
        maxAssetBytes: z
          .number()
          .int()
          .min(1024)
          .max(52428800)
          .optional()
          .describe("Maximum bytes per downloaded asset. Defaults to 10 MiB."),
        autoScroll: z
          .boolean()
          .optional()
          .describe("Scroll through the page before extraction to trigger lazy-loaded content. Defaults to true."),
        scrollStepPx: z.number().int().min(100).max(8000).optional().describe("Pixels to scroll per step when auto-scrolling."),
        scrollDelayMs: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .describe("Delay between auto-scroll steps in milliseconds."),
        scrollMaxSteps: z.number().int().min(1).max(200).optional().describe("Maximum number of auto-scroll steps."),
        allowPrivateNetwork: z
          .boolean()
          .optional()
          .describe("Allow localhost/private network URLs for this call. Defaults to false.")
      }
    },
    async (input) =>
      jsonToolResult(
        await asyncOkResult(async () => {
          const result = await cloneWebsite(input, config);
          return ok(result.data, result.evidence);
        })
      )
  );

  server.registerTool(
    "doctor",
    {
      title: "Doctor",
      description: "Check local runtime, security policy, optional remote readers, and Playwright availability.",
      inputSchema: {
        checkBrowserLaunch: z
          .boolean()
          .optional()
          .describe("Launch Chromium to verify browser binaries are installed. Defaults to false.")
      }
    },
    async (input) =>
      jsonToolResult(
        await asyncOkResult(async () => {
          const result = await doctor(input, config);
          return ok(result.data, result.evidence);
        })
      )
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function jsonToolResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  };
}

function okResult<T>(fn: () => ReturnType<typeof ok<T>>) {
  try {
    return fn();
  } catch (error) {
    return fail(error);
  }
}

async function asyncOkResult<T>(fn: () => Promise<ReturnType<typeof ok<T>>>) {
  try {
    return await fn();
  } catch (error) {
    return fail(error);
  }
}
