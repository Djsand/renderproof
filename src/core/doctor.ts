import type { RuntimeConfig } from "./config.js";
import { nowIso, type Evidence } from "./types.js";

export interface DoctorInput {
  checkBrowserLaunch?: boolean;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function doctor(
  input: DoctorInput,
  config: RuntimeConfig
): Promise<{ data: { checks: CheckResult[] }; evidence: Evidence[] }> {
  const checks: CheckResult[] = [];

  checks.push({
    name: "node",
    ok: isNode20OrNewer(),
    message: `Node ${process.versions.node}`,
    details: { required: ">=20" }
  });

  checks.push({
    name: "remote_readers",
    ok: true,
    message: config.enableRemoteReaders
      ? "Remote readers enabled via RENDERPROOF_ENABLE_REMOTE_READERS=1."
      : "Remote readers disabled by default.",
    details: { jinaApiKeyConfigured: Boolean(process.env.JINA_API_KEY) }
  });

  checks.push({
    name: "url_policy",
    ok: true,
    message: config.blockPrivateNetwork
      ? "Private network URLs are blocked by default."
      : "Private network URLs are allowed by environment config.",
    details: { allowedHosts: config.allowedHosts }
  });

  checks.push(await checkPlaywrightImport(input.checkBrowserLaunch === true));

  return {
    data: { checks },
    evidence: [
      {
        kind: "doctor",
        method: "runtime_checks",
        timestamp: nowIso(),
        details: {
          ok: checks.every((check) => check.ok)
        }
      }
    ]
  };
}

function isNode20OrNewer(): boolean {
  const major = Number(process.versions.node.split(".")[0]);
  return Number.isFinite(major) && major >= 20;
}

async function checkPlaywrightImport(checkBrowserLaunch: boolean): Promise<CheckResult> {
  try {
    const { chromium } = await import("playwright");

    if (checkBrowserLaunch) {
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      return {
        name: "playwright",
        ok: true,
        message: "Playwright imported and Chromium launched successfully."
      };
    }

    return {
      name: "playwright",
      ok: true,
      message: "Playwright imported successfully. Run doctor with checkBrowserLaunch to verify Chromium."
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "playwright",
      ok: false,
      message,
      details: {
        hint: message.includes("Executable doesn't exist")
          ? "Run `npx playwright install chromium` in this project."
          : undefined
      }
    };
  }
}
