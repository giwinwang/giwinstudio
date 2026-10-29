using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("极物 GIWIN Studio 卸载程序")]
[assembly: AssemblyDescription("极物 GIWIN Studio 本地卸载程序")]
[assembly: AssemblyProduct("极物 GIWIN Studio")]
[assembly: AssemblyCompany("GIWIN")]
[assembly: AssemblyVersion(Giwin.Installer.AppVersion.Assembly)]
[assembly: AssemblyFileVersion(Giwin.Installer.AppVersion.Assembly)]

namespace Giwin.Installer
{
    internal static class UninstallEngine
    {
        private const string ManifestName = "install-manifest.txt";

        internal static void RemoveFiles(string installDirectory, Action<int, string> report, Func<bool> cancelled)
        {
            string root = Path.GetFullPath(installDirectory).TrimEnd(Path.DirectorySeparatorChar);
            ValidateDirectory(root);
            if (IsApplicationRunning(root))
            {
                throw new InvalidOperationException("极物正在运行。请先关闭软件，再继续卸载。");
            }
            string manifest = Path.Combine(root, ManifestName);
            if (!File.Exists(manifest))
            {
                throw new InvalidOperationException("没有找到安装清单，无法安全卸载。");
            }

            string rootPrefix = root + Path.DirectorySeparatorChar;
            string current = Path.GetFullPath(Application.ExecutablePath);
            string[] files = File.ReadAllLines(manifest);
            int index = 0;
            foreach (string relative in files)
            {
                if (cancelled())
                {
                    throw new OperationCanceledException();
                }
                index++;
                if (String.IsNullOrWhiteSpace(relative))
                {
                    continue;
                }
                string path = Path.GetFullPath(Path.Combine(root, relative));
                if (!path.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                if (String.Equals(path, current, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                try
                {
                    if (File.Exists(path))
                    {
                        File.SetAttributes(path, FileAttributes.Normal);
                        File.Delete(path);
                    }
                }
                catch
                {
                }
                int percent = 15 + (int)(70d * index / Math.Max(1, files.Length));
                report(Math.Min(85, percent), "正在移除应用文件");
            }

            try
            {
                if (File.Exists(manifest))
                {
                    File.Delete(manifest);
                }
            }
            catch
            {
            }

            DeleteShortcuts();
            DeleteRegistryEntry();
            report(92, "正在清理快捷方式");

            string[] directories = Directory.GetDirectories(root, "*", SearchOption.AllDirectories);
            Array.Sort(directories);
            Array.Reverse(directories);
            foreach (string directory in directories)
            {
                try
                {
                    if (Directory.Exists(directory) &&
                        !String.Equals(directory, root, StringComparison.OrdinalIgnoreCase) &&
                        Directory.GetFileSystemEntries(directory).Length == 0)
                    {
                        Directory.Delete(directory, false);
                    }
                }
                catch
                {
                }
            }
            report(100, "卸载完成");
        }

        internal static void ScheduleDirectoryRemoval(string directory)
        {
            string root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
            ValidateDirectory(root);
            string command = "/d /c ping 127.0.0.1 -n 2 >nul & rmdir /s /q \"" + root.Replace("\"", "\"\"") + "\"";
            Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "cmd.exe"),
                Arguments = command,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
        }

        private static void ValidateDirectory(string root)
        {
            string pathRoot = Path.GetPathRoot(root).TrimEnd(Path.DirectorySeparatorChar);
            if (String.IsNullOrEmpty(root) || String.Equals(root, pathRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("安装目录无效。");
            }
            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows).TrimEnd(Path.DirectorySeparatorChar);
            if (String.Equals(root, windows, StringComparison.OrdinalIgnoreCase) ||
                root.StartsWith(windows + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("不能从 Windows 系统目录中卸载。");
            }
        }

        private static bool IsApplicationRunning(string root)
        {
            string prefix = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            foreach (Process process in Process.GetProcesses())
            {
                try
                {
                    string path = process.MainModule == null ? null : process.MainModule.FileName;
                    if (!String.IsNullOrEmpty(path) &&
                        path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) &&
                        !String.Equals(path, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }
            return false;
        }

        private static void DeleteShortcuts()
        {
            string[] shortcuts =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "极物 GIWIN Studio.lnk"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "极物 GIWIN Studio.lnk")
            };
            foreach (string shortcut in shortcuts)
            {
                try
                {
                    if (File.Exists(shortcut))
                    {
                        File.Delete(shortcut);
                    }
                }
                catch
                {
                }
            }
        }

        private static void DeleteRegistryEntry()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall\GIWINStudio",
                    false);
            }
            catch
            {
            }
        }
    }

    internal sealed class UninstallerWindow : DarkWindow
    {
        private readonly Panel confirmPage;
        private readonly Panel progressPage;
        private readonly Panel completePage;
        private readonly UiButton footerButton;
        private readonly Label footerText;
        private readonly Label progressPercent;
        private readonly Label progressStatus;
        private readonly ProgressBarEx progressBar;
        private readonly string installDirectory;
        private Thread uninstallThread;
        private volatile bool cancelRequested;

        internal UninstallerWindow()
            : base(new Size(760, 540))
        {
            installDirectory = Path.GetDirectoryName(Application.ExecutablePath);
            Text = "极物 GIWIN Studio";
            BuildHeader(true, delegate
            {
                if (uninstallThread == null)
                {
                    Close();
                }
            });
            BuildFooter();

            confirmPage = NewPage();
            progressPage = NewPage();
            completePage = NewPage();
            Controls.Add(confirmPage);
            Controls.Add(progressPage);
            Controls.Add(completePage);

            AddTitle(confirmPage, "移除极物", "只删除应用文件，不会删除项目和素材。");
            confirmPage.Controls.Add(BuildChip(Giwin.Installer.AppVersion.Chip, 584, 54, 92, 24));
            RoundedPanel card = new RoundedPanel
            {
                Location = new Point(56, 132),
                Size = new Size(648, 150),
                FillColor = Theme.Surface,
                BorderColor = Theme.FieldBorder
            };
            confirmPage.Controls.Add(card);
            Label appName = Ui.Label("极物 GIWIN Studio", 18, 18, 410, 25, 9.6f, Theme.Text, FontStyle.Bold);
            card.Controls.Add(appName);
            Label installPath = Ui.Label(installDirectory, 18, 48, 600, 24, 8.1f, Theme.Muted);
            card.Controls.Add(installPath);
            Panel divider = new Panel { Location = new Point(18, 83), Size = new Size(612, 1), BackColor = Theme.Border };
            card.Controls.Add(divider);
            Label keepTitle = Ui.Label("会保留", 18, 96, 100, 18, 7.8f, Theme.Faint);
            card.Controls.Add(keepTitle);
            Label keepCopy = Ui.Label("项目、导出文件、素材与账号设置", 18, 114, 350, 20, 8.2f, Theme.Text);
            card.Controls.Add(keepCopy);
            Label removeTitle = Ui.Label("会移除", 392, 96, 100, 18, 7.8f, Theme.Faint);
            card.Controls.Add(removeTitle);
            Label removeCopy = Ui.Label("应用、快捷方式和卸载信息", 392, 114, 240, 20, 8.2f, Theme.Text);
            card.Controls.Add(removeCopy);
            AddNotice(confirmPage, "请先关闭极物。卸载过程中不会改动你的项目和素材。", 298);
            UiButton uninstallButton = new UiButton
            {
                Text = "卸载极物",
                Location = new Point(56, 334),
                Size = new Size(648, 44),
                FillColor = Theme.Danger,
                HoverColor = Color.FromArgb(181, 115, 106),
                TextColor = Color.FromArgb(255, 248, 245),
                Font = Ui.Font(9.5f, FontStyle.Regular),
                AccessibleName = "卸载极物"
            };
            uninstallButton.Click += delegate { StartUninstall(); };
            confirmPage.Controls.Add(uninstallButton);

            Label progressKicker = Ui.Label("正在卸载", 56, 30, 180, 19, 8.1f, Theme.Faint);
            progressPage.Controls.Add(progressKicker);
            Label progressTitle = Ui.Label("正在清理应用", 56, 50, 460, 44, 21f, Theme.Text, FontStyle.Bold);
            progressPage.Controls.Add(progressTitle);
            Label progressCopy = Ui.Label("项目和素材不会被删除。", 56, 94, 460, 22, 8.4f, Theme.Muted);
            progressPage.Controls.Add(progressCopy);
            progressPercent = Ui.Label("0%", 670, 104, 34, 22, 8.4f, Theme.Text, FontStyle.Bold);
            progressPercent.TextAlign = ContentAlignment.MiddleRight;
            progressPage.Controls.Add(progressPercent);
            RoundedPanel progressCard = new RoundedPanel
            {
                Location = new Point(56, 132),
                Size = new Size(648, 104),
                FillColor = Theme.Surface,
                BorderColor = Theme.FieldBorder
            };
            progressPage.Controls.Add(progressCard);
            progressStatus = Ui.Label("正在移除应用文件", 18, 19, 430, 22, 8.7f, Theme.Text, FontStyle.Bold);
            progressCard.Controls.Add(progressStatus);
            progressBar = new ProgressBarEx { Location = new Point(18, 54), Size = new Size(612, 8), Value = 0 };
            progressCard.Controls.Add(progressBar);
            progressPage.Controls.Add(BuildChip("本地卸载", 584, 104, 92, 24));

            Label completeKicker = Ui.Label("卸载完成", 56, 30, 180, 19, 8.1f, Theme.Faint);
            completePage.Controls.Add(completeKicker);
            Label completeTitle = Ui.Label("已移除", 56, 50, 300, 44, 21f, Theme.Text, FontStyle.Bold);
            completePage.Controls.Add(completeTitle);
            RoundedPanel completeCard = new RoundedPanel
            {
                Location = new Point(56, 132),
                Size = new Size(648, 120),
                FillColor = Theme.Surface,
                BorderColor = Theme.FieldBorder
            };
            completePage.Controls.Add(completeCard);
            RoundedPanel seal = new RoundedPanel
            {
                Location = new Point(18, 18),
                Size = new Size(44, 44),
                FillColor = Theme.Accent,
                BorderColor = Theme.Accent,
                Radius = 11
            };
            completeCard.Controls.Add(seal);
            Label check = Ui.Label("✓", 0, -1, 44, 44, 15f, Theme.AccentText, FontStyle.Bold);
            check.TextAlign = ContentAlignment.MiddleCenter;
            seal.Controls.Add(check);
            Label doneTitle = Ui.Label("极物 GIWIN Studio 已移除", 78, 19, 420, 22, 9.4f, Theme.Text, FontStyle.Bold);
            completeCard.Controls.Add(doneTitle);
            Label doneCopy = Ui.Label("项目、导出文件和素材仍保留在本机。", 78, 42, 420, 20, 8.2f, Theme.Muted);
            completeCard.Controls.Add(doneCopy);
            Label note = Ui.Label("安装目录将在窗口关闭后自动清理。", 18, 82, 600, 20, 8.1f, Theme.Faint);
            completeCard.Controls.Add(note);
            AddNotice(completePage, "感谢使用极物。", 284);

            footerText = Ui.Label("极物，为设计而生", 38, 0, 430, 56, 8.2f, Theme.Faint);
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

            ShowPage(confirmPage);
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

        private void AddTitle(Control page, string titleText, string copyText)
        {
            Label title = Ui.Label(titleText, 56, 50, 460, 44, 21f, Theme.Text, FontStyle.Bold);
            page.Controls.Add(title);
            Label copy = Ui.Label(copyText, 56, 94, 500, 22, 8.4f, Theme.Muted);
            page.Controls.Add(copy);
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

        private void ShowPage(Panel page)
        {
            confirmPage.Visible = page == confirmPage;
            progressPage.Visible = page == progressPage;
            completePage.Visible = page == completePage;
        }

        private void StartUninstall()
        {
            ShowPage(progressPage);
            footerButton.Text = "请稍候";
            footerButton.Enabled = false;
            cancelRequested = false;
            uninstallThread = new Thread(delegate()
            {
                try
                {
                    UninstallEngine.RemoveFiles(
                        installDirectory,
                        delegate(int value, string status)
                        {
                            OnUi(delegate
                            {
                                progressBar.Value = value;
                                progressPercent.Text = value + "%";
                                progressStatus.Text = status;
                            });
                        },
                        delegate { return cancelRequested; });
                    OnUi(delegate
                    {
                        ShowPage(completePage);
                        footerText.Text = "极物，为设计而生";
                        footerButton.Text = "关闭";
                        footerButton.Enabled = true;
                        footerButton.AccessibleName = "关闭";
                        if (CloseButton != null)
                        {
                            CloseButton.Enabled = true;
                        }
                        uninstallThread = null;
                    });
                }
                catch (Exception error)
                {
                    OnUi(delegate
                    {
                        ShowPage(confirmPage);
                        footerButton.Text = "取消";
                        footerButton.Enabled = true;
                        if (CloseButton != null)
                        {
                            CloseButton.Enabled = true;
                        }
                        uninstallThread = null;
                        using (UninstallErrorDialog dialog = new UninstallErrorDialog(error.Message))
                        {
                            dialog.ShowDialog(this);
                        }
                    });
                }
            });
            uninstallThread.IsBackground = true;
            uninstallThread.Start();
        }

        private void FooterAction()
        {
            if (completePage.Visible)
            {
                Close();
                return;
            }
            if (uninstallThread != null)
            {
                return;
            }
            Close();
        }

        internal void ShowPreviewState(string state)
        {
            if (String.Equals(state, "complete", StringComparison.OrdinalIgnoreCase))
            {
                ShowPage(completePage);
                footerText.Text = "极物，为设计而生";
                footerButton.Text = "关闭";
                footerButton.Enabled = true;
                footerButton.AccessibleName = "关闭";
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
            if (uninstallThread != null && uninstallThread.IsAlive)
            {
                e.Cancel = true;
                return;
            }
            if (completePage.Visible)
            {
                try
                {
                    UninstallEngine.ScheduleDirectoryRemoval(installDirectory);
                }
                catch
                {
                }
            }
            base.OnFormClosing(e);
        }
    }

    internal sealed class UninstallErrorDialog : DarkWindow
    {
        internal UninstallErrorDialog(string message)
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
                AccessibleName = "知道了"
            };
            ok.Click += delegate { Close(); };
            Controls.Add(ok);
        }
    }

    internal static class UninstallerProgram
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool silent = Array.IndexOf(args, "--silent") >= 0;
            string installDirectory = Path.GetDirectoryName(Application.ExecutablePath);
            if (silent)
            {
                try
                {
                    UninstallEngine.RemoveFiles(installDirectory, delegate { }, delegate { return false; });
                    UninstallEngine.ScheduleDirectoryRemoval(installDirectory);
                    return 0;
                }
                catch
                {
                    return 1;
                }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            int snapshotIndex = Array.IndexOf(args, "--snapshot");
            if (snapshotIndex >= 0 && args.Length > snapshotIndex + 1)
            {
                using (UninstallerWindow window = new UninstallerWindow())
                {
                    if (Array.IndexOf(args, "--complete") >= 0)
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

            Application.Run(new UninstallerWindow());
            return 0;
        }
    }
}
