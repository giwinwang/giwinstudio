const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createProjectBackup, restoreProjectBackup } = require('../project-backup');

test('complete project backup copies canvas, versions and originals without cache', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gw-backup-test-'));
  const source = path.join(root, 'source-project');
  const backupRoot = path.join(root, 'backups');
  const restoreRoot = path.join(root, 'restored');
  try {
    await fs.promises.mkdir(path.join(source, 'Content'), { recursive: true });
    await fs.promises.mkdir(path.join(source, 'Config', 'versions'), { recursive: true });
    await fs.promises.mkdir(path.join(source, 'cache', 'thumbs'), { recursive: true });
    await fs.promises.mkdir(backupRoot, { recursive: true });
    await fs.promises.mkdir(restoreRoot, { recursive: true });
    await fs.promises.writeFile(path.join(source, 'project.gw'), JSON.stringify({
      version: 1, id: 'project-original', name: 'Source Project', createdAt: 1
    }));
    await fs.promises.writeFile(path.join(source, 'Content', 'render.png'), 'image-data');
    await fs.promises.writeFile(path.join(source, 'Config', 'canvas.json'), JSON.stringify({ nodes: [{ id: 'node-1' }] }));
    await fs.promises.writeFile(path.join(source, 'Config', 'versions', 'v1.json'), JSON.stringify({ id: 'v1' }));
    await fs.promises.writeFile(path.join(source, 'cache', 'thumbs', 'thumb.bin'), 'cache-only');

    const backup = await createProjectBackup({
      projectPath: source,
      destinationRoot: backupRoot,
      appVersion: '0.4.25',
      now: new Date('2026-10-24T10:20:30+08:00').getTime()
    });
    assert.equal(backup.ok, true);
    assert.ok(fs.existsSync(path.join(backup.path, 'backup-info.json')));
    assert.ok(fs.existsSync(path.join(backup.path, 'project.gw')));
    assert.ok(fs.existsSync(path.join(backup.path, 'Config', 'canvas.json')));
    assert.ok(fs.existsSync(path.join(backup.path, 'Config', 'versions', 'v1.json')));
    assert.ok(fs.existsSync(path.join(backup.path, 'Content', 'render.png')));
    assert.equal(fs.existsSync(path.join(backup.path, 'cache')), false);

    const restored = await restoreProjectBackup({
      backupPath: backup.path,
      destinationRoot: restoreRoot,
      now: new Date('2026-10-24T11:00:00+08:00').getTime()
    });
    assert.equal(restored.ok, true);
    assert.notEqual(restored.project.id, 'project-original');
    assert.match(restored.project.name, /恢复/);
    assert.ok(fs.existsSync(path.join(restored.project.path, 'Content', 'render.png')));
    assert.ok(fs.existsSync(path.join(restored.project.path, 'Config', 'versions', 'v1.json')));
    assert.equal(fs.existsSync(path.join(restored.project.path, 'backup-info.json')), false);
    const metadata = JSON.parse(fs.readFileSync(path.join(restored.project.path, 'project.gw'), 'utf8'));
    assert.equal(metadata.id, restored.project.id);
    assert.equal(metadata.restoredFrom, 'project-original');
    assert.equal(JSON.parse(fs.readFileSync(path.join(source, 'project.gw'), 'utf8')).id, 'project-original');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('project page exposes backup and restore actions', () => {
  const root = path.resolve(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(index, /id="btn-backup-project"/);
  assert.match(index, /id="btn-restore-backup"/);
  assert.match(app, /ipcRenderer\.invoke\('projects:exportBackup'/);
  assert.match(app, /ipcRenderer\.invoke\('projects:restoreBackup'/);
  assert.match(main, /ipcMain\.handle\('projects:exportBackup'/);
  assert.match(main, /ipcMain\.handle\('projects:restoreBackup'/);
});
