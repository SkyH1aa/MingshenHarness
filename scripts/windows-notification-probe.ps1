param([string]$AppId = 'com.mingshen.harness.experimental.desktop', [string]$Activator = '', [string]$Tag = '', [string]$Reply = '', [string]$Executable = '', [int]$ActionIndex = -1, [string]$RawArguments = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
if (-not $Reply -and $ActionIndex -lt 0 -and -not $RawArguments) {
  @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($AppId) | ForEach-Object {
    if ($_ -and $_.Content) {
      @{ tag = $_.Tag; group = $_.Group; xml = $_.Content.GetXml() }
    }
  }) | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
if (-not $Activator -and $Executable) {
  $resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
  $candidates = @(Get-ChildItem -LiteralPath 'HKCU:\Software\Classes\CLSID' | Where-Object {
    $server = Get-Item -LiteralPath (Join-Path $_.PSPath 'LocalServer32') -ErrorAction SilentlyContinue
    $server -and ([string]$server.GetValue('')).IndexOf($resolvedExecutable, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  if ($candidates.Count -ne 1) { throw "Expected one matching native toast activator, found $($candidates.Count)" }
  $Activator = $candidates[0].PSChildName
}
if ($Activator -notmatch '^\{[A-Fa-f0-9-]{36}\}$' -or $Tag -notmatch '^[a-f0-9]{16}$') { throw 'Invalid test activation identity' }
if ($ActionIndex -gt 1) { throw 'Invalid test action index' }
if ($RawArguments -and ($RawArguments -notlike "*tag=$Tag*")) { throw 'Test arguments do not match the notification tag' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct NotificationInput {
  [MarshalAs(UnmanagedType.LPWStr)] public string Key;
  [MarshalAs(UnmanagedType.LPWStr)] public string Value;
}
[ComImport, Guid("53E31837-6600-4A81-9395-75CFFE746F94"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface INotificationActivationCallback {
  void Activate([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
    [MarshalAs(UnmanagedType.LPWStr)] string invokedArgs,
    [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=3)] NotificationInput[] data,
    uint count);
}
public static class NotificationProbe {
  public static void Reply(string clsid, string appId, string tag, string text) {
    var type = Type.GetTypeFromCLSID(new Guid(clsid));
    var callback = (INotificationActivationCallback)Activator.CreateInstance(type);
    callback.Activate(appId, "type=reply&tag="+tag,
      new [] {new NotificationInput {Key="reply", Value=text}}, 1);
    Marshal.FinalReleaseComObject(callback);
  }
  public static void Action(string clsid, string appId, string arguments) {
    var type = Type.GetTypeFromCLSID(new Guid(clsid));
    var callback = (INotificationActivationCallback)Activator.CreateInstance(type);
    callback.Activate(appId, arguments, new NotificationInput[0], 0);
    Marshal.FinalReleaseComObject(callback);
  }
}
'@
if ($RawArguments -or $ActionIndex -ge 0) {
  $activationArguments = if ($RawArguments) { $RawArguments } else { "type=action&action=$ActionIndex&tag=$Tag" }
  [NotificationProbe]::Action($Activator, $AppId, $activationArguments)
  'Native COM action activation submitted.'
} else {
  [NotificationProbe]::Reply($Activator, $AppId, $Tag, $Reply)
  'Native COM reply activation submitted.'
}
