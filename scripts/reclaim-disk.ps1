<#
.SYNOPSIS
  Reclaims disk space from regenerable build/tooling artefacts across C:\Users\toluo\dev.

.DESCRIPTION
  Nothing here is source or state. Terraform's real state lives remotely (S3);
  .terraform/providers holds only downloaded provider executables, restored by
  `terraform init`. node_modules is restored by `npm ci`.

  Run -WhatIf first to see what would go.

.EXAMPLE
  .\reclaim-disk.ps1 -WhatIf
  .\reclaim-disk.ps1
  .\reclaim-disk.ps1 -IncludeNodeModules -OlderThanDays 30
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string] $DevRoot = "C:\Users\toluo\dev",
  # Also remove node_modules. Off by default — you must reinstall to work on a project.
  [switch] $IncludeNodeModules,
  # Only touch projects untouched for this many days. 0 = no age filter.
  [int]    $OlderThanDays = 0
)

function Get-DirSize($p) {
  (Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum
}

$cutoff = if ($OlderThanDays -gt 0) { (Get-Date).AddDays(-$OlderThanDays) } else { $null }
$freed  = 0
$before = (Get-PSDrive C).Free

Write-Host "`n=== Terraform provider binaries ===" -ForegroundColor Cyan
Get-ChildItem $DevRoot -Recurse -Directory -Force -Filter ".terraform" -ErrorAction SilentlyContinue |
  ForEach-Object {
    $prov = Join-Path $_.FullName "providers"
    if (-not (Test-Path $prov)) { return }
    if ($cutoff -and (Get-Item $prov).LastWriteTime -gt $cutoff) { return }
    $sz = Get-DirSize $prov
    if (-not $sz -or $sz -lt 1MB) { return }
    if ($PSCmdlet.ShouldProcess($prov, "Remove ($([math]::Round($sz/1MB)) MB)")) {
      Remove-Item $prov -Recurse -Force -ErrorAction SilentlyContinue
      $script:freed += $sz
    }
    "{0,8:N0} MB   {1}" -f ($sz/1MB), $_.FullName.Replace("$DevRoot\", '')
  }

if ($IncludeNodeModules) {
  Write-Host "`n=== node_modules (reinstall with npm ci) ===" -ForegroundColor Cyan
  Get-ChildItem $DevRoot -Recurse -Directory -Force -Filter "node_modules" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch 'node_modules.*node_modules' } |
    ForEach-Object {
      if ($cutoff -and $_.LastWriteTime -gt $cutoff) { return }
      $sz = Get-DirSize $_.FullName
      if (-not $sz -or $sz -lt 10MB) { return }
      if ($PSCmdlet.ShouldProcess($_.FullName, "Remove ($([math]::Round($sz/1MB)) MB)")) {
        Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        $script:freed += $sz
      }
      "{0,8:N0} MB   {1}" -f ($sz/1MB), $_.FullName.Replace("$DevRoot\", '')
    }
}

Write-Host "`n=== Package manager caches ===" -ForegroundColor Cyan
if ($PSCmdlet.ShouldProcess("npm cache", "clean --force")) {
  & npm cache clean --force 2>&1 | Out-Null
  Write-Host "  npm cache cleaned"
}

"`nReclaimed this run : {0:N0} MB" -f ($freed/1MB)
"Free before        : {0:N1} GB" -f ($before/1GB)
"Free now           : {0:N1} GB" -f ((Get-PSDrive C).Free/1GB)
