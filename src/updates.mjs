import { readFile, mkdir, rename, unlink } from 'node:fs/promises';
import { createReadStream, openSync, writeSync, closeSync, mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Unzip, UnzipInflate } from 'fflate';
import { saveFile } from './files.mjs';
import { fileHash } from './storage.mjs';
import { ResumeError } from './errors.mjs';

const repository = 'MoChiUaena/tech-resume-kit', maximumDownload = 350_000_000, maximumExtractedFile = 300_000_000;
const fail = message => new ResumeError(message, { code: 'UPDATE' });
export function compareVersions(left, right) {
  const parse = value => {
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
    if (!match) throw fail('版本号格式不正确'); return { numbers: match.slice(1, 4).map(Number), pre: match[4] };
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i] ? 1 : -1;
  if (a.pre === b.pre) return 0; if (!a.pre) return 1; if (!b.pre) return -1;
  const aa = a.pre.split('.'), bb = b.pre.split('.');
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === bb[i]) continue; if (aa[i] === undefined) return -1; if (bb[i] === undefined) return 1;
    const numericA = /^\d+$/.test(aa[i]), numericB = /^\d+$/.test(bb[i]);
    if (numericA && numericB) return Number(aa[i]) > Number(bb[i]) ? 1 : -1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return aa[i] > bb[i] ? 1 : -1;
  }
  return 0;
}
function releaseAsset(asset, tag) {
  if (!asset || typeof asset.name !== 'string' || !Number.isInteger(asset.size) || asset.size < 1 || asset.size > maximumDownload) throw fail('正式版本缺少可用安装包');
  const expected = `https://github.com/${repository}/releases/download/${tag}/${asset.name}`;
  if (asset.browser_download_url !== expected) throw fail('安装包来源与正式仓库不一致');
  return { name: asset.name, size: asset.size, url: expected, digest: asset.digest };
}
export async function checkRelease(currentVersion, fetcher = fetch) {
  let response;
  try { response = await fetcher(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'tech-resume-kit' }, signal: AbortSignal.timeout(25000) }); }
  catch { throw fail('无法连接 GitHub，请稍后重试；本地简历可以继续使用'); }
  if (!response.ok) throw fail(response.status === 403 || response.status === 429 ? '更新检查暂时达到访问上限，请稍后重试' : '暂时无法读取正式版本');
  const text = await boundedText(response, 1_000_000), release = JSON.parse(text), tag = release.tag_name;
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag)) throw fail('正式版本信息不完整');
  const version = tag.slice(1), available = compareVersions(version, currentVersion) > 0;
  const name = `tech-resume-windows-x64-${version}.zip`, assets = release.assets || [];
  return { currentVersion, latestVersion: version, available, releaseUrl: `https://github.com/${repository}/releases/tag/${tag}`, ...(available ? { archive: releaseAsset(assets.find(asset => asset.name === name), tag), checksums: releaseAsset(assets.find(asset => asset.name === 'SHA256SUMS.txt'), tag) } : {}) };
}
async function boundedText(response, maximum) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > maximum) throw fail('更新说明文件超过大小上限'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}
function safeEntry(name, expectedRoot) {
  const parts = name.split('/'); if (parts.at(-1) === '') parts.pop();
  if (parts[0] !== expectedRoot || parts.length < 1 || parts.some(part => !part || part === '.' || part === '..' || /[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw fail('安装包包含不安全的文件路径');
  return parts.slice(1).join('/');
}
export async function extractPackage(archive, stage, version) {
  const source = await open(archive, 'r');
  try {
    const { size } = await source.stat(), length = Math.min(size, 65557), tail = Buffer.alloc(length);
    await source.read(tail, 0, length, size - length); let end = -1;
    for (let i = length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === length) { end = i; break; }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== tail.readUInt16LE(end + 10) || tail.readUInt16LE(end + 10) === 65535 || tail.readUInt32LE(end + 12) + tail.readUInt32LE(end + 16) !== size - length + end) throw fail('安装包 ZIP 不完整或格式不支持');
  } finally { await source.close(); }
  const expectedRoot = `tech-resume-windows-x64-${version}`, output = path.join(stage, expectedRoot);
  await mkdir(stage); let problem, total = 0; const seen = new Set(), finished = new Set(), handles = new Set(), entries = [];
  const unzip = new Unzip(file => {
    try {
      const relative = safeEntry(file.name, expectedRoot), key = file.name.replace(/\/$/, '').toLowerCase();
      if (seen.has(key) || seen.size >= 15000 || ![0, 8].includes(file.compression) || file.originalSize > maximumExtractedFile) throw fail('安装包包含重复、过大或不支持的文件');
      seen.add(key); const directory = file.name.endsWith('/'), filename = path.join(output, relative);
      // File callbacks are synchronous; extraction occurs only inside a newly created staging directory.
      let handle, size = 0; const digest = createHash('sha256');
      file.ondata = (error, data, final) => {
        if (problem) return;
        try {
          if (error) throw fail('安装包压缩数据损坏');
          size += data.length; total += data.length;
          if (size > maximumExtractedFile || total > 900_000_000 || directory && size) throw fail('安装包解压大小超过上限');
          if (!directory) { writeSync(handle, data); digest.update(data); }
          if (final) { if (handle !== undefined) { closeSync(handle); handles.delete(handle); } finished.add(key); if (!directory) entries.push({ name: relative, size, sha256: digest.digest('hex') }); }
        } catch (error) { problem = error; file.terminate(); }
      };
      // fflate emits entries during a synchronous push, so create parents with the sync filesystem API.
      if (directory) mkdirSync(filename, { recursive: true }); else { mkdirSync(path.dirname(filename), { recursive: true }); handle = openSync(filename, 'wx', 0o600); handles.add(handle); }
      file.start();
    } catch (error) { problem = error; file.terminate(); }
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(archive, { highWaterMark: 65536 })) { if (problem) throw problem; unzip.push(chunk); }
    unzip.push(new Uint8Array(), true); if (problem) throw problem;
    if (!seen.size || seen.size !== finished.size) throw fail('安装包不完整');
    const required = ['启动简历.exe', 'runtime/node.exe', 'runtime/versions.json', 'toolkit/package.json', 'toolkit/src/app.mjs'];
    if (required.some(name => !entries.some(entry => entry.name === name))) throw fail('安装包缺少启动文件');
    const metadata = JSON.parse(await readFile(path.join(output, 'toolkit/package.json'), 'utf8'));
    const runtime = JSON.parse(await readFile(path.join(output, 'runtime/versions.json'), 'utf8'));
    if (metadata.version !== version || runtime.kit !== version || await fileHash(path.join(output, 'runtime/node.exe')) !== runtime.nodeExeSha256) throw fail('安装包版本或运行时校验失败');
    await saveFile(path.join(stage, 'files.json'), JSON.stringify(entries, null, 2)); return output;
  } catch (error) { throw error instanceof ResumeError ? error : fail('安装包解压失败，旧程序仍可使用'); }
  finally { for (const handle of handles) closeSync(handle); }
}
export async function createUpdater({ version, home, programDirectory, supported = process.platform === 'win32' && !!programDirectory, fetcher = fetch } = {}) {
  let state = { currentVersion: version, supported, phase: 'idle' }, release, task, controller;
  const receiptFile = path.join(home, 'update-state.json');
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    if (receipt?.schemaVersion !== 1 || typeof receipt.previousProgramDirectory !== 'string' || typeof receipt.installedProgramDirectory !== 'string') throw new Error('Invalid update receipt');
  } catch (error) { receipt = null; if (error.code !== 'ENOENT') state.warning = '上次更新记录无法读取，上一版本入口暂不可用。'; }
  const status = () => ({ ...state, rollbackDirectory: receipt?.previousProgramDirectory && receipt.installedProgramDirectory === programDirectory ? receipt.previousProgramDirectory : null });
  const check = async () => {
    if (task || state.phase === 'ready') return status();
    release = await checkRelease(version, fetcher); state = { ...release, supported, phase: release.available ? 'available' : 'current' }; return status();
  };
  async function download() {
    const folder = path.join(home, 'updates', randomUUID());
    controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 600000);
    const archive = path.join(folder, release.archive.name), temporary = archive + '.download'; let handle;
    try {
      await mkdir(folder, { recursive: true });
      state = { ...state, phase: 'downloading', received: 0, total: release.archive.size };
      const sums = await fetcher(release.checksums.url, { signal: controller.signal }); if (!sums.ok) throw fail('无法下载安装包校验文件');
      const lines = (await boundedText(sums, 100_000)).split(/\r?\n/), matches = lines.map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(match => match?.[2] === release.archive.name);
      if (matches.length !== 1) throw fail('安装包缺少唯一的 SHA-256 校验值'); const expectedHash = matches[0][1];
      if (release.archive.digest && release.archive.digest !== `sha256:${expectedHash}`) throw fail('GitHub 安装包摘要与校验文件不一致');
      const response = await fetcher(release.archive.url, { signal: controller.signal }); if (!response.ok) throw fail('无法下载正式安装包');
      handle = await open(temporary, 'wx', 0o600); const digest = createHash('sha256');
      for await (const chunk of response.body) {
        state.received += chunk.length; if (state.received > release.archive.size || state.received > maximumDownload) throw fail('下载包大小与正式版本不一致');
        digest.update(chunk); await handle.writeFile(chunk);
      }
      await handle.close(); handle = null;
      if (state.received !== release.archive.size || digest.digest('hex') !== expectedHash) throw fail('安装包下载不完整或 SHA-256 校验失败，旧程序保持不变');
      await rename(temporary, archive); state.phase = 'extracting';
      const stage = path.join(folder, 'staging'), output = await extractPackage(archive, stage, release.latestVersion);
      const destination = path.join(folder, path.basename(output)); await rename(output, destination);
      state = { ...state, phase: 'ready', directory: destination, sha256: expectedHash }; return status();
    } catch (error) { state = { ...state, phase: 'failed', error: error instanceof ResumeError ? error.message : '更新下载失败，请检查网络后重试；旧程序仍可使用' }; }
    finally { clearTimeout(timeout); if (handle) await handle.close(); await unlink(temporary).catch(() => {}); controller = null; }
  }
  const prepare = () => {
    if (!supported) throw fail('此环境请从正式发布页下载安装包');
    if (!release?.available) throw fail('请先检查可用的正式版本');
    if (!task && state.phase !== 'ready') { state = { ...state, phase: 'downloading', received: 0, total: release.archive.size }; task = download().finally(() => { task = null; }); }
    return status();
  };
  const activate = async backup => {
    if (state.phase !== 'ready') throw fail('新版安装包尚未准备完成');
    receipt = { schemaVersion: 1, previousProgramDirectory: programDirectory, installedProgramDirectory: state.directory, dataBackupDirectory: backup.backup, createdAt: new Date().toISOString() };
    await saveFile(receiptFile, JSON.stringify(receipt, null, 2), true); return state.directory;
  };
  return { status, check, prepare, activate, wait: () => task, close: async () => { controller?.abort(); await task; } };
}
