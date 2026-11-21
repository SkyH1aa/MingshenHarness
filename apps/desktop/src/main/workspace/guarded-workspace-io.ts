import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const WINDOWS_POWERSHELL = process.env.SystemRoot
  ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : "powershell.exe";
const WORKER_START_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const WORKER_STOP_TIMEOUT_MS = 5_000;
const WORKER_IDLE_TIMEOUT_MS = 10_000;
const MAX_PROTOCOL_LINE_CHARS = 64 * 1024 * 1024;
const MAX_REQUEST_CHARS = 64 * 1024 * 1024;
const MAX_STDERR_CHARS = 64 * 1024;

const POWERSHELL_BOOTSTRAP = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Web.Extensions'
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while (($line = [Console]::In.ReadLine()) -ne $null) {
  [Console]::Out.WriteLine([MingshenWorkspaceGuard]::Execute($line))
  [Console]::Out.Flush()
}
`;

const GUARDED_IO_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public class GuardRequest {
  public string id;
  public string kind;
  public string root;
  public string sourceRoot;
  public string path;
  public string content;
  public string expectedHash;
  public string replacementHash;
  public string temporaryPath;
  public string backupPath;
  public bool createParents;
  public int holdMilliseconds;
  public string[] paths;
  public GuardOperation[] operations;
  public string[] ignoredDirectories;
  public long maxBytes;
  public long maxTotalBytes;
  public int maxFiles;
}

public class GuardOperation {
  public string kind;
  public string sourcePath;
  public string targetPath;
  public string path;
  public string state;
  public bool createParents;
  public bool allowMissing;
  public int holdMilliseconds;
}

public class GuardFile {
  public string path;
  public long size;
}

public class GuardEntry {
  public string name;
  public bool directory;
  public bool reparse;
  public long size;
}

public class GuardInspection {
  public string path;
  public string state;
  public long size;
}

public class GuardCopyResult {
  public long bytes;
  public string sourceSha256;
  public string targetSha256;
}

public class GuardApplyResult {
  public int copied;
  public int deleted;
  public int asserted;
  public long bytes;
  public List<GuardCopyResult> copies = new List<GuardCopyResult>();
}

public class GuardListResult {
  public List<GuardFile> files = new List<GuardFile>();
  public long totalBytes;
}

public class GuardReadResult {
  public string data;
  public long size;
  public string sha256;
}

public class GuardWriteResult {
  public long size;
  public string sha256;
}

public class GuardRecoveryResult {
  public string state;
  public string backupPath;
}

public class GuardStatResult {
  public string state;
  public bool directory;
  public long size;
}

public class GuardResponse {
  public string id;
  public bool ok;
  public object result;
  public string error;
}

public sealed class GuardException : Exception {
  public readonly string code;
  public GuardException(string code, string message) : base(message) { this.code = code; }
}

public static class MingshenWorkspaceGuard {
  private const uint FILE_READ_ATTRIBUTES = 0x00000080;
  private const uint FILE_WRITE_ATTRIBUTES = 0x00000100;
  private const uint DELETE = 0x00010000;
  private const uint SYNCHRONIZE = 0x00100000;
  private const uint GENERIC_READ = 0x80000000;
  private const uint GENERIC_WRITE = 0x40000000;
  private const uint FILE_SHARE_READ = 0x00000001;
  private const uint FILE_SHARE_WRITE = 0x00000002;
  private const uint FILE_SHARE_DELETE = 0x00000004;
  private const uint FILE_ATTRIBUTE_READONLY = 0x00000001;
  private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
  private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
  private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
  private const uint FILE_FLAG_DELETE_ON_CLOSE = 0x04000000;
  private const uint CREATE_NEW = 1;
  private const uint OPEN_EXISTING = 3;
  private const uint MOVEFILE_REPLACE_EXISTING = 0x00000001;
  private const uint MOVEFILE_WRITE_THROUGH = 0x00000008;
  private const int FILE_BASIC_INFO_CLASS = 0;
  private const int FILE_RENAME_INFO_CLASS = 3;
  private const int FILE_DISPOSITION_INFO_CLASS = 4;
  private const int ERROR_FILE_NOT_FOUND = 2;
  private const int ERROR_PATH_NOT_FOUND = 3;
  private const int ERROR_ACCESS_DENIED = 5;
  private const int ERROR_SHARING_VIOLATION = 32;
  private const int ERROR_LOCK_VIOLATION = 33;
  private const int ERROR_FILE_EXISTS = 80;
  private const int ERROR_ALREADY_EXISTS = 183;
  private const int FILE_ATTRIBUTE_NORMAL = 0x80;
  private const int MAX_WRITE_BYTES = 25 * 1024 * 1024;
  private const int MAX_WRITE_BASE64_CHARS = ((MAX_WRITE_BYTES + 2) / 3) * 4;

  [StructLayout(LayoutKind.Sequential)]
  private struct BY_HANDLE_FILE_INFORMATION {
    public uint FileAttributes;
    public uint CreationTimeLow;
    public uint CreationTimeHigh;
    public uint LastAccessTimeLow;
    public uint LastAccessTimeHigh;
    public uint LastWriteTimeLow;
    public uint LastWriteTimeHigh;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FILE_DISPOSITION_INFO {
    [MarshalAs(UnmanagedType.U1)]
    public bool DeleteFile;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FILE_BASIC_INFO {
    public long CreationTime;
    public long LastAccessTime;
    public long LastWriteTime;
    public long ChangeTime;
    public uint FileAttributes;
    public uint Reserved;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFileW(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool MoveFileExW(
    string existingFileName,
    string newFileName,
    uint flags);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool GetFileInformationByHandle(
    SafeFileHandle file,
    out BY_HANDLE_FILE_INFORMATION information);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetFinalPathNameByHandleW(
    SafeFileHandle file,
    System.Text.StringBuilder path,
    uint pathLength,
    uint flags);

  [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true)]
  private static extern bool SetFileBasicInformationByHandle(
    SafeFileHandle file,
    int informationClass,
    ref FILE_BASIC_INFO information,
    int bufferSize);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetFileInformationByHandle(
    SafeFileHandle file,
    int informationClass,
    ref FILE_DISPOSITION_INFO information,
    int bufferSize);

  [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true)]
  private static extern bool SetFileRenameInformationByHandle(
    SafeFileHandle file,
    int informationClass,
    IntPtr information,
    int bufferSize);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool WriteFile(
    SafeFileHandle file,
    byte[] buffer,
    uint numberOfBytesToWrite,
    out uint numberOfBytesWritten,
    IntPtr overlapped);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool ReadFile(
    SafeFileHandle file,
    byte[] buffer,
    uint numberOfBytesToRead,
    out uint numberOfBytesRead,
    IntPtr overlapped);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetFilePointerEx(
    SafeFileHandle file,
    long distanceToMove,
    out long newFilePointer,
    uint moveMethod);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool FlushFileBuffers(SafeFileHandle file);

  private static readonly Regex ReservedName = new Regex(
    @"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$",
    RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
  private static readonly Regex Sha256Pattern = new Regex(
    @"^[0-9a-fA-F]{64}$",
    RegexOptions.CultureInvariant);

  private sealed class RecoveryFile : IDisposable {
    public readonly string RelativePath;
    public readonly PinnedPath Parent;
    public readonly SafeFileHandle Handle;
    public readonly BY_HANDLE_FILE_INFORMATION Information;
    public readonly string Hash;

    public bool Exists { get { return Handle != null; } }

    public RecoveryFile(GuardRoot root, string path) {
      RelativePath = NormalizeRelativeText(path);
      PinnedPath parent = null;
      SafeFileHandle handle = null;
      try {
        parent = root.OpenParent(RelativePath, false);
        Parent = parent;
        handle = parent.OpenFile(
          GENERIC_READ | DELETE | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE,
          FILE_SHARE_READ,
          OPEN_EXISTING,
          false);
        Information = GetInformation(handle);
        Hash = HashHandle(handle, FileSize(Information));
      } catch (GuardException error) {
        if (handle != null) handle.Dispose();
        if (parent != null) parent.Dispose();
        if (error.code == "missing") return;
        throw;
      } catch {
        if (handle != null) handle.Dispose();
        if (parent != null) parent.Dispose();
        throw;
      }
      Handle = handle;
    }

    public void Dispose() {
      if (Handle != null) Handle.Dispose();
      if (Parent != null) Parent.Dispose();
    }
  }

  private sealed class GuardRoot : IDisposable {
    private readonly List<SafeFileHandle> handles = new List<SafeFileHandle>();
    private readonly string rootPath;
    public readonly string CanonicalRoot;

    public GuardRoot(string root) {
      if (String.IsNullOrWhiteSpace(root) || !Path.IsPathRooted(root))
        throw new GuardException("invalid-root", "工作区根路径必须是绝对路径。");
      rootPath = Path.GetFullPath(root);
      string volumeRoot = Path.GetPathRoot(rootPath);
      if (String.IsNullOrEmpty(volumeRoot) || volumeRoot.StartsWith(@"\\", StringComparison.Ordinal))
        throw new GuardException("unsupported-root", "仅支持本地 Windows 工作区路径。");
      try {
        string current = volumeRoot;
        handles.Add(OpenDirectoryHandle(current));
        string remainder = rootPath.Substring(volumeRoot.Length);
        foreach (string part in remainder.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries)) {
          current = Path.Combine(current, part);
          handles.Add(OpenDirectoryHandle(current));
        }
        CanonicalRoot = GetCanonicalPath(handles[handles.Count - 1]);
      } catch {
        DisposeAll(handles);
        throw;
      }
    }

    public string RootPath { get { return rootPath; } }

    public PinnedPath OpenParent(string relativePath, bool createParents) {
      string[] parts = NormalizeRelative(relativePath);
      List<SafeFileHandle> parents = new List<SafeFileHandle>();
      string current = rootPath;
      try {
        for (int index = 0; index < parts.Length - 1; index++) {
          current = Path.Combine(current, parts[index]);
          try {
            SafeFileHandle parent = OpenDirectoryHandle(current);
            try {
              EnsureCanonical(parent);
            } catch {
              parent.Dispose();
              throw;
            }
            parents.Add(parent);
          } catch (GuardException error) {
            if (!createParents || error.code != "missing") throw;
            try {
              Directory.CreateDirectory(current);
            } catch (IOException cause) {
              throw MapIoError(cause);
            } catch (UnauthorizedAccessException cause) {
              throw MapIoError(cause);
            }
            SafeFileHandle createdParent = OpenDirectoryHandle(current);
            try {
              EnsureCanonical(createdParent);
            } catch {
              createdParent.Dispose();
              throw;
            }
            parents.Add(createdParent);
          }
        }
        string fullPath = Path.Combine(rootPath, String.Join("\\", parts));
        return new PinnedPath(this, parents, fullPath);
      } catch {
        DisposeAll(parents);
        throw;
      }
    }

    public SafeFileHandle OpenDirectoryRelative(string relativePath) {
      string normalized = NormalizeRelative(relativePath).Length == 0
        ? String.Empty
        : String.Join("\\", NormalizeRelative(relativePath));
      string current = rootPath;
      if (normalized.Length > 0) current = Path.Combine(current, normalized);
      SafeFileHandle handle = OpenDirectoryHandle(current);
      try {
        EnsureCanonical(handle);
        return handle;
      } catch {
        handle.Dispose();
        throw;
      }
    }

    public string EnsureCanonical(SafeFileHandle handle) {
      string candidate = GetCanonicalPath(handle);
      string root = CanonicalRoot.TrimEnd('\\');
      if (!candidate.Equals(root, StringComparison.OrdinalIgnoreCase) &&
          !candidate.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)) {
        throw new GuardException("escape", "句柄解析后的路径超出工作区。");
      }
      return candidate;
    }

    public void Dispose() {
      DisposeAll(handles);
    }
  }

  private sealed class PinnedPath : IDisposable {
    private readonly GuardRoot root;
    private readonly List<SafeFileHandle> parents;
    public readonly string FullPath;

    public PinnedPath(GuardRoot root, List<SafeFileHandle> parents, string fullPath) {
      this.root = root;
      this.parents = parents;
      FullPath = fullPath;
    }

    public SafeFileHandle OpenFile(
      uint access,
      uint share,
      uint creation,
      bool directory,
      uint additionalFlags = 0) {
      uint flags = FILE_FLAG_OPEN_REPARSE_POINT | additionalFlags;
      if (directory) flags |= FILE_FLAG_BACKUP_SEMANTICS;
      SafeFileHandle handle = CreateFileW(
        ExtendedPath(FullPath),
        access,
        share,
        IntPtr.Zero,
        creation,
        flags,
        IntPtr.Zero);
      if (handle.IsInvalid) {
        int code = Marshal.GetLastWin32Error();
        handle.Dispose();
        throw Win32Error(code);
      }
      try {
        BY_HANDLE_FILE_INFORMATION information = GetInformation(handle);
        if ((information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
          throw new GuardException("reparse", "文件路径经过符号链接或目录链接。");
        bool isDirectory = (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
        if (isDirectory != directory)
          throw new GuardException("type", directory ? "目标不是目录。" : "目标不是普通文件。");
        EnsureNotHardLinked(information, isDirectory);
        root.EnsureCanonical(handle);
        return handle;
      } catch {
        handle.Dispose();
        throw;
      }
    }

    public SafeFileHandle OpenEntry(uint access, uint share, uint creation) {
      SafeFileHandle handle = CreateFileW(
        ExtendedPath(FullPath),
        access,
        share,
        IntPtr.Zero,
        creation,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        IntPtr.Zero);
      if (handle.IsInvalid) {
        int code = Marshal.GetLastWin32Error();
        handle.Dispose();
        throw Win32Error(code);
      }
      try {
        BY_HANDLE_FILE_INFORMATION information = GetInformation(handle);
        if ((information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
          throw new GuardException("reparse", "文件路径经过符号链接或目录链接。");
        EnsureNotHardLinked(
          information,
          (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0);
        root.EnsureCanonical(handle);
        return handle;
      } catch {
        handle.Dispose();
        throw;
      }
    }

    public void Dispose() {
      DisposeAll(parents);
    }
  }

  public static string Execute(string requestJson) {
    GuardRequest request = null;
    try {
      JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };
      request = serializer.Deserialize<GuardRequest>(requestJson);
      if (request == null || String.IsNullOrWhiteSpace(request.id))
        throw new GuardException("protocol", "守护进程请求缺少 id。");
      object result = ExecuteRequest(request);
      return serializer.Serialize(new GuardResponse {
        id = request.id,
        ok = true,
        result = result
      });
    } catch (Exception cause) {
      string error = cause is GuardException ? cause.Message : cause.Message;
      return new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue }.Serialize(new GuardResponse {
        id = request == null ? null : request.id,
        ok = false,
        error = error
      });
    }
  }

  private static object ExecuteRequest(GuardRequest request) {
    using (GuardRoot root = new GuardRoot(request.root)) {
      switch (request.kind) {
        case "inspect":
          return Inspect(root, request.paths ?? new string[0]);
        case "list":
          return ListFiles(root, request.ignoredDirectories ?? new string[0], request.maxFiles, request.maxTotalBytes);
        case "apply":
          return Apply(root, request.sourceRoot, request.operations ?? new GuardOperation[0]);
        case "read":
          return Read(root, request.path, request.maxBytes);
        case "write":
          return Write(
            root,
            request.path,
            request.content,
            request.expectedHash,
            request.temporaryPath,
            request.backupPath,
            request.createParents,
            request.holdMilliseconds);
        case "recover-write":
          return RecoverWrite(
            root,
            request.path,
            request.temporaryPath,
            request.backupPath,
            request.expectedHash,
            request.replacementHash);
        case "stat":
          return Stat(root, request.path);
        case "listdir":
          return ListDirectory(root, request.path);
        default:
          throw new GuardException("protocol", "未知的受保护文件操作。");
      }
    }
  }

  private static List<GuardInspection> Inspect(GuardRoot root, string[] paths) {
    List<GuardInspection> results = new List<GuardInspection>();
    foreach (string path in paths) {
      string relative = NormalizeRelativeText(path);
      try {
        using (PinnedPath target = root.OpenParent(relative, false))
        using (SafeFileHandle handle = target.OpenEntry(
          FILE_READ_ATTRIBUTES | SYNCHRONIZE,
          FILE_SHARE_READ,
          OPEN_EXISTING)) {
          BY_HANDLE_FILE_INFORMATION information = GetInformation(handle);
          if ((information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0)
            throw new GuardException("type", "文件检查点目标必须是普通文件。");
          if ((information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            throw new GuardException("reparse", "文件路径经过符号链接或目录链接。");
          results.Add(new GuardInspection {
            path = relative,
            state = "file",
            size = FileSize(information)
          });
        }
      } catch (GuardException error) {
        if (error.code != "missing") throw;
        results.Add(new GuardInspection { path = relative, state = "missing", size = 0 });
      }
    }
    return results;
  }

  private static GuardListResult ListFiles(
    GuardRoot root,
    string[] ignoredDirectories,
    int maxFiles,
    long maxTotalBytes) {
    HashSet<string> ignored = new HashSet<string>(ignoredDirectories, StringComparer.OrdinalIgnoreCase);
    GuardListResult result = new GuardListResult();
    using (SafeFileHandle rootHandle = root.OpenDirectoryRelative(String.Empty)) {
      string canonical = root.EnsureCanonical(rootHandle);
      WalkDirectory(root, canonical, String.Empty, ignored, result, maxFiles, maxTotalBytes);
    }
    return result;
  }

  private static void WalkDirectory(
    GuardRoot root,
    string directoryPath,
    string relativeDirectory,
    HashSet<string> ignored,
    GuardListResult result,
    int maxFiles,
    long maxTotalBytes) {
    foreach (string entryPath in Directory.GetFileSystemEntries(directoryPath)) {
      string name = Path.GetFileName(entryPath);
      string relative = relativeDirectory.Length == 0 ? name : Path.Combine(relativeDirectory, name);
      FileAttributes attributes;
      try {
        attributes = File.GetAttributes(entryPath);
      } catch (FileNotFoundException) {
        continue;
      } catch (DirectoryNotFoundException) {
        continue;
      }
      if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
      if ((attributes & FileAttributes.Directory) != 0) {
        if (ignored.Contains(name)) continue;
        using (SafeFileHandle directory = OpenDirectoryHandle(entryPath)) {
          string canonical = root.EnsureCanonical(directory);
          WalkDirectory(root, canonical, relative, ignored, result, maxFiles, maxTotalBytes);
        }
        continue;
      }
      using (SafeFileHandle file = OpenFileHandle(
        entryPath,
        FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        FILE_SHARE_READ,
        OPEN_EXISTING,
        false)) {
        BY_HANDLE_FILE_INFORMATION information = GetInformation(file);
        long size = FileSize(information);
        result.totalBytes += size;
        if (maxTotalBytes > 0 && result.totalBytes > maxTotalBytes)
          throw new GuardException("limit", "工作区可快照文件超过 1 GiB，无法创建完整文件快照。");
        result.files.Add(new GuardFile { path = relative, size = size });
        if (maxFiles > 0 && result.files.Count > maxFiles)
          throw new GuardException("limit", "工作区文件数量超过限制。");
      }
    }
  }

  private static GuardApplyResult Apply(GuardRoot targetRoot, string sourceRootPath, GuardOperation[] operations) {
    GuardRoot sourceRoot = null;
    if (!String.IsNullOrWhiteSpace(sourceRootPath)) {
      sourceRoot = String.Equals(
        Path.GetFullPath(sourceRootPath),
        targetRoot.RootPath,
        StringComparison.OrdinalIgnoreCase)
        ? targetRoot
        : new GuardRoot(sourceRootPath);
    }
    GuardApplyResult result = new GuardApplyResult();
    try {
      foreach (GuardOperation operation in operations) {
        if (operation == null || String.IsNullOrWhiteSpace(operation.kind))
          throw new GuardException("protocol", "受保护文件操作缺少类型。");
        switch (operation.kind) {
          case "assert":
            AssertState(targetRoot, operation.path, operation.state);
            result.asserted++;
            break;
          case "copy":
            if (sourceRoot == null)
              throw new GuardException("protocol", "复制操作缺少来源根目录。");
            GuardCopyResult copied = CopyFile(
              sourceRoot,
              targetRoot,
              operation.sourcePath,
              operation.targetPath,
              operation.createParents,
              operation.holdMilliseconds);
            result.copied++;
            result.bytes += copied.bytes;
            result.copies.Add(copied);
            break;
          case "delete":
            if (DeleteFile(targetRoot, operation.path, operation.allowMissing, operation.holdMilliseconds))
              result.deleted++;
            break;
          default:
            throw new GuardException("protocol", "未知的受保护文件变更操作。");
        }
      }
      return result;
    } finally {
      if (sourceRoot != null && !Object.ReferenceEquals(sourceRoot, targetRoot)) sourceRoot.Dispose();
    }
  }

  private static void AssertState(GuardRoot root, string path, string state) {
    string relative = NormalizeRelativeText(path);
    bool expectedFile = state == "file";
    bool expectedMissing = state == "missing";
    if (!expectedFile && !expectedMissing && state != "file-or-missing")
      throw new GuardException("protocol", "未知的断言状态。");
    try {
      using (PinnedPath target = root.OpenParent(relative, false))
      using (SafeFileHandle handle = target.OpenFile(
        FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        FILE_SHARE_READ,
        OPEN_EXISTING,
        false)) {
        if (expectedMissing) throw new GuardException("state", "目标文件应保持缺失。");
      }
    } catch (GuardException error) {
      if (error.code == "missing" && (expectedMissing || state == "file-or-missing")) return;
      throw;
    }
  }

  private static GuardCopyResult CopyFile(
    GuardRoot sourceRoot,
    GuardRoot targetRoot,
    string sourcePath,
    string targetPath,
    bool createParents,
    int holdMilliseconds) {
    string sourceRelative = NormalizeRelativeText(sourcePath);
    string targetRelative = NormalizeRelativeText(targetPath);
    using (PinnedPath source = sourceRoot.OpenParent(sourceRelative, false))
    using (SafeFileHandle sourceHandle = source.OpenFile(
      GENERIC_READ,
      FILE_SHARE_READ,
      OPEN_EXISTING,
      false))
    using (PinnedPath target = targetRoot.OpenParent(targetRelative, createParents)) {
      BY_HANDLE_FILE_INFORMATION existingInformation = new BY_HANDLE_FILE_INFORMATION();
      bool targetExisted = false;
      try {
        using (SafeFileHandle existing = target.OpenFile(
          FILE_READ_ATTRIBUTES | SYNCHRONIZE,
          FILE_SHARE_READ,
          OPEN_EXISTING,
          false)) {
          existingInformation = GetInformation(existing);
          targetExisted = true;
        }
      } catch (GuardException error) {
        if (error.code != "missing") throw;
      }

      string targetDirectory = Path.GetDirectoryName(targetRelative);
      string temporaryName = ".mingshen-" + Guid.NewGuid().ToString("N") + ".tmp";
      string temporaryRelative = String.IsNullOrEmpty(targetDirectory)
        ? temporaryName
        : Path.Combine(targetDirectory, temporaryName);
      string sentinelName = ".mingshen-" + Guid.NewGuid().ToString("N") + ".lock";
      string sentinelRelative = String.IsNullOrEmpty(targetDirectory)
        ? sentinelName
        : Path.Combine(targetDirectory, sentinelName);
      string sourceHash;
      long bytes;
      try {
        using (PinnedPath temporary = targetRoot.OpenParent(temporaryRelative, false))
        using (PinnedPath sentinel = targetRoot.OpenParent(sentinelRelative, false))
        using (SafeFileHandle sentinelGuard = sentinel.OpenFile(
          FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
          FILE_SHARE_READ,
          CREATE_NEW,
          false,
          FILE_FLAG_DELETE_ON_CLOSE)) {
          using (SafeFileHandle temporaryHandle = temporary.OpenFile(
            GENERIC_READ | GENERIC_WRITE | DELETE | SYNCHRONIZE,
            FILE_SHARE_READ,
            CREATE_NEW,
            false))
          {
            if (holdMilliseconds > 0) Thread.Sleep(Math.Min(holdMilliseconds, 5000));
            using (FileStream input = new FileStream(sourceHandle, FileAccess.Read, 128 * 1024, false))
            using (FileStream output = new FileStream(temporaryHandle, FileAccess.ReadWrite, 128 * 1024, false)) {
              input.Position = 0;
              sourceHash = CopyAndHash(input, output);
              output.Flush(true);
              bytes = output.Length;
              output.Position = 0;
              string temporaryHash = HashStream(output);
              if (!String.Equals(sourceHash, temporaryHash, StringComparison.Ordinal))
                throw new GuardException("hash", "临时文件复制后的句柄哈希校验不一致。");
            }
          }
          using (SafeFileHandle commitGuard = temporary.OpenFile(
            FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | DELETE | SYNCHRONIZE,
            FILE_SHARE_READ | FILE_SHARE_DELETE,
            OPEN_EXISTING,
            false)) {
            if (targetExisted) {
            FILE_BASIC_INFO basic = new FILE_BASIC_INFO {
              FileAttributes = existingInformation.FileAttributes &
                ~(FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)
            };
            if (!SetFileBasicInformationByHandle(
              commitGuard,
              FILE_BASIC_INFO_CLASS,
              ref basic,
              Marshal.SizeOf(typeof(FILE_BASIC_INFO))))
              throw Win32Error(Marshal.GetLastWin32Error());
            }
            if (!MoveFileExW(
              ExtendedPath(Path.Combine(targetRoot.RootPath, temporaryRelative)),
              ExtendedPath(target.FullPath),
              MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
              throw Win32Error(Marshal.GetLastWin32Error());
          }
        }
      } catch {
        try { DeleteFile(targetRoot, temporaryRelative, true, 0); } catch { }
        throw;
      }

      using (PinnedPath committed = targetRoot.OpenParent(targetRelative, false))
      using (SafeFileHandle committedHandle = committed.OpenFile(
        GENERIC_READ,
        FILE_SHARE_READ,
        OPEN_EXISTING,
        false)) {
        using (FileStream stream = new FileStream(committedHandle, FileAccess.Read, 128 * 1024, false)) {
          string targetHash = HashStream(stream);
          if (!String.Equals(sourceHash, targetHash, StringComparison.Ordinal))
            throw new GuardException("hash", "原子替换后的目标文件哈希校验不一致。");
          return new GuardCopyResult {
            bytes = bytes,
            sourceSha256 = sourceHash,
            targetSha256 = targetHash
          };
        }
      }
    }
  }

  private static string CopyAndHash(FileStream input, FileStream output) {
    using (SHA256 hash = SHA256.Create()) {
      byte[] buffer = new byte[128 * 1024];
      int read;
      while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
        hash.TransformBlock(buffer, 0, read, null, 0);
        output.Write(buffer, 0, read);
      }
      hash.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
      return ToHex(hash.Hash);
    }
  }

  private static string HashStream(FileStream stream) {
    using (SHA256 hash = SHA256.Create()) {
      byte[] buffer = new byte[128 * 1024];
      int read;
      while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
        hash.TransformBlock(buffer, 0, read, null, 0);
      hash.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
      return ToHex(hash.Hash);
    }
  }

  private static bool DeleteFile(GuardRoot root, string path, bool allowMissing, int holdMilliseconds) {
    string relative = NormalizeRelativeText(path);
    PinnedPath target;
    try {
      target = root.OpenParent(relative, false);
    } catch (GuardException error) {
      if (allowMissing && error.code == "missing") return false;
      throw;
    }
    using (target) {
      SafeFileHandle handle;
      try {
        handle = target.OpenFile(
          DELETE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE,
          FILE_SHARE_READ,
          OPEN_EXISTING,
          false);
      } catch (GuardException error) {
        if (allowMissing && error.code == "missing") return false;
        throw;
      }
      using (handle) {
        BY_HANDLE_FILE_INFORMATION information = GetInformation(handle);
        if (holdMilliseconds > 0) Thread.Sleep(Math.Min(holdMilliseconds, 5000));
        if ((information.FileAttributes & FILE_ATTRIBUTE_READONLY) != 0) {
          uint attributes = information.FileAttributes & ~FILE_ATTRIBUTE_READONLY;
          FILE_BASIC_INFO basic = new FILE_BASIC_INFO { FileAttributes = attributes };
          if (!SetFileBasicInformationByHandle(
            handle,
            FILE_BASIC_INFO_CLASS,
            ref basic,
            Marshal.SizeOf(typeof(FILE_BASIC_INFO))))
            throw Win32Error(Marshal.GetLastWin32Error());
        }
        FILE_DISPOSITION_INFO disposition = new FILE_DISPOSITION_INFO { DeleteFile = true };
        if (!SetFileInformationByHandle(
          handle,
          FILE_DISPOSITION_INFO_CLASS,
          ref disposition,
          Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO))))
          throw Win32Error(Marshal.GetLastWin32Error());
        return true;
      }
    }
  }

  private static GuardReadResult Read(GuardRoot root, string path, long maxBytes) {
    string relative = NormalizeRelativeText(path);
    using (PinnedPath target = root.OpenParent(relative, false))
    using (SafeFileHandle handle = target.OpenFile(
      GENERIC_READ,
      FILE_SHARE_READ,
      OPEN_EXISTING,
      false)) {
      BY_HANDLE_FILE_INFORMATION information = GetInformation(handle);
      long size = FileSize(information);
      if (maxBytes > 0 && size > maxBytes)
        throw new GuardException("limit", "文件超过受保护读取上限。");
      using (FileStream stream = new FileStream(handle, FileAccess.Read, 128 * 1024, false)) {
        byte[] bytes = new byte[checked((int)size)];
        int offset = 0;
        while (offset < bytes.Length) {
          int read = stream.Read(bytes, offset, bytes.Length - offset);
          if (read == 0) throw new GuardException("changed", "文件在读取期间缩短。");
          offset += read;
        }
        if (stream.ReadByte() != -1) throw new GuardException("changed", "文件在读取期间增长。");
        using (SHA256 hash = SHA256.Create())
          return new GuardReadResult {
            data = Convert.ToBase64String(bytes),
            size = bytes.LongLength,
            sha256 = ToHex(hash.ComputeHash(bytes))
          };
      }
    }
  }

  private static GuardWriteResult Write(
    GuardRoot root,
    string path,
    string contentBase64,
    string expectedHash,
    string temporaryPath,
    string backupPath,
    bool createParents,
    int holdMilliseconds) {
    string relative = NormalizeRelativeText(path);
    if (relative.Length == 0)
      throw new GuardException("invalid-path", "写入目标不能是工作区根目录。");
    string expected = String.IsNullOrWhiteSpace(expectedHash)
      ? String.Empty
      : expectedHash.Trim();
    bool expectMissing = String.Equals(expected, "missing", StringComparison.OrdinalIgnoreCase);
    if (!expectMissing && !Sha256Pattern.IsMatch(expected))
      throw new GuardException("protocol", "写入请求必须提供 missing 或完整的 SHA-256。");
    if (contentBase64 == null || contentBase64.Length > MAX_WRITE_BASE64_CHARS)
      throw new GuardException("limit", "受保护写入内容超过 25 MiB。");

    byte[] content;
    try {
      content = Convert.FromBase64String(contentBase64);
    } catch (FormatException) {
      throw new GuardException("protocol", "受保护写入内容不是有效的 Base64。");
    }
    if (content.LongLength > MAX_WRITE_BYTES)
      throw new GuardException("limit", "受保护写入内容超过 25 MiB。");
    string contentHash = HashBytes(content);

    using (PinnedPath target = root.OpenParent(relative, createParents)) {
      SafeFileHandle existingHandle = null;
      SafeFileHandle temporaryHandle = null;
      BY_HANDLE_FILE_INFORMATION existingInformation = new BY_HANDLE_FILE_INFORMATION();
      bool backupContainsTarget = false;
      bool targetCommitted = false;
      string targetDirectory = Path.GetDirectoryName(relative);
      string temporaryRelative = NormalizeRelativeText(temporaryPath);
      string backupRelative = expectMissing ? null : NormalizeRelativeText(backupPath);
      if (!String.Equals(
        Path.GetDirectoryName(temporaryRelative) ?? String.Empty,
        targetDirectory ?? String.Empty,
        StringComparison.OrdinalIgnoreCase))
        throw new GuardException("protocol", "临时文件必须与写入目标位于同一目录。");
      if (!expectMissing && !String.Equals(
        Path.GetDirectoryName(backupRelative) ?? String.Empty,
        targetDirectory ?? String.Empty,
        StringComparison.OrdinalIgnoreCase))
        throw new GuardException("protocol", "备份文件必须与写入目标位于同一目录。");

      try {
        if (expectMissing) {
          try {
            using (SafeFileHandle unexpected = target.OpenFile(
              FILE_READ_ATTRIBUTES | SYNCHRONIZE,
              FILE_SHARE_READ,
              OPEN_EXISTING,
              false))
              throw new GuardException("exists", "目标文件已存在，拒绝创建覆盖。");
          } catch (GuardException error) {
            if (error.code != "missing") throw;
          }
        } else {
          try {
            existingHandle = target.OpenFile(
              GENERIC_READ | DELETE | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE,
              FILE_SHARE_READ,
              OPEN_EXISTING,
              false);
          } catch (GuardException error) {
            throw new GuardException(error.code, "无法锁定当前目标：" + error.Message);
          }
          existingInformation = GetInformation(existingHandle);
          string currentHash = HashHandle(existingHandle, FileSize(existingInformation));
          if (!String.Equals(currentHash, expected, StringComparison.OrdinalIgnoreCase))
            throw new GuardException(
              "conflict",
              "EXTERNAL_FILE_CHANGED: 文件已被其他程序修改，期望哈希与当前内容不一致；本次写入未执行。");
        }

        using (PinnedPath temporary = root.OpenParent(temporaryRelative, false)) {
          try {
            temporaryHandle = temporary.OpenFile(
              GENERIC_READ | GENERIC_WRITE | DELETE | SYNCHRONIZE,
              FILE_SHARE_READ,
              CREATE_NEW,
              false);
          } catch (GuardException error) {
            throw new GuardException(error.code, "无法创建受保护临时文件：" + error.Message);
          }
          WriteBytes(temporaryHandle, content);
          BY_HANDLE_FILE_INFORMATION temporaryInformation = GetInformation(temporaryHandle);
          if (FileSize(temporaryInformation) != content.LongLength)
            throw new GuardException("hash", "临时文件长度校验不一致。");
          string temporaryHash = HashHandle(temporaryHandle, content.LongLength);
          if (!String.Equals(temporaryHash, contentHash, StringComparison.Ordinal))
            throw new GuardException("hash", "临时文件写入后的哈希校验不一致。");

          if (!expectMissing) {
            FILE_BASIC_INFO basic = new FILE_BASIC_INFO {
              FileAttributes = existingInformation.FileAttributes &
                ~(FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)
            };
            if (!SetFileBasicInformationByHandle(
              temporaryHandle,
              FILE_BASIC_INFO_CLASS,
              ref basic,
              Marshal.SizeOf(typeof(FILE_BASIC_INFO))))
              throw Win32Error(Marshal.GetLastWin32Error());
          }

          if (holdMilliseconds > 0) Thread.Sleep(Math.Min(holdMilliseconds, 5000));
          try {
            if (!expectMissing) {
              try {
                RenameByHandle(
                  existingHandle,
                  Path.Combine(root.RootPath, backupRelative),
                  false);
              } catch (GuardException error) {
                throw new GuardException(error.code, "无法暂存当前目标：" + error.Message);
              }
              backupContainsTarget = true;
              SleepCommitGapForTest();
            }
            try {
              RenameByHandle(temporaryHandle, target.FullPath, false);
            } catch (GuardException error) {
              throw new GuardException(error.code, "无法提交受保护写入：" + error.Message);
            }
            targetCommitted = true;
            SleepAfterCommitGapForTest();
            string committedHash;
            try {
              committedHash = EnsureCommittedTarget(
                target,
                temporaryHandle,
                temporaryInformation,
                content.LongLength);
            } catch (GuardException error) {
              throw new GuardException(error.code, "无法验证已提交目标：" + error.Message);
            }
            if (!String.Equals(committedHash, contentHash, StringComparison.Ordinal))
              throw new GuardException("hash", "提交后的目标文件哈希校验不一致。");
            if (backupContainsTarget) {
              try {
                MarkForDeletion(existingHandle, existingInformation.FileAttributes);
              } catch (GuardException error) {
                throw new GuardException(error.code, "无法清理旧目标备份：" + error.Message);
              }
              backupContainsTarget = false;
            }
          } catch (Exception commitError) {
            GuardException rollbackFailure = null;
            if (targetCommitted) {
              try {
                RenameByHandle(temporaryHandle, temporary.FullPath, false);
                targetCommitted = false;
                SetDeleteOnClose(temporaryHandle);
              } catch (Exception rollbackError) {
                rollbackFailure = new GuardException(
                  "conflict",
                  "写入提交失败且无法撤回新文件：" + rollbackError.Message);
              }
            } else {
              try { SetDeleteOnClose(temporaryHandle); } catch { }
            }

            if (backupContainsTarget) {
              try {
                RenameByHandle(existingHandle, target.FullPath, false);
                backupContainsTarget = false;
              } catch (Exception restoreError) {
                throw new GuardException(
                  "conflict",
                  "写入提交失败且目标路径已被占用；旧文件保留在 " +
                  backupRelative + "：" + restoreError.Message);
              }
            }
            if (rollbackFailure != null) throw rollbackFailure;
            throw commitError;
          }
        }

        return new GuardWriteResult {
          size = content.LongLength,
          sha256 = contentHash
        };
      } finally {
        if (temporaryHandle != null) temporaryHandle.Dispose();
        if (existingHandle != null) existingHandle.Dispose();
      }
    }
  }

  private static GuardRecoveryResult RecoverWrite(
    GuardRoot root,
    string path,
    string temporaryPath,
    string backupPath,
    string expectedHash,
    string replacementHash) {
    string relative = NormalizeRelativeText(path);
    string temporaryRelative = NormalizeRelativeText(temporaryPath);
    string backupRelative = NormalizeRelativeText(backupPath);
    string expected = String.IsNullOrWhiteSpace(expectedHash)
      ? String.Empty
      : expectedHash.Trim();
    string replacement = String.IsNullOrWhiteSpace(replacementHash)
      ? String.Empty
      : replacementHash.Trim();
    bool expectMissing = String.Equals(expected, "missing", StringComparison.OrdinalIgnoreCase);
    if (!expectMissing && !Sha256Pattern.IsMatch(expected))
      throw new GuardException("protocol", "恢复请求缺少有效的原文件 SHA-256。");
    if (!Sha256Pattern.IsMatch(replacement))
      throw new GuardException("protocol", "恢复请求缺少有效的新文件 SHA-256。");
    string targetDirectory = Path.GetDirectoryName(relative) ?? String.Empty;
    if (!String.Equals(Path.GetDirectoryName(temporaryRelative) ?? String.Empty,
          targetDirectory, StringComparison.OrdinalIgnoreCase) ||
        !String.Equals(Path.GetDirectoryName(backupRelative) ?? String.Empty,
          targetDirectory, StringComparison.OrdinalIgnoreCase))
      throw new GuardException("protocol", "恢复文件必须与写入目标位于同一目录。");

    using (RecoveryFile target = new RecoveryFile(root, relative))
    using (RecoveryFile temporary = new RecoveryFile(root, temporaryRelative))
    using (RecoveryFile backup = new RecoveryFile(root, backupRelative)) {
      if (expectMissing) {
        if (target.Exists && String.Equals(target.Hash, replacement, StringComparison.Ordinal))
          MarkForDeletion(target.Handle, target.Information.FileAttributes);
        if (temporary.Exists &&
            String.Equals(temporary.Hash, replacement, StringComparison.Ordinal))
          MarkForDeletion(temporary.Handle, temporary.Information.FileAttributes);
        return new GuardRecoveryResult {
          state = !target.Exists ||
            String.Equals(target.Hash, replacement, StringComparison.Ordinal)
            ? "restored"
            : "preserved",
          backupPath = backupRelative
        };
      }

      if (target.Exists &&
          String.Equals(target.Hash, expected, StringComparison.Ordinal)) {
        if (temporary.Exists &&
            String.Equals(temporary.Hash, replacement, StringComparison.Ordinal))
          MarkForDeletion(temporary.Handle, temporary.Information.FileAttributes);
        if (backup.Exists &&
            String.Equals(backup.Hash, expected, StringComparison.Ordinal))
          MarkForDeletion(backup.Handle, backup.Information.FileAttributes);
        return new GuardRecoveryResult {
          state = backup.Exists &&
            !String.Equals(backup.Hash, expected, StringComparison.Ordinal)
            ? "preserved"
            : "clean",
          backupPath = backupRelative
        };
      }

      if (!target.Exists &&
          backup.Exists &&
          String.Equals(backup.Hash, expected, StringComparison.Ordinal)) {
        if (temporary.Exists &&
            String.Equals(temporary.Hash, replacement, StringComparison.Ordinal))
          MarkForDeletion(temporary.Handle, temporary.Information.FileAttributes);
        RenameByHandle(backup.Handle, target.Parent.FullPath, false);
        return new GuardRecoveryResult {
          state = "restored",
          backupPath = backupRelative
        };
      }

      if (target.Exists &&
          String.Equals(target.Hash, replacement, StringComparison.Ordinal) &&
          backup.Exists &&
          String.Equals(backup.Hash, expected, StringComparison.Ordinal)) {
        if (temporary.Exists &&
            String.Equals(temporary.Hash, replacement, StringComparison.Ordinal))
          MarkForDeletion(temporary.Handle, temporary.Information.FileAttributes);
        string scratchRelative = SiblingRelative(
          targetDirectory,
          ".mh-cas-recovery-" + Guid.NewGuid().ToString("N").Substring(0, 16) + ".tmp");
        PinnedPath scratch = root.OpenParent(scratchRelative, false);
        using (scratch) {
          RenameByHandle(target.Handle, scratch.FullPath, false);
          try {
            RenameByHandle(backup.Handle, target.Parent.FullPath, false);
          } catch (Exception restoreError) {
            try { RenameByHandle(target.Handle, target.Parent.FullPath, false); }
            catch { }
            throw new GuardException(
              "recovery",
              "恢复旧文件失败，新文件临时保存在 " + scratchRelative + "：" +
              restoreError.Message);
          }
          MarkForDeletion(target.Handle, target.Information.FileAttributes);
        }
        return new GuardRecoveryResult {
          state = "restored",
          backupPath = backupRelative
        };
      }

      if (target.Exists) {
        if (temporary.Exists &&
            String.Equals(temporary.Hash, replacement, StringComparison.Ordinal))
          MarkForDeletion(temporary.Handle, temporary.Information.FileAttributes);
        return new GuardRecoveryResult {
          state = "preserved",
          backupPath = backupRelative
        };
      }

      if (temporary.Exists &&
          String.Equals(temporary.Hash, replacement, StringComparison.Ordinal))
        MarkForDeletion(temporary.Handle, temporary.Information.FileAttributes);
      return new GuardRecoveryResult {
        state = backup.Exists ? "preserved" : "missing",
        backupPath = backupRelative
      };
    }
  }

  private static void WriteBytes(SafeFileHandle handle, byte[] content) {
    long position;
    if (!SetFilePointerEx(handle, 0, out position, 0))
      throw Win32Error(Marshal.GetLastWin32Error());
    uint written;
    if (!WriteFile(
      handle,
      content,
      checked((uint)content.LongLength),
      out written,
      IntPtr.Zero))
      throw Win32Error(Marshal.GetLastWin32Error());
    if (written != content.LongLength)
      throw new GuardException("io", "临时文件未完整写入。");
    if (!FlushFileBuffers(handle))
      throw Win32Error(Marshal.GetLastWin32Error());
  }

  private static string HashHandle(SafeFileHandle handle, long expectedSize) {
    if (expectedSize < 0) throw new GuardException("io", "文件长度无效。");
    long position;
    if (!SetFilePointerEx(handle, 0, out position, 0))
      throw Win32Error(Marshal.GetLastWin32Error());
    using (SHA256 hash = SHA256.Create()) {
      byte[] buffer = new byte[128 * 1024];
      long remaining = expectedSize;
      while (remaining > 0) {
        uint requested = checked((uint)Math.Min((long)buffer.Length, remaining));
        uint read;
        if (!ReadFile(handle, buffer, requested, out read, IntPtr.Zero))
          throw Win32Error(Marshal.GetLastWin32Error());
        if (read == 0) throw new GuardException("changed", "文件在读取期间缩短。");
        hash.TransformBlock(buffer, 0, checked((int)read), null, 0);
        remaining -= read;
      }
      uint extra;
      if (!ReadFile(handle, buffer, 1, out extra, IntPtr.Zero))
        throw Win32Error(Marshal.GetLastWin32Error());
      if (extra != 0) throw new GuardException("changed", "文件在读取期间增长。");
      hash.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
      return ToHex(hash.Hash);
    }
  }

  private static string HashBytes(byte[] content) {
    using (SHA256 hash = SHA256.Create()) return ToHex(hash.ComputeHash(content));
  }

  private static string SiblingRelative(string directory, string name) {
    return String.IsNullOrEmpty(directory) ? name : Path.Combine(directory, name);
  }

  private static void SetDeleteOnClose(SafeFileHandle handle) {
    FILE_DISPOSITION_INFO disposition = new FILE_DISPOSITION_INFO { DeleteFile = true };
    if (!SetFileInformationByHandle(
      handle,
      FILE_DISPOSITION_INFO_CLASS,
      ref disposition,
      Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO))))
      throw Win32Error(Marshal.GetLastWin32Error());
  }

  private static void MarkForDeletion(SafeFileHandle handle, uint fileAttributes) {
    if ((fileAttributes & FILE_ATTRIBUTE_READONLY) != 0) {
      FILE_BASIC_INFO basic = new FILE_BASIC_INFO {
        FileAttributes = fileAttributes & ~FILE_ATTRIBUTE_READONLY
      };
      if (!SetFileBasicInformationByHandle(
        handle,
        FILE_BASIC_INFO_CLASS,
        ref basic,
        Marshal.SizeOf(typeof(FILE_BASIC_INFO))))
        throw Win32Error(Marshal.GetLastWin32Error());
    }
    SetDeleteOnClose(handle);
  }

  private static void SleepCommitGapForTest() {
    string raw = Environment.GetEnvironmentVariable(
      "MINGSHEN_GUARDED_WRITE_TEST_GAP_MS");
    int delay;
    if (!String.IsNullOrWhiteSpace(raw) &&
        Int32.TryParse(raw, out delay) &&
        delay > 0)
      Thread.Sleep(Math.Min(delay, 5000));
  }

  private static void SleepAfterCommitGapForTest() {
    string raw = Environment.GetEnvironmentVariable(
      "MINGSHEN_GUARDED_WRITE_TEST_AFTER_COMMIT_GAP_MS");
    int delay;
    if (!String.IsNullOrWhiteSpace(raw) &&
        Int32.TryParse(raw, out delay) &&
        delay > 0)
      Thread.Sleep(Math.Min(delay, 5000));
  }

  private static string EnsureCommittedTarget(
    PinnedPath target,
    SafeFileHandle ownerHandle,
    BY_HANDLE_FILE_INFORMATION expectedIdentity,
    long expectedSize) {
    string canonicalExpected = ExtendedPath(Path.GetFullPath(target.FullPath));
    string ownerPath = GetCanonicalPath(ownerHandle);
    if (!String.Equals(ownerPath, canonicalExpected, StringComparison.OrdinalIgnoreCase))
      throw new GuardException("identity", "提交后的文件路径与请求目标不一致：" + ownerPath);

    using (SafeFileHandle pathHandle = target.OpenFile(
      GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      OPEN_EXISTING,
      false)) {
      BY_HANDLE_FILE_INFORMATION actualIdentity = GetInformation(pathHandle);
      if (actualIdentity.VolumeSerialNumber != expectedIdentity.VolumeSerialNumber ||
          actualIdentity.FileIndexHigh != expectedIdentity.FileIndexHigh ||
          actualIdentity.FileIndexLow != expectedIdentity.FileIndexLow)
        throw new GuardException("identity", "请求目标路径与已提交句柄指向不同文件。");
      if (FileSize(actualIdentity) != expectedSize)
        throw new GuardException("hash", "请求目标路径上的文件长度校验不一致。");
      string reopenedPath = GetCanonicalPath(pathHandle);
      if (!String.Equals(reopenedPath, canonicalExpected, StringComparison.OrdinalIgnoreCase))
        throw new GuardException("identity", "重新打开的目标路径与请求路径不一致：" + reopenedPath);
      return HashHandle(pathHandle, expectedSize);
    }
  }

  private static void RenameByHandle(SafeFileHandle handle, string destination, bool replace) {
    string fullDestination = Path.GetFullPath(destination);
    if (fullDestination.StartsWith(@"\\", StringComparison.Ordinal))
      throw new GuardException("unsupported-path", "重命名目标不能是网络或设备路径。");
    byte[] name = System.Text.Encoding.Unicode.GetBytes(fullDestination);
    int fileNameOffset = IntPtr.Size == 8 ? 20 : 12;
    int bufferSize = checked(fileNameOffset + name.Length + sizeof(char));
    IntPtr buffer = Marshal.AllocHGlobal(bufferSize);
    try {
      for (int index = 0; index < bufferSize; index++) Marshal.WriteByte(buffer, index, 0);
      Marshal.WriteByte(buffer, 0, replace ? (byte)1 : (byte)0);
      Marshal.WriteIntPtr(buffer, IntPtr.Size == 8 ? 8 : 4, IntPtr.Zero);
      Marshal.WriteInt32(buffer, IntPtr.Size == 8 ? 16 : 8, name.Length);
      Marshal.Copy(name, 0, new IntPtr(buffer.ToInt64() + fileNameOffset), name.Length);
      Marshal.WriteInt16(buffer, fileNameOffset + name.Length, 0);
      if (!SetFileRenameInformationByHandle(
        handle,
        FILE_RENAME_INFO_CLASS,
        buffer,
        bufferSize))
        throw Win32Error(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }

  private static GuardStatResult Stat(GuardRoot root, string path) {
    string relative = NormalizeRelativeText(path);
    try {
      using (PinnedPath target = root.OpenParent(relative, false)) {
        using (SafeFileHandle handle = target.OpenFile(
          FILE_READ_ATTRIBUTES | SYNCHRONIZE,
          FILE_SHARE_READ,
          OPEN_EXISTING,
          true)) {
          BY_HANDLE_FILE_INFORMATION information = GetInformation(handle);
          return new GuardStatResult {
            state = "file",
            directory = true,
            size = FileSize(information)
          };
        }
      }
    } catch (GuardException directoryError) {
      if (directoryError.code != "type") {
        if (directoryError.code == "missing")
          return new GuardStatResult { state = "missing", directory = false, size = 0 };
        throw;
      }
    }
    using (PinnedPath target = root.OpenParent(relative, false))
    using (SafeFileHandle handle = target.OpenFile(
      FILE_READ_ATTRIBUTES | SYNCHRONIZE,
      FILE_SHARE_READ,
      OPEN_EXISTING,
      false)) {
      BY_HANDLE_FILE_INFORMATION information = GetInformation(handle);
      return new GuardStatResult {
        state = "file",
        directory = false,
        size = FileSize(information)
      };
    }
  }

  private static List<GuardEntry> ListDirectory(GuardRoot root, string path) {
    string relative = NormalizeRelativeText(path);
    using (PinnedPath target = root.OpenParent(relative, false))
    using (SafeFileHandle handle = target.OpenFile(
      FILE_READ_ATTRIBUTES | SYNCHRONIZE,
      FILE_SHARE_READ,
      OPEN_EXISTING,
      true)) {
      string canonical = root.EnsureCanonical(handle);
      List<GuardEntry> entries = new List<GuardEntry>();
      foreach (string entry in Directory.GetFileSystemEntries(canonical)) {
        FileAttributes attributes;
        try {
          attributes = File.GetAttributes(entry);
        } catch (FileNotFoundException) {
          continue;
        } catch (DirectoryNotFoundException) {
          continue;
        }
        bool directory = (attributes & FileAttributes.Directory) != 0;
        bool reparse = (attributes & FileAttributes.ReparsePoint) != 0;
        long size = 0;
        if (!directory && !reparse) {
          try {
            using (SafeFileHandle file = OpenFileHandle(
              entry,
              FILE_READ_ATTRIBUTES | SYNCHRONIZE,
              FILE_SHARE_READ,
              OPEN_EXISTING,
              false))
              size = FileSize(GetInformation(file));
          } catch (GuardException error) {
            if (error.code != "missing") throw;
            continue;
          }
        }
        entries.Add(new GuardEntry {
          name = Path.GetFileName(entry),
          directory = directory,
          reparse = reparse,
          size = size
        });
      }
      return entries;
    }
  }

  private static SafeFileHandle OpenDirectoryHandle(string path) {
    return OpenFileHandle(
      path,
      FILE_READ_ATTRIBUTES | SYNCHRONIZE,
      FILE_SHARE_READ,
      OPEN_EXISTING,
      true);
  }

  private static SafeFileHandle OpenFileHandle(
    string path,
    uint access,
    uint share,
    uint creation,
    bool directory) {
    uint flags = FILE_FLAG_OPEN_REPARSE_POINT;
    if (directory) flags |= FILE_FLAG_BACKUP_SEMANTICS;
    SafeFileHandle handle = CreateFileW(
      ExtendedPath(path),
      access,
      share,
      IntPtr.Zero,
      creation,
      flags,
      IntPtr.Zero);
    if (handle.IsInvalid) {
      int code = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw Win32Error(code);
    }
    try {
      BY_HANDLE_FILE_INFORMATION information = GetInformation(handle);
      if ((information.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
        throw new GuardException("reparse", "文件路径经过符号链接或目录链接。");
      bool isDirectory = (information.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
      if (isDirectory != directory)
        throw new GuardException("type", directory ? "目标不是目录。" : "目标不是普通文件。");
      EnsureNotHardLinked(information, isDirectory);
      return handle;
    } catch {
      handle.Dispose();
      throw;
    }
  }

  private static BY_HANDLE_FILE_INFORMATION GetInformation(SafeFileHandle handle) {
    BY_HANDLE_FILE_INFORMATION information;
    if (!GetFileInformationByHandle(handle, out information))
      throw Win32Error(Marshal.GetLastWin32Error());
    return information;
  }

  private static void EnsureNotHardLinked(BY_HANDLE_FILE_INFORMATION information, bool directory) {
    if (!directory && information.NumberOfLinks > 1)
      throw new GuardException("hardlink", "文件是硬链接，受保护操作已拒绝。");
  }

  private static long FileSize(BY_HANDLE_FILE_INFORMATION information) {
    return ((long)information.FileSizeHigh << 32) | information.FileSizeLow;
  }

  private static string GetCanonicalPath(SafeFileHandle handle) {
    System.Text.StringBuilder path = new System.Text.StringBuilder(32768);
    uint written = GetFinalPathNameByHandleW(handle, path, (uint)path.Capacity, 0);
    if (written == 0) throw Win32Error(Marshal.GetLastWin32Error());
    if (written >= path.Capacity) {
      path = new System.Text.StringBuilder(checked((int)written + 1));
      written = GetFinalPathNameByHandleW(handle, path, (uint)path.Capacity, 0);
      if (written == 0 || written >= path.Capacity)
        throw Win32Error(Marshal.GetLastWin32Error());
    }
    return path.ToString();
  }

  private static string[] NormalizeRelative(string path) {
    string normalized = NormalizeRelativeText(path);
    if (normalized.Length == 0) return new string[0];
    return normalized.Split('\\');
  }

  private static string NormalizeRelativeText(string path) {
    if (path == null) throw new GuardException("invalid-path", "文件路径不能为空。");
    if (path.Length == 0) return String.Empty;
    if (path.IndexOf('\0') >= 0 || Path.IsPathRooted(path))
      throw new GuardException("invalid-path", "文件路径必须是工作区内的相对路径。");
    string normalized = path.Replace('/', '\\');
    string[] parts = normalized.Split('\\');
    foreach (string part in parts) {
      if (part.Length == 0 || part == "." || part == "..")
        throw new GuardException("invalid-path", "文件路径包含不安全的相对段。");
      if (part.IndexOf(':') >= 0 || part.EndsWith(".", StringComparison.Ordinal) ||
          part.EndsWith(" ", StringComparison.Ordinal) || ReservedName.IsMatch(part))
        throw new GuardException("invalid-path", "文件路径包含不安全的 Windows 路径段。");
      foreach (char character in part)
        if (character < 32) throw new GuardException("invalid-path", "文件路径包含控制字符。");
      if (part.Equals(".git", StringComparison.OrdinalIgnoreCase))
        throw new GuardException("invalid-path", "文件路径指向 Git 元数据。");
    }
    return String.Join("\\", parts);
  }

  private static string ExtendedPath(string path) {
    if (path.StartsWith(@"\\?\", StringComparison.Ordinal)) return path;
    if (path.StartsWith(@"\\", StringComparison.Ordinal))
      throw new GuardException("unsupported-path", "不支持网络或设备路径。");
    return @"\\?\" + Path.GetFullPath(path);
  }

  private static GuardException Win32Error(int code) {
    if (code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND)
      return new GuardException("missing", "找不到路径。");
    if (code == ERROR_ACCESS_DENIED)
      return new GuardException("access", "拒绝访问受保护路径。");
    if (code == ERROR_SHARING_VIOLATION || code == ERROR_LOCK_VIOLATION)
      return new GuardException("sharing", "路径正被其他程序占用或替换。");
    if (code == ERROR_FILE_EXISTS || code == ERROR_ALREADY_EXISTS)
      return new GuardException("exists", "目标文件已存在。");
    return new GuardException("win32", new Win32Exception(code).Message);
  }

  private static GuardException MapIoError(Exception error) {
    if (error is FileNotFoundException || error is DirectoryNotFoundException)
      return new GuardException("missing", "找不到路径。");
    if (error is UnauthorizedAccessException)
      return new GuardException("access", "拒绝访问受保护路径。");
    if (error is IOException)
      return new GuardException("io", error.Message);
    return new GuardException("io", error.Message);
  }

  private static string ToHex(byte[] bytes) {
    System.Text.StringBuilder builder = new System.Text.StringBuilder(bytes.Length * 2);
    foreach (byte value in bytes) builder.Append(value.ToString("x2"));
    return builder.ToString();
  }

  private static void DisposeAll(List<SafeFileHandle> handles) {
    for (int index = handles.Count - 1; index >= 0; index--) handles[index].Dispose();
    handles.Clear();
  }
}
`;

interface GuardResponse {
  id: string | null;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PendingLine {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

let guardedIoFailure: Error | null = null;
let shuttingDown = false;
let shutdownEpoch = 0;
let shutdownPromise: Promise<void> | null = null;

class GuardedIoWorker {
  private readonly child;
  private readonly lines: string[] = [];
  private readonly pending: PendingLine[] = [];
  private readonly exitPromise: Promise<void>;
  private ready = false;
  private closed = false;
  private spawned = false;
  private stopPromise: Promise<void> | null = null;
  private protocolFailure: Error | null = null;
  private stderr = "";
  private idleTimer: NodeJS.Timeout | null = null;

  get isClosed(): boolean {
    return this.closed;
  }

  get isStopping(): boolean {
    return this.stopPromise !== null;
  }

  constructor() {
    const source = Buffer.from(GUARDED_IO_SOURCE, "utf8").toString("base64");
    const command = Buffer.from(POWERSHELL_BOOTSTRAP, "utf16le").toString("base64");
    this.child = spawn(
      WINDOWS_POWERSHELL,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", command],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child.once("spawn", () => {
      this.spawned = true;
    });
    this.exitPromise = new Promise((resolve) => {
      this.child.once("exit", () => {
        this.closed = true;
        this.rejectPending(new Error("受保护文件守护进程已退出。"));
        resolve();
      });
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-MAX_STDERR_CHARS);
    });
    const reader = createInterface({ input: this.child.stdout });
    reader.on("line", (line) => this.acceptLine(line));
    reader.on("error", (error) => {
      this.rejectPending(new Error(`受保护文件守护进程输出失败：${error.message}`));
      void this.stop().catch(() => undefined);
    });
    this.child.once("error", (error) => {
      if (!this.spawned) {
        this.closed = true;
        this.rejectPending(new Error(`无法启动受保护文件守护进程：${error.message}`));
        return;
      }
      this.rejectPending(new Error(`受保护文件守护进程运行失败：${error.message}`));
      void this.stop().catch(() => undefined);
    });
    this.child.stdin.once("error", (error) => {
      this.rejectPending(new Error(`受保护文件守护进程输入失败：${error.message}`));
      void this.stop().catch(() => undefined);
    });
    this.child.stdin.write(`${source}\n`);
    this.child.unref();
    (this.child.stdin as unknown as { unref?: () => void }).unref?.();
    (this.child.stdout as unknown as { unref?: () => void }).unref?.();
    (this.child.stderr as unknown as { unref?: () => void }).unref?.();
  }

  async readyPromise(signal: AbortSignal, timeoutMs: number): Promise<void> {
    const readyLine = await this.nextLine(timeoutMs, signal);
    if (readyLine !== "READY") throw this.protocolError(`启动响应无效：${readyLine.slice(0, 200)}`);
    this.ready = true;
  }

  async send(request: object, signal: AbortSignal, timeoutMs: number): Promise<GuardResponse> {
    if (signal.aborted) throw abortError();
    if (timeoutMs <= 0) throw new Error("受保护文件操作超过整体期限。");
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.ready) throw new Error("受保护文件守护进程尚未就绪。");
    if (this.closed) throw new Error("受保护文件守护进程已退出。");
    const json = JSON.stringify(request);
    if (json.length > MAX_REQUEST_CHARS) throw new Error("受保护文件请求超过大小上限。");
    const id = (request as { id?: unknown }).id;
    if (typeof id !== "string" || !id) throw new Error("受保护文件请求缺少 id。");
    this.child.stdin.write(`${json}\n`);
    const line = await this.nextLine(timeoutMs, signal);
    let response: GuardResponse;
    try {
      response = JSON.parse(line) as GuardResponse;
    } catch {
      return this.failSend("受保护文件守护进程返回了无效 JSON。");
    }
    if (response.id !== id) await this.failSend("受保护文件守护进程返回了不匹配的请求 id。");
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (this.protocolFailure) {
      await this.stop().catch(() => undefined);
      throw this.protocolFailure;
    }
    if (!response.ok) throw new Error(response.error || "受保护文件操作失败。");
    return response;
  }

  scheduleIdleStop(timeoutMs = WORKER_IDLE_TIMEOUT_MS): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.stop().catch(() => undefined);
    }, timeoutMs);
    this.idleTimer.unref();
  }

  async stop(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopOnce();
    try {
      await this.stopPromise;
    } catch (error) {
      guardedIoFailure = error instanceof Error ? error : new Error(String(error));
      throw guardedIoFailure;
    }
  }

  private async stopOnce(): Promise<void> {
    if (this.closed) return;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.child.stdin.end();
    this.child.kill();
    let exited = await Promise.race([
      this.exitPromise.then(() => true),
      new Promise<false>((resolve) => {
        const timer = setTimeout(() => resolve(false), WORKER_STOP_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    if (!exited && this.child.pid) {
      const taskkill = process.env.SystemRoot
        ? join(process.env.SystemRoot, "System32", "taskkill.exe")
        : "taskkill.exe";
      const killer = spawn(taskkill, ["/PID", String(this.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, WORKER_STOP_TIMEOUT_MS);
        const finish = () => {
          clearTimeout(timer);
          resolve();
        };
        killer.once("close", finish);
        killer.once("error", finish);
        timer.unref();
      });
      exited = await Promise.race([
        this.exitPromise.then(() => true),
        new Promise<false>((resolve) => {
          const timer = setTimeout(() => resolve(false), WORKER_STOP_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    }
    if (!exited) throw new Error("无法确认受保护文件守护进程已退出，后续操作已阻断。");
  }

  private acceptLine(line: string): void {
    if (line.length > MAX_PROTOCOL_LINE_CHARS) {
      this.failProtocol("受保护文件守护进程输出超过单行上限。");
      return;
    }
    const waiter = this.pending.shift();
    if (!waiter) {
      this.failProtocol("受保护文件守护进程返回了多余的输出。");
      return;
    }
    clearTimeout(waiter.timeout);
    waiter.resolve(line);
  }

  private nextLine(timeoutMs: number, signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(abortError());
    const queued = this.lines.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.reject(new Error(this.stderr || "受保护文件守护进程已退出。"));
    return new Promise((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const failAfterStop = (error: Error) => {
        void this.stop()
          .catch((stopError: unknown) => {
            error.message = `${error.message} ${String(stopError)}`;
          })
          .finally(() => {
            cleanup();
            reject(error);
          });
      };
      const waiter: PendingLine = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.removePending(waiter);
          failAfterStop(new Error("受保护文件操作超过整体期限。"));
        }, timeoutMs),
      };
      const onAbort = () => {
        this.removePending(waiter);
        failAfterStop(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const originalResolve = waiter.resolve;
      const originalReject = waiter.reject;
      waiter.resolve = (line) => {
        cleanup();
        originalResolve(line);
      };
      waiter.reject = (error) => {
        cleanup();
        originalReject(error);
      };
      this.pending.push(waiter);
    });
  }

  private removePending(waiter: PendingLine): void {
    clearTimeout(waiter.timeout);
    const index = this.pending.indexOf(waiter);
    if (index >= 0) this.pending.splice(index, 1);
  }

  private rejectPending(error: Error): void {
    for (const waiter of this.pending.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  }

  private failProtocol(message: string): void {
    this.protocolFailure = this.protocolError(message);
    this.rejectPending(this.protocolFailure);
    void this.stop().catch(() => undefined);
  }

  private async failSend(message: string): Promise<never> {
    const error = this.protocolError(message);
    this.protocolFailure = error;
    this.rejectPending(error);
    await this.stop().catch(() => undefined);
    throw error;
  }

  private protocolError(message: string): Error {
    const detail = this.stderr.trim();
    return new Error(detail ? `${message}\n${detail}` : message);
  }
}

let worker: GuardedIoWorker | null = null;
let requestTail: Promise<void> = Promise.resolve();

function abortError(): Error {
  const error = new Error("受保护文件操作已取消。");
  error.name = "AbortError";
  return error;
}

function assertRequestActive(requestEpoch: number): void {
  if (shuttingDown) throw new Error("受保护文件服务正在关闭。");
  if (requestEpoch !== shutdownEpoch) throw new Error("受保护文件服务已停止，排队操作未执行。");
}

async function getWorker(
  requestEpoch: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<GuardedIoWorker> {
  assertRequestActive(requestEpoch);
  if (guardedIoFailure) throw guardedIoFailure;
  if (signal.aborted) throw abortError();
  if (worker && !worker.isClosed && !worker.isStopping) return worker;
  if (worker) {
    const stale = worker;
    worker = null;
    await stale.stop();
    assertRequestActive(requestEpoch);
  }
  assertRequestActive(requestEpoch);
  const created = new GuardedIoWorker();
  worker = created;
  try {
    await created.readyPromise(signal, Math.min(timeoutMs, WORKER_START_TIMEOUT_MS));
    assertRequestActive(requestEpoch);
    return created;
  } catch (error) {
    if (worker === created) worker = null;
    await created.stop();
    throw error;
  }
}

async function runRequest<T>(
  request: Omit<Record<string, unknown>, "id">,
  options: GuardedIoOptions = {},
): Promise<T> {
  const requestEpoch = shutdownEpoch;
  if (shuttingDown) return Promise.reject(new Error("受保护文件服务正在关闭。"));
  const operation = requestTail.then(async () => {
    assertRequestActive(requestEpoch);
    if (guardedIoFailure) throw guardedIoFailure;
    const signal = options.signal ?? new AbortController().signal;
    if (signal.aborted) throw abortError();
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const active = await getWorker(requestEpoch, signal, timeoutMs);
    assertRequestActive(requestEpoch);
    if (signal.aborted) throw abortError();
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await active.stop();
      throw new Error("受保护文件操作超过整体期限。");
    }
    const id = randomUUID();
    try {
      const response = await active.send({ ...request, id }, signal, remaining);
      return response.result as T;
    } catch (error) {
      if (
        worker === active &&
        (signal.aborted ||
          active.isClosed ||
          active.isStopping ||
          (error instanceof Error && /超过整体期限|守护进程/.test(error.message)))
      ) {
        if (worker === active) worker = null;
      }
      throw error;
    } finally {
      active.scheduleIdleStop(options.idleTimeoutMs);
    }
  });
  requestTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export interface GuardedIoOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface GuardedWriteOptions extends GuardedIoOptions {
  createParents?: boolean;
  holdMilliseconds?: number;
}

export interface GuardedFileInspection {
  path: string;
  state: "file" | "missing";
  size: number;
}

export interface GuardedWorkspaceFile {
  path: string;
  size: number;
}

export interface GuardedOperation {
  kind: "assert" | "copy" | "delete";
  path?: string;
  sourcePath?: string;
  targetPath?: string;
  state?: "file" | "missing" | "file-or-missing";
  createParents?: boolean;
  allowMissing?: boolean;
  holdMilliseconds?: number;
}

export interface GuardedApplyResult {
  copied: number;
  deleted: number;
  asserted: number;
  bytes: number;
  copies: Array<{
    bytes: number;
    sourceSha256: string;
    targetSha256: string;
  }>;
}

export interface GuardedStatResult {
  state: "file" | "missing";
  directory: boolean;
  size: number;
}

export interface GuardedDirectoryEntry {
  name: string;
  directory: boolean;
  reparse: boolean;
  size: number;
}

const MAX_GUARDED_WRITE_BYTES = 25 * 1024 * 1024;

function assertWindows(): void {
  if (process.platform !== "win32") throw new Error("受保护的句柄级文件操作仅支持 Windows。");
}

export async function inspectGuardedPaths(
  root: string,
  paths: string[],
  options: GuardedIoOptions = {},
): Promise<GuardedFileInspection[]> {
  assertWindows();
  return runRequest<GuardedFileInspection[]>({ kind: "inspect", root, paths }, options);
}

export async function listGuardedWorkspaceFiles(
  root: string,
  input: {
    ignoredDirectories: string[];
    maxFiles?: number;
    maxTotalBytes?: number;
  },
  options: GuardedIoOptions = {},
): Promise<{ files: GuardedWorkspaceFile[]; totalBytes: number }> {
  assertWindows();
  return runRequest(
    {
      kind: "list",
      root,
      ignoredDirectories: input.ignoredDirectories,
      maxFiles: input.maxFiles ?? 0,
      maxTotalBytes: input.maxTotalBytes ?? 0,
    },
    options,
  );
}

export async function applyGuardedOperations(
  input: {
    root: string;
    sourceRoot?: string;
    operations: GuardedOperation[];
  },
  options: GuardedIoOptions = {},
): Promise<GuardedApplyResult> {
  assertWindows();
  return runRequest(
    {
      kind: "apply",
      root: input.root,
      sourceRoot: input.sourceRoot,
      operations: input.operations,
    },
    options,
  );
}

export async function readGuardedFile(
  root: string,
  path: string,
  maxBytes: number,
  options: GuardedIoOptions = {},
): Promise<{ buffer: Buffer; size: number; sha256: string }> {
  assertWindows();
  const result = await runRequest<{ data: string; size: number; sha256: string }>(
    { kind: "read", root, path, maxBytes },
    options,
  );
  return { buffer: Buffer.from(result.data, "base64"), size: result.size, sha256: result.sha256 };
}

export async function writeGuardedFile(
  root: string,
  relativePath: string,
  content: Buffer,
  expectedHash: "missing" | string,
  options: GuardedWriteOptions = {},
): Promise<{ size: number; sha256: string }> {
  assertWindows();
  if (!relativePath.trim()) throw new Error("受保护写入目标不能为空。");
  if (!Buffer.isBuffer(content)) throw new TypeError("受保护写入内容必须是 Buffer。");
  if (content.length > MAX_GUARDED_WRITE_BYTES) throw new Error("受保护写入内容超过 25 MiB。");
  if (expectedHash !== "missing" && !/^[a-f0-9]{64}$/i.test(expectedHash))
    throw new Error("受保护写入必须提供 missing 或完整的 SHA-256。");
  const holdMilliseconds = options.holdMilliseconds ?? 0;
  if (!Number.isFinite(holdMilliseconds) || holdMilliseconds < 0)
    throw new Error("受保护写入的 holdMilliseconds 必须是非负数。");
  const replacementHash = createHash("sha256").update(content).digest("hex");
  const temporaryPath = join(dirname(relativePath), `.mh-cas-${randomUUID()}.tmp`);
  const backupPath = join(dirname(relativePath), `.mh-cas-${randomUUID()}.bak`);
  try {
    return await runRequest<{ size: number; sha256: string }>(
      {
        kind: "write",
        root,
        path: relativePath,
        content: content.toString("base64"),
        expectedHash: expectedHash.toLowerCase(),
        replacementHash,
        temporaryPath,
        backupPath,
        createParents: options.createParents ?? false,
        holdMilliseconds: Math.min(Math.trunc(holdMilliseconds), 5_000),
      },
      options,
    );
  } catch (error) {
    let recoveryState = "unavailable";
    let recoveryDetail = "";
    try {
      const recovery = await runRequest<{ state: string; backupPath: string }>(
        {
          kind: "recover-write",
          root,
          path: relativePath,
          temporaryPath,
          backupPath,
          expectedHash: expectedHash.toLowerCase(),
          replacementHash,
        },
        { timeoutMs: 5_000, idleTimeoutMs: 100 },
      );
      recoveryState = recovery.state;
    } catch (recoveryError) {
      recoveryDetail = recoveryError instanceof Error ? ` (${recoveryError.message})` : "";
    }
    if (recoveryState !== "clean" && recoveryState !== "restored") {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const enriched = new Error(
        `${originalMessage}\nRECOVERY_STATE: ${recoveryState}${recoveryDetail}\n` +
          `RECOVERY_BACKUP: ${backupPath}`,
      );
      if (error instanceof Error) enriched.name = error.name;
      throw enriched;
    }
    throw error;
  }
}

export async function statGuardedPath(
  root: string,
  path: string,
  options: GuardedIoOptions = {},
): Promise<GuardedStatResult> {
  assertWindows();
  return runRequest({ kind: "stat", root, path }, options);
}

export async function listGuardedDirectory(
  root: string,
  path: string,
  options: GuardedIoOptions = {},
): Promise<GuardedDirectoryEntry[]> {
  assertWindows();
  return runRequest({ kind: "listdir", root, path }, options);
}

export async function stopGuardedWorkspaceIo(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownEpoch++;
  const stoppingEpoch = shutdownEpoch;
  shutdownPromise = (async () => {
    const active = worker;
    worker = null;
    if (active) await active.stop();
    await requestTail;
  })()
    .then(() => {
      if (stoppingEpoch === shutdownEpoch) shuttingDown = false;
    })
    .catch((error: unknown) => {
      guardedIoFailure = error instanceof Error ? error : new Error(String(error));
      throw guardedIoFailure;
    })
    .finally(() => {
      shutdownPromise = null;
    });
  return shutdownPromise;
}

process.once("exit", () => {
  if (worker) void worker.stop();
});
