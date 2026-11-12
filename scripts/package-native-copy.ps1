param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination,
  [Parameter(Mandatory = $true)][string]$BuildRoot
)
$ErrorActionPreference = 'Stop'
$resolvedRoot = [IO.Path]::GetFullPath($BuildRoot).TrimEnd('\') + '\'
$resolvedDestination = [IO.Path]::GetFullPath($Destination)
if (-not $resolvedDestination.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Destination is outside the packaging workspace.'
}
$resolvedSource = (Resolve-Path -LiteralPath $Source).ProviderPath
if (-not [IO.File]::Exists($resolvedSource)) { throw 'Source is not a regular file.' }
[IO.File]::Copy($resolvedSource, $resolvedDestination, $true)
