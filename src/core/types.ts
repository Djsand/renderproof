export type RouteName =
  | "read_url"
  | "capture_page"
  | "capture_motion"
  | "analyze_motion"
  | "external_search"
  | "external_platform_tool"
  | "browser_interaction";

export type EvidenceKind = "route" | "read" | "screenshot" | "motion" | "motion_analysis" | "doctor";

export interface Evidence {
  kind: EvidenceKind;
  method: string;
  url?: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class WebRouterError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WebRouterError";
    this.code = code;
    this.details = details;
  }

  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {})
    };
  }
}

export interface ToolEnvelope<T> {
  ok: true;
  data: T;
  evidence: Evidence[];
}

export interface ToolErrorEnvelope {
  ok: false;
  error: ErrorPayload;
  evidence: Evidence[];
}

export type ToolResponse<T> = ToolEnvelope<T> | ToolErrorEnvelope;

export function nowIso(): string {
  return new Date().toISOString();
}

export function ok<T>(data: T, evidence: Evidence[] = []): ToolEnvelope<T> {
  return { ok: true, data, evidence };
}

export function fail(error: unknown, evidence: Evidence[] = []): ToolErrorEnvelope {
  if (error instanceof WebRouterError) {
    return { ok: false, error: error.toPayload(), evidence };
  }

  return {
    ok: false,
    error: {
      code: "unexpected_error",
      message: error instanceof Error ? error.message : String(error)
    },
    evidence
  };
}
