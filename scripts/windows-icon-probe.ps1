param(
  [Parameter(Mandatory=$true)][string[]]$Paths,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShellIconProbe {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern uint ExtractIconEx(string path, int index, IntPtr[] large, IntPtr[] small, uint count);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$results = @()
foreach ($path in $Paths) {
  $resolved = (Resolve-Path -LiteralPath $path).Path
  $large = New-Object IntPtr[] 1
  $small = New-Object IntPtr[] 1
  $count = [ShellIconProbe]::ExtractIconEx($resolved, 0, $large, $small, 1)
  $stem = [IO.Path]::GetFileName($resolved)
  foreach ($entry in @(@('large', $large[0]), @('small', $small[0]))) {
    if ($entry[1] -eq [IntPtr]::Zero) { continue }
    try {
      $bitmap = [Drawing.Icon]::FromHandle($entry[1]).ToBitmap()
      try { $bitmap.Save((Join-Path $OutputDirectory ($stem+'.'+$entry[0]+'.png')), [Drawing.Imaging.ImageFormat]::Png) }
      finally { $bitmap.Dispose() }
    } finally { [ShellIconProbe]::DestroyIcon($entry[1]) | Out-Null }
  }
  $results += [pscustomobject]@{ path=$resolved; count=$count; large=($large[0] -ne [IntPtr]::Zero); small=($small[0] -ne [IntPtr]::Zero) }
}
$results | ConvertTo-Json -Compress
