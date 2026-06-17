import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type InstallAgent = "codex" | "claude" | "cursor" | "windsurf" | "cline" | "gemini" | "generic" | "all";
export type InstallMode = "local" | "npx";

export interface InstallOptions {
  agent: InstallAgent;
  apply?: boolean;
  writeProject?: boolean;
  writeUser?: boolean;
  jsonOnly?: boolean;
  name?: string;
  entrypoint?: string;
  mode?: InstallMode;
  scope?: "local" | "user" | "project";
}

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  autoApprove?: string[];
  trust?: boolean;
}

interface ApplyCommand {
  command: string;
  args: string[];
}

interface InstallPlan {
  agent: Exclude<InstallAgent, "all">;
  title: string;
  description: string;
  command?: ApplyCommand;
  config?: Record<string, unknown>;
  projectPath?: string;
  userPath?: string;
  notes: string[];
}

export async function runInstallAssistant(options: InstallOptions): Promise<number> {
  if (!isInstallAgent(options.agent)) {
    process.stderr.write(`Unknown install target: ${options.agent}\n`);
    printInstallHelp();
    return 1;
  }

  if (options.mode && options.mode !== "local" && options.mode !== "npx") {
    process.stderr.write(`Unknown install mode: ${options.mode}\n`);
    return 1;
  }

  const plans = createInstallPlans(options);

  if (options.jsonOnly) {
    writeJson(plans.length === 1 ? plans[0]?.config : Object.fromEntries(plans.map((plan) => [plan.agent, plan.config])));
    return 0;
  }

  if (!options.apply && !options.writeProject && !options.writeUser) {
    printInstallPlans(plans, options);
    return 0;
  }

  for (const plan of plans) {
    if (options.apply) {
      if (!plan.command) {
        process.stderr.write(`${plan.title}: --apply is not available; use --write-project or --write-user for JSON config clients.\n`);
        return 1;
      }

      const result = spawnSync(plan.command.command, plan.command.args, { stdio: "inherit" });
      if (result.status !== 0) {
        return result.status ?? 1;
      }
    }

    if (options.writeProject) {
      if (!plan.projectPath || !plan.config) {
        process.stderr.write(`${plan.title}: --write-project is not supported for this client.\n`);
        return 1;
      }
      await mergeMcpConfig(plan.projectPath, plan.config);
      process.stdout.write(`Wrote ${plan.projectPath}\n`);
    }

    if (options.writeUser) {
      if (!plan.userPath || !plan.config) {
        process.stderr.write(`${plan.title}: --write-user is not supported for this client.\n`);
        return 1;
      }
      await mergeMcpConfig(plan.userPath, plan.config);
      process.stdout.write(`Wrote ${plan.userPath}\n`);
    }
  }

  return 0;
}

function isInstallAgent(value: string): value is InstallAgent {
  return ["codex", "claude", "cursor", "windsurf", "cline", "gemini", "generic", "all"].includes(value);
}

export function printInstallHelp(): void {
  process.stdout.write(`renderproof install

Usage:
  renderproof install
  renderproof install all
  renderproof install codex [--apply]
  renderproof install claude [--apply] [--scope local|user|project]
  renderproof install gemini [--apply] [--scope user|project]
  renderproof install cursor [--write-project]
  renderproof install cline [--write-user]
  renderproof install windsurf [--write-user]
  renderproof install generic [--json]

Options:
  --apply          Run the native CLI install command when supported.
  --write-project  Write project-local JSON config when supported.
  --write-user     Write user-level JSON config when supported.
  --json           Print only JSON config.
  --name NAME      MCP server name. Defaults to renderproof.
  --entry PATH     Path to dist/index.js. Defaults to this checkout.
  --mode local|npx Use local node path or npx renderproof-mcp@latest. Defaults to local.
`);
}

function createInstallPlans(options: InstallOptions): InstallPlan[] {
  const agents =
    options.agent === "all"
      ? (["codex", "claude", "cursor", "windsurf", "cline", "gemini", "generic"] as const)
      : [options.agent];
  const name = options.name ?? "renderproof";
  const server = createServerConfig(options);

  return agents.map((agent) => createPlan(agent, name, server, options));
}

function createServerConfig(options: InstallOptions): McpServerConfig {
  if (options.mode === "npx") {
    return {
      command: "npx",
      args: ["-y", "renderproof-mcp@latest", "mcp"]
    };
  }

  return {
    command: process.execPath,
    args: [resolveEntrypoint(options.entrypoint), "mcp"]
  };
}

function createPlan(
  agent: Exclude<InstallAgent, "all">,
  name: string,
  server: McpServerConfig,
  options: InstallOptions
): InstallPlan {
  const mcpConfig = { mcpServers: { [name]: server } };
  const scope = options.scope;

  if (agent === "codex") {
    return {
      agent,
      title: "Codex",
      description: "Installs through `codex mcp add`.",
      command: {
        command: "codex",
        args: ["mcp", "add", name, "--", server.command, ...server.args]
      },
      config: mcpConfig,
      notes: ["Restart active Codex threads if the new tools do not appear immediately."]
    };
  }

  if (agent === "claude") {
    return {
      agent,
      title: "Claude Code",
      description: "Installs through `claude mcp add`.",
      command: {
        command: "claude",
        args: ["mcp", "add", ...(scope ? ["--scope", scope] : []), name, "--", server.command, ...server.args]
      },
      config: mcpConfig,
      notes: ["Default Claude Code scope is local. Use `--scope user` for user-wide install."]
    };
  }

  if (agent === "gemini") {
    return {
      agent,
      title: "Gemini CLI",
      description: "Installs through `gemini mcp add`, or by editing settings.json.",
      command: {
        command: "gemini",
        args: ["mcp", "add", ...(scope ? ["--scope", scope] : []), name, server.command, ...server.args]
      },
      config: { mcpServers: { [name]: { ...server, trust: false } } },
      projectPath: path.resolve(".gemini/settings.json"),
      userPath: path.join(os.homedir(), ".gemini", "settings.json"),
      notes: ["Gemini uses `mcpServers` in settings.json and supports user or project scope."]
    };
  }

  if (agent === "cursor") {
    return {
      agent,
      title: "Cursor",
      description: "Uses `.cursor/mcp.json` or Cursor's MCP settings UI.",
      config: mcpConfig,
      projectPath: path.resolve(".cursor/mcp.json"),
      notes: ["Project-local install writes `.cursor/mcp.json`."]
    };
  }

  if (agent === "windsurf") {
    return {
      agent,
      title: "Windsurf / Cascade",
      description: "Uses the Windsurf `mcp_config.json` file.",
      config: mcpConfig,
      userPath: path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"),
      notes: ["If your team uses an MCP whitelist, the server ID must match the config key."]
    };
  }

  if (agent === "cline") {
    return {
      agent,
      title: "Cline",
      description: "Uses Cline's `mcpServers` JSON config.",
      config: {
        mcpServers: {
          [name]: {
            ...server,
            disabled: false,
            autoApprove: []
          }
        }
      },
      userPath: path.join(os.homedir(), ".cline", "mcp.json"),
      notes: ["Cline IDE extensions can also open this JSON from the MCP Servers configure screen."]
    };
  }

  return {
    agent,
    title: "Generic MCP JSON",
    description: "Works with MCP clients that accept `mcpServers` JSON.",
    config: mcpConfig,
    notes: ["Paste this under the client's MCP config file."]
  };
}

function printInstallPlans(plans: InstallPlan[], options: InstallOptions): void {
  process.stdout.write("RenderProof MCP install helper\n\n");
  process.stdout.write(`Mode: ${options.mode ?? "local"}\n`);
  process.stdout.write("Run with --apply or --write-project/--write-user to modify config.\n\n");

  for (const plan of plans) {
    process.stdout.write(`## ${plan.title}\n`);
    process.stdout.write(`${plan.description}\n\n`);

    if (plan.command) {
      process.stdout.write(`${shellCommand(plan.command)}\n\n`);
    }

    if (plan.config) {
      process.stdout.write(`${JSON.stringify(plan.config, null, 2)}\n\n`);
    }

    if (plan.projectPath) {
      process.stdout.write(`Project config: ${plan.projectPath}\n`);
    }
    if (plan.userPath) {
      process.stdout.write(`User config: ${plan.userPath}\n`);
    }
    for (const note of plan.notes) {
      process.stdout.write(`Note: ${note}\n`);
    }
    process.stdout.write("\n");
  }
}

function resolveEntrypoint(override: string | undefined): string {
  if (override) {
    return path.resolve(override);
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, "..", "index.js"),
    path.resolve(process.cwd(), "dist", "index.js")
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));

  if (existing) {
    return existing;
  }

  return path.resolve(process.argv[1] ?? "dist/index.js");
}

async function mergeMcpConfig(filePath: string, config: Record<string, unknown>): Promise<void> {
  const existing = readJsonObject(filePath);
  const incomingServers = getObject(config.mcpServers);
  const existingServers = getObject(existing.mcpServers);

  existing.mcpServers = {
    ...existingServers,
    ...incomingServers
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(existing, null, 2)}\n`);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  return getObject(parsed);
}

function getObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function shellCommand(command: ApplyCommand): string {
  return [command.command, ...command.args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
