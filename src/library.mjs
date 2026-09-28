import { readFile, mkdir, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openProject } from './project.mjs';
import { initializeProject, saveFile } from './files.mjs';
import { captureBackup, decodeBackup, applyBackup } from './backup.mjs';
import { ResumeError } from './errors.mjs';
import { assetPath } from './assets.mjs';
import { imageSize } from 'image-size';

const uuid = z.string().uuid(), idSchema = z.union([z.literal('legacy'), uuid]);
const catalogSchema = z.object({ schemaVersion: z.literal(1), activeId: idSchema, resumes: z.array(z.object({ id: idSchema, name: z.string().trim().min(1).max(60), createdAt: z.string() }).strict()).min(1).max(100) }).strict();
const sha = data => createHash('sha256').update(data).digest('hex');
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60 || /[\x00-\x1f\x7f]/.test(value)) throw new ResumeError('简历名称需要 1 到 60 个字符');
  return value.trim();
}
const kinds = { initial: '初始版本', manual: '手动备份', auto: '自动版本', template: '切换模板前', import: '导入正文前', restore: '恢复前', photo: '裁剪照片前' };

export async function openLibrary(directory, { historyIntervalMs = 300000 } = {}) {
  const root = path.resolve(directory), catalogFile = path.join(root, 'library.json');
  let catalog;
  try { catalog = catalogSchema.parse(JSON.parse(await readFile(catalogFile, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new ResumeError('简历列表文件无法读取，请保留 library.json，不要覆盖现有数据', { file: catalogFile });
    await openProject(root);
    catalog = { schemaVersion: 1, activeId: 'legacy', resumes: [{ id: 'legacy', name: '我的简历', createdAt: new Date().toISOString() }] };
    await saveFile(catalogFile, JSON.stringify(catalog, null, 2));
  }
  const ids = catalog.resumes.map(item => item.id);
  if (new Set(ids).size !== ids.length || !ids.includes(catalog.activeId)) throw new ResumeError('简历列表存在重复或未知 ID，请保留数据目录');
  let queue = Promise.resolve(), timer, historyWarning = '';
  const projects = new Map(), dirty = new Set();
  function mutate(action) { const result = queue.then(action); queue = result.catch(() => {}); return result; }
  async function persistCatalog() { await saveFile(catalogFile, JSON.stringify(catalog, null, 2), true); }
  function entry(id = catalog.activeId) { const item = catalog.resumes.find(item => item.id === id); if (!item) throw new ResumeError('这份简历不存在', { code: 'CONFLICT' }); return item; }
  async function projectFor(id = catalog.activeId) {
    entry(id);
    if (!projects.has(id)) {
      const target = id === 'legacy' ? root : path.join(root, 'resumes', id);
      const info = await lstat(target); if (info.isSymbolicLink() || !info.isDirectory()) throw new ResumeError('简历数据目录不正确');
      projects.set(id, await openProject(target));
    }
    return projects.get(id);
  }
  async function state() {
    const active = entry(), project = await projectFor(active.id);
    return { ...(await project.read()), resumeId: active.id, resumeName: active.name, resumes: catalog.resumes.map(item => ({ ...item })), libraryRevision: sha(JSON.stringify(catalog)), historyWarning };
  }
  async function check(payload) {
    const current = await state();
    if (payload.resumeId !== current.resumeId || payload.revision !== current.revision || payload.libraryRevision && payload.libraryRevision !== current.libraryRevision) throw new ResumeError('简历已经切换或修改，请重新载入后再操作', { code: 'CONFLICT' });
    return current;
  }
  function historyDirectory(id) { entry(id); return path.join(root, 'history', id); }
  async function historyFor(id) {
    const directory = historyDirectory(id); let names;
    try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const list = [];
    for (const filename of names.filter(filename => filename.endsWith('.json'))) {
      const backupId = filename.slice(0, -5); if (!uuid.safeParse(backupId).success) continue;
      try {
        const info = JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
        if (info.id === backupId && info.resumeId === id) list.push(info);
      } catch { /* A damaged metadata entry does not erase other history. */ }
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function checkpoint(id, kind = 'manual', force = true) {
    const item = entry(id), project = await projectFor(id), history = await historyFor(id);
    const captured = await captureBackup(project, { id: randomUUID(), resumeId: id, resumeName: item.name, createdAt: new Date().toISOString(), kind });
    if (!force && history[0]?.fingerprint === captured.manifest.fingerprint) { dirty.delete(id); return history[0]; }
    const info = { ...captured.manifest, label: kinds[kind], size: captured.buffer.length };
    const directory = historyDirectory(id); await mkdir(directory, { recursive: true });
    await saveFile(path.join(directory, `${info.id}.zip`), captured.buffer);
    await saveFile(path.join(directory, `${info.id}.json`), JSON.stringify(info, null, 2));
    dirty.delete(id); historyWarning = ''; return info;
  }
  async function readBackup(id, backupId) {
    if (!uuid.safeParse(backupId).success) throw new ResumeError('请选择有效的历史版本');
    const buffer = await readFile(path.join(historyDirectory(id), `${backupId}.zip`));
    const decoded = decodeBackup(buffer);
    if (decoded.manifest.resumeId !== id || decoded.manifest.id !== backupId) throw new ResumeError('历史备份与当前简历不匹配');
    return { buffer, decoded };
  }
  function uniqueName(value, except) {
    const proposed = name(value);
    if (catalog.resumes.some(item => item.id !== except && item.name === proposed)) throw new ResumeError('这个简历名称已经存在，请换一个名称');
    return proposed;
  }
  async function createInternal(payload, duplicate = false) {
    const current = await check(payload);
    if (catalog.resumes.length >= 100) throw new ResumeError('简历数量已达到 100 份');
    const proposed = uniqueName(payload.name), id = randomUUID(), target = path.join(root, 'resumes', id);
    if (dirty.has(current.resumeId)) await checkpoint(current.resumeId, 'auto', false);
    await initializeProject(target, duplicate ? 'blank' : payload.template || 'blank');
    const project = await openProject(target);
    if (duplicate) {
      const snapshot = await captureBackup(await projectFor(current.resumeId), { schemaVersion: 1 });
      await applyBackup(project, decodeBackup(snapshot.buffer));
    }
    const item = { id, name: proposed, createdAt: new Date().toISOString() };
    catalog.resumes.push(item); catalog.activeId = id; projects.set(id, project);
    try { await persistCatalog(); } catch (error) { catalog.resumes.pop(); catalog.activeId = current.resumeId; projects.delete(id); throw error; }
    await checkpoint(id, 'initial'); return state();
  }
  const read = async () => { await queue; return state(); };
  const save = payload => mutate(async () => {
    const current = await check(payload);
    if (payload.importing) await checkpoint(current.resumeId, 'import');
    await (await projectFor()).save(payload); dirty.add(current.resumeId);
    return state();
  });
  const useTemplate = payload => mutate(async () => {
    const current = await check(payload); await checkpoint(current.resumeId, 'template');
    await (await projectFor()).useTemplate(payload); dirty.add(current.resumeId); return state();
  });
  const switchResume = payload => mutate(async () => {
    const current = await check(payload); entry(payload.targetId);
    if (dirty.has(current.resumeId)) await checkpoint(current.resumeId, 'auto', false);
    catalog.activeId = payload.targetId;
    try { await persistCatalog(); } catch (error) { catalog.activeId = current.resumeId; throw error; }
    return state();
  });
  const rename = payload => mutate(async () => {
    const current = await check(payload), item = entry(); const previous = item.name;
    item.name = uniqueName(payload.name, item.id);
    try { await persistCatalog(); } catch (error) { item.name = previous; throw error; }
    return state();
  });
  const restore = (payload, upload) => mutate(async () => {
    const current = await check(payload), project = await projectFor();
    const decoded = upload ? decodeBackup(upload) : (await readBackup(current.resumeId, payload.backupId)).decoded;
    await checkpoint(current.resumeId, 'restore');
    await applyBackup(project, decoded); dirty.add(current.resumeId); return state();
  });
  async function preview(revision, resumeId) {
    await queue;
    const id = catalog.activeId;
    if (resumeId && resumeId !== id) throw new ResumeError('简历已经切换，请刷新预览', { code: 'CONFLICT' });
    return { ...(await (await projectFor(id)).preview(revision)), resumeId: id };
  }
  const storeImage = (id, src, content) => mutate(async () => {
    if (id !== catalog.activeId) throw new ResumeError('简历已经切换，请重新选择图片', { code: 'CONFLICT' });
    const project = await projectFor();
    const assets = path.join(project.root, 'assets');
    try { const info = await lstat(assets); if (!info.isDirectory() || info.isSymbolicLink()) throw new ResumeError('图片目录不正确'); } catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(assets); }
    await saveFile(path.join(project.root, src), content, true);
  });
  const portrait = async (id, revision) => {
    await queue; await check({ resumeId: id, revision });
    const project = await projectFor(), asset = (await project.read()).front?.assets?.portrait;
    if (!asset || typeof asset.src !== 'string') throw new ResumeError('请先选择证件照');
    const buffer = await readFile(assetPath(project.root, asset.src));
    const type = imageSize(buffer).type;
    if (!['png', 'jpg'].includes(type) || buffer.length > 5_000_000) throw new ResumeError('照片需要为 5 MB 以内的 PNG 或 JPEG');
    return { buffer, type: type === 'jpg' ? 'image/jpeg' : 'image/png' };
  };
  const backups = async id => { await queue; if (id !== catalog.activeId) throw new ResumeError('简历已经切换', { code: 'CONFLICT' }); return historyFor(id); };
  const exportBackup = async (id, backupId) => { await queue; if (id !== catalog.activeId) throw new ResumeError('简历已经切换', { code: 'CONFLICT' }); return readBackup(id, backupId); };
  const createBackup = payload => mutate(async () => { const current = await check(payload); return checkpoint(current.resumeId, payload.reason === 'photo' ? 'photo' : 'manual'); });
  const flush = () => mutate(async () => { for (const id of dirty) await checkpoint(id, 'auto', false); });
  async function autoCheckpoint() {
    await mutate(async () => {
      for (const id of [...dirty]) { const latest = (await historyFor(id))[0]; if (!latest || Date.now() - Date.parse(latest.createdAt) >= historyIntervalMs) await checkpoint(id, 'auto', false); }
    });
  }
  if (!(await historyFor(catalog.activeId)).length) await checkpoint(catalog.activeId, 'initial');
  if (historyIntervalMs > 0) { timer = setInterval(() => autoCheckpoint().catch(error => { historyWarning = `自动版本未保存：${error.message}`; }), Math.min(historyIntervalMs, 60000)); timer.unref(); }
  return { root, read, save, useTemplate, preview, create: payload => mutate(() => createInternal(payload)), duplicate: payload => mutate(() => createInternal(payload, true)), rename, switchResume, backups, createBackup, exportBackup, restore, storeImage, portrait, flush, autoCheckpoint, historyStatus: () => historyWarning, close: async () => { clearInterval(timer); await flush(); } };
}
