import { lstat, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileHash } from './storage.mjs';
import { ResumeError } from './errors.mjs';

const fail = message => new ResumeError(message, { code: 'UPDATE' });
export async function downloadSize(filename) {
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw fail('更新缓存不是普通文件，请重新检查版本');
    return info.size;
  } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}
async function rejectCache(filename) {
  if (await downloadSize(filename)) await rename(filename, path.join(path.dirname(filename), `rejected-${randomUUID()}.zip`));
}
export async function downloadArchive({ archive, filename, sha256, validator, fetcher, signal, onProgress, onValidator, onVerify }) {
  const partial = filename + '.download';
  const expectedSize = archive.size;
  let offset = await downloadSize(filename);
  if (offset) {
    onVerify();
    if (offset === expectedSize && await fileHash(filename) === sha256) { onProgress(offset); return; }
    await rejectCache(filename);
  }
  offset = await downloadSize(partial);
  if (offset > expectedSize) { await rejectCache(partial); offset = 0; }
  onProgress(offset);
  if (offset === expectedSize && offset) {
    onVerify();
    if (await fileHash(partial) === sha256) { await rename(partial, filename); return; }
    await rejectCache(partial); offset = 0; onProgress(0);
  }
  for (let part = 0; offset < expectedSize && part < 32; part++) {
    signal.throwIfAborted();
    const headers = { 'Accept-Encoding': 'identity', ...(offset ? { Range: `bytes=${offset}-`, ...(validator ? { 'If-Range': validator } : {}) } : {}) };
    const response = await fetcher(archive.url, { headers, signal });
    if (!response.ok || ![200, 206].includes(response.status)) throw fail('无法下载正式安装包，已收到的内容会保留');
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw fail('下载服务器不支持此方式的续传，请稍后重试');
    const etag = response.headers.get('etag'), lastModified = response.headers.get('last-modified');
    const nextValidator = etag && !etag.startsWith('W/') ? etag : lastModified || undefined;
    let end = expectedSize - 1;
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (!range || Number(range[1]) !== offset || Number(range[3]) !== expectedSize || Number(range[2]) < offset || Number(range[2]) >= expectedSize) throw fail('服务器返回的续传范围不正确，已收到的内容会保留');
      if (offset && validator && nextValidator && validator !== nextValidator) { await rejectCache(partial); onProgress(0); throw fail('服务器上的安装包发生变化，请重新下载'); }
      end = Number(range[2]);
    } else if (offset) { offset = 0; onProgress(0); } // The server may ignore Range and return a complete archive.
    validator = nextValidator; await onValidator(validator);
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== end - offset + 1)) throw fail('下载包大小与正式版本不一致');
    const handle = await open(partial, offset ? 'a' : 'w', 0o600);
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        if (offset + chunk.length > end + 1) throw fail('下载包大小与正式版本不一致');
        await handle.writeFile(chunk); offset += chunk.length; onProgress(offset);
      }
    } finally { await handle.close(); }
    signal.throwIfAborted();
    if (offset !== end + 1) throw fail('下载连接中断，已收到的内容会保留');
  }
  if (offset !== expectedSize) throw fail('下载尚未完成，点击继续下载可接着传输');
  signal.throwIfAborted();
  onVerify();
  if (await fileHash(partial) !== sha256) { await rejectCache(partial); onProgress(0); throw fail('安装包 SHA-256 校验失败，请重新下载；旧程序保持不变'); }
  await rename(partial, filename);
}
