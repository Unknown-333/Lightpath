# Runs one harness condition with the CPU load check: read load, wait 60 s while it is over 20%,
# record the load at the start and end in the raw log.
# Usage: powershell -File bench/prototypes/call-order/run.ps1 -Condition G0 -Runs 20 -Out <raw dir>
param([string]$Condition = 'G0', [int]$Runs = 20, [string]$Out)
$ErrorActionPreference = 'Stop'
$log = Join-Path $Out "harness-$Condition.log"
function Load { [math]::Round((Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue, 1) }
if (Test-Path $log) { Remove-Item $log }
$load = Load
$waits = 0
while ($load -gt 20 -and $waits -lt 5) {
  Add-Content $log "cpu load $load% at $(Get-Date -Format o): over 20%, waiting 60 s"
  Start-Sleep -Seconds 60
  $waits++
  $load = Load
}
Add-Content $log "cpu load at start: $load% ($(Get-Date -Format o))$(if ($load -gt 20) { ' BUSY' })"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $here 'harness.mjs') --condition $Condition --runs $Runs --out $Out
$code = $LASTEXITCODE
$end = Load
Add-Content $log "cpu load at end: $end% ($(Get-Date -Format o))$(if ($end -gt 20) { ' BUSY' })"
exit $code
