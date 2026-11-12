# Audited on 2026-11-12. Preview is the default; -Apply deletes only unchanged targets.
[CmdletBinding()]
param([switch]$Apply)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repository = $repository.TrimEnd([char[]]@('\', '/'))
$separator = [IO.Path]::DirectorySeparatorChar
$comparison = [StringComparison]::OrdinalIgnoreCase

$manifest = @'
.pnpm-store|8192|1
.tmp|19700824|9
.tmp-demo-profile/Cache|2357014|8
.tmp-demo-profile/Code Cache|7540|5
.tmp-demo-profile/DawnGraphiteCache|557424|5
.tmp-demo-profile/DawnWebGPUCache|557424|5
.tmp-demo-profile/GPUCache|557424|5
.tmp-demo-profile/GPUPersistentCache|0|3
.tmp-demo-profile/GrShaderCache|4824532|7
.tmp-demo-profile/Shared Dictionary/cache|72|2
.tmp-demo-profile/ShaderCache|557424|5
.tmp-e2e-profile/Cache|62403679|188
.tmp-e2e-profile/Code Cache|83400273|452
.tmp-e2e-profile/DawnGraphiteCache|557424|5
.tmp-e2e-profile/DawnWebGPUCache|557424|5
.tmp-e2e-profile/GPUCache|1642864|5
.tmp-e2e-profile/GPUPersistentCache|0|3
.tmp-e2e-profile/GrShaderCache|5053276|18
.tmp-e2e-profile/Partitions/mingshen-chrome/Cache|10355827|51
.tmp-e2e-profile/Partitions/mingshen-chrome/Code Cache|5336812|145
.tmp-e2e-profile/Partitions/mingshen-chrome/DawnGraphiteCache|557424|5
.tmp-e2e-profile/Partitions/mingshen-chrome/DawnWebGPUCache|557424|5
.tmp-e2e-profile/Partitions/mingshen-chrome/GPUCache|557424|5
.tmp-e2e-profile/Partitions/mingshen-chrome/Shared Dictionary/cache|72|2
.tmp-e2e-profile/Partitions/mingshen-edge/Cache|8047324|43
.tmp-e2e-profile/Partitions/mingshen-edge/Code Cache|3235989|170
.tmp-e2e-profile/Partitions/mingshen-edge/DawnGraphiteCache|557424|5
.tmp-e2e-profile/Partitions/mingshen-edge/DawnWebGPUCache|557424|5
.tmp-e2e-profile/Partitions/mingshen-edge/GPUCache|557424|5
.tmp-e2e-profile/Partitions/mingshen-edge/Shared Dictionary/cache|72|2
.tmp-e2e-profile/Shared Dictionary/cache|72|2
.tmp-e2e-profile/ShaderCache|557424|5
.tmp-e2e-profile/browser-profiles/chrome/Default/Cache|2357014|8
.tmp-e2e-profile/browser-profiles/chrome/Default/Code Cache|466|5
.tmp-e2e-profile/browser-profiles/chrome/Default/DawnGraphiteCache|557424|5
.tmp-e2e-profile/browser-profiles/chrome/Default/DawnWebGPUCache|557424|5
.tmp-e2e-profile/browser-profiles/chrome/Default/GPUCache|557424|5
.tmp-e2e-profile/browser-profiles/chrome/Default/Shared Dictionary/cache|72|2
.tmp-e2e-profile/browser-profiles/chrome/Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/Cache|0|0
.tmp-e2e-profile/browser-profiles/chrome/Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/Code Cache|476|5
.tmp-e2e-profile/browser-profiles/chrome/Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/DawnGraphiteCache|557424|5
.tmp-e2e-profile/browser-profiles/chrome/Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/DawnWebGPUCache|557424|5
.tmp-e2e-profile/browser-profiles/chrome/Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/GPUCache|557424|5
.tmp-e2e-profile/browser-profiles/chrome/Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/Shared Dictionary/cache|72|2
.tmp-e2e-profile/browser-profiles/chrome/GPUPersistentCache|0|3
.tmp-e2e-profile/browser-profiles/chrome/GrShaderCache|4805208|6
.tmp-e2e-profile/browser-profiles/chrome/ShaderCache|557424|5
.tmp-e2e-profile/browser-profiles/chrome/component_crx_cache|34060987|18
.tmp-e2e-profile/browser-profiles/edge/Default/Cache|9464213|60
.tmp-e2e-profile/browser-profiles/edge/Default/Code Cache|42192|144
.tmp-e2e-profile/browser-profiles/edge/Default/DawnGraphiteCache|557424|5
.tmp-e2e-profile/browser-profiles/edge/Default/DawnWebGPUCache|557424|5
.tmp-e2e-profile/browser-profiles/edge/Default/GPUCache|557424|5
.tmp-e2e-profile/browser-profiles/edge/Default/Shared Dictionary/cache|72|2
.tmp-e2e-profile/browser-profiles/edge/Default/Storage/ext/ihmafllikibpmigkcoadcmckbfhibefp/def/Cache|0|0
.tmp-e2e-profile/browser-profiles/edge/Default/Storage/ext/ihmafllikibpmigkcoadcmckbfhibefp/def/Code Cache|477|5
.tmp-e2e-profile/browser-profiles/edge/Default/Storage/ext/ihmafllikibpmigkcoadcmckbfhibefp/def/DawnGraphiteCache|557424|5
.tmp-e2e-profile/browser-profiles/edge/Default/Storage/ext/ihmafllikibpmigkcoadcmckbfhibefp/def/DawnWebGPUCache|557424|5
.tmp-e2e-profile/browser-profiles/edge/Default/Storage/ext/ihmafllikibpmigkcoadcmckbfhibefp/def/GPUCache|557424|5
.tmp-e2e-profile/browser-profiles/edge/Default/Storage/ext/ihmafllikibpmigkcoadcmckbfhibefp/def/Shared Dictionary/cache|72|2
.tmp-e2e-profile/browser-profiles/edge/GPUPersistentCache|0|3
.tmp-e2e-profile/browser-profiles/edge/GrShaderCache|5077264|19
.tmp-e2e-profile/browser-profiles/edge/ShaderCache|557424|5
.tmp-e2e-profile/browser-profiles/edge/component_crx_cache|17042247|17
.tmp-experimental-2/Cache|16567942|22
.tmp-experimental-2/Code Cache|13089|26
.tmp-experimental-2/DawnGraphiteCache|557424|5
.tmp-experimental-2/DawnWebGPUCache|557424|5
.tmp-experimental-2/GPUCache|557424|5
.tmp-experimental-2/GPUPersistentCache|0|3
.tmp-experimental-2/GrShaderCache|4788592|5
.tmp-experimental-2/Shared Dictionary/cache|72|2
.tmp-experimental-2/ShaderCache|557424|5
.tmp-i18n|38825|2
.tmp-icon-atomic-test.ico|37498|1
.tmp-installer-repair-20261110|12178|1
.tmp-notification-smoke-1794023328003|11917871|79
.tmp-taskbar-restart-1794271230153|12287566|87
.tmp-v121-smoke-1794059129703|12431705|93
.tmp-v121-smoke-1794059217276|14741794|151
.tmp-v121-smoke-1794193156505|12644240|151
.tmp-v121-smoke-1794196884438|14722572|150
.tmp-v121-smoke-1794214004282|14643260|155
.tmp-v121-smoke-1794227560633|14643260|155
apps/desktop/release-artifacts/.icon-ico|16221|1
apps/desktop/release-artifacts/builder-debug.yml|7614|1
apps/desktop/release-artifacts/win-unpacked|415929547|81
apps/desktop/release/builder-debug.yml|7604|1
apps/desktop/release/win-unpacked|415929547|81
apps/desktop/release/win-unpacked.tmp|17961431|8
tmp|6705361210|9301
'@ | ConvertFrom-Csv -Delimiter '|' -Header Path, Bytes, Files

function Assert-LocalPath([string]$Path) {
    if (-not $Path.StartsWith($repository + $separator, $comparison)) {
        throw "Target is outside the repository: $Path"
    }
    $ancestor = $Path
    while ($true) {
        if ([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing a junction or symbolic link: $ancestor"
        }
        if ($ancestor.Equals($repository, $comparison)) { break }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
}

function Get-TargetStats([string]$Path) {
    Assert-LocalPath $Path
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Path)
    [long]$bytes = 0
    [long]$files = 0
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        $attributes = [IO.File]::GetAttributes($current)
        if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing a junction or symbolic link: $current"
        }
        if ($attributes -band [IO.FileAttributes]::Directory) {
            foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($current)) {
                $pending.Push($child)
            }
        } else {
            $bytes += [IO.FileInfo]::new($current).Length
            $files++
        }
    }
    [pscustomobject]@{ Bytes = $bytes; Files = $files }
}

function Assert-NoActiveRepositoryProcess {
    $active = @(Get-CimInstance Win32_Process | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($repository + $separator, $comparison)) -or
        ($_.CommandLine -and $_.CommandLine.IndexOf($repository, $comparison) -ge 0 -and
            $_.Name -match '(?i)electron|mingshen|chrome|msedge|node')
    })
    if ($active.Count -gt 0) {
        throw 'Close repository development, test and browser processes before cleanup.'
    }
}

$gitRoot = & git -C $repository rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0 -or -not [IO.Path]::GetFullPath($gitRoot).Equals($repository, $comparison)) {
    throw 'The script must belong to the root of the audited Git repository.'
}
$tracked = @(& git -C $repository -c core.quotepath=false ls-files)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect tracked files.' }
if (@($manifest).Count -ne 91) { throw 'The audited manifest is incomplete.' }

$present = @($manifest | Where-Object {
    Test-Path -LiteralPath (Join-Path $repository $_.Path)
})
if ($present.Count -eq 0) {
    Write-Host 'No audited artifacts remain.'
    return
}
$ignored = @(& git -C $repository -c core.quotepath=false check-ignore -- @($present.Path))
if ($LASTEXITCODE -ne 0) { throw 'Some targets are no longer ignored by Git; re-audit first.' }
$validated = @(foreach ($entry in $present) {
    $relative = $entry.Path
    $absolute = [IO.Path]::GetFullPath((Join-Path $repository $relative))
    foreach ($file in $tracked) {
        if ($file.Equals($relative, $comparison) -or $file.StartsWith($relative + '/', $comparison)) {
            throw "Target contains tracked files: $relative"
        }
    }
    if ($ignored -notcontains $relative) { throw "Target is not ignored by Git: $relative" }
    $stats = Get-TargetStats $absolute
    if ($stats.Bytes -ne [long]$entry.Bytes -or $stats.Files -ne [long]$entry.Files) {
        throw "Target changed since the audit; nothing has been deleted. Re-audit: $relative"
    }
    [pscustomobject]@{
        Path = $relative
        Absolute = $absolute
        Bytes = $stats.Bytes
        Files = $stats.Files
    }
})

[long]$totalBytes = ($validated | Measure-Object Bytes -Sum).Sum
$validated | Sort-Object Bytes -Descending | Select-Object @{
    Name = 'MiB'; Expression = { [math]::Round($_.Bytes / 1MB, 2) }
}, Files, Path | Format-Table -AutoSize
Write-Host ('Validated {0} targets, {1:N3} GiB ({2} bytes).' -f $validated.Count, ($totalBytes / 1GB), $totalBytes)
if (-not $Apply) {
    Write-Host 'Preview only. No files were changed. Add -Apply to remove these audited artifacts.'
    return
}

Assert-NoActiveRepositoryProcess
[long]$removedBytes = 0
$removedCount = 0
try {
    foreach ($entry in $validated) {
        $stats = Get-TargetStats $entry.Absolute
        if ($stats.Bytes -ne $entry.Bytes -or $stats.Files -ne $entry.Files) {
            throw "Target changed during cleanup; stopping: $($entry.Path)"
        }
        Remove-Item -LiteralPath $entry.Absolute -Recurse -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $entry.Absolute) { throw "Target was not removed: $($entry.Path)" }
        $removedBytes += $entry.Bytes
        $removedCount++
        Write-Host ('Removed {0}/{1}: {2}' -f $removedCount, $validated.Count, $entry.Path)
    }
} finally {
    Write-Host ('Removed {0} targets, {1:N3} GiB. No installer, dependency or source directory is in this manifest.' -f $removedCount, ($removedBytes / 1GB))
}
