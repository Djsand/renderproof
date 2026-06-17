param(
  [string]$Target = "help",
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$RenderProofHome = if ($env:RENDERPROOF_HOME) { $env:RENDERPROOF_HOME } else { Join-Path $HOME ".renderproof" }
$RenderProofRepoUrl = if ($env:RENDERPROOF_REPO_URL) { $env:RENDERPROOF_REPO_URL } else { "https://github.com/Djsand/renderproof.git" }
$RenderProofBranch = if ($env:RENDERPROOF_BRANCH) { $env:RENDERPROOF_BRANCH } else { "main" }
$OriginalCwd = (Get-Location).Path

function Show-Help {
  @"
RenderProof Windows one-line installer

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Djsand/renderproof/main/install.ps1))) -Target claude"

Targets:
  codex       Write Codex config to ~/.codex/config.toml
  claude      Install into Claude Code with claude mcp add
  cursor      Write .cursor/mcp.json in the directory where you ran the one-liner
  cline       Write ~/.cline/mcp.json
  windsurf    Write ~/.codeium/windsurf/mcp_config.json
  gemini      Install into Gemini CLI user scope
  generic     Print generic MCP JSON
  print       Print all install commands/configs

Environment:
  RENDERPROOF_HOME=$RenderProofHome
  RENDERPROOF_BRANCH=$RenderProofBranch
"@
}

function Require-Command {
  param([string]$Name, [string]$Hint)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Error "Missing required command: $Name. $Hint"
  }
}

function Invoke-Step {
  param([string]$Label, [scriptblock]$Script)

  & $Script
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Label"
  }
}

if ($Target -in @("help", "--help", "-h")) {
  Show-Help
  exit 0
}

Require-Command "git" "Install Git for Windows, then reopen PowerShell."
Require-Command "node" "Install Node.js 20+ with: winget install OpenJS.NodeJS.LTS"
Require-Command "npm" "Install Node.js 20+ with: winget install OpenJS.NodeJS.LTS"
Require-Command "npx" "Install Node.js 20+ with: winget install OpenJS.NodeJS.LTS"

$NodeMajor = & node -p "Number(process.versions.node.split('.')[0])"
$ParsedNodeMajor = 0
if (-not [int]::TryParse([string]$NodeMajor, [ref]$ParsedNodeMajor) -or $ParsedNodeMajor -lt 20) {
  Write-Error "RenderProof requires Node.js >=20. Current Node major version: $NodeMajor"
}

$GitDir = Join-Path $RenderProofHome ".git"
if (Test-Path $GitDir) {
  Write-Host "Updating RenderProof in $RenderProofHome"
  Invoke-Step "git fetch" { & git -C $RenderProofHome fetch --depth 1 origin $RenderProofBranch }
  Invoke-Step "git checkout" { & git -C $RenderProofHome checkout $RenderProofBranch }
  Invoke-Step "git reset" { & git -C $RenderProofHome reset --hard "origin/$RenderProofBranch" }
} elseif (Test-Path $RenderProofHome) {
  Write-Error "$RenderProofHome exists but is not a git checkout. Set RENDERPROOF_HOME to another path."
} else {
  Write-Host "Installing RenderProof into $RenderProofHome"
  Invoke-Step "git clone" { & git clone --depth 1 --branch $RenderProofBranch $RenderProofRepoUrl $RenderProofHome }
}

Push-Location $RenderProofHome
try {
  Invoke-Step "npm install" { & npm install }
  Invoke-Step "npx playwright install chromium" { & npx playwright install chromium }
  Invoke-Step "npm run build" { & npm run build }
} finally {
  Pop-Location
}

$Entry = Join-Path $RenderProofHome "dist/index.js"

switch ($Target) {
  "codex" {
    Invoke-Step "renderproof install codex" { & node $Entry install codex --write-user --entry $Entry @RemainingArgs }
  }
  "claude" {
    Invoke-Step "renderproof install claude" { & node $Entry install claude --apply --entry $Entry @RemainingArgs }
  }
  "cursor" {
    Push-Location $OriginalCwd
    try {
      Invoke-Step "renderproof install cursor" { & node $Entry install cursor --write-project --entry $Entry @RemainingArgs }
    } finally {
      Pop-Location
    }
  }
  "cline" {
    Invoke-Step "renderproof install cline" { & node $Entry install cline --write-user --entry $Entry @RemainingArgs }
  }
  "windsurf" {
    Invoke-Step "renderproof install windsurf" { & node $Entry install windsurf --write-user --entry $Entry @RemainingArgs }
  }
  "gemini" {
    Invoke-Step "renderproof install gemini" { & node $Entry install gemini --apply --scope user --entry $Entry @RemainingArgs }
  }
  "generic" {
    Invoke-Step "renderproof install generic" { & node $Entry install generic --json --entry $Entry @RemainingArgs }
  }
  { $_ -in @("print", "all") } {
    Invoke-Step "renderproof install all" { & node $Entry install all --entry $Entry @RemainingArgs }
  }
  default {
    Write-Error "Unknown target: $Target. Run with target 'help' to see supported targets."
  }
}

@"

RenderProof is installed at:
  $RenderProofHome

Smoke test:
  node "$Entry" doctor --check-browser-launch
"@
