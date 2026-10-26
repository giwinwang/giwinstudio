'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function timestamp(now) {
  const date = new Date(now || Date.now());
  const pad = value => String(value).padStart(2, '0');
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' +
    pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

function safeName(value) {
  return String(value || '项目').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 72) || '项目';
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readProject(projectPath) {
  const source = path.resolve(projectPath);
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'project.gw'), 'utf8'));
  if (!metadata || !metadata.id) throw new Error('项目文件无效');
  return { source, metadata };
}

async function projectBytes(root) {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relative = path.relative(root, fullPath);
      if (!relative || relative.startsWith('..')) continue;
      if (relative.split(path.sep)[0].toLowerCase() === 'cache') continue;
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) total += (await fs.promises.stat(fullPath)).size;
    }
  }
  return total;
}

async function assertDiskSpace(destinationRoot, requiredBytes) {
  try {
    const stats = await fs.promises.statfs(destinationRoot);
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (Number.isFinite(available) && available < requiredBytes + 64 * 1024 * 1024) {
      throw new Error('目标磁盘可用空间不足，至少还需要约 ' +
        Math.ceil((requiredBytes + 64 * 1024 * 1024 - available) / 1024 / 1024) + ' MB');
    }
  } catch (error) {
    if (/磁盘可用空间不足/.test(error.message)) throw error;
  }
}

function shouldCopy(sourceRoot, src, restore) {
  const root = path.resolve(sourceRoot);
  const relative = path.relative(root, src);
  if (!relative) return true;
  const top = relative.split(path.sep)[0].toLowerCase();
  if (top === 'cache') return false;
  if (restore && path.basename(src).toLowerCase() === 'backup-info.json') return false;
  return true;
}

async function copyProjectTree(sourceRoot, destinationRoot, restore) {
  async function copyEntry(sourcePath, destinationPath) {
    if (!shouldCopy(sourceRoot, sourcePath, restore)) return;
    const stat = await fs.promises.lstat(sourcePath);
    if (stat.isDirectory()) {
      await fs.promises.mkdir(destinationPath, { recursive: true });
      const entries = await fs.promises.readdir(sourcePath);
      for (const entry of entries) {
        await copyEntry(path.join(sourcePath, entry), path.join(destinationPath, entry));
      }
      return;
    }
    if (stat.isFile()) {
      await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.promises.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    }
  }
  await copyEntry(sourceRoot, destinationRoot);
}

async function createProjectBackup({ projectPath, destinationRoot, appVersion, now } = {}) {
  const { source, metadata } = readProject(projectPath);
  const root = path.resolve(destinationRoot || '');
  if (!root || !fs.existsSync(root)) throw new Error('备份保存位置不可用');
  const name = safeName(metadata.name || path.basename(source)) + '-备份-' + timestamp(now);
  const target = path.join(root, name);
  if (isInside(source, target) || isInside(target, source)) throw new Error('备份位置不能放在项目文件夹内部');
  if (fs.existsSync(target)) throw new Error('备份文件夹已存在，请稍后重试');
  const bytes = await projectBytes(source);
  await assertDiskSpace(root, bytes);
  try {
    await copyProjectTree(source, target, false);
    await fs.promises.writeFile(path.join(target, 'backup-info.json'), JSON.stringify({
      format: 'giwin-project-backup',
      version: 1,
      projectId: metadata.id,
      projectName: metadata.name || path.basename(source),
      createdAt: Number(now) || Date.now(),
      appVersion: String(appVersion || '')
    }, null, 2), 'utf8');
    return { ok: true, path: target, bytes };
  } catch (error) {
    await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function restoreProjectBackup({ backupPath, destinationRoot, now } = {}) {
  const { source, metadata: original } = readProject(backupPath);
  const root = path.resolve(destinationRoot || '');
  if (!root || !fs.existsSync(root)) throw new Error('恢复目标位置不可用');
  const baseName = safeName(original.name || path.basename(source)) + '（恢复）';
  let target = path.join(root, baseName);
  if (fs.existsSync(target)) target = path.join(root, baseName + '-' + timestamp(now));
  if (isInside(source, target) || isInside(target, source)) throw new Error('恢复位置不能放在备份文件夹内部');
  const temp = path.join(root, '.gw-restore-' + crypto.randomUUID());
  const bytes = await projectBytes(source);
  await assertDiskSpace(root, bytes);
  try {
    await copyProjectTree(source, temp, true);
    const createdAt = Number(now) || Date.now();
    const project = {
      id: crypto.randomUUID(),
      name: baseName,
      path: target,
      createdAt,
      lastOpened: createdAt
    };
    const metadataPath = path.join(temp, 'project.gw');
    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
    Object.assign(metadata, {
      version: 1,
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      lastOpened: project.lastOpened,
      restoredFrom: original.id,
      restoredAt: createdAt
    });
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    await fs.promises.rename(temp, target);
    return { ok: true, project, bytes };
  } catch (error) {
    await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { createProjectBackup, restoreProjectBackup };
