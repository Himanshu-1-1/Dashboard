# Sets up the hourly Chief of Staff feed on Hemang's laptop (Windows).
#
#   powershell -ExecutionPolicy Bypass -File C:\cos-dashboard-feed\cos_feed_setup.ps1
#
# Expects cos_feed.mjs, cos_feed_run.vbs and seal_key.pub.pem in the same folder. Checks Node 24+, git and the gh login
# (with push access to Himanshu-1-1/Dashboard), runs one dry build against C:\chief-of-staff\data\cos.db (read-only), then
# registers the scheduled task "CoS dashboard feed": every hour while you're signed in, hidden, one run at a time.
# Remove it with: Unregister-ScheduledTask -TaskName 'CoS dashboard feed' -Confirm:$false
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$task = 'CoS dashboard feed'

function Need($cmd) {
  $c = Get-Command $cmd -ErrorAction SilentlyContinue
  if (-not $c) { throw "$cmd is not on PATH. Install it, open a new PowerShell window and run this again." }
  return $c.Source
}

foreach ($f in 'cos_feed.mjs', 'cos_feed_run.vbs', 'seal_key.pub.pem') {
  if (-not (Test-Path (Join-Path $dir $f))) { throw "$f is missing from $dir." }
}
$node = Need 'node'
Need 'git' | Out-Null
Need 'gh' | Out-Null

$major = [int]((& $node -p 'process.versions.node').Split('.')[0])
if ($major -lt 24) { throw "Node $major found at $node; the feed needs Node 24 or newer (node:sqlite)." }

# Through cmd so Windows PowerShell doesn't turn gh's stderr into a terminating error.
cmd /c "gh auth status >nul 2>&1"
if ($LASTEXITCODE -ne 0) { throw 'gh is not signed in. Run: gh auth login' }
$push = (cmd /c "gh api repos/Himanshu-1-1/Dashboard --jq .permissions.push 2>nul")
if ($push -ne 'true') { throw 'The gh account signed in here cannot push to Himanshu-1-1/Dashboard.' }

if (-not (Test-Path 'C:\chief-of-staff\data\cos.db')) { throw 'C:\chief-of-staff\data\cos.db not found. Set "db" in cos_feed.config.json next to the script.' }

Write-Host 'Dry run (reads the bot database read-only, pushes nothing)...'
$run = Start-Process -FilePath $node -ArgumentList "`"$(Join-Path $dir 'cos_feed.mjs')`"", '--dry-run' -WorkingDirectory $dir -NoNewWindow -Wait -PassThru
if ($run.ExitCode -ne 0) { throw "The dry run failed; see $dir\out\cos_feed.log." }

# wscript runs the feed without flashing a console window every hour.
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "`"$(Join-Path $dir 'cos_feed_run.vbs')`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Force `
  -Description 'Builds the sealed Chief of Staff feed for the locked dashboard (read-only on C:\chief-of-staff) and pushes it to the cos-snapshot branch.' | Out-Null

Write-Host "Registered '$task': first run in about 2 minutes, then hourly. Log: $dir\out\cos_feed.log"
