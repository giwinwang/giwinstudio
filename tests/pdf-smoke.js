const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: 338.67mm 190.5mm; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .page { width: 338.67mm; height: 190.5mm; page-break-after: always; background: #f3efe8; }
      .page:last-child { page-break-after: auto; }
      h1 { margin: 0; padding: 28mm 20mm; font: 700 28px sans-serif; color: #20201e; }
    </style></head><body>
      <section class="page"><h1>GIWIN PDF smoke test · page 1</h1></section>
      <section class="page"><h1>GIWIN PDF smoke test · page 2</h1></section>
    </body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: { width: 338667, height: 190500 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    const output = path.resolve(__dirname, '..', 'pdf-smoke.pdf');
    fs.writeFileSync(output, pdf);
    console.log(JSON.stringify({ output, bytes: pdf.length }));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error.message);
    app.exit(1);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});
