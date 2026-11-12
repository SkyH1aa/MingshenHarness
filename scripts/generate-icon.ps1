param(
  [string]$SourcePath = (Join-Path $PSScriptRoot '..\apps\desktop\build\icon.png'),
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Convert the approved artwork; never redraw or replace the brand image.
$source = [System.IO.Path]::GetFullPath($SourcePath)
$output = if ($OutputPath) { [System.IO.Path]::GetFullPath($OutputPath) } else { [System.IO.Path]::ChangeExtension($source, '.ico') }
if ([string]::Equals($source, $output, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The Windows icon output must not replace the source artwork.'
}
$image = [System.Drawing.Image]::FromFile($source)
$frames = @()
try {
  foreach ($size in @(16, 20, 24, 32, 48, 64, 128, 256)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $stream = New-Object System.IO.MemoryStream
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($image, 0, 0, $size, $size)
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $frames += @{ Size = $size; Bytes = $stream.ToArray() }
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose() }
  }
  # Finish the entire icon before touching the existing file.
  $file = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($file)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
      $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
      $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
      $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32)
      $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
      $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
    $writer.Flush()
    $iconBytes = $file.ToArray()
    if ($iconBytes.Length -ne $offset -or $iconBytes.Length -le (6 + 16 * $frames.Count)) {
      throw 'The generated Windows icon is incomplete.'
    }
  } finally { $writer.Dispose(); $file.Dispose() }
} finally { $image.Dispose() }

$temporary = Join-Path ([System.IO.Path]::GetDirectoryName($output)) ([System.IO.Path]::GetFileName($output) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
try {
  [System.IO.File]::WriteAllBytes($temporary, $iconBytes)
  if ([System.IO.File]::Exists($output)) {
    [System.IO.File]::Replace($temporary, $output, [System.Management.Automation.Language.NullString]::Value)
  } else {
    [System.IO.File]::Move($temporary, $output)
  }
} finally {
  if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
}
Write-Output "Windows icon generated: $output"
