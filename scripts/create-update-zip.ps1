param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Archive
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourcePath = [System.IO.Path]::GetFullPath($Installer)
$archivePath = [System.IO.Path]::GetFullPath($Archive)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw 'Installer not found.' }
if (Test-Path -LiteralPath $archivePath) { throw 'Temporary update archive already exists.' }
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
try {
  $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
  try {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $sourcePath, [System.IO.Path]::GetFileName($sourcePath),
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
