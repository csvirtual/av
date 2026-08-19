# Registra o native messaging host no Chrome (Windows).
#
# Uso: .\install-windows.ps1 -ExtensionId "abcdefgh...seu-id-aqui"

param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ManifestDir = Join-Path $env:LOCALAPPDATA "CSRemoteDesktop\NativeMessagingHosts"
New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null

$HostPath = Join-Path $Dir "host.cmd"
$ManifestPath = Join-Path $ManifestDir "com.csvirtual.remotedesktop.host.json"

$Template = Get-Content (Join-Path $Dir "manifest.template.json") -Raw
$Manifest = $Template.Replace("__HOST_PATH__", $HostPath.Replace("\", "\\")).Replace("__EXTENSION_ID__", $ExtensionId)
Set-Content -Path $ManifestPath -Value $Manifest -Encoding UTF8

$RegKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.csvirtual.remotedesktop.host"
New-Item -Path $RegKey -Force | Out-Null
Set-ItemProperty -Path $RegKey -Name "(Default)" -Value $ManifestPath

# Configuração padrão de como iniciar o host-agent (modo desenvolvimento).
# Se você empacotou o app com electron-builder, edite
# %USERPROFILE%\.cs-remote-desktop\launch-config.json apontando pro .exe gerado.
$StateDir = Join-Path $env:USERPROFILE ".cs-remote-desktop"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$HostAgentDir = Resolve-Path (Join-Path $Dir "..\..\host-agent")
$LaunchConfig = @{
  command = "npx.cmd"
  args    = @("electron", ".")
  cwd     = "$HostAgentDir"
} | ConvertTo-Json
Set-Content -Path (Join-Path $StateDir "launch-config.json") -Value $LaunchConfig -Encoding UTF8

Write-Host "Manifest registrado em: $ManifestPath"
Write-Host "Instalação concluída."
