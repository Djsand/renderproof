import { nowIso, type Evidence, type RouteName } from "./types.js";

export interface RouteWebTaskInput {
  task: string;
  url?: string;
}

export interface RouteRecommendation {
  primaryRoute: RouteName;
  confidence: "low" | "medium" | "high";
  reason: string;
  suggestedTools: string[];
  escalationPolicy: string[];
}

export function routeWebTask(input: RouteWebTaskInput): {
  data: RouteRecommendation;
  evidence: Evidence[];
} {
  const task = input.task.toLowerCase();
  const url = input.url ? safeParseUrl(input.url) : undefined;
  const host = url?.hostname.toLowerCase();

  const isVisual =
    /\b(see|look|visual|screenshot|layout|pixel|image|photo|chart|graph|canvas|webgl|map|color|overlap|render)\b/.test(
      task
    );
  const isClone =
    /\b(clone|copy|recreate|rebuild|replicate|reverse-engineer|reverse engineer|pixel-perfect|site like|website like)\b/.test(task);
  const isMotion =
    /\b(animation|animated|motion|transition|easing|parallax|scroll-driven|microinteraction|carousel|spinner|loading state)\b/.test(
      task
    );
  const isInteractive =
    /\b(click|type|fill|login|sign in|submit|checkout|scroll|navigate|form|dropdown|button|modal)\b/.test(task);
  const isSearch = /\b(search|find|research|latest|current|compare|what.*people|mentions|sentiment)\b/.test(task);
  const isVideo = host?.includes("youtube.com") || host?.includes("youtu.be") || /\b(video|transcript|captions)\b/.test(task);
  const isGitHub = host === "github.com" || host?.endsWith(".github.com") || /\b(github|repo|issue|pull request|pr)\b/.test(task);

  let recommendation: RouteRecommendation;

  if (isClone) {
    recommendation = {
      primaryRoute: "clone_website",
      confidence: "high",
      reason:
        "The task asks to clone or rebuild a website, so it needs screenshots, design tokens, assets, topology, behaviors, and component specs.",
      suggestedTools: ["clone_website", "capture_page", "analyze_motion"],
      escalationPolicy: [
        "Generate a clone brief with desktop/mobile screenshots and component specs.",
        "Use motion analysis for sections where animation fidelity matters.",
        "Use interactive browser automation for hidden click or hover states that need deeper inspection."
      ]
    };
  } else if (isMotion) {
    recommendation = {
      primaryRoute: "analyze_motion",
      confidence: "high",
      reason: "The task depends on rendered time-based behavior such as animation, transitions, scrolling, or loading motion.",
      suggestedTools: ["analyze_motion", "capture_motion", "capture_page", "read_url"],
      escalationPolicy: [
        "Analyze sampled frames, CSS animations, and pixel diffs first.",
        "Record a short Playwright video when humans need playback evidence.",
        "Use a still screenshot as supporting layout evidence."
      ]
    };
  } else if (isVisual) {
    recommendation = {
      primaryRoute: "capture_page",
      confidence: "high",
      reason: "The task depends on rendered pixels, layout, images, charts, canvas, or visual verification.",
      suggestedTools: ["capture_page", "read_url"],
      escalationPolicy: [
        "Capture a screenshot with Playwright.",
        "Use accessibility snapshot when text/controls matter.",
        "Use read_url only as supporting context."
      ]
    };
  } else if (isInteractive) {
    recommendation = {
      primaryRoute: "browser_interaction",
      confidence: "high",
      reason: "The task requires browser state changes or UI actions rather than passive reading.",
      suggestedTools: ["capture_page", "external browser automation such as Playwright MCP or Codex/Claude browser tools"],
      escalationPolicy: [
        "Start with a browser snapshot or screenshot.",
        "Use a dedicated browser automation tool for clicks and form fills.",
        "Capture evidence before and after important state changes."
      ]
    };
  } else if (isVideo) {
    recommendation = {
      primaryRoute: "external_platform_tool",
      confidence: "high",
      reason: "Video tasks are usually better served by captions/metadata than screenshots.",
      suggestedTools: ["yt-dlp --dump-json", "yt-dlp --write-auto-subs", "read_url"],
      escalationPolicy: [
        "Prefer transcript/caption extraction.",
        "Use browser capture only for visual content that captions cannot describe."
      ]
    };
  } else if (isGitHub) {
    recommendation = {
      primaryRoute: "external_platform_tool",
      confidence: "high",
      reason: "GitHub data is usually more reliable through gh/GitHub MCP than webpage scraping.",
      suggestedTools: ["gh repo view", "gh issue view", "gh pr view", "read_url"],
      escalationPolicy: [
        "Prefer GitHub CLI or GitHub MCP for repository, issue, and PR data.",
        "Use read_url for public docs pages.",
        "Use browser capture only for visual GitHub UI state."
      ]
    };
  } else if (isSearch) {
    recommendation = {
      primaryRoute: "external_search",
      confidence: "medium",
      reason: "Search/research needs a search index before page reading.",
      suggestedTools: ["Codex/Claude web search", "Jina Search", "Exa", "Firecrawl", "read_url for selected results"],
      escalationPolicy: [
        "Search first.",
        "Read selected source URLs.",
        "Capture screenshots only when visual evidence matters."
      ]
    };
  } else {
    recommendation = {
      primaryRoute: "read_url",
      confidence: "medium",
      reason: "The task appears to be passive reading or extraction, so text is cheaper and easier to cite than pixels.",
      suggestedTools: ["read_url", "capture_page"],
      escalationPolicy: [
        "Try direct text extraction first.",
        "Use Jina Reader if direct extraction fails and remote readers are enabled.",
        "Escalate to screenshot only when rendered state matters."
      ]
    };
  }

  return {
    data: recommendation,
    evidence: [
      {
        kind: "route",
        method: "keyword_policy_v0",
        url: input.url,
        timestamp: nowIso(),
        details: {
          task: input.task,
          host,
          signals: { isVisual, isClone, isMotion, isInteractive, isSearch, isVideo, isGitHub }
        }
      }
    ]
  };
}

function safeParseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}
