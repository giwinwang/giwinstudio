using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("极物 GIWIN Studio 安装程序")]
[assembly: AssemblyDescription("极物 GIWIN Studio 本地安装程序")]
[assembly: AssemblyProduct("极物 GIWIN Studio")]
[assembly: AssemblyCompany("GIWIN")]
[assembly: AssemblyVersion(Giwin.Installer.AppVersion.Assembly)]
[assembly: AssemblyFileVersion(Giwin.Installer.AppVersion.Assembly)]

namespace Giwin.Installer
{
    internal sealed class InstallOptions
    {
        internal string Destination { get; set; }
        internal bool CreateDesktopShortcut { get; set; }
        internal bool LaunchAfterInstall { get; set; }
        internal bool CreateStartMenuShortcut { get; set; }
    }

    internal sealed class InstallResult
    {
        internal string ExecutablePath { get; set; }
        internal string UninstallerPath { get; set; }
        internal string InstallDirectory { get; set; }
    }

    internal static class InstallerEngine
    {
        private const string PayloadResource = "payload.zip";
        private const string UninstallerResource = "uninstall.exe";
        private const string ManifestName = "install-manifest.txt";
        private const string MarkerName = ".giwin-install";
        private const long MinimumFreeBytes = 360L * 1024L * 1024L;

        internal static long GetRequiredBytes()
        {
            return 300L * 1024L * 1024L;
        }

        internal static string DefaultDestination()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "GIWIN Studio");
        }

        internal static long GetAvailableBytes(string path)
        {
            try
            {
                string root = Path.GetPathRoot(Path.GetFullPath(path));
                if (String.IsNullOrEmpty(root))
                {
                    return 0L;
                }
                return new DriveInfo(root).AvailableFreeSpace;
            }
            catch
            {
                return 0L;
            }
        }

        // 静默模式（无界面、自动更新）标记：允许安装器自行结束占用进程
        [ThreadStatic]
        private static bool muteRunningAppFlag;

        internal static bool CanTakeOverRunningApp { get { return muteRunningAppFlag; } }

        private static bool muteRunningApp { get { return muteRunningAppFlag; } }

        // 诊断日志钩子：静默安装时指向 giwin-silent-install.log
        internal static Action<string> DiagnosticLog = delegate { };

        internal static void AllowTakingOverRunningApp()
        {
            muteRunningAppFlag = true;
        }

        internal static InstallResult Install(
            InstallOptions options,
            Action<int, string> report,
            Func<bool> cancelled)
        {
            if (options == null)
            {
                throw new ArgumentNullException("options");
            }
            report = report ?? delegate { };
            cancelled = cancelled ?? delegate { return false; };

            string target = Path.GetFullPath(options.Destination.Trim().Trim('"'));
            ValidateDestination(target);
            if (IsInstallationRunning(target))
            {
                if (muteRunningApp)
                {
                    // 静默升级：用户已经点了「更新并重启」，不能再用「请先关闭软件」把流程堵死，
                    // 由安装器收尾关闭并接管目录。
                    TerminateProcessesUnderTarget(target, null);
                }
                if (IsInstallationRunning(target))
                {
                    throw new InvalidOperationException("极物正在运行。请先关闭软件，再继续安装。");
                }
            }
            if (GetAvailableBytes(target) < MinimumFreeBytes)
            {
                throw new InvalidOperationException("所选磁盘可用空间不足，请至少保留 360 MB。");
            }

            string parent = Path.GetDirectoryName(target);
            if (String.IsNullOrEmpty(parent))
            {
                throw new InvalidOperationException("安装位置无效。");
            }
            Directory.CreateDirectory(parent);

            string token = Guid.NewGuid().ToString("N");
            string stage = Path.Combine(parent, "." + Path.GetFileName(target) + ".install-" + token);
            string backup = Path.Combine(parent, "." + Path.GetFileName(target) + ".backup-" + token);
            string payloadFile = Path.Combine(Path.GetTempPath(), "giwin-payload-" + token + ".zip");
            bool switched = false;

            try
            {
                report(2, "正在准备安装文件");
                ExtractEmbeddedResource(PayloadResource, payloadFile);
                if (cancelled())
                {
                    throw new OperationCanceledException();
                }

                Directory.CreateDirectory(stage);
                using (FileStream payload = new FileStream(payloadFile, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read, false))
                {
                    long total = 0L;
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        if (!String.IsNullOrEmpty(entry.Name))
                        {
                            total += entry.Length;
                        }
                    }
                    total = Math.Max(1L, total);
                    long processed = 0L;
                    report(8, "正在解压应用文件");
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        if (cancelled())
                        {
                            throw new OperationCanceledException();
                        }
                        string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                        string destinationPath = Path.GetFullPath(Path.Combine(stage, relative));
                        string stageRoot = stage.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                        if (!destinationPath.StartsWith(stageRoot, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidDataException("安装包包含无效路径。");
                        }
                        if (String.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(destinationPath);
                            continue;
                        }
                        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath));
                        using (Stream input = entry.Open())
                        using (FileStream output = new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            CopyWithProgress(input, output, entry.Length, delegate(long copied)
                            {
                                processed += copied;
                                int percentage = 8 + (int)Math.Min(72d, processed * 72d / total);
                                report(percentage, "正在解压应用文件");
                            }, cancelled);
                        }
                    }
                }

                string stagedExecutable = FindMainExecutable(stage);
                report(82, "正在验证应用文件");
                if (!File.Exists(stagedExecutable))
                {
                    throw new InvalidDataException("安装包中缺少应用程序。");
                }

                if (Directory.Exists(target))
                {
                    bool hasContent = Directory.EnumerateFileSystemEntries(target).GetEnumerator().MoveNext();
                    bool previousInstall = File.Exists(Path.Combine(target, MarkerName));
                    if (hasContent && !previousInstall)
                    {
                        throw new InvalidOperationException("目标文件夹不是空的。请选择新的文件夹，或选择已有的极物安装目录。");
                    }
                    if (hasContent)
                    {
                        // 旧目录里有文件被杀软/文件监视进程瞬时占用时，Directory.Move 会抛
                        // IOException。这是自动更新的关键路径，失败=更新静默失效，所以重试。
                        MoveDirectoryWithRetry(target, backup, report);
                    }
                    else
                    {
                        Directory.Delete(target, false);
                    }
                }

                MoveDirectoryWithRetry(stage, target, report);
                switched = true;
                report(88, "正在完成文件安装");

                string uninstaller = Path.Combine(target, "Uninstall.exe");
                ExtractEmbeddedResource(UninstallerResource, uninstaller);
                File.WriteAllText(
                    Path.Combine(target, MarkerName),
                    Giwin.Installer.AppVersion.Marker,
                    new UTF8Encoding(true));

                string executable = Path.Combine(target, Path.GetFileName(stagedExecutable));
                if (options.CreateDesktopShortcut)
                {
                    CreateShortcut(
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "极物 GIWIN Studio.lnk"),
                        executable,
                        target);
                }
                if (options.CreateStartMenuShortcut)
                {
                    CreateShortcut(
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "极物 GIWIN Studio.lnk"),
                        executable,
                        target);
                }
                WriteManifest(target);
                RegisterUninstaller(target, executable, uninstaller);
                report(96, "正在创建快捷方式");

                if (Directory.Exists(backup))
                {
                    try
                    {
                        Directory.Delete(backup, true);
                    }
                    catch
                    {
                    }
                }
                report(100, "安装完成");

                if (options.LaunchAfterInstall)
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = executable,
                            WorkingDirectory = target,
                            UseShellExecute = true
                        });
                    }
                    catch (Exception launchError)
                    {
                        // 提升权限的安装器直接拉起应用可能被系统拒绝；
                        // 交给资源管理器启动（以普通用户身份）是可靠的兜底。
                        DiagnosticLog("launch direct failed: " + launchError.Message);
                        try
                        {
                            Process.Start(new ProcessStartInfo
                            {
                                FileName = "explorer.exe",
                                Arguments = "\"" + executable + "\"",
                                UseShellExecute = true
                            });
                            DiagnosticLog("launch via explorer ok");
                        }
                        catch (Exception fallbackError)
                        {
                            DiagnosticLog("launch fallback failed: " + fallbackError.Message);
                        }
                    }
                }

                return new InstallResult
                {
                    ExecutablePath = executable,
                    UninstallerPath = uninstaller,
                    InstallDirectory = target
                };
            }
            catch
            {
                if (!switched && Directory.Exists(backup) && !Directory.Exists(target))
                {
                    try
                    {
                        Directory.Move(backup, target);
                    }
                    catch
                    {
                    }
                }
                throw;
            }
            finally
            {
                SafeDeleteDirectory(stage);
                if (File.Exists(payloadFile))
                {
                    try
                    {
                        File.Delete(payloadFile);
                    }
                    catch
                    {
                    }
                }
            }
        }

        private static void ValidateDestination(string target)
        {
            string trimmed = target.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string root = Path.GetPathRoot(target).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (String.IsNullOrEmpty(trimmed) || String.Equals(trimmed, root, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("不能直接安装到磁盘根目录。");
            }
            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows).TrimEnd(Path.DirectorySeparatorChar);
            if (String.Equals(trimmed, windows, StringComparison.OrdinalIgnoreCase) ||
                trimmed.StartsWith(windows + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("不能安装到 Windows 系统目录。");
            }
        }

        // 找出安装目录下的全部进程。
        // 旧实现只靠 MainModule.FileName，32 位安装器读 64 位进程的主模块会抛异常，
        // 异常被吞掉后误判「没有进程在跑」，于是静默升级撞上「文件被占用」而必然失败。
        // 现在有两条判定：主模块路径命中，或进程名与本目录主程序同名（兜底，不依赖权限）。
        internal static List<Process> ProcessesUnderTarget(string target)
        {
            List<Process> found = new List<Process>();
            string root = target.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

            string[] names = new string[0];
            try
            {
                if (Directory.Exists(target))
                {
                    string[] executables = Directory.GetFiles(target, "*.exe", SearchOption.TopDirectoryOnly);
                    names = new string[executables.Length];
                    for (int i = 0; i < executables.Length; i++)
                    {
                        names[i] = Path.GetFileNameWithoutExtension(executables[i]);
                    }
                }
            }
            catch
            {
            }

            foreach (Process process in Process.GetProcesses())
            {
                bool match = false;
                try
                {
                    string path = process.MainModule == null ? null : process.MainModule.FileName;
                    if (!String.IsNullOrEmpty(path) && path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    {
                        match = true;
                    }
                }
                catch
                {
                    // 无权读取主模块（32/64 位或完整性级别差异）：退回进程名比对
                    try
                    {
                        for (int i = 0; i < names.Length && !match; i++)
                        {
                            if (String.Equals(process.ProcessName, names[i], StringComparison.OrdinalIgnoreCase))
                            {
                                match = true;
                            }
                        }
                    }
                    catch
                    {
                    }
                }

                if (match)
                {
                    found.Add(process);
                }
                else
                {
                    process.Dispose();
                }
            }
            return found;
        }

        internal static bool IsInstallationRunning(string target)
        {
            List<Process> running = ProcessesUnderTarget(target);
            bool any = running.Count > 0;
            for (int i = 0; i < running.Count; i++)
            {
                running[i].Dispose();
            }
            return any;
        }

        // 结束安装目录下的进程：先请它们自己关窗口（给个收尾机会），再强制结束。
        // 自动更新是无人值守路径，用户点「更新并重启」后又顺手双击了图标、
        // 或者 Electron 的 GPU/渲染子进程残留，都会让目录替换失败；
        // 安装器是唯一有权处理这件事的角色，必须自己把占位的进程清掉。
        internal static int TerminateProcessesUnderTarget(string target, Action<string> log)
        {
            log = log ?? DiagnosticLog;
            List<Process> running = ProcessesUnderTarget(target);
            if (running.Count == 0)
            {
                return 0;
            }

            for (int i = 0; i < running.Count; i++)
            {
                try
                {
                    log("closing pid=" + running[i].Id + " name=" + running[i].ProcessName);
                    running[i].CloseMainWindow();
                }
                catch
                {
                }
            }

            // 最多等 4 秒让窗口正常退出，避免强杀丢用户未保存的画布数据
            for (int tick = 0; tick < 16; tick++)
            {
                Thread.Sleep(250);
                bool alive = false;
                for (int i = 0; i < running.Count; i++)
                {
                    try
                    {
                        if (!running[i].HasExited)
                        {
                            alive = true;
                            break;
                        }
                    }
                    catch
                    {
                    }
                }
                if (!alive)
                {
                    break;
                }
            }

            int killed = 0;
            for (int i = 0; i < running.Count; i++)
            {
                try
                {
                    if (!running[i].HasExited)
                    {
                        log("killing pid=" + running[i].Id + " name=" + running[i].ProcessName);
                        running[i].Kill();
                        killed++;
                    }
                }
                catch
                {
                }
            }
            for (int i = 0; i < running.Count; i++)
            {
                try
                {
                    running[i].Dispose();
                }
                catch
                {
                }
            }

            // 等内核真正释放文件句柄（Kill 返回时句柄还没销毁完）
            for (int tick = 0; tick < 20; tick++)
            {
                Thread.Sleep(250);
                if (!IsInstallationRunning(target))
                {
                    break;
                }
            }
            return killed;
        }

        // 供 InstallerProgram（静默模式）等待目标目录进程完全释放
        internal static bool AnyProcessUnderTarget(string target)
        {
            return IsInstallationRunning(target);
        }

        private static void CopyWithProgress(
            Stream input,
            Stream output,
            long expected,
            Action<long> progress,
            Func<bool> cancelled)
        {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (cancelled())
                {
                    throw new OperationCanceledException();
                }
                output.Write(buffer, 0, read);
                progress(read);
            }
        }

        internal static string FindMainExecutable(string root)
        {
            string[] executables = Directory.GetFiles(root, "*.exe", SearchOption.TopDirectoryOnly);
            if (executables.Length == 0)
            {
                return "";
            }
            Array.Sort(executables, delegate(string left, string right)
            {
                return new FileInfo(right).Length.CompareTo(new FileInfo(left).Length);
            });
            return executables[0];
        }

        private static void ExtractEmbeddedResource(string name, string destination)
        {
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (source == null)
                {
                    throw new InvalidDataException("安装包缺少必要资源：" + name);
                }
                string directory = Path.GetDirectoryName(destination);
                if (!String.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }
                using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    source.CopyTo(output, 256 * 1024);
                }
            }
        }

        // 文件监视/杀毒软件会瞬时抓住目录内的文件（历史日志里两次“另一个进程正在使用此
        // 文件”都是这个原因），导致 Directory.Move 抛 IOException 后整个安装失败。
        // 这里做有耐心的重试：最多约 15 秒，期间不放弃，等占用方释放。
        private static void MoveDirectoryWithRetry(string from, string to, Action<int, string> report)
        {
            const int maxAttempts = 14;
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    Directory.Move(from, to);
                    return;
                }
                catch (Exception error)
                {
                    // 只重试“被占用”类瞬时错误，其它错误照常抛出
                    if (attempt >= maxAttempts || !IsTransientLockError(error)) throw;
                }
                // 干等是没用的：占用方可能正是仍开着的旧版应用。
                // 静默升级（用户已确认更新）时由安装器直接结束占用进程，再重试移动。
                if (muteRunningApp && (attempt == 2 || attempt == 6))
                {
                    report(85, "正在关闭旧版本进程");
                    TerminateProcessesUnderTarget(from, null);
                }
                if (attempt == 3)
                {
                    report(85, "文件被其他程序占用，正在重试…");
                }
                Thread.Sleep(500 + attempt * 200);
            }
        }

        private static bool IsTransientLockError(Exception error)
        {
            return error is IOException || error is UnauthorizedAccessException;
        }

        private static void CreateShortcut(string shortcutPath, string executable, string workingDirectory)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                throw new InvalidOperationException("系统无法创建快捷方式。");
            }
            // .lnk 文件被瞬时占用时 Save 会抛 UnauthorizedAccessException，同样重试
            const int maxAttempts = 8;
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    CreateShortcutOnce(shortcutPath, executable, workingDirectory, shellType);
                    return;
                }
                catch (Exception error)
                {
                    if (attempt >= maxAttempts || !IsTransientShortcutError(error)) throw;
                }
                Thread.Sleep(500 + attempt * 200);
            }
        }

        private static bool IsTransientShortcutError(Exception error)
        {
            if (error is System.Reflection.TargetInvocationException && error.InnerException != null)
            {
                return IsTransientShortcutError(error.InnerException);
            }
            return error is IOException || error is UnauthorizedAccessException;
        }

        private static void CreateShortcutOnce(string shortcutPath, string executable, string workingDirectory, Type shellType)
        {
            object shell = Activator.CreateInstance(shellType);
            object shortcut = null;
            try
            {
                shortcut = shellType.InvokeMember(
                    "CreateShortcut",
                    BindingFlags.InvokeMethod,
                    null,
                    shell,
                    new object[] { shortcutPath });
                Type shortcutType = shortcut.GetType();
                shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { executable });
                shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
                shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { executable + ",0" });
                shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "极物 GIWIN Studio" });
                shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, new object[0]);
            }
            finally
            {
                if (shortcut != null && System.Runtime.InteropServices.Marshal.IsComObject(shortcut))
                {
                    System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut);
                }
                if (shell != null && System.Runtime.InteropServices.Marshal.IsComObject(shell))
                {
                    System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
                }
            }
        }

        private static void WriteManifest(string target)
        {
            StringBuilder manifest = new StringBuilder();
            string root = target.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            foreach (string file in Directory.GetFiles(target, "*", SearchOption.AllDirectories))
            {
                if (String.Equals(Path.GetFileName(file), ManifestName, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                manifest.AppendLine(file.Substring(root.Length));
            }
            manifest.AppendLine(ManifestName);
            File.WriteAllText(Path.Combine(target, ManifestName), manifest.ToString(), new UTF8Encoding(true));
        }

        private static void RegisterUninstaller(string directory, string executable, string uninstaller)
        {
            const string keyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\GIWINStudio";
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(keyPath))
            {
                key.SetValue("DisplayName", "极物 GIWIN Studio");
                key.SetValue("DisplayVersion", Giwin.Installer.AppVersion.Display);
                key.SetValue("Publisher", "GIWIN");
                key.SetValue("InstallLocation", directory);
                key.SetValue("DisplayIcon", executable + ",0");
                key.SetValue("UninstallString", "\"" + uninstaller + "\"");
                key.SetValue("QuietUninstallString", "\"" + uninstaller + "\" --silent");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", 307200, RegistryValueKind.DWord);
            }
        }

        internal static void SafeDeleteDirectory(string path)
        {
            if (String.IsNullOrEmpty(path) || !Directory.Exists(path))
            {
                return;
            }
            try
            {
                Directory.Delete(path, true);
            }
            catch
            {
            }
        }
    }

    internal sealed class InstallerWindow : DarkWindow
    {
        private Panel configPage;
        private Panel progressPage;
        private Panel completePage;
        private TextBox pathInput;
        private Label availableLabel;
        private CheckTile desktopCheck;
        private CheckTile launchCheck;
        private UiButton primaryButton;
        private UiButton footerButton;
        private Label footerText;
        private Label progressPercent;
        private Label progressCardPercent;
        private Label progressStatus;
        private ProgressBarEx progressBar;
        private Label progressStageOne;
        private Label progressStageTwo;
        private Label progressStageThree;
        private Thread installThread;
        private volatile bool cancelRequested;
        private InstallResult completedInstall;

        internal InstallerWindow()
            : base(new Size(760, 540))
        {
            Text = "极物 GIWIN Studio";
            BuildHeader(true, delegate(object sender, EventArgs args)
            {
                if (installThread == null)
                {
                    Close();
                }
            });
            BuildFooter();

            configPage = NewPage();
            progressPage = NewPage();
            completePage = NewPage();
            Controls.Add(configPage);
            Controls.Add(progressPage);
            Controls.Add(completePage);

            Label title = Ui.Label("极物", 56, 28, 108, 44, 22f, Theme.Text, FontStyle.Bold);
            configPage.Controls.Add(title);
            Label latin = Ui.Label("GIWIN Studio", 166, 42, 170, 26, 11.2f, Theme.Muted, FontStyle.Regular);
            latin.Font = Ui.LatinFont(11.2f, FontStyle.Regular);
            configPage.Controls.Add(latin);
            configPage.Controls.Add(BuildChip(Giwin.Installer.AppVersion.Chip, 584, 38, 92, 24));

            RoundedPanel settings = new RoundedPanel
            {
                Location = new Point(56, 82),
                Size = new Size(648, 178),
                FillColor = Theme.Surface,
                BorderColor = Theme.FieldBorder
            };
            configPage.Controls.Add(settings);

            Label locationLabel = Ui.Label("安装位置", 18, 11, 180, 22, 8.8f, Theme.Text, FontStyle.Bold);
            settings.Controls.Add(locationLabel);
            Label scopeLabel = Ui.Label("仅为当前用户安装", 430, 11, 200, 22, 8.3f, Theme.Faint);
            scopeLabel.TextAlign = ContentAlignment.MiddleRight;
            settings.Controls.Add(scopeLabel);

            RoundedPanel pathField = new RoundedPanel
            {
                Location = new Point(18, 36),
                Size = new Size(612, 44),
                FillColor = Theme.Field,
                BorderColor = Theme.FieldBorder,
                Radius = 9
            };
            settings.Controls.Add(pathField);
            FolderGlyph folder = new FolderGlyph { Location = new Point(13, 15) };
            pathField.Controls.Add(folder);
            pathInput = new TextBox
            {
                Text = InstallerEngine.DefaultDestination(),
                Location = new Point(40, 11),
                Size = new Size(508, 24),
                BorderStyle = BorderStyle.None,
                BackColor = Theme.Field,
                ForeColor = Theme.Text,
                Font = Ui.Font(8.8f, FontStyle.Regular),
                AccessibleName = "安装位置"
            };
            pathInput.TextChanged += delegate { UpdateAvailableSpace(); };
            pathField.Controls.Add(pathInput);
            UiButton browse = new UiButton
            {
                Text = "浏览",
                Location = new Point(556, 7),
                Size = new Size(46, 30),
                FillColor = Theme.Field,
                HoverColor = Theme.Header,
                TextColor = Theme.Muted,
                Font = Ui.Font(9.5f, FontStyle.Bold),
                Radius = 6,
                AccessibleName = "选择安装位置"
            };
            browse.Click += delegate { ChooseDirectory(); };
            pathField.Controls.Add(browse);

            Label requiredLabel = Ui.Label("需要  300 MB", 18, 87, 130, 20, 8.2f, Theme.Faint);
            settings.Controls.Add(requiredLabel);
            Label separator = Ui.Label("•", 155, 87, 14, 20, 8.2f, Theme.Faint);
            separator.TextAlign = ContentAlignment.MiddleCenter;
            settings.Controls.Add(separator);
            availableLabel = Ui.Label("可用  计算中", 174, 87, 180, 20, 8.2f, Theme.Faint);
            settings.Controls.Add(availableLabel);

            desktopCheck = new CheckTile
            {
                Text = "创建桌面快捷方式",
                Location = new Point(18, 112),
                Size = new Size(301, 38),
                AccessibleName = "创建桌面快捷方式",
                Checked = true
            };
            settings.Controls.Add(desktopCheck);
            launchCheck = new CheckTile
            {
                Text = "安装完成后启动",
                Location = new Point(329, 112),
                Size = new Size(301, 38),
                AccessibleName = "安装完成后启动",
                Checked = true
            };
            settings.Controls.Add(launchCheck);

            AddNotice(configPage, "项目文件与账号信息只保存在本机。安装过程不会上传你的设计内容。", 272);
            primaryButton = new UiButton
            {
                Text = "开始安装",
                Location = new Point(56, 304),
                Size = new Size(648, 44),
                FillColor = Theme.Accent,
                HoverColor = Color.FromArgb(140, 167, 181),
                TextColor = Theme.AccentText,
                Font = Ui.Font(9.5f, FontStyle.Regular),
                AccessibleName = "开始安装"
            };
            primaryButton.Click += delegate { StartInstall(); };
            configPage.Controls.Add(primaryButton);

            footerText = Ui.Label("适用于 Windows 10 / 11 · 64 位", 38, 0, 430, 56, 8.2f, Theme.Faint);
            FooterPanel.Controls.Add(footerText);
            Label footerDot = Ui.Label("●", 24, 16, 12, 24, 6.5f, Theme.Accent);
            FooterPanel.Controls.Add(footerDot);
            footerButton = new UiButton
            {
                Text = "取消",
                Location = new Point(682, 12),
                Size = new Size(58, 31),
                FillColor = Theme.Footer,
                HoverColor = Theme.Surface,
                TextColor = Theme.Muted,
                ButtonBorderColor = Theme.Border,
                DrawBorder = true,
                Font = Ui.Font(8.5f, FontStyle.Regular),
                Radius = 7,
                AccessibleName = "取消"
            };
            footerButton.Click += delegate { FooterAction(); };
            FooterPanel.Controls.Add(footerButton);

            BuildProgressPage();
            BuildCompletePage();
            ShowConfig();
            UpdateAvailableSpace();
        }

        private Panel NewPage()
        {
            return new Panel
            {
                Location = new Point(0, 52),
                Size = new Size(760, 432),
                BackColor = Theme.Window
            };
        }

        private RoundedPanel BuildChip(string text, int x, int y, int width, int height)
        {
            RoundedPanel chip = new RoundedPanel
            {
                Location = new Point(x, y),
                Size = new Size(width, height),
                FillColor = Theme.Header,
                BorderColor = Theme.Border,
                Radius = 6
            };
            Label label = Ui.Label(text, 0, 0, width, height, 7.4f, Theme.Muted, FontStyle.Bold);
            label.TextAlign = ContentAlignment.MiddleCenter;
            label.Font = Ui.LatinFont(7.4f, FontStyle.Bold);
            chip.Controls.Add(label);
            return chip;
        }

        private void AddNotice(Control page, string text, int y)
        {
            Label dot = Ui.Label("●", 56, y, 15, 20, 7.5f, Theme.Accent);
            page.Controls.Add(dot);
            Label notice = Ui.Label(text, 72, y, 630, 25, 8.1f, Theme.Faint);
            page.Controls.Add(notice);
        }

        private void BuildProgressPage()
        {
            Label kicker = Ui.Label("安装进度", 56, 30, 180, 19, 8.1f, Theme.Faint);
            progressPage.Controls.Add(kicker);
            Label title = Ui.Label("正在准备工作台", 56, 50, 460, 42, 20.5f, Theme.Text, FontStyle.Bold);
            progressPage.Controls.Add(title);
            Label subtitle = Ui.Label("正在写入画布与资源文件，请保持窗口打开。", 56, 93, 500, 22, 8.4f, Theme.Muted);
            progressPage.Controls.Add(subtitle);
            progressPercent = Ui.Label("68%", 671, 103, 34, 24, 8.4f, Theme.Text, FontStyle.Bold);
            progressPercent.TextAlign = ContentAlignment.MiddleRight;
            progressPage.Controls.Add(progressPercent);

            RoundedPanel card = new RoundedPanel
            {
                Location = new Point(56, 132),
                Size = new Size(648, 172),
                FillColor = Theme.Surface,
                BorderColor = Theme.FieldBorder
            };
            progressPage.Controls.Add(card);
            Label appName = Ui.Label("极物 GIWIN Studio", 18, 15, 300, 24, 9.1f, Theme.Text, FontStyle.Bold);
            card.Controls.Add(appName);
            Label version = Ui.Label(Giwin.Installer.AppVersion.Display, 520, 15, 110, 24, 8.1f, Theme.Muted);
            version.TextAlign = ContentAlignment.MiddleRight;
            card.Controls.Add(version);
            progressBar = new ProgressBarEx { Location = new Point(18, 49), Size = new Size(612, 8), Value = 68 };
            progressBar.AccessibleName = "安装进度";
            card.Controls.Add(progressBar);
            progressStatus = Ui.Label("正在安装画布组件", 18, 64, 480, 22, 8.2f, Theme.Faint);
            card.Controls.Add(progressStatus);
            progressCardPercent = Ui.Label("68%", 535, 64, 95, 22, 8.2f, Theme.Faint);
            progressCardPercent.TextAlign = ContentAlignment.MiddleRight;
            card.Controls.Add(progressCardPercent);
            Panel divider = new Panel { Location = new Point(18, 96), Size = new Size(612, 1), BackColor = Theme.Border };
            card.Controls.Add(divider);
            progressStageOne = Ui.Label("●  准备文件", 18, 110, 190, 22, 8.2f, Theme.Text);
            card.Controls.Add(progressStageOne);
            progressStageTwo = Ui.Label("●  写入应用", 224, 110, 190, 22, 8.2f, Theme.Text);
            card.Controls.Add(progressStageTwo);
            progressStageThree = Ui.Label("●  完成设置", 430, 110, 190, 22, 8.2f, Theme.Faint);
            card.Controls.Add(progressStageThree);

            AddNotice(progressPage, "项目文件与账号信息只保存在本机。安装过程不会上传你的设计内容。", 322);
            UiButton progressButton = new UiButton
            {
                Text = "正在安装…",
                Location = new Point(56, 354),
                Size = new Size(648, 44),
                Enabled = false,
                FillColor = Theme.Accent,
                HoverColor = Theme.Accent,
                TextColor = Theme.AccentText,
                Font = Ui.Font(9.5f, FontStyle.Regular),
                AccessibleName = "正在安装"
            };
            progressPage.Controls.Add(progressButton);
        }

        private void BuildCompletePage()
        {
            Label kicker = Ui.Label("安装完成", 56, 30, 180, 19, 8.1f, Theme.Faint);
            completePage.Controls.Add(kicker);
            Label title = Ui.Label("准备好了", 56, 50, 300, 44, 21f, Theme.Text, FontStyle.Bold);
            completePage.Controls.Add(title);
            completePage.Controls.Add(BuildChip(Giwin.Installer.AppVersion.Chip, 584, 54, 92, 24));

            RoundedPanel card = new RoundedPanel
            {
                Location = new Point(56, 132),
                Size = new Size(648, 142),
                FillColor = Theme.Surface,
                BorderColor = Theme.FieldBorder
            };
            completePage.Controls.Add(card);
            RoundedPanel seal = new RoundedPanel
            {
                Location = new Point(18, 18),
                Size = new Size(44, 44),
                FillColor = Theme.Accent,
                BorderColor = Theme.Accent,
                Radius = 11
            };
            card.Controls.Add(seal);
            Label check = Ui.Label("✓", 0, -1, 44, 44, 15f, Theme.AccentText, FontStyle.Bold);
            check.TextAlign = ContentAlignment.MiddleCenter;
            seal.Controls.Add(check);
            Label completeTitle = Ui.Label("极物 GIWIN Studio 已就绪", 78, 19, 360, 22, 9.2f, Theme.Text, FontStyle.Bold);
            card.Controls.Add(completeTitle);
            Label completeCopy = Ui.Label("应用文件和快捷方式已经配置完成。", 78, 41, 420, 20, 8.2f, Theme.Muted);
            card.Controls.Add(completeCopy);
            Panel divider = new Panel { Location = new Point(18, 76), Size = new Size(612, 1), BackColor = Theme.Border };
            card.Controls.Add(divider);
            Label shortcutCaption = Ui.Label("桌面快捷方式", 18, 87, 190, 16, 7.8f, Theme.Faint);
            card.Controls.Add(shortcutCaption);
            Label shortcutValue = Ui.Label("已创建", 18, 104, 190, 18, 8.2f, Theme.Text, FontStyle.Bold);
            card.Controls.Add(shortcutValue);
            Label locationCaption = Ui.Label("安装位置", 348, 87, 190, 16, 7.8f, Theme.Faint);
            card.Controls.Add(locationCaption);
            Label locationValue = Ui.Label("本地应用目录", 348, 104, 250, 18, 8.2f, Theme.Text, FontStyle.Bold);
            card.Controls.Add(locationValue);

            AddNotice(completePage, "你的项目、素材与设置会在首次启动后保存在本机。", 290);
            UiButton launch = new UiButton
            {
                Text = "启动极物",
                Location = new Point(56, 322),
                Size = new Size(648, 44),
                FillColor = Theme.Accent,
                HoverColor = Color.FromArgb(140, 167, 181),
                TextColor = Theme.AccentText,
                Font = Ui.Font(9.5f, FontStyle.Regular),
                AccessibleName = "启动极物"
            };
            launch.Click += delegate { LaunchInstalledApp(); };
            completePage.Controls.Add(launch);
        }

        private void ShowPage(Panel page)
        {
            configPage.Visible = page == configPage;
            progressPage.Visible = page == progressPage;
            completePage.Visible = page == completePage;
        }

        private void ShowConfig()
        {
            ShowPage(configPage);
            primaryButton.Enabled = true;
            footerButton.Text = "取消";
            footerButton.AccessibleName = "取消";
            footerText.Text = "适用于 Windows 10 / 11 · 64 位";
            if (CloseButton != null)
            {
                CloseButton.Enabled = true;
            }
            installThread = null;
            cancelRequested = false;
        }

        internal void ShowPreviewState(string state)
        {
            if (String.Equals(state, "progress", StringComparison.OrdinalIgnoreCase))
            {
                ShowPage(progressPage);
                SetProgress(68, "正在安装画布组件");
                footerText.Text = "准备文件 · 写入应用 · 完成设置";
                footerButton.Text = "取消";
            }
            else if (String.Equals(state, "complete", StringComparison.OrdinalIgnoreCase))
            {
                ShowPage(completePage);
                footerText.Text = "极物，为设计而生";
                footerButton.Text = "关闭";
                footerButton.AccessibleName = "关闭";
                if (CloseButton != null)
                {
                    CloseButton.Enabled = true;
                }
            }
        }

        private void StartInstall()
        {
            string destination = pathInput.Text.Trim();
            if (destination.Length == 0)
            {
                ShowError("请选择安装位置。");
                return;
            }
            if (InstallerEngine.GetAvailableBytes(destination) < 360L * 1024L * 1024L)
            {
                ShowError("所选磁盘可用空间不足，请至少保留 360 MB。");
                return;
            }

            ShowPage(progressPage);
            footerButton.Text = "取消";
            footerButton.AccessibleName = "取消安装";
            footerText.Text = "准备文件 · 写入应用 · 完成设置";
            cancelRequested = false;
            SetProgress(0, "正在准备安装文件");
            InstallOptions options = new InstallOptions
            {
                Destination = destination,
                CreateDesktopShortcut = desktopCheck.Checked,
                LaunchAfterInstall = launchCheck.Checked,
                CreateStartMenuShortcut = true
            };
            installThread = new Thread(delegate()
            {
                try
                {
                    InstallResult result = InstallerEngine.Install(
                        options,
                        delegate(int value, string message)
                        {
                            ReportProgress(value, message);
                        },
                        delegate { return cancelRequested; });
                    completedInstall = result;
                    OnUi(delegate
                    {
                        ShowPage(completePage);
                        footerButton.Text = "关闭";
                        footerButton.AccessibleName = "关闭";
                        footerText.Text = "极物，为设计而生";
                        if (CloseButton != null)
                        {
                            CloseButton.Enabled = true;
                        }
                        installThread = null;
                    });
                }
                catch (OperationCanceledException)
                {
                    OnUi(delegate
                    {
                        ShowConfig();
                        ShowError("安装已取消，应用文件没有变更。");
                    });
                }
                catch (Exception error)
                {
                    OnUi(delegate
                    {
                        ShowConfig();
                        ShowError(error.Message);
                    });
                }
            });
            installThread.IsBackground = true;
            installThread.Start();
        }

        private void ReportProgress(int percent, string status)
        {
            OnUi(delegate
            {
                SetProgress(percent, status);
            });
        }

        private void SetProgress(int percent, string status)
        {
            progressBar.Value = percent;
            progressPercent.Text = percent + "%";
            progressCardPercent.Text = percent + "%";
            progressStatus.Text = status;
            progressStageOne.ForeColor = percent >= 20 ? Theme.Text : Theme.Faint;
            progressStageTwo.ForeColor = percent >= 20 ? Theme.Text : Theme.Faint;
            progressStageThree.ForeColor = percent >= 90 ? Theme.Text : Theme.Faint;
        }

        private void FooterAction()
        {
            if (completePage.Visible)
            {
                Close();
                return;
            }
            if (progressPage.Visible && installThread != null)
            {
                cancelRequested = true;
                footerButton.Text = "正在取消…";
                footerButton.Enabled = false;
                return;
            }
            Close();
        }

        private void LaunchInstalledApp()
        {
            if (completedInstall != null && File.Exists(completedInstall.ExecutablePath))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = completedInstall.ExecutablePath,
                    WorkingDirectory = completedInstall.InstallDirectory,
                    UseShellExecute = true
                });
            }
            Close();
        }

        private void ChooseDirectory()
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择极物 GIWIN Studio 的安装位置";
                dialog.ShowNewFolderButton = true;
                dialog.SelectedPath = pathInput.Text;
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    pathInput.Text = Path.Combine(dialog.SelectedPath, "GIWIN Studio");
                }
            }
            UpdateAvailableSpace();
        }

        private void UpdateAvailableSpace()
        {
            long available = InstallerEngine.GetAvailableBytes(pathInput.Text);
            availableLabel.Text = available > 0
                ? "可用  " + FormatBytes(available)
                : "可用  无法读取";
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes >= 1024L * 1024L * 1024L)
            {
                return (bytes / (1024d * 1024d * 1024d)).ToString("0.0") + " GB";
            }
            return (bytes / (1024d * 1024d)).ToString("0") + " MB";
        }

        private void ShowError(string message)
        {
            using (ErrorDialog dialog = new ErrorDialog(message))
            {
                dialog.ShowDialog(this);
            }
        }

        private void OnUi(Action action)
        {
            if (IsDisposed || !IsHandleCreated)
            {
                return;
            }
            try
            {
                BeginInvoke(action);
            }
            catch (InvalidOperationException)
            {
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (installThread != null && installThread.IsAlive)
            {
                cancelRequested = true;
                e.Cancel = true;
                footerButton.Enabled = false;
                footerButton.Text = "正在取消…";
            }
            base.OnFormClosing(e);
        }
    }

    internal sealed class ErrorDialog : DarkWindow
    {
        internal ErrorDialog(string message)
            : base(new Size(480, 260))
        {
            Text = "极物";
            BuildHeader(true, delegate { Close(); });
            Label title = Ui.Label("需要处理", 48, 78, 380, 38, 17f, Theme.Text, FontStyle.Bold);
            Controls.Add(title);
            Label copy = Ui.Label(message, 48, 116, 384, 58, 9f, Theme.Muted);
            Controls.Add(copy);
            UiButton ok = new UiButton
            {
                Text = "知道了",
                Location = new Point(48, 188),
                Size = new Size(384, 42),
                FillColor = Theme.Accent,
                HoverColor = Color.FromArgb(140, 167, 181),
                TextColor = Theme.AccentText,
                DialogResult = DialogResult.OK,
                AccessibleName = "知道了"
            };
            ok.Click += delegate { Close(); };
            Controls.Add(ok);
        }
    }

    internal static class InstallerProgram
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool silent = HasArgument(args, "--silent");
            if (silent)
            {
                string destination = null;
                try
                {
                    // 静默安装是自动更新路径：用户已明确同意「更新并重启」，
                    // 安装器必须有权结束仍占着安装目录的旧进程，否则目录替换必然失败。
                    InstallerEngine.AllowTakingOverRunningApp();
                    InstallerEngine.DiagnosticLog = LogSilent;
                    // 先解析目标目录，再等待退出：等待阶段需要检查目标目录的进程是否完全释放
                    destination = ResolveSilentDestination(args);
                    LogSilent("silent install start, destination=" + destination);
                    int waitPid = ReadIntArgument(args, "--wait-pid");
                    if (waitPid > 0)
                    {
                        WaitForInstallTargetFree(waitPid, destination, TimeSpan.FromSeconds(90));
                    }
                    InstallOptions options = new InstallOptions
                    {
                        Destination = destination,
                        CreateDesktopShortcut = !HasArgument(args, "--no-shortcuts"),
                        LaunchAfterInstall = HasArgument(args, "--launch"),
                        CreateStartMenuShortcut = !HasArgument(args, "--no-shortcuts")
                    };
                    InstallerEngine.Install(options, delegate { }, delegate { return false; });
                    LogSilent("silent install ok");
                    return 0;
                }
                catch (Exception silentError)
                {
                    // 静默模式没有界面，必须把失败原因写进日志，否则升级失败无从排查
                    LogSilent("silent install FAILED: " + silentError);
                    // 用户在应用里点了「更新并重启」，安装失败时旧版必须拉起来，
                    // 否则软件直接消失、下次打开用户也不知道发生了什么。
                    if (HasArgument(args, "--launch") && Directory.Exists(destination))
                    {
                        try
                        {
                            string fallbackExe = InstallerEngine.FindMainExecutable(destination);
                            if (!String.IsNullOrEmpty(fallbackExe))
                            {
                                Process.Start(new ProcessStartInfo
                                {
                                    FileName = fallbackExe,
                                    WorkingDirectory = Path.GetDirectoryName(fallbackExe),
                                    UseShellExecute = true
                                });
                                LogSilent("silent install fallback: relaunched old app " + fallbackExe);
                            }
                        }
                        catch (Exception launchError)
                        {
                            LogSilent("silent install fallback relaunch failed: " + launchError);
                        }
                    }
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            int snapshotIndex = Array.IndexOf(args, "--snapshot");
            if (snapshotIndex >= 0 && args.Length > snapshotIndex + 1)
            {
                using (InstallerWindow window = new InstallerWindow())
                {
                    if (HasArgument(args, "--progress"))
                    {
                        window.ShowPreviewState("progress");
                    }
                    else if (HasArgument(args, "--complete"))
                    {
                        window.ShowPreviewState("complete");
                    }
                    window.Show();
                    Application.DoEvents();
                    using (Bitmap bitmap = new Bitmap(window.Width, window.Height))
                    {
                        window.DrawToBitmap(bitmap, new Rectangle(0, 0, window.Width, window.Height));
                        bitmap.Save(args[snapshotIndex + 1], System.Drawing.Imaging.ImageFormat.Png);
                    }
                    window.Close();
                }
                return 0;
            }

            Application.Run(new InstallerWindow());
            return 0;
        }

        private static bool HasArgument(string[] args, string target)
        {
            foreach (string argument in args)
            {
                if (String.Equals(argument, target, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static string ResolveSilentDestination(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (!String.Equals(args[i], "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                if (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
                {
                    return args[i + 1];
                }
                break;
            }
            return InstallerEngine.DefaultDestination();
        }

        private static int ReadIntArgument(string[] args, string name)
        {
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                int value;
                if (Int32.TryParse(args[i + 1], out value))
                {
                    return value;
                }
            }
            return 0;
        }

        // 静默安装日志：每次追加写入固定路径，应用下次启动可读取并向用户报告失败原因
        private static readonly string SilentLogPath = Path.Combine(Path.GetTempPath(), "giwin-silent-install.log");

        private static void LogSilent(string message)
        {
            try
            {
                File.AppendAllText(SilentLogPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine);
            }
            catch
            {
                // 日志写入失败不影响安装
            }
        }

        private static void WaitForInstallTargetFree(int processId, string target, TimeSpan timeout)
        {
            DateTime deadline = DateTime.UtcNow + timeout;
            // 1) 等主进程退出。GetProcessById 在进程已退出时会抛异常，含义同样是「已退出」
            try
            {
                using (Process process = Process.GetProcessById(processId))
                {
                    process.WaitForExit((int)timeout.TotalMilliseconds);
                }
            }
            catch
            {
            }
            // 2) Electron 子进程（GPU/渲染/工具进程）可能在主进程退出后仍存活数秒；
            //    用户又双击了图标、或旧窗口根本没关，也会让目录一直不可替换。
            //    先给 8 秒自己退出的机会，之后由安装器接管（静默升级场景）。
            DateTime grace = DateTime.UtcNow + TimeSpan.FromSeconds(8);
            while (DateTime.UtcNow < deadline)
            {
                if (!InstallerEngine.AnyProcessUnderTarget(target))
                {
                    return;
                }
                if (InstallerEngine.CanTakeOverRunningApp && DateTime.UtcNow >= grace)
                {
                    LogSilent("target still in use, terminating processes under target");
                    InstallerEngine.TerminateProcessesUnderTarget(target, LogSilent);
                    grace = DateTime.UtcNow + TimeSpan.FromSeconds(4);
                    if (!InstallerEngine.AnyProcessUnderTarget(target))
                    {
                        return;
                    }
                }
                Thread.Sleep(500);
            }
            LogSilent("wait for target free timed out");
        }
    }
}
