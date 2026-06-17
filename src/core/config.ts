export interface RuntimeConfig {
  allowedHosts: string[];
  blockPrivateNetwork: boolean;
  enableRemoteReaders: boolean;
  userAgent: string;
  outputDir: string;
  defaultMaxChars: number;
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    allowedHosts: splitEnvList(process.env.RENDERPROOF_ALLOWED_HOSTS ?? process.env.GROUNDED_WEB_ALLOWED_HOSTS) ?? ["*"],
    blockPrivateNetwork: (process.env.RENDERPROOF_ALLOW_PRIVATE_NETWORK ?? process.env.GROUNDED_WEB_ALLOW_PRIVATE_NETWORK) !== "1",
    enableRemoteReaders: (process.env.RENDERPROOF_ENABLE_REMOTE_READERS ?? process.env.GROUNDED_WEB_ENABLE_REMOTE_READERS) === "1",
    userAgent: process.env.RENDERPROOF_USER_AGENT ?? process.env.GROUNDED_WEB_USER_AGENT ?? "renderproof-mcp/0.3",
    outputDir: process.env.RENDERPROOF_OUTPUT_DIR ?? process.env.GROUNDED_WEB_OUTPUT_DIR ?? ".renderproof/evidence",
    defaultMaxChars: numberFromEnv(process.env.RENDERPROOF_MAX_CHARS ?? process.env.GROUNDED_WEB_MAX_CHARS, 12000)
  };
}

function splitEnvList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : undefined;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
