import { readFile, readdir, lstat, mkdir, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { zipSync, Unzip, UnzipInflate } from 'fflate';
import { z } from 'zod';
import { imageSize } from 'image-size';
import { catalogSchema, trashSchema, validateCatalogs, emptyTrash, uuid } from './catalog.mjs';
import { readYaml } from './input.mjs';
import { layoutSchema, validate } from './schema.mjs';
import { saveFile } from './files.mjs';
import { ResumeError } from './errors.mjs';

export const libraryBackupLimit = 128_000_000;
const expandedLimit = 256_000_000, fileCountLimit = 5000;
const hash = data => createHash('sha256').update(data).digest('hex');
const fail = message => new ResumeError(`整库备份无法使用：${message}`, { code: 'LIBRARY_BACKUP' });
const id = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const projectFile = new RegExp(`^(?:resumes/${id}/)?(?:resume\\.md|layout\\.yaml|\\.gitignore|assets/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\\.(?:png|jpe?g)|backups/[0-9][0-9A-Za-z_.-]{1,100}/(?:resume\\.md|layout\\.yaml))$`);
const historyFile = new RegExp(`^history/(?:legacy|${id})/${id}\\.(?:json|zip)$`);
function allowed(name) {
  if (typeof name !== 'string' || name.split('/').some(part => part === '.' || part === '..' || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return false;
  return ['library.json', 'trash.json', 'library-backup.json'].includes(name) || projectFile.test(name) || historyFile.test(name);
}
function limitFor(name) { return name === 'library-backup.json' ? 1_000_000 : name.endsWith('.zip') ? 32_000_000 : /\.(?:png|jpe?g)$/.test(name) ? 5_000_000 : name.endsWith('resume.md') ? 500_000 : 200_000; }
async function safeFile(root, name, create = false) {
  if (!allowed(name)) throw fail('文件路径不支持');
  let folder = root;
  for (const segment of name.split('/').slice(0, -1)) {
    folder = path.join(folder, segment);
    try { const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) throw fail('数据目录中包含链接或非普通目录'); }
    catch (error) { if (error.code !== 'ENOENT' || !create) throw error; await mkdir(folder); }
  }
  const filename = path.join(root, name);
  try { const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) throw fail('数据文件不是普通文件'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return filename;
}
async function collect(root) {
  const files = {}; let total = 0;
  async function visit(folder, prefix = '') {
    const stat = await lstat(folder); if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('数据目录中包含链接');
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name, filename = path.join(folder, entry.name);
      if (!prefix && !['library.json', 'trash.json', 'resume.md', 'layout.yaml', '.gitignore', 'assets', 'resumes', 'history', 'backups'].includes(entry.name)) continue;
      if (entry.isSymbolicLink()) throw fail(`数据目录中包含链接：${name}`);
      if (entry.isDirectory()) await visit(filename, name + '/');
      else {
        if (!entry.isFile() || !allowed(name)) throw fail(`不支持的资料文件：${name}`);
        const info = await lstat(filename); total += info.size;
        if (info.size > limitFor(name) || total > expandedLimit || Object.keys(files).length >= fileCountLimit) throw fail('资料超过单文件、256 MB 或 5000 个文件上限');
        files[name] = await readFile(filename);
      }
    }
  }
  await visit(root); return files;
}
function textFile(files, name) {
  if (!files[name]) throw fail(`缺少文件：${name}`);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(files[name]); } catch { throw fail(`文件编码不正确：${name}`); }
}
function inspectFiles(files) {
  let catalog, trash;
  try { catalog = catalogSchema.parse(JSON.parse(textFile(files, 'library.json'))); trash = files['trash.json'] ? trashSchema.parse(JSON.parse(textFile(files, 'trash.json'))) : emptyTrash(); validateCatalogs(catalog, trash); }
  catch { throw fail('简历列表或回收站记录不正确'); }
  for (const item of [...catalog.resumes, ...trash.resumes]) {
    const base = item.id === 'legacy' ? '' : `resumes/${item.id}/`;
    if (!files[base + 'resume.md'] || !files[base + 'layout.yaml']) throw fail(`简历资料不完整：${item.name}`);
  }
  if (!files['resume.md'] || !files['layout.yaml']) throw fail('缺少首份简历的原始文件');
  for (const name of Object.keys(files).filter(name => name.endsWith('resume.md'))) {
    const source = textFile(files, name), base = path.posix.dirname(name);
    const layoutName = (base === '.' ? '' : base + '/') + 'layout.yaml';
    validate(layoutSchema, readYaml(textFile(files, layoutName)), new Map());
    // A Markdown draft with malformed front matter is still recoverable data.
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source.replace(/^\uFEFF/, ''));
    let front; try { if (match) front = readYaml(match[1]); } catch { continue; }
    if (name.includes('/backups/') || name.startsWith('backups/')) continue;
    for (const asset of Object.values(front?.assets || {})) {
      if (typeof asset?.src !== 'string') continue;
      const reference = asset.src.replaceAll('\\', '/');
      if (path.posix.isAbsolute(reference) || /^[a-z]:/i.test(reference)) throw fail('图片位于简历库外，请在页面重新选择图片');
      const target = path.posix.normalize(path.posix.join(base, reference));
      if (!allowed(target) || !/\.(png|jpe?g)$/.test(target) || !files[target]) throw fail(`图片缺失或位于简历库外：${asset.src}`);
    }
  }
  for (const [name, content] of Object.entries(files)) if (/\.(?:png|jpe?g)$/.test(name)) {
    let dimensions; try { dimensions = imageSize(content); } catch { throw fail(`图片无法读取：${name}`); }
    if (dimensions.type !== (name.endsWith('.png') ? 'png' : 'jpg') || !dimensions.width || !dimensions.height || dimensions.width > 20000 || dimensions.height > 20000) throw fail(`图片格式或尺寸不支持：${name}`);
  }
  return { catalog, trash };
}
const listing = files => Object.entries(files).map(([name, content]) => ({ name, size: content.length, sha256: hash(content) })).sort((a, b) => a.name.localeCompare(b.name));
export async function captureLibraryBackup(root) {
  const files = await collect(root), { catalog, trash } = inspectFiles(files), entries = listing(files);
  const manifest = { schemaVersion: 1, kind: 'tech-resume-library', createdAt: new Date().toISOString(), files: entries, fingerprint: hash(JSON.stringify(entries)) };
  const buffer = Buffer.from(zipSync({ ...files, 'library-backup.json': Buffer.from(JSON.stringify(manifest)) }, { level: 6 }));
  if (buffer.length > libraryBackupLimit) throw fail('压缩后的文件超过 128 MB');
  if (JSON.stringify(listing(await collect(root))) !== JSON.stringify(entries)) throw fail('备份期间资料发生变化，请关闭外部编辑器后重试');
  return { buffer, manifest, catalog, trash };
}
export function decodeLibraryBackup(buffer) {
  if (!buffer.length || buffer.length > libraryBackupLimit) throw fail('ZIP 需要在 128 MB 以内');
  const files = {}, seen = new Set(); let total = 0, failure;
  const unzip = new Unzip(file => {
    try {
      const key = file.name.toLowerCase();
      if (!allowed(file.name) || seen.has(key) || seen.size >= fileCountLimit + 1 || file.originalSize > limitFor(file.name)) throw fail('ZIP 包含重复、不支持的路径或过大的文件');
      seen.add(key); let size = 0; const chunks = [];
      file.ondata = (error, data, final) => {
        if (failure) return;
        if (error) { failure = fail('压缩文件损坏'); return; }
        size += data.length; total += data.length;
        if (size > limitFor(file.name) || total > expandedLimit + 1_000_000) { failure = fail('解压后的资料超过大小上限'); file.terminate(); return; }
        chunks.push(Buffer.from(data)); if (final) files[file.name] = Buffer.concat(chunks);
      };
      file.start();
    } catch (error) { failure = error; file.terminate(); }
  });
  unzip.register(UnzipInflate);
  try { for (let i = 0; i < buffer.length && !failure; i += 16384) unzip.push(buffer.subarray(i, i + 16384), i + 16384 >= buffer.length); } catch { throw fail('不是有效的整库 ZIP'); }
  if (failure) throw failure;
  let manifest;
  try { manifest = JSON.parse(textFile(files, 'library-backup.json')); } catch { throw fail('缺少整库备份说明，请选择“导出整库 ZIP”生成的文件'); }
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'tech-resume-library' || !z.string().datetime().safeParse(manifest.createdAt).success || !Array.isArray(manifest.files) || manifest.files.length > fileCountLimit) throw fail('整库格式或版本不支持');
  delete files['library-backup.json'];
  const entries = listing(files);
  if (seen.size !== entries.length + 1 || JSON.stringify(entries) !== JSON.stringify(manifest.files) || manifest.fingerprint !== hash(JSON.stringify(entries))) throw fail('文件清单或 SHA-256 核验失败');
  const names = new Set(entries.map(entry => entry.name.toLowerCase()));
  for (const entry of entries) {
    const parts = entry.name.toLowerCase().split('/'); parts.pop();
    while (parts.length) { if (names.has(parts.join('/'))) throw fail('文件与目录路径冲突'); parts.pop(); }
  }
  return { files, manifest, ...inspectFiles(files) };
}
const restoreRecord = z.object({ schemaVersion: z.literal(1), backupId: uuid, createdAt: z.string().datetime(), backupSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const journalFile = root => path.join(root, 'library-restore-pending.local.json');
async function clearStage(root, backupId) {
  uuid.parse(backupId);
  const stage = path.resolve(root, `.library-restore-${backupId}.local`);
  if (path.dirname(stage) !== path.resolve(root)) throw fail('暂存目录不在简历库内');
  try { const info = await lstat(stage); if (!info.isDirectory() || info.isSymbolicLink()) return; } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await rm(stage, { recursive: true, force: true });
}
async function backupPath(root, backupId, create = false) {
  if (!uuid.safeParse(backupId).success) throw fail('恢复前副本 ID 不正确');
  const folder = path.join(root, 'library-backups');
  try { const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) throw fail('恢复前副本目录不是普通目录'); }
  catch (error) { if (error.code !== 'ENOENT' || !create) throw error; await mkdir(folder); }
  const filename = path.join(folder, `${backupId}.zip`);
  try { const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) throw fail('恢复前副本不是普通文件'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return filename;
}
export async function previousLibraryBackup(root, record) {
  restoreRecord.parse(record);
  const buffer = await readFile(await backupPath(root, record.backupId));
  if (hash(buffer) !== record.backupSha256) throw fail('恢复前副本文件发生变化');
  return buffer;
}
export async function readLibraryRestoreRecord(root) {
  try { return restoreRecord.parse(JSON.parse(await readFile(path.join(root, 'library-restore-state.json'), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw fail('恢复前副本记录无法读取，请保留 library-restore-state.json'); }
}
async function applyFiles(root, files, removeNames) {
  const names = Object.keys(files).sort((a, b) => Number(['library.json', 'trash.json'].includes(a)) - Number(['library.json', 'trash.json'].includes(b)));
  for (const name of names) await saveFile(await safeFile(root, name, true), files[name], true);
  for (const name of removeNames) if (!files[name]) {
    let filename; try { filename = await safeFile(root, name); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function recoverLibraryRestore(root) {
  let pending;
  try { pending = JSON.parse(await readFile(journalFile(root), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return false; throw new ResumeError('整库恢复记录无法读取，请保留文件', { code: 'LIBRARY_RECOVERY' }); }
  try {
    if (pending.schemaVersion !== 1) throw fail('恢复记录的版本不支持');
    const record = restoreRecord.parse(pending.record);
    if (!Array.isArray(pending.incomingNames) || pending.incomingNames.length > fileCountLimit || pending.incomingNames.some(name => !allowed(name) || name === 'library-backup.json')) throw fail('恢复记录的文件清单不正确');
    const original = decodeLibraryBackup(await previousLibraryBackup(root, record));
    await applyFiles(root, original.files, pending.incomingNames);
    await saveFile(path.join(root, 'library-restore-state.json'), JSON.stringify(record), true);
    await unlink(journalFile(root)); await clearStage(root, record.backupId).catch(() => {}); return true;
  } catch { throw new ResumeError('整库恢复未完成，请退出后重启以回退，恢复前 ZIP 已保留在 library-backups', { code: 'LIBRARY_RECOVERY' }); }
}
export async function restoreLibraryBackup(root, decoded, { onWrite } = {}) {
  const original = await captureLibraryBackup(root), backupId = randomUUID();
  const record = { schemaVersion: 1, backupId, createdAt: new Date().toISOString(), backupSha256: hash(original.buffer) };
  await saveFile(await backupPath(root, backupId, true), original.buffer);
  const stage = path.join(root, `.library-restore-${backupId}.local`); await mkdir(stage);
  for (const [name, content] of Object.entries(decoded.files)) await saveFile(await safeFile(stage, name, true), content);
  if (JSON.stringify(listing(await collect(stage))) !== JSON.stringify(decoded.manifest.files)) throw fail('暂存文件核验失败，当前库保持不变');
  if (JSON.stringify(listing(await collect(root))) !== JSON.stringify(original.manifest.files)) throw fail('恢复准备期间当前资料发生变化，原资料保持不变');
  await saveFile(journalFile(root), JSON.stringify({ schemaVersion: 1, record, incomingNames: Object.keys(decoded.files) }));
  try {
    for (const [name, content] of Object.entries(decoded.files)) {
      await saveFile(await safeFile(root, name, true), content, true); await onWrite?.(name);
    }
    for (const name of Object.keys((decodeLibraryBackup(original.buffer)).files)) if (!decoded.files[name]) await unlink(await safeFile(root, name));
    if (JSON.stringify(listing(await collect(root))) !== JSON.stringify(decoded.manifest.files)) throw fail('恢复后的文件核验失败');
    await saveFile(path.join(root, 'library-restore-state.json'), JSON.stringify(record), true);
    await unlink(journalFile(root)); await clearStage(root, backupId).catch(() => {}); return record;
  } catch (error) { await recoverLibraryRestore(root); throw error; }
}
