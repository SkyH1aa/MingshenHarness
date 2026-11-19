[CmdletBinding(DefaultParameterSetName = "Verify")]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "Verify")][string]$InputPath,
  [Parameter(ParameterSetName = "Verify")][string]$OutputPath = "",
  [Parameter(Mandatory = $true, ParameterSetName = "Verify")][ValidateSet("docx", "xlsx", "pptx")][string]$Kind,
  [Parameter(Mandatory = $true, ParameterSetName = "Verify")][int]$TimeoutSeconds,
  [Parameter(Mandatory = $true, ParameterSetName = "Verify")][string]$PidFile,
  [Parameter(ParameterSetName = "Verify")][switch]$Render,
  [Parameter(ParameterSetName = "Verify")][switch]$Recalculate,
  [Parameter(Mandatory = $true, ParameterSetName = "Cleanup")][switch]$Cleanup,
  [Parameter(Mandatory = $true, ParameterSetName = "Cleanup")][string]$CleanupPidFile
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$status = "failed"
$message = ""
$currentStage = "startup"
$reportStage = $currentStage
$application = $null
$document = $null
$ownsApplication = $false
$ownsDocument = $false
$abandonApplication = $false
$inputFullPath = $null
$inputDirectory = $null
$outputFullPath = $null

function Set-OfficeStage([string]$Name) {
  $script:currentStage = $Name
  [Console]::Out.WriteLine((@{ event = "office-stage"; stage = $Name } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Assert-OfficeTimeRemaining {
  if ([datetime]::UtcNow -gt $script:officeDeadline) {
    throw "OFFICE_TIMEOUT: Microsoft Office did not reach the next verification stage before the requested deadline."
  }
}

function Get-OfficeProcess($ProcessId) {
  return Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$ProcessId)" -ErrorAction SilentlyContinue
}

function Test-OfficeProcessOwnership($Owner, $Process) {
  if ($null -eq $Process -or $null -eq $Owner) { return $false }
  $allowedNames = @("WINWORD.EXE", "EXCEL.EXE", "POWERPNT.EXE")
  if ($allowedNames -notcontains [string]$Owner.name) { return $false }
  if (-not [string]::Equals([string]$Process.Name, [string]$Owner.name, [StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  if ([string]::IsNullOrWhiteSpace([string]$Owner.executablePath) -or
      -not [string]::Equals([string]$Process.ExecutablePath, [string]$Owner.executablePath, [StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  $actualCreation = ([datetime]$Process.CreationDate).ToUniversalTime().ToString("o")
  if (-not [string]::Equals($actualCreation, [string]$Owner.creationTimeUtc, [StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  $commandLine = [string]$Process.CommandLine
  return $commandLine -match "(?i)(?:^|\s)/Automation(?:\s|$)" -and
    $commandLine -match "(?i)(?:^|\s)-Embedding(?:\s|$)"
}

function Resolve-OfficeProcessOwner($Application, [datetime]$AttemptStartedAt) {
  if (-not ("MingshenOfficeNative" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MingshenOfficeNative {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
  }
  $windowHandle = $null
  foreach ($propertyName in @("Hwnd", "HWND")) {
    try {
      $candidate = $Application.$propertyName
      if ($null -ne $candidate -and [int64]$candidate -ne 0) {
        $windowHandle = [int64]$candidate
        break
      }
    } catch {}
  }
  if ($null -eq $windowHandle) { throw "OFFICE_OWNER_UNRESOLVED: Office window handle is unavailable." }
  [uint32]$ownerProcessId = 0
  [void][MingshenOfficeNative]::GetWindowThreadProcessId([IntPtr]$windowHandle, [ref]$ownerProcessId)
  if ($ownerProcessId -eq 0) { throw "OFFICE_OWNER_UNRESOLVED: GetWindowThreadProcessId returned PID 0." }
  $process = Get-OfficeProcess $ownerProcessId
  if ($null -eq $process) { throw "OFFICE_OWNER_UNRESOLVED: Owned Office process was not found." }
  $expectedName = switch ($Kind) {
    "docx" { "WINWORD.EXE" }
    "xlsx" { "EXCEL.EXE" }
    "pptx" { "POWERPNT.EXE" }
  }
  if (-not [string]::Equals([string]$process.Name, $expectedName, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OFFICE_OWNER_UNRESOLVED: Office window belongs to $($process.Name), expected $expectedName."
  }
  if (([datetime]$process.CreationDate).ToUniversalTime() -lt $AttemptStartedAt.ToUniversalTime()) {
    throw "OFFICE_OWNER_NOT_NEW: The detected Office process predates this verification attempt; refusing to own or close it."
  }
  if ([string]$process.CommandLine -notmatch "(?i)(?:^|\s)/Automation(?:\s|$)" -or
      [string]$process.CommandLine -notmatch "(?i)(?:^|\s)-Embedding(?:\s|$)") {
    throw "OFFICE_OWNER_UNRESOLVED: Office process is not an Automation embedding instance."
  }
  $owner = [ordered]@{
    pid = [int]$ownerProcessId
    name = [string]$process.Name
    executablePath = [string]$process.ExecutablePath
    creationTimeUtc = ([datetime]$process.CreationDate).ToUniversalTime().ToString("o")
    commandLine = [string]$process.CommandLine
  }
  return $owner
}

function Register-OfficeProcessOwner($Owner) {
  $temporaryPidFile = "$PidFile.writing-$PID"
  try {
    [IO.File]::WriteAllText(
      $temporaryPidFile,
      ($owner | ConvertTo-Json -Compress),
      ([Text.UTF8Encoding]::new($false))
    )
    [IO.File]::Move($temporaryPidFile, $PidFile)
  } finally {
    if (Test-Path -LiteralPath $temporaryPidFile) {
      Remove-Item -LiteralPath $temporaryPidFile -Force
    }
  }
}

function Get-OfficeInstanceDocumentCount($Application) {
  switch ($Kind) {
    "docx" { return [int]$Application.Documents.Count }
    "xlsx" { return [int]$Application.Workbooks.Count }
    "pptx" { return [int]$Application.Presentations.Count }
  }
}

if ($PSCmdlet.ParameterSetName -eq "Cleanup") {
  $cleanupStatus = "no-owner"
  $cleanupMessage = "No owned Office PID file was recorded."
  if (Test-Path -LiteralPath $CleanupPidFile -PathType Leaf) {
    try {
      $owner = Get-Content -LiteralPath $CleanupPidFile -Raw | ConvertFrom-Json
      $ownerProcessId = [int]$owner.pid
      if ($ownerProcessId -le 0) { throw "Invalid recorded PID." }
      $process = Get-OfficeProcess $ownerProcessId
      if ($null -eq $process) {
        $cleanupStatus = "already-exited"
        $cleanupMessage = "The recorded Office process already exited."
      } elseif (Test-OfficeProcessOwnership $owner $process) {
        Stop-Process -Id $ownerProcessId -Force
        $cleanupStatus = "cleaned"
        $cleanupMessage = "Stopped the exact recorded Office Automation process."
      } else {
        $cleanupStatus = "ownership-mismatch"
        $cleanupMessage = "Process identity no longer matches the recorded Office Automation instance; nothing was stopped."
      }
      if ($cleanupStatus -in @("already-exited", "cleaned")) {
        Remove-Item -LiteralPath $CleanupPidFile -Force
      }
    } catch {
      $cleanupStatus = "invalid-pidfile"
      $cleanupMessage = $_.Exception.Message
    }
  }
  @{ status = $cleanupStatus; message = $cleanupMessage } | ConvertTo-Json -Compress
  exit 0
}

try {
  $script:officeDeadline = [datetime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSeconds))
  Set-OfficeStage "validate-input"
  if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
    throw "Input file does not exist."
  }
  if ($Render.IsPresent -and [string]::IsNullOrWhiteSpace($OutputPath)) {
    throw "OutputPath is required when Render is requested."
  }
  if ($Kind -in @("docx", "pptx") -and -not $Render.IsPresent) {
    throw "DOCX and PPTX verification require -Render."
  }
  if ($Kind -eq "xlsx" -and -not $Render.IsPresent -and -not $Recalculate.IsPresent) {
    throw "Excel verification requires -Render and/or -Recalculate."
  }
  if ($Render.IsPresent -and (Test-Path -LiteralPath $OutputPath)) {
    Remove-Item -LiteralPath $OutputPath -Force
  }
  $inputFullPath = [IO.Path]::GetFullPath($InputPath)
  $pidFullPath = [IO.Path]::GetFullPath($PidFile)
  $inputDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $inputFullPath)).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $outputFullPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) { $null } else { [IO.Path]::GetFullPath($OutputPath) }
  if (-not $pidFullPath.StartsWith($inputDirectory, [StringComparison]::OrdinalIgnoreCase)) {
    throw "PID_FILE_PATH_INVALID: PidFile must be inside the isolated Office verification directory."
  }
  if (Test-Path -LiteralPath $pidFullPath) {
    throw "PID_FILE_ALREADY_EXISTS: PidFile must be unique to this Office verification."
  }
  $PidFile = $pidFullPath

  $processName = switch ($Kind) {
    "docx" { "WINWORD" }
    "xlsx" { "EXCEL" }
    "pptx" { "POWERPNT" }
  }
  Set-OfficeStage "check-office-process"
  Assert-OfficeTimeRemaining
  if (@(Get-Process -Name $processName -ErrorAction SilentlyContinue).Count -gt 0) {
    throw "OFFICE_IN_USE: Microsoft Office is already running for this file type. COM verification was skipped without closing existing Office sessions; structural verification remains available."
  }

  switch ($Kind) {
    "docx" {
      $attemptStartedAt = [datetime]::UtcNow
      Set-OfficeStage "create-application"
      Assert-OfficeTimeRemaining
      $application = New-Object -ComObject Word.Application
      Set-OfficeStage "resolve-owner"
      Assert-OfficeTimeRemaining
      $owner = Resolve-OfficeProcessOwner $application $attemptStartedAt
      Set-OfficeStage "verify-empty-instance"
      Assert-OfficeTimeRemaining
      try {
        $instanceCount = Get-OfficeInstanceDocumentCount $application
      } catch {
        $abandonApplication = $true
        throw "OFFICE_INSTANCE_UNVERIFIED: Could not prove that the new Word automation instance is empty. Ownership was abandoned and the process will not be closed by Mingshen."
      }
      if ($instanceCount -ne 0) {
        $abandonApplication = $true
        throw "OFFICE_INSTANCE_NOT_EMPTY: The new Word automation instance already contains $instanceCount document(s). Ownership was abandoned and the process will not be closed by Mingshen."
      }
      Set-OfficeStage "record-owner"
      Assert-OfficeTimeRemaining
      Register-OfficeProcessOwner $owner
      $ownsApplication = $true
      Set-OfficeStage "configure-application"
      Assert-OfficeTimeRemaining
      $application.Visible = $false
      $application.DisplayAlerts = 0
      $application.AutomationSecurity = 3
      Set-OfficeStage "open-document"
      Assert-OfficeTimeRemaining
      # Word's OpenNoRepairDialog signature has 16 arguments. Omit optional
      # Format/Encoding/DocumentDirection by passing [Type]::Missing.
      $document = $application.Documents.OpenNoRepairDialog($InputPath, $false, $true, $false, [Type]::Missing, [Type]::Missing, $false, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, $false, $false, [Type]::Missing, $true, [Type]::Missing)
      $ownsDocument = $true
      if ($Render.IsPresent) {
        Set-OfficeStage "render-document"
        Assert-OfficeTimeRemaining
        $document.ExportAsFixedFormat($OutputPath, 17)
        $message = "Microsoft Word opened a hidden read-only isolated copy and exported PDF."
      }
    }
    "xlsx" {
      $attemptStartedAt = [datetime]::UtcNow
      Set-OfficeStage "create-application"
      Assert-OfficeTimeRemaining
      $application = New-Object -ComObject Excel.Application
      Set-OfficeStage "resolve-owner"
      Assert-OfficeTimeRemaining
      $owner = Resolve-OfficeProcessOwner $application $attemptStartedAt
      Set-OfficeStage "verify-empty-instance"
      Assert-OfficeTimeRemaining
      try {
        $instanceCount = Get-OfficeInstanceDocumentCount $application
      } catch {
        $abandonApplication = $true
        throw "OFFICE_INSTANCE_UNVERIFIED: Could not prove that the new Excel automation instance is empty. Ownership was abandoned and the process will not be closed by Mingshen."
      }
      if ($instanceCount -ne 0) {
        $abandonApplication = $true
        throw "OFFICE_INSTANCE_NOT_EMPTY: The new Excel automation instance already contains $instanceCount workbook(s). Ownership was abandoned and the process will not be closed by Mingshen."
      }
      Set-OfficeStage "record-owner"
      Assert-OfficeTimeRemaining
      Register-OfficeProcessOwner $owner
      $ownsApplication = $true
      Set-OfficeStage "configure-application"
      Assert-OfficeTimeRemaining
      $application.Visible = $false
      $application.DisplayAlerts = $false
      $application.AskToUpdateLinks = $false
      $application.AutomationSecurity = 3
      Set-OfficeStage "open-document"
      Assert-OfficeTimeRemaining
      $document = $application.Workbooks.Open($InputPath, 0, $false)
      $ownsDocument = $true
      Set-OfficeStage "recalculate-document"
      Assert-OfficeTimeRemaining
      $application.CalculateFullRebuild()
      if ($Recalculate.IsPresent) {
        Set-OfficeStage "save-document"
        Assert-OfficeTimeRemaining
        $document.Save()
        $message = "Microsoft Excel recalculated the isolated workbook and saved formula caches."
      } else {
        $message = "Microsoft Excel opened and calculated an isolated workbook; the source was not saved."
      }
      if ($Render.IsPresent) {
        Set-OfficeStage "render-document"
        Assert-OfficeTimeRemaining
        $document.ExportAsFixedFormat(0, $OutputPath)
        $message = "$message PDF rendered."
      }
    }
    "pptx" {
      $attemptStartedAt = [datetime]::UtcNow
      Set-OfficeStage "create-application"
      Assert-OfficeTimeRemaining
      $application = New-Object -ComObject PowerPoint.Application
      Set-OfficeStage "resolve-owner"
      Assert-OfficeTimeRemaining
      $owner = Resolve-OfficeProcessOwner $application $attemptStartedAt
      Set-OfficeStage "verify-empty-instance"
      Assert-OfficeTimeRemaining
      try {
        $instanceCount = Get-OfficeInstanceDocumentCount $application
      } catch {
        $abandonApplication = $true
        throw "OFFICE_INSTANCE_UNVERIFIED: Could not prove that the new PowerPoint automation instance is empty. Ownership was abandoned and the process will not be closed by Mingshen."
      }
      if ($instanceCount -ne 0) {
        $abandonApplication = $true
        throw "OFFICE_INSTANCE_NOT_EMPTY: The new PowerPoint automation instance already contains $instanceCount presentation(s). Ownership was abandoned and the process will not be closed by Mingshen."
      }
      Set-OfficeStage "record-owner"
      Assert-OfficeTimeRemaining
      Register-OfficeProcessOwner $owner
      $ownsApplication = $true
      Set-OfficeStage "configure-application"
      Assert-OfficeTimeRemaining
      $application.DisplayAlerts = 1
      $application.AutomationSecurity = 3
      Set-OfficeStage "open-document"
      Assert-OfficeTimeRemaining
      $document = $application.Presentations.Open($InputPath, $true, $false, $false)
      $ownsDocument = $true
      if ($Render.IsPresent) {
        Set-OfficeStage "render-document"
        Assert-OfficeTimeRemaining
        $document.SaveAs($OutputPath, 32)
        $message = "Microsoft PowerPoint opened an isolated read-only copy and exported PDF."
      }
    }
  }
  Set-OfficeStage "verify-output"
  Assert-OfficeTimeRemaining
  if ($Render.IsPresent -and -not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
    throw "Microsoft Office did not produce the requested PDF."
  }
  $status = "verified"
  $currentStage = "completed"
  $reportStage = "completed"
}
catch {
  $text = $_.Exception.Message
  if (-not [string]::IsNullOrWhiteSpace($inputFullPath)) {
    $text = $text.Replace($inputFullPath, "<isolated-document>")
  }
  if (-not [string]::IsNullOrWhiteSpace($inputDirectory)) {
    $text = $text.Replace($inputDirectory, "<isolated-directory>")
  }
  if (-not [string]::IsNullOrWhiteSpace($outputFullPath)) {
    $text = $text.Replace($outputFullPath, "<isolated-output>")
  }
  $reportStage = $currentStage
  if ($text -match "^OFFICE_IN_USE:") {
    $status = "unavailable"
    $message = $text
  } elseif ($text -match "^OFFICE_INSTANCE_(?:NOT_EMPTY|UNVERIFIED):") {
    $status = "unavailable"
    $message = $text
  } elseif ($text -match "80080005|80040154|800706BA|800706BE|8001010A|class not registered|Creating an instance of the COM component|remote procedure call failed|access is denied|permission denied") {
    $status = "unavailable"
    $message = "Microsoft Office cannot be automated for this file type in the current session (not installed, blocked by permissions or process isolation, or COM did not start); no recalculate or render verification was performed. $text"
  } else {
    $status = "failed"
    $message = $text
  }
}
finally {
  if (-not $abandonApplication -and $ownsDocument -and $null -ne $document) {
    Set-OfficeStage "close-document"
    try {
      if ($Kind -eq "docx") { $document.Close($false) }
      elseif ($Kind -eq "xlsx") { $document.Close($false) }
      else { $document.Close() }
    } catch {}
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) } catch {}
  }
  if (-not $abandonApplication -and $ownsApplication -and $null -ne $application) {
    Set-OfficeStage "quit-application"
    try {
      if ($Kind -eq "docx") { $application.Quit(0) }
      elseif ($Kind -eq "xlsx") { $application.Quit() }
      else { $application.Quit() }
    } catch {}
  }
  if (-not $abandonApplication -and $null -ne $document -and -not $ownsDocument) {
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) } catch {}
  }
  if (-not $abandonApplication -and $null -ne $application) {
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application) } catch {}
  }
  if (-not $abandonApplication) {
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

@{ status = $status; message = $message; stage = $reportStage } | ConvertTo-Json -Compress
if ($status -ne "verified") { exit 2 }
