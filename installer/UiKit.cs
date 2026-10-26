using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Giwin.Installer
{
    internal static class Theme
    {
        internal static readonly Color Window = Color.FromArgb(18, 19, 17);
        internal static readonly Color Header = Color.FromArgb(25, 27, 25);
        internal static readonly Color Surface = Color.FromArgb(23, 26, 24);
        internal static readonly Color Field = Color.FromArgb(11, 13, 11);
        internal static readonly Color FieldBorder = Color.FromArgb(53, 57, 54);
        internal static readonly Color Border = Color.FromArgb(46, 50, 47);
        internal static readonly Color Text = Color.FromArgb(242, 239, 233);
        internal static readonly Color Muted = Color.FromArgb(167, 170, 164);
        internal static readonly Color Faint = Color.FromArgb(119, 123, 118);
        internal static readonly Color Accent = Color.FromArgb(120, 148, 164);
        internal static readonly Color AccentText = Color.FromArgb(16, 24, 29);
        internal static readonly Color Footer = Color.FromArgb(15, 17, 15);
        internal static readonly Color Danger = Color.FromArgb(164, 100, 92);
    }

    internal static class Ui
    {
        internal static Font Font(float size, FontStyle style)
        {
            try
            {
                return new Font("Microsoft YaHei UI", size, style, GraphicsUnit.Point);
            }
            catch
            {
                return new Font("Segoe UI", size, style, GraphicsUnit.Point);
            }
        }

        internal static Font LatinFont(float size, FontStyle style)
        {
            try
            {
                return new Font("Segoe UI Semibold", size, style, GraphicsUnit.Point);
            }
            catch
            {
                return new Font("Segoe UI", size, style, GraphicsUnit.Point);
            }
        }

        internal static GraphicsPath Rounded(RectangleF bounds, float radius)
        {
            GraphicsPath path = new GraphicsPath();
            float diameter = Math.Min(radius * 2f, Math.Min(bounds.Width, bounds.Height));
            RectangleF arc = new RectangleF(bounds.X, bounds.Y, diameter, diameter);
            path.AddArc(arc, 180f, 90f);
            arc.X = bounds.Right - diameter;
            path.AddArc(arc, 270f, 90f);
            arc.Y = bounds.Bottom - diameter;
            path.AddArc(arc, 0f, 90f);
            arc.X = bounds.Left;
            path.AddArc(arc, 90f, 90f);
            path.CloseFigure();
            return path;
        }

        internal static Label Label(string text, int x, int y, int width, int height, float size, Color color, FontStyle style = FontStyle.Regular)
        {
            return new Label
            {
                Text = text,
                Location = new Point(x, y),
                Size = new Size(width, height),
                AutoSize = false,
                ForeColor = color,
                BackColor = Color.Transparent,
                Font = Font(size, style),
                TextAlign = ContentAlignment.MiddleLeft,
                UseCompatibleTextRendering = false
            };
        }

        internal static void ApplyRoundedRegion(Control control, int radius)
        {
            if (control.Width <= 0 || control.Height <= 0)
            {
                return;
            }
            using (GraphicsPath path = Rounded(new RectangleF(0f, 0f, control.Width, control.Height), radius))
            {
                Region old = control.Region;
                control.Region = new Region(path);
                if (old != null)
                {
                    old.Dispose();
                }
            }
        }
    }

    internal sealed class LogoMark : Control
    {
        public LogoMark()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            Size = new Size(20, 20);
            TabStop = false;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float scale = Math.Min(Width / 557f, Height / 556f);
            float offsetX = (Width - 557f * scale) / 2f;
            float offsetY = (Height - 556f * scale) / 2f;
            PointF[] source =
            {
                new PointF(0f, 0f),
                new PointF(557f, 0f),
                new PointF(557f, 273f),
                new PointF(461f, 273f),
                new PointF(461f, 84f),
                new PointF(97f, 84f),
                new PointF(97f, 468f),
                new PointF(280f, 468f),
                new PointF(280f, 556f),
                new PointF(0f, 556f)
            };
            PointF[] points = new PointF[source.Length];
            for (int index = 0; index < source.Length; index++)
            {
                points[index] = new PointF(offsetX + source[index].X * scale, offsetY + source[index].Y * scale);
            }
            using (SolidBrush brush = new SolidBrush(Theme.Text))
            {
                e.Graphics.FillPolygon(brush, points);
            }
        }
    }

    internal sealed class FolderGlyph : Control
    {
        internal FolderGlyph()
        {
            Size = new Size(17, 15);
            TabStop = false;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (Pen pen = new Pen(Theme.Muted, 1.2f))
            {
                e.Graphics.DrawLine(pen, 1f, 4f, 6f, 4f);
                e.Graphics.DrawLine(pen, 6f, 4f, 8f, 6f);
                using (GraphicsPath path = Ui.Rounded(new RectangleF(1f, 6f, 15f, 8f), 2f))
                {
                    e.Graphics.DrawPath(pen, path);
                }
            }
        }
    }

    internal class RoundedPanel : Panel
    {
        internal int Radius { get; set; }
        internal Color FillColor { get; set; }
        internal Color BorderColor { get; set; }
        internal bool DrawBorder { get; set; }

        internal RoundedPanel()
        {
            Radius = 12;
            FillColor = Theme.Surface;
            BorderColor = Theme.Border;
            DrawBorder = true;
            DoubleBuffered = true;
            BackColor = Theme.Window;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnResize(EventArgs eventargs)
        {
            base.OnResize(eventargs);
            Ui.ApplyRoundedRegion(this, Radius);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF bounds = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
            using (GraphicsPath path = Ui.Rounded(bounds, Radius))
            using (SolidBrush fill = new SolidBrush(FillColor))
            {
                e.Graphics.FillPath(fill, path);
                if (DrawBorder)
                {
                    using (Pen pen = new Pen(BorderColor, 1f))
                    {
                        e.Graphics.DrawPath(pen, path);
                    }
                }
            }
        }
    }

    internal sealed class UiButton : Button
    {
        internal Color FillColor { get; set; }
        internal Color TextColor { get; set; }
        internal Color HoverColor { get; set; }
        internal Color ButtonBorderColor { get; set; }
        internal bool DrawBorder { get; set; }
        internal int Radius { get; set; }
        private bool hovering;

        internal UiButton()
        {
            FillColor = Theme.Accent;
            TextColor = Theme.AccentText;
            HoverColor = Color.FromArgb(138, 164, 178);
            ButtonBorderColor = Theme.Border;
            Radius = 9;
            DrawBorder = false;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            UseVisualStyleBackColor = false;
            Font = Ui.Font(9.3f, FontStyle.Regular);
            Cursor = Cursors.Hand;
            TabStop = true;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnResize(EventArgs eventargs)
        {
            base.OnResize(eventargs);
            Ui.ApplyRoundedRegion(this, Radius);
        }

        protected override void OnMouseEnter(EventArgs eventargs)
        {
            hovering = true;
            Invalidate();
            base.OnMouseEnter(eventargs);
        }

        protected override void OnMouseLeave(EventArgs eventargs)
        {
            hovering = false;
            Invalidate();
            base.OnMouseLeave(eventargs);
        }

        protected override void OnPaint(PaintEventArgs pevent)
        {
            pevent.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF bounds = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
            Color fill = Enabled ? (hovering ? HoverColor : FillColor) : Color.FromArgb(61, 75, 83);
            Color text = Enabled ? TextColor : Theme.Muted;
            using (GraphicsPath path = Ui.Rounded(bounds, Radius))
            using (SolidBrush brush = new SolidBrush(fill))
            {
                pevent.Graphics.FillPath(brush, path);
                if (DrawBorder)
                {
                    using (Pen pen = new Pen(ButtonBorderColor, 1f))
                    {
                        pevent.Graphics.DrawPath(pen, path);
                    }
                }
            }
            TextRenderer.DrawText(
                pevent.Graphics,
                Text,
                Font,
                ClientRectangle,
                text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            if (Focused && ShowFocusCues)
            {
                Rectangle focus = Rectangle.Inflate(ClientRectangle, -5, -5);
                ControlPaint.DrawFocusRectangle(pevent.Graphics, focus, Theme.Text, fill);
            }
        }
    }

    internal sealed class CheckTile : Control
    {
        private bool checkedValue;

        internal bool Checked
        {
            get { return checkedValue; }
            set
            {
                if (checkedValue == value)
                {
                    return;
                }
                checkedValue = value;
                Invalidate();
                EventHandler handler = CheckedChanged;
                if (handler != null)
                {
                    handler(this, EventArgs.Empty);
                }
            }
        }

        internal event EventHandler CheckedChanged;

        internal CheckTile()
        {
            checkedValue = true;
            Height = 38;
            BackColor = Theme.Field;
            ForeColor = Theme.Muted;
            Font = Ui.Font(8.8f, FontStyle.Regular);
            Cursor = Cursors.Hand;
            TabStop = true;
            AccessibleRole = AccessibleRole.CheckButton;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
        }

        protected override void OnClick(EventArgs e)
        {
            base.OnClick(e);
            Checked = !Checked;
            Focus();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter)
            {
                Checked = !Checked;
                e.Handled = true;
            }
            base.OnKeyDown(e);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            Ui.ApplyRoundedRegion(this, 9);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF bounds = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
            using (GraphicsPath path = Ui.Rounded(bounds, 9))
            using (SolidBrush fill = new SolidBrush(Theme.Field))
            using (Pen border = new Pen(Focused ? Theme.Accent : Theme.Border, 1f))
            {
                e.Graphics.FillPath(fill, path);
                e.Graphics.DrawPath(border, path);
            }
            Rectangle box = new Rectangle(11, (Height - 15) / 2, 15, 15);
            using (SolidBrush boxFill = new SolidBrush(Checked ? Theme.Accent : Theme.Window))
            using (Pen boxBorder = new Pen(Checked ? Theme.Accent : Theme.FieldBorder, 1f))
            {
                e.Graphics.FillRectangle(boxFill, box);
                e.Graphics.DrawRectangle(boxBorder, box);
            }
            if (Checked)
            {
                using (Pen check = new Pen(Theme.AccentText, 1.8f))
                {
                    check.StartCap = LineCap.Round;
                    check.EndCap = LineCap.Round;
                    e.Graphics.DrawLines(check, new[]
                    {
                        new Point(box.Left + 3, box.Top + 7),
                        new Point(box.Left + 6, box.Top + 10),
                        new Point(box.Left + 12, box.Top + 4)
                    });
                }
            }
            Rectangle textBounds = new Rectangle(34, 0, Width - 42, Height);
            TextRenderer.DrawText(
                e.Graphics,
                Text,
                Font,
                textBounds,
                Theme.Muted,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            if (Focused && ShowFocusCues)
            {
                ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle, -4, -4), Theme.Text, Theme.Field);
            }
        }
    }

    internal sealed class ProgressBarEx : Control
    {
        private int progressValue;

        internal int Value
        {
            get { return progressValue; }
            set
            {
                int next = Math.Max(0, Math.Min(100, value));
                if (progressValue == next)
                {
                    return;
                }
                progressValue = next;
                Invalidate();
            }
        }

        internal ProgressBarEx()
        {
            Height = 8;
            AccessibleRole = AccessibleRole.ProgressBar;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF track = new RectangleF(0f, 0f, Width, Height);
            using (GraphicsPath path = Ui.Rounded(track, Height / 2f))
            using (SolidBrush background = new SolidBrush(Theme.Field))
            {
                e.Graphics.FillPath(background, path);
            }
            if (progressValue <= 0)
            {
                return;
            }
            float fillWidth = Math.Max(Height, Width * progressValue / 100f);
            RectangleF fill = new RectangleF(0f, 0f, Math.Min(Width, fillWidth), Height);
            using (GraphicsPath path = Ui.Rounded(fill, Height / 2f))
            using (SolidBrush foreground = new SolidBrush(Theme.Accent))
            {
                e.Graphics.FillPath(foreground, path);
            }
        }
    }

    internal class DarkWindow : Form
    {
        private const int WmNclButtonDown = 0xA1;
        private const int HtCaption = 0x2;

        protected Panel HeaderPanel { get; private set; }
        protected Panel FooterPanel { get; private set; }
        protected UiButton CloseButton { get; private set; }

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam);

        internal DarkWindow(Size size)
        {
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96f, 96f);
            ClientSize = size;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ShowIcon = false;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Theme.Window;
            ForeColor = Theme.Text;
            Font = Ui.Font(9f, FontStyle.Regular);
            DoubleBuffered = true;
            KeyPreview = true;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.ClassStyle |= 0x00020000;
                return parameters;
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Ui.ApplyRoundedRegion(this, 18);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (Pen pen = new Pen(Color.FromArgb(36, 40, 43), 1f))
            using (GraphicsPath path = Ui.Rounded(new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f), 18))
            {
                e.Graphics.DrawPath(pen, path);
            }
        }

        protected void BuildHeader(bool showClose, EventHandler closeHandler)
        {
            HeaderPanel = new Panel
            {
                Location = Point.Empty,
                Size = new Size(ClientSize.Width, 52),
                BackColor = Theme.Header
            };
            Controls.Add(HeaderPanel);

            LogoMark logo = new LogoMark { Location = new Point(18, 16) };
            HeaderPanel.Controls.Add(logo);

            Label tagline = Ui.Label("为设计而生", 46, 10, 180, 13, 7.4f, Theme.Faint);
            tagline.Font = Ui.Font(7.4f, FontStyle.Regular);
            HeaderPanel.Controls.Add(tagline);

            Label wordmark = Ui.Label("GIWIN STUDIO", 46, 24, 180, 14, 8.4f, Theme.Text, FontStyle.Bold);
            wordmark.Font = Ui.LatinFont(8.4f, FontStyle.Bold);
            HeaderPanel.Controls.Add(wordmark);

            if (showClose)
            {
                CloseButton = new UiButton
                {
                    Text = "×",
                    Size = new Size(30, 30),
                    Location = new Point(ClientSize.Width - 42, 11),
                    FillColor = Color.Transparent,
                    HoverColor = Theme.Surface,
                    TextColor = Theme.Muted,
                    Font = Ui.Font(13f, FontStyle.Regular),
                    AccessibleName = "关闭",
                    DialogResult = DialogResult.Cancel
                };
                CloseButton.Click += closeHandler;
                HeaderPanel.Controls.Add(CloseButton);
            }

            Panel line = new Panel { Location = new Point(0, 51), Size = new Size(ClientSize.Width, 1), BackColor = Theme.Border };
            HeaderPanel.Controls.Add(line);

            MouseEventHandler drag = delegate(object sender, MouseEventArgs args)
            {
                if (args.Button == MouseButtons.Left)
                {
                    ReleaseCapture();
                    SendMessage(Handle, WmNclButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
                }
            };
            HeaderPanel.MouseDown += drag;
            logo.MouseDown += drag;
            tagline.MouseDown += drag;
            wordmark.MouseDown += drag;
        }

        protected void BuildFooter()
        {
            FooterPanel = new Panel
            {
                Location = new Point(0, ClientSize.Height - 56),
                Size = new Size(ClientSize.Width, 56),
                BackColor = Theme.Footer
            };
            Panel line = new Panel { Location = new Point(0, 0), Size = new Size(ClientSize.Width, 1), BackColor = Theme.Border };
            FooterPanel.Controls.Add(line);
            Controls.Add(FooterPanel);
        }
    }
}
