param([Parameter(Mandatory=$true)][int]$ProcessId, [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TaskbarProbe {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
  [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct PropVariant { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr pointer; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    uint GetCount(); void GetAt(uint index, out PropertyKey key); void GetValue(ref PropertyKey key, out PropVariant value);
    void SetValue(ref PropertyKey key, ref PropVariant value); void Commit();
  }
  public static IntPtr[] Windows(uint process) {
    var found = new List<IntPtr>();
    EnumWindows((hwnd, ignored) => { uint owner; GetWindowThreadProcessId(hwnd, out owner); if (owner == process) found.Add(hwnd); return true; }, IntPtr.Zero);
    return found.ToArray();
  }
  public static IntPtr Icon(IntPtr hwnd, int kind) { IntPtr result; SendMessageTimeout(hwnd, 0x7f, new IntPtr(kind), IntPtr.Zero, 2, 1000, out result); return result; }
  public static string Property(IntPtr hwnd, uint id) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore store;
    if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) != 0) return null;
    try {
      var key = new PropertyKey { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = id }; PropVariant value;
      store.GetValue(ref key, out value);
      try { return value.type == 31 ? Marshal.PtrToStringUni(value.pointer) : "vt="+value.type; }
      finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
}
'@
foreach ($handle in [TaskbarProbe]::Windows($ProcessId)) {
  if (-not [TaskbarProbe]::IsWindowVisible($handle)) { continue }
  $small = [TaskbarProbe]::Icon($handle, 0)
  $big = [TaskbarProbe]::Icon($handle, 1)
  if ($OutputDirectory) {
    [IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
    foreach ($entry in @(@('small',$small),@('big',$big))) {
      if ($entry[1] -eq [IntPtr]::Zero) { continue }
      $bitmap = [Drawing.Icon]::FromHandle($entry[1]).ToBitmap()
      try { $bitmap.Save((Join-Path $OutputDirectory ($entry[0]+'.png')),[Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
    }
  }
  [pscustomobject]@{handle=$handle.ToInt64(); appId=[TaskbarProbe]::Property($handle,5); icon=[TaskbarProbe]::Property($handle,3); command=[TaskbarProbe]::Property($handle,2); name=[TaskbarProbe]::Property($handle,4); small=$small.ToInt64(); big=$big.ToInt64()} | ConvertTo-Json -Compress
}
