# 用本机 Edge 无头模式给游戏截图（开发自用，不参与部署）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File tools/shot.ps1
param(
  [string]$Out = "$env:TEMP\naiwa-shots"
)
$ErrorActionPreference = "SilentlyContinue"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$root = Split-Path -Parent $PSScriptRoot
$enc = [System.Uri]::EscapeUriString(($root -replace '\\', '/'))
$base = "file:///" + $enc + "/index.html"

$shots = @(
  @{ n = "menu";     q = "";                                   w = 1280; h = 720; b = 1500 },
  @{ n = "run";      q = "?dev=run&god=1&warp=900";             w = 1280; h = 720; b = 2600 },
  @{ n = "night";    q = "?dev=run&god=1&theme=night&warp=1400"; w = 1280; h = 720; b = 2600 },
  @{ n = "dusk";     q = "?dev=run&god=1&theme=dusk&warp=2400";  w = 1280; h = 720; b = 2600 },
  @{ n = "chars";    q = "?chars=1";                            w = 1280; h = 720; b = 1600 },
  @{ n = "mobile";   q = "?dev=run&god=1&warp=600";             w = 420;  h = 880; b = 2600 }
)

if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Force -Path $Out | Out-Null }

foreach ($s in $shots) {
  $prof = Join-Path $env:TEMP ("naiva-shot-" + $s.n)
  $file = Join-Path $Out ($s.n + ".png")
  if (Test-Path $file) { Remove-Item $file -Force }
  $url = $base + $s.q
  $argStr = "--headless=new --disable-gpu --no-sandbox --hide-scrollbars --no-first-run " +
            "--no-default-browser-check --mute-audio " +
            "--user-data-dir=`"$prof`" --window-size=$($s.w),$($s.h) --virtual-time-budget=$($s.b) " +
            "--screenshot=`"$file`" `"$url`""
  $p = Start-Process -FilePath $edge -ArgumentList $argStr -PassThru -WindowStyle Hidden
  if (-not $p.WaitForExit(20000)) { $p.Kill(); Write-Host ("[" + $s.n + "] 超时，已强制结束") }
  Start-Sleep -Milliseconds 800
  if (Test-Path $file) { Write-Host ("[" + $s.n + "] OK " + (Get-Item $file).Length + " bytes") }
  else { Write-Host ("[" + $s.n + "] 失败: 未生成文件") }
}
Write-Host "输出目录: $Out"
