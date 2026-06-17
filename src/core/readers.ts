import type { RuntimeConfig } from "./config.js";
import { assertAllowedHttpUrl } from "./url.js";
import { nowIso, type Evidence, WebRouterError } from "./types.js";

export type ReadStrategy = "auto" | "direct" | "jina";

export interface ReadUrlInput {
  url: string;
  strategy?: ReadStrategy;
  maxChars?: number;
  allowPrivateNetwork?: boolean;
}

export interface ReadUrlData {
  url: string;
  finalUrl: string;
  title?: string;
  adapter: "direct_fetch" | "jina_reader";
  contentType?: string;
  text: string;
  truncated: boolean;
  charCount: number;
}

export async function readUrl(input: ReadUrlInput, config: RuntimeConfig): Promise<{
  data: ReadUrlData;
  evidence: Evidence[];
}> {
  const url = await assertAllowedHttpUrl(input.url, config, {
    allowPrivateNetwork: input.allowPrivateNetwork
  });
  const strategy = input.strategy ?? "auto";
  const maxChars = input.maxChars ?? config.defaultMaxChars;
  const evidence: Evidence[] = [];

  if (strategy === "direct") {
    const data = await directRead(url, config, maxChars);
    evidence.push(readEvidence(data));
    return { data, evidence };
  }

  if (strategy === "jina") {
    const data = await jinaRead(url, config, maxChars);
    evidence.push(readEvidence(data));
    return { data, evidence };
  }

  try {
    const data = await directRead(url, config, maxChars);
    evidence.push(readEvidence(data));
    return { data, evidence };
  } catch (error) {
    if (!config.enableRemoteReaders) {
      throw error;
    }

    const data = await jinaRead(url, config, maxChars);
    evidence.push({
      ...readEvidence(data),
      details: {
        ...readEvidence(data).details,
        fallbackFrom: error instanceof Error ? error.message : String(error)
      }
    });
    return { data, evidence };
  }
}

async function directRead(url: URL, config: RuntimeConfig, maxChars: number): Promise<ReadUrlData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": config.userAgent,
        accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new WebRouterError("http_error", "Direct fetch failed.", {
        status: response.status,
        statusText: response.statusText,
        url: url.toString()
      });
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const raw = await response.text();
    const title = contentType?.includes("html") ? extractTitle(raw) : undefined;
    const normalized = normalizeContent(raw, contentType);
    const { text, truncated } = truncate(normalized, maxChars);

    return {
      url: url.toString(),
      finalUrl: response.url,
      title,
      adapter: "direct_fetch",
      contentType,
      text,
      truncated,
      charCount: normalized.length
    };
  } catch (error) {
    if (error instanceof WebRouterError) {
      throw error;
    }

    throw new WebRouterError("direct_fetch_failed", "Direct fetch failed.", {
      url: url.toString(),
      cause: error instanceof Error ? error.message : String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function jinaRead(url: URL, config: RuntimeConfig, maxChars: number): Promise<ReadUrlData> {
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new WebRouterError("remote_reader_refused", "Remote readers are not used for localhost URLs.", {
      url: url.toString()
    });
  }

  const readerUrl = `https://r.jina.ai/${url.toString()}`;
  const headers: Record<string, string> = {
    "user-agent": config.userAgent,
    accept: "text/markdown"
  };
  if (process.env.JINA_API_KEY) {
    headers.authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(readerUrl, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new WebRouterError("jina_reader_http_error", "Jina Reader returned an error.", {
        status: response.status,
        statusText: response.statusText,
        url: url.toString()
      });
    }

    const raw = await response.text();
    const { text, truncated } = truncate(raw.trim(), maxChars);
    return {
      url: url.toString(),
      finalUrl: url.toString(),
      title: extractMarkdownTitle(raw),
      adapter: "jina_reader",
      contentType: response.headers.get("content-type") ?? undefined,
      text,
      truncated,
      charCount: raw.length
    };
  } catch (error) {
    if (error instanceof WebRouterError) {
      throw error;
    }

    throw new WebRouterError("jina_reader_failed", "Jina Reader fetch failed.", {
      url: url.toString(),
      cause: error instanceof Error ? error.message : String(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeContent(raw: string, contentType: string | undefined): string {
  if (contentType?.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw.trim();
    }
  }

  if (contentType?.includes("html") || looksLikeHtml(raw)) {
    return htmlToText(raw);
  }

  return raw.trim();
}

function looksLikeHtml(raw: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(raw.slice(0, 2000));
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim() : undefined;
}

function extractMarkdownTitle(markdown: string): string | undefined {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function truncate(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }

  return {
    text: `${value.slice(0, maxChars)}\n\n[truncated at ${maxChars} characters]`,
    truncated: true
  };
}

function readEvidence(data: ReadUrlData): Evidence {
  return {
    kind: "read",
    method: data.adapter,
    url: data.finalUrl,
    timestamp: nowIso(),
    details: {
      title: data.title,
      contentType: data.contentType,
      charCount: data.charCount,
      truncated: data.truncated
    }
  };
}
