import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { saveFile } from './files.mjs';
import { ResumeError } from './errors.mjs';

export const uuid = z.string().uuid(), idSchema = z.union([z.literal('legacy'), uuid]);
const item = z.object({ id: idSchema, name: z.string().trim().min(1).max(60).regex(/^[^\x00-\x1f\x7f]+$/), createdAt: z.string() }).strict();
export const catalogSchema = z.object({ schemaVersion: z.literal(1), activeId: idSchema, resumes: z.array(item).min(1).max(100) }).strict();
export const trashSchema = z.object({ schemaVersion: z.literal(1), resumes: z.array(item.extend({ deletedAt: z.string().datetime() }).strict()).max(1000) }).strict();
export const emptyTrash = () => ({ schemaVersion: 1, resumes: [] });
export function validateCatalogs(catalog, trash = emptyTrash()) {
  catalog = catalogSchema.parse(catalog); trash = trashSchema.parse(trash);
  const active = catalog.resumes.map(item => item.id), all = [...active, ...trash.resumes.map(item => item.id)];
  if (!active.includes(catalog.activeId) || new Set(all).size !== all.length || new Set(catalog.resumes.map(item => item.name)).size !== active.length) throw new ResumeError('简历列表存在重复或未知 ID、名称，请保留数据目录');
  return { catalog, trash };
}
export async function readTrash(root) {
  try { return trashSchema.parse(JSON.parse(await readFile(path.join(root, 'trash.json'), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return emptyTrash(); throw new ResumeError('回收站记录无法读取，请保留 trash.json'); }
}
const journal = root => path.join(root, 'catalog-pending.local.json');
async function rollback(root, pending) {
  const prior = validateCatalogs(pending.catalog, pending.trash);
  await saveFile(path.join(root, 'library.json'), JSON.stringify(prior.catalog, null, 2), true);
  if (pending.hadTrash) await saveFile(path.join(root, 'trash.json'), JSON.stringify(prior.trash, null, 2), true);
  else await unlink(path.join(root, 'trash.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await unlink(journal(root));
}
export async function recoverCatalog(root) {
  let pending;
  try { pending = JSON.parse(await readFile(journal(root), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw new ResumeError('简历列表保存记录无法读取，请保留文件', { code: 'LIBRARY_RECOVERY' }); }
  if (pending.schemaVersion !== 1 || typeof pending.hadTrash !== 'boolean') throw new ResumeError('简历列表保存记录格式不正确', { code: 'LIBRARY_RECOVERY' });
  await rollback(root, pending);
}
export async function commitCatalogPair(root, prior, next) {
  validateCatalogs(next.catalog, next.trash);
  let hadTrash = true;
  try { await readFile(path.join(root, 'trash.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; hadTrash = false; }
  await saveFile(journal(root), JSON.stringify({ schemaVersion: 1, hadTrash, ...prior }), true);
  try {
    await saveFile(path.join(root, 'library.json'), JSON.stringify(next.catalog, null, 2), true);
    await saveFile(path.join(root, 'trash.json'), JSON.stringify(next.trash, null, 2), true);
    await unlink(journal(root));
  } catch (error) {
    try { await rollback(root, { ...prior, hadTrash }); }
    catch { throw new ResumeError('简历列表保存未完成，请退出后重启以恢复，原记录已保留', { code: 'LIBRARY_RECOVERY' }); }
    throw error;
  }
}
