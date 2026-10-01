import { readFile, readdir, lstat, realpath, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { uuid, idSchema } from './catalog.mjs';
import { draftState } from './backup.mjs';
import { saveFile } from './files.mjs';
import { ResumeError } from './errors.mjs';
const fail = message => new ResumeError(message, { code: 'DRAFT' });
const shaPattern = /^[0-9a-f]{64}$/, recordLimit = 2_000_000;
export async function openDraftStore(root) {
  const canonical = await realpath(root), scope = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const directory = path.join(root, 'editor-drafts.local.d');
  async function folder(create = false) {
    try { const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw fail('草稿目录不是普通文件夹，请保留现有资料并检查数据位置'); return true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; if (!create) return false; await mkdir(directory); return true; }
  }
  function identity(record) {
    if (!record || !idSchema.safeParse(record.resumeId).success || !uuid.safeParse(record.id).success || !Number.isSafeInteger(record.sequence) || record.sequence < 1) throw fail('草稿记录格式不正确');
    return path.join(directory, `${record.id}.json`);
  }
  function checkScope(payload) { if (payload?.scope !== scope) throw fail('数据目录已经变化，请重新打开当前资料后再处理草稿'); }
  function snapshotPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('草稿快照格式不正确');
    const state = draftState(payload);
    const snapshot = typeof payload.source === 'string' ? { source: state.source, layout: state.layout } : { baseSource: payload.baseSource, front: payload.front, body: payload.body, layout: state.layout };
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > recordLimit - 1000) throw fail('草稿填写数据过大，请精简内容或下载草稿备份');
    return { snapshot, fingerprint: state.revision };
  }
  function validate(record) {
    identity(record);
    if (record.schemaVersion !== 1 || typeof record.baseRevision !== 'string' || !shaPattern.test(record.baseRevision) || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt)) || record.cleared !== undefined && typeof record.cleared !== 'boolean') throw fail('草稿记录格式不正确');
    if (record.cleared !== true && snapshotPayload(record.payload).fingerprint !== record.fingerprint) throw fail('草稿内容校验不一致');
    return record;
  }
  async function readOne(id) {
    try {
      const filename = path.join(directory, `${id}.json`), info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > recordLimit) throw fail('草稿文件类型或大小不正确');
      const record = validate(JSON.parse(await readFile(filename, 'utf8'))); if (record.id !== id) throw fail('草稿文件与记录不一致'); return record;
    } catch (error) { if (error.code === 'ENOENT') return null; throw fail('草稿文件无法读取，请保留该文件以便检查或恢复'); }
  }
  async function records() {
    if (!await folder()) return { records: [], warning: '' };
    const items = []; let warning = '';
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.json') || !uuid.safeParse(name.slice(0, -5)).success) continue;
      try { const item = await readOne(name.slice(0, -5)); if (item) items.push(item); }
      catch { warning = '部分草稿文件无法读取，原文件已保留；其他草稿仍可恢复。'; }
    }
    return { records: items, warning };
  }
  async function save(record) { await folder(true); await saveFile(identity(record), JSON.stringify(record), true); }
  async function clear(payload) {
    checkScope(payload); identity(payload); await folder(true);
    const old = await readOne(payload.id);
    if (old && (old.resumeId !== payload.resumeId || old.sequence > payload.sequence)) return { removed: false };
    await save({ schemaVersion: 1, id: payload.id, resumeId: payload.resumeId, sequence: payload.sequence, baseRevision: old?.baseRevision || '0'.repeat(64), updatedAt: new Date().toISOString(), cleared: true });
    return { removed: true };
  }
  async function write(payload, currentRevision) {
    checkScope(payload); identity(payload);
    if (typeof payload.baseRevision !== 'string' || !shaPattern.test(payload.baseRevision)) throw fail('草稿的原始文件版本不正确');
    const { snapshot, fingerprint } = snapshotPayload(payload.payload);
    await folder(true); const old = await readOne(payload.id);
    if (old && old.resumeId !== payload.resumeId) throw fail('草稿已经属于另一份简历');
    if (old && old.sequence >= payload.sequence) return { stored: old.cleared !== true, sequence: old.sequence };
    const collection = await records(), active = collection.records.filter(item => item.cleared !== true && item.id !== payload.id);
    if (active.length >= 256 || active.filter(item => item.resumeId === payload.resumeId).length >= 32) throw fail('保留的草稿较多，请先恢复或删除不需要的草稿');
    for (const item of collection.records) if (item.cleared === true && Date.now() - Date.parse(item.updatedAt) > 30 * 86400000) await unlink(identity(item));
    if (fingerprint === currentRevision) { await clear(payload); return { stored: false, sequence: payload.sequence }; }
    await save({ schemaVersion: 1, id: payload.id, resumeId: payload.resumeId, sequence: payload.sequence, baseRevision: payload.baseRevision, updatedAt: new Date().toISOString(), payload: snapshot, fingerprint });
    return { stored: true, sequence: payload.sequence };
  }
  async function list(payload, currentRevision) {
    checkScope(payload);
    if (!idSchema.safeParse(payload.resumeId).success) throw fail('请选择有效的简历');
    const collection = await records(), drafts = [];
    for (const item of collection.records) if (item.cleared !== true && item.resumeId === payload.resumeId) {
      if (item.fingerprint === currentRevision) await clear({ ...item, scope });
      else drafts.push({ ...item, scope, conflict: item.baseRevision !== currentRevision });
    }
    drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { scope, drafts, warning: collection.warning };
  }
  return { scope, write, clear, list };
}
