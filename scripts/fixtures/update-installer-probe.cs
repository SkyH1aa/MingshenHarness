using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

// Harmless replacement for an installer, used only by the isolated update smoke test.
class UpdateInstallerProbe {
    static int Main() {
        string marker = Environment.GetEnvironmentVariable("MSH_UPDATE_PROBE_MARKER");
        string database = Environment.GetEnvironmentVariable("MSH_UPDATE_PROBE_DATABASE");
        int parent;
        if (String.IsNullOrEmpty(marker) || String.IsNullOrEmpty(database) ||
            !Int32.TryParse(Environment.GetEnvironmentVariable("MSH_UPDATE_PROBE_PARENT"), out parent)) return 2;
        bool exited = false;
        for (int i = 0; i < 100; i++) {
            try { using (Process process = Process.GetProcessById(parent)) { exited = process.HasExited; } }
            catch (ArgumentException) { exited = true; }
            if (exited) break;
            Thread.Sleep(100);
        }
        bool closed = false;
        try { using (FileStream stream = File.Open(database, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { closed = true; } }
        catch (IOException) { }
        File.WriteAllText(marker, "{\"installerStarted\":true,\"parentExited\":" + exited.ToString().ToLowerInvariant() +
            ",\"databaseClosed\":" + closed.ToString().ToLowerInvariant() + "}");
        return exited && closed ? 0 : 1;
    }
}
