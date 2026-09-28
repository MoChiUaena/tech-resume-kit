using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

class Launcher {
    static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes); result.Append(c); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    [STAThread]
    static int Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string identifier;
        using (var sha = SHA256.Create()) identifier = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()))).Replace("-", "");
        bool created;
        using (var mutex = new Mutex(true, "Local\\tech-resume-kit-" + identifier, out created)) {
            if (!created) {
                try {
                    string text = File.ReadAllText(Path.Combine(root, "my-resume", "app-session.local.json"));
                    var match = Regex.Match(text, "\"url\"\\s*:\\s*\"(http://127\\.0\\.0\\.1:\\d+/)\"");
                    if (match.Success && !args.Contains("--no-open")) Process.Start(new ProcessStartInfo(match.Groups[1].Value) { UseShellExecute = true });
                } catch { }
                return 0;
            }
            var errors = new StringBuilder();
            try {
                string node = Path.Combine(root, "runtime", "node.exe"), app = Path.Combine(root, "toolkit", "src", "app.mjs");
                if (!File.Exists(node) || !File.Exists(app)) throw new Exception("请先完整解压下载包，再运行启动简历.exe。");
                var start = new ProcessStartInfo(node, Quote(app) + " --idle-seconds 300 " + String.Join(" ", args.Select(Quote))) {
                    WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
                };
                start.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"] = Path.Combine(root, "runtime", "browsers");
                using (var process = new Process()) {
                    process.StartInfo = start;
                    process.ErrorDataReceived += (sender, eventArgs) => { if (eventArgs.Data != null) lock (errors) if (errors.Length < 12000) errors.AppendLine(eventArgs.Data); };
                    process.Start(); process.BeginErrorReadLine(); process.BeginOutputReadLine(); process.WaitForExit();
                    if (process.ExitCode != 0) throw new Exception(errors.Length > 0 ? errors.ToString() : "启动未完成，请确认解压目录允许写入。");
                }
                return 0;
            } catch (Exception error) {
                try { File.WriteAllText(Path.Combine(root, "startup-error.local.txt"), error.ToString(), Encoding.UTF8); } catch { }
                if (!args.Contains("--no-open")) MessageBox.Show(error.Message, "Markdown 简历", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            } finally { mutex.ReleaseMutex(); }
        }
    }
}
