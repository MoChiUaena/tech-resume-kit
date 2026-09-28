using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;

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
        var json = new JavaScriptSerializer();
        if (args.Length == 2 && args[0] == "--pick-directory") {
            using (var dialog = new FolderBrowserDialog()) {
                dialog.Description = "选择简历数据文件夹"; dialog.ShowNewFolderButton = true;
                string selected = dialog.ShowDialog() == DialogResult.OK ? dialog.SelectedPath : null;
                File.WriteAllText(args[1], json.Serialize(new { directory = selected }), new UTF8Encoding(false)); return 0;
            }
        }
        Func<string, string> option = name => { int index = Array.IndexOf(args, name); return index >= 0 && index + 1 < args.Length ? args[index + 1] : null; };
        string settings = option("--settings") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TechResumeKit", "settings.json");
        string explicitDirectory = option("--dir"), previous = option("--update-from");
        string identity = Path.GetFullPath(explicitDirectory ?? settings);
        string identifier;
        using (var sha = SHA256.Create()) identifier = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(identity.ToUpperInvariant()))).Replace("-", "");
        using (var mutex = new Mutex(false, "Local\\tech-resume-kit-" + identifier)) {
            bool acquired; try { acquired = mutex.WaitOne(args.Contains("--wait") ? 20000 : 0); } catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) {
                try {
                    string data = explicitDirectory;
                    if (data == null) data = (string)json.Deserialize<Dictionary<string, object>>(File.ReadAllText(settings))["dataDirectory"];
                    string text = File.ReadAllText(Path.Combine(data, "app-session.local.json"));
                    var match = Regex.Match(text, "\"url\"\\s*:\\s*\"(http://127\\.0\\.0\\.1:\\d+/)\"");
                    if (match.Success && !args.Contains("--no-open")) Process.Start(new ProcessStartInfo(match.Groups[1].Value) { UseShellExecute = true });
                } catch { }
                return 0;
            }
            var errors = new StringBuilder();
            try {
                string node = Path.Combine(root, "runtime", "node.exe"), app = Path.Combine(root, "toolkit", "src", "app.mjs");
                if (!File.Exists(node) || !File.Exists(app)) throw new Exception("请先完整解压下载包，再运行启动简历.exe。");
                var forwarded = new System.Collections.Generic.List<string>();
                for (int index = 0; index < args.Length; index++) {
                    if (args[index] == "--wait") continue;
                    if (args[index] == "--update-from") { index++; continue; }
                    forwarded.Add(args[index]);
                }
                var start = new ProcessStartInfo(node, Quote(app) + " --idle-seconds 300 --desktop " + Quote(root.TrimEnd(Path.DirectorySeparatorChar)) + " " + String.Join(" ", forwarded.Select(Quote))) {
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
                if (previous != null && !String.Equals(Path.GetFullPath(previous).TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) {
                    mutex.ReleaseMutex(); acquired = false;
                    try {
                        string fallback = Path.Combine(previous, "启动简历.exe");
                        if (File.Exists(fallback)) Process.Start(new ProcessStartInfo(fallback, "--wait --settings " + Quote(settings) + (args.Contains("--no-open") ? " --no-open" : "")) { UseShellExecute = false, CreateNoWindow = true });
                    } catch { }
                }
                if (!args.Contains("--no-open")) MessageBox.Show(error.Message, "Markdown 简历", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            } finally { if (acquired) mutex.ReleaseMutex(); }
        }
    }
}
