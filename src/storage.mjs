import { readFile, readdir, lstat, mkdir, rename, rmdir, realpath, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { saveFile } from './files.mjs';
import { readYaml } from './input.mjs';
import { assetPath } from './assets.mjs';
import { ResumeError } from './errors.mjs';

const transient = new Set(['app-session.local.json', '.app-lock.local.json']);
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => new ResumeError(message, { code: 'STORAGE' });
export const containsPath = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
export function settingsPath() {
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local') : process.platform === 'darwin' ? path.join(homedir(), 'Library', 'Application Support') : process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(base, 'TechResumeKit', 'settings.json');
}
export async function canonicalDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw fail('请填写完整的数据文件夹路径');
  let cursor = path.resolve(value), tail = [];
  for (;;) {
    try { return path.join(await realpath(cursor), ...tail); }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(cursor); if (parent === cursor) throw error; tail.unshift(path.basename(cursor)); cursor = parent; }
  }
}
async function exists(filename) { try { return await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
export async function fileHash(filename) {
  const digest = createHash('sha256'); for await (const chunk of createReadStream(filename)) digest.update(chunk); return digest.digest('hex');
}
export async function inventory(directory) {
  const files = []; let total = 0;
  async function visit(folder, prefix = '') {
    const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) throw fail('迁移目录中包含链接或非普通目录，请先整理数据文件夹');
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!prefix && transient.has(entry.name)) continue;
      const filename = path.join(folder, entry.name), relative = prefix + entry.name;
      const stat = await lstat(filename);
      if (stat.isSymbolicLink()) throw fail(`迁移目录中包含链接：${relative}`);
      if (stat.isDirectory()) await visit(filename, relative + '/');
      else if (stat.isFile()) {
        total += stat.size;
        if (total > 1_000_000_000 || files.length >= 20000) throw fail('整库超过 1 GB 或 20000 个文件，请先将资料分开迁移');
        files.push({ name: relative, size: stat.size, sha256: await fileHash(filename) });
      } else throw fail(`迁移目录中包含非普通文件：${relative}`);
    }
  }
  await visit(directory); return files.sort((a, b) => a.name.localeCompare(b.name));
}
async function copyInventory(source, destination, files) {
  await mkdir(destination);
  for (const entry of files) {
    const target = path.join(destination, entry.name); await mkdir(path.dirname(target), { recursive: true });
    await pipeline(createReadStream(path.join(source, entry.name)), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  }
  if (JSON.stringify(await inventory(destination)) !== JSON.stringify(files)) throw fail('迁移文件校验失败，原目录和整库副本已保留');
}
async function verifyReferences(source, files) {
  if (!files.some(file => file.name === 'resume.md') || !files.some(file => file.name === 'layout.yaml')) throw fail('目录缺少 resume.md 或 layout.yaml');
  const names = new Set(files.map(file => file.name));
  for (const file of files.filter(file => file.name === 'resume.md' || /^resumes\/[^/]+\/resume\.md$/.test(file.name))) {
    const text = await readFile(path.join(source, file.name), 'utf8'), match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.replace(/^\uFEFF/, ''));
    let front; try { if (match) front = readYaml(match[1]); } catch { continue; }
    for (const asset of Object.values(front?.assets || {})) {
      if (typeof asset?.src !== 'string') continue;
      const filename = assetPath(path.dirname(path.join(source, file.name)), asset.src);
      if (!containsPath(source, filename)) throw fail(`图片位于数据目录外：${asset.src}；请先将图片放进数据文件夹再迁移`);
      if (!names.has(path.relative(source, filename).split(path.sep).join('/'))) throw fail(`图片文件缺失：${asset.src}；原目录保持不变`);
    }
  }
}
export async function assertInactive(directory) {
  try {
    const session = JSON.parse(await readFile(path.join(directory, 'app-session.local.json'), 'utf8'));
    if (session.pid !== process.pid && Number.isInteger(session.pid) && session.pid > 0) {
      try { process.kill(session.pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
      throw new ResumeError('该数据目录正在使用，请先在原程序中点击“退出”', { code: 'IN_USE' });
    }
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
}
export async function snapshotLibrary(sourceDirectory, backupRoot) {
  const source = await canonicalDirectory(sourceDirectory), backups = await canonicalDirectory(backupRoot);
  if (containsPath(source, backups)) throw fail('整库副本不能保存在原数据目录内');
  const files = await inventory(source), backup = path.join(backups, randomUUID());
  await mkdir(backup, { recursive: true }); await copyInventory(source, path.join(backup, 'data'), files);
  await saveFile(path.join(backup, 'manifest.json'), JSON.stringify({ schemaVersion: 1, source, createdAt: new Date().toISOString(), files }, null, 2));
  if (JSON.stringify(await inventory(source)) !== JSON.stringify(files)) throw fail('备份时文件发生变化，请关闭其他编辑器后重试');
  return { backup, fileCount: files.length, verified: true };
}
export async function lockDirectory(directory) {
  const canonical = await canonicalDirectory(directory), lockRoot = path.join(tmpdir(), 'tech-resume-kit-locks');
  await mkdir(lockRoot, { recursive: true });
  const filename = path.join(lockRoot, hash(process.platform === 'win32' ? canonical.toLowerCase() : canonical) + '.json');
  const nonce = randomUUID(), contents = JSON.stringify({ pid: process.pid, nonce });
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await saveFile(filename, contents); return async () => { try { if ((await readFile(filename, 'utf8')) === contents) await unlink(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; } }; }
    catch (error) {
      if (error.code !== 'EXISTS') throw error;
      let prior; try { prior = JSON.parse(await readFile(filename, 'utf8')); } catch { throw fail('数据目录的启动锁无法读取，请保留文件并重新启动'); }
      try { process.kill(prior.pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw fail('该数据目录正在使用'); await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); continue; }
      throw new ResumeError('该数据目录正在使用，请返回已打开的窗口', { code: 'IN_USE' });
    }
  }
  throw fail('数据目录暂时无法锁定，请重试');
}

export async function migrateLibrary(sourceDirectory, targetDirectory, backupRoot) {
  const source = await canonicalDirectory(sourceDirectory), target = await canonicalDirectory(targetDirectory), backups = await canonicalDirectory(backupRoot);
  if (containsPath(source, target) || containsPath(target, source) || containsPath(source, backups) || containsPath(target, backups)) throw fail('原目录、目标目录和整库副本目录不能互相包含');
  await assertInactive(source); await assertInactive(target);
  const existing = await exists(target);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(target)).length)) throw fail('迁移目标需要是空文件夹，已有资料不会被覆盖');
  const files = await inventory(source); await verifyReferences(source, files);
  const id = randomUUID(), backup = path.join(backups, id); await mkdir(backup, { recursive: true });
  await copyInventory(source, path.join(backup, 'data'), files);
  const report = { schemaVersion: 1, source, target, createdAt: new Date().toISOString(), files };
  await saveFile(path.join(backup, 'manifest.json'), JSON.stringify(report, null, 2));
  await mkdir(path.dirname(target), { recursive: true });
  const stage = path.join(path.dirname(target), `.resume-migration-${id}`);
  await copyInventory(source, stage, files);
  if (JSON.stringify(await inventory(source)) !== JSON.stringify(files)) throw fail('迁移时原文件发生变化，已保留副本，请关闭其他编辑器后重试');
  if (existing) await rmdir(target); // Only an empty, explicitly selected destination can be removed.
  await rename(stage, target);
  return { directory: target, backup, fileCount: files.length, verified: true };
}

export async function openStorage({ directory, settingsFile = settingsPath(), programDirectory = process.cwd() } = {}) {
  const managed = !directory, configFile = path.resolve(settingsFile), home = path.dirname(configFile), programRoot = await canonicalDirectory(programDirectory);
  let settings = { schemaVersion: 1 }, migration;
  if (managed) {
    try {
      settings = JSON.parse(await readFile(configFile, 'utf8'));
      if (settings.schemaVersion !== 1 || typeof settings.dataDirectory !== 'string') throw fail('数据目录设置无法读取，请保留 settings.json');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let root = await canonicalDirectory(directory || settings.dataDirectory || path.join(home, 'data'));
  const backupRoot = path.join(home, 'migrations'), legacyDirectories = [];
  if (await exists(path.join(programRoot, 'my-resume', 'resume.md'))) legacyDirectories.push(path.join(programRoot, 'my-resume'));
  if (!legacyDirectories.length) {
    for (const item of (await readdir(path.dirname(programRoot), { withFileTypes: true })).filter(item => item.isDirectory() && /^tech-resume-windows-x64-/.test(item.name)).slice(0, 30)) {
      const candidate = path.join(path.dirname(programRoot), item.name, 'my-resume');
      if (await exists(path.join(candidate, 'resume.md'))) legacyDirectories.push(candidate);
    }
  }
  function validateTarget(target) {
    if (containsPath(target, home) || containsPath(programRoot, target) || containsPath(target, programRoot)) throw fail('请选择独立于程序和设置文件夹的数据位置');
  }
  if (managed && !settings.dataDirectory) {
    validateTarget(root);
    if (legacyDirectories.length === 1 && !(await exists(root))) {
      const legacy = legacyDirectories[0];
      const release = await lockDirectory(legacy);
      try { migration = await migrateLibrary(legacy, root, backupRoot); } finally { await release(); }
    }
    settings.dataDirectory = root; if (migration) settings.lastMigration = migration;
    await saveFile(configFile, JSON.stringify(settings, null, 2), true);
  }
  async function commit(target, result) {
    if (!managed) throw fail('使用 --dir 启动时，请在启动参数中更换数据位置');
    const next = { ...settings, dataDirectory: target, ...(result ? { lastMigration: result } : {}) };
    await saveFile(configFile, JSON.stringify(next, null, 2), true); settings = next; root = target;
  }
  return {
    get root() { return root; }, managed, configFile, home, programRoot, backupRoot,
    info: () => ({ directory: root, managed, settingsFile: managed ? configFile : null, legacyDirectories, lastMigration: settings.lastMigration || null }),
    async prepare(target, mode, sourceDirectory) {
      target = await canonicalDirectory(target); validateTarget(target);
      if (target === root) throw fail('已经在使用这个数据目录');
      if (containsPath(root, target) || containsPath(target, root)) throw fail('新旧数据目录不能互相包含');
      await assertInactive(target);
      if (mode === 'move') return migrateLibrary(root, target, backupRoot);
      if (mode === 'import') {
        const source = await canonicalDirectory(sourceDirectory), release = await lockDirectory(source);
        try { return await migrateLibrary(source, target, backupRoot); } finally { await release(); }
      }
      if (mode !== 'existing' || !(await exists(path.join(target, 'resume.md')))) throw fail('请选择包含 resume.md 的已有数据目录');
      return { directory: target };
    },
    commit,
  };
}
