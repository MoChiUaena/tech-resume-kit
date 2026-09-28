import { readFile, mkdir, unlink, lstat } from 'node:fs/promises';
import { createReadStream, openSync, writeSync, closeSync, mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Unzip, UnzipInflate } from 'fflate';
import { saveFile } from './files.mjs';
import { fileHash, canonicalDirectory, inventory } from './storage.mjs';
import { downloadArchive, downloadSize } from './update-download.mjs';
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
export async function extractPackage(archive, stage, version, { signal } = {}) {
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
    for await (const chunk of createReadStream(archive, { highWaterMark: 65536, signal })) { if (problem) throw problem; unzip.push(chunk); }
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
  home = await canonicalDirectory(home);
  if (programDirectory) programDirectory = await canonicalDirectory(programDirectory);
  let state = { currentVersion: version, supported, phase: 'idle' }, release, task, controller, job;
  const receiptFile = path.join(home, 'update-state.json'), jobFile = path.join(home, 'update-job.json');
  const warnings = [];
  const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  async function readJson(filename, maximum) {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw fail('更新记录格式不正确');
    return JSON.parse(await readFile(filename, 'utf8'));
  }
  function savedRelease(value) {
    if (!value || !/^\d+\.\d+\.\d+$/.test(value.latestVersion)) throw fail('更新版本记录不正确');
    const tag = 'v' + value.latestVersion;
    if (value.archive?.name !== `tech-resume-windows-x64-${value.latestVersion}.zip` || value.checksums?.name !== 'SHA256SUMS.txt') throw fail('更新包记录不正确');
    return { currentVersion: version, latestVersion: value.latestVersion, available: compareVersions(value.latestVersion, version) > 0, releaseUrl: `https://github.com/${repository}/releases/tag/${tag}`, archive: releaseAsset({ ...value.archive, browser_download_url: value.archive.url }, tag), checksums: releaseAsset({ ...value.checksums, browser_download_url: value.checksums.url }, tag) };
  }
  const folderFor = () => path.join(home, 'updates', job.id);
  const archiveFile = () => path.join(folderFor(), release.archive.name);
  const stageFor = () => path.join(folderFor(), 'staging-' + job.preparedId);
  const preparedDirectory = () => path.join(stageFor(), `tech-resume-windows-x64-${release.latestVersion}`);
  async function regularFolder(folder) { const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) throw fail('更新缓存目录不正确'); }
  async function saveJob(phase) {
    job.phase = phase; await saveFile(jobFile, JSON.stringify(job, null, 2), true);
  }
  async function receivedBytes() {
    try { return Math.max(await downloadSize(archiveFile()), await downloadSize(archiveFile() + '.download')); } catch { return 0; }
  }
  async function verifyPrepared(complete = false) {
    if (!validId(job.preparedId) || !validHash(job.manifestSha256)) throw fail('已准备的程序记录不完整，请重新准备');
    for (const folder of [path.join(home, 'updates'), folderFor(), stageFor(), preparedDirectory()]) await regularFolder(folder);
    const manifestFile = path.join(stageFor(), 'files.json');
    const entries = await readJson(manifestFile, 5_000_000);
    if (await fileHash(manifestFile) !== job.manifestSha256 || !Array.isArray(entries) || entries.length > 15000) throw fail('已准备的程序清单发生变化，请重新准备');
    const seen = new Set(); let total = 0;
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !validHash(entry.sha256) || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > maximumExtractedFile) throw fail('程序文件清单不正确');
      safeEntry(`tech-resume-windows-x64-${release.latestVersion}/${entry.name}`, `tech-resume-windows-x64-${release.latestVersion}`);
      if (seen.has(entry.name.toLowerCase())) throw fail('程序文件清单重复'); seen.add(entry.name.toLowerCase()); total += entry.size;
    }
    if (total > 900_000_000) throw fail('程序文件清单超过大小上限');
    if (complete) {
      const actual = (await inventory(preparedDirectory())).filter(entry => entry.name !== 'startup-error.local.txt');
      const canonical = list => JSON.stringify([...list].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, size, sha256 }) => ({ name, size, sha256 })));
      if (canonical(actual) !== canonical(entries)) throw fail('准备好的程序文件发生变化，请重新准备');
    } else {
      for (const name of ['启动简历.exe', 'runtime/node.exe', 'runtime/versions.json', 'toolkit/package.json', 'toolkit/src/app.mjs']) {
        const entry = entries.find(entry => entry.name === name); if (!entry) throw fail('程序清单缺少启动文件');
        let parent = preparedDirectory();
        for (const part of name.split('/').slice(0, -1)) { parent = path.join(parent, part); await regularFolder(parent); }
        const filename = path.join(preparedDirectory(), name);
        if (await downloadSize(filename) !== entry.size || await fileHash(filename) !== entry.sha256) throw fail('准备好的启动文件发生变化，请重新准备');
      }
    }
  }
  let receipt;
  try {
    receipt = await readJson(receiptFile, 100_000);
    if (receipt?.schemaVersion !== 1 || typeof receipt.previousProgramDirectory !== 'string' || typeof receipt.installedProgramDirectory !== 'string') throw new Error('Invalid update receipt');
  } catch (error) { receipt = null; if (error.code !== 'ENOENT') warnings.push('上次更新记录无法读取，上一版本入口暂不可用。'); }
  try {
    const saved = await readJson(jobFile, 100_000);
    if (saved.schemaVersion !== 1 || !validId(saved.id) || !['available', 'downloading', 'verifying', 'extracting', 'ready', 'paused', 'failed'].includes(saved.phase) || saved.sha256 && !validHash(saved.sha256) || saved.validator && (typeof saved.validator !== 'string' || saved.validator.length > 1024 || /[\r\n]/.test(saved.validator))) throw fail('下载记录无法读取');
    const restored = savedRelease(saved.release);
    if (restored.available) {
      job = saved; release = restored;
      const received = await receivedBytes();
      state = { ...release, supported, phase: saved.phase === 'available' ? 'available' : 'paused', received, total: release.archive.size, resumed: true };
      if (saved.phase === 'ready') {
        try { await verifyPrepared(); state = { ...state, phase: 'ready', directory: preparedDirectory(), sha256: job.sha256 }; }
        catch (error) { state = { ...state, phase: 'failed', error: `${error.message}；已下载的压缩包会保留。` }; }
      }
    }
  } catch (error) { job = null; release = undefined; if (error.code !== 'ENOENT') warnings.push('上次下载记录无法读取，可以重新检查版本。'); }
  const status = () => ({ ...state, warning: warnings.join(' '), resumable: state.received > 0, downloadComplete: typeof state.total === 'number' && state.received === state.total, rollbackDirectory: receipt?.previousProgramDirectory && receipt.installedProgramDirectory === programDirectory ? receipt.previousProgramDirectory : null });
  const check = async () => {
    if (task || state.phase === 'ready') return status();
    const latest = await checkRelease(version, fetcher);
    const same = job && release?.latestVersion === latest.latestVersion && JSON.stringify(release.archive) === JSON.stringify(latest.archive);
    release = latest;
    if (latest.available) {
      if (!same) job = { schemaVersion: 1, id: randomUUID(), release: latest, phase: 'available' };
      await saveJob(same ? job.phase : 'available');
      state = { ...latest, supported, phase: same && state.phase === 'failed' ? 'failed' : same && state.received ? 'paused' : 'available', ...(same ? { received: state.received, total: latest.archive.size, error: state.error } : {}) };
    } else { job = null; await unlink(jobFile).catch(error => { if (error.code !== 'ENOENT') throw error; }); state = { ...latest, supported, phase: 'current' }; }
    return status();
  };
  async function download() {
    controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 600000);
    try {
      await mkdir(path.join(home, 'updates'), { recursive: true }); await regularFolder(path.join(home, 'updates'));
      await mkdir(folderFor(), { recursive: true }); await regularFolder(folderFor());
      controller.signal.throwIfAborted(); await saveJob('downloading');
      if (!job.sha256) {
        const sums = await fetcher(release.checksums.url, { signal: controller.signal }); if (!sums.ok) throw fail('无法下载安装包校验文件');
        const lines = (await boundedText(sums, 100_000)).split(/\r?\n/), matches = lines.map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(match => match?.[2] === release.archive.name);
        if (matches.length !== 1) throw fail('安装包缺少唯一的 SHA-256 校验值'); job.sha256 = matches[0][1];
      }
      if (release.archive.digest && release.archive.digest !== `sha256:${job.sha256}`) throw fail('GitHub 安装包摘要与校验文件不一致');
      await saveJob('downloading');
      await downloadArchive({ archive: release.archive, filename: archiveFile(), sha256: job.sha256, validator: job.validator, fetcher, signal: controller.signal,
        onProgress: received => { state.received = received; state.phase = 'downloading'; }, onVerify: () => { state.phase = 'verifying'; },
        onValidator: async validator => { job.validator = validator; await saveJob('downloading'); } });
      controller.signal.throwIfAborted(); state.phase = 'extracting'; job.preparedId = randomUUID(); await saveJob('extracting');
      const output = await extractPackage(archiveFile(), stageFor(), release.latestVersion, { signal: controller.signal });
      controller.signal.throwIfAborted(); job.manifestSha256 = await fileHash(path.join(stageFor(), 'files.json')); await saveJob('ready');
      state = { ...state, phase: 'ready', directory: output, sha256: job.sha256 }; return status();
    } catch (error) {
      const paused = controller.signal.aborted;
      state = { ...state, phase: paused ? 'paused' : 'failed', received: await receivedBytes(), error: paused ? undefined : error instanceof ResumeError ? error.message : '下载中断，已收到的内容会保留；点击继续下载可重试。' };
      await saveJob(state.phase).catch(() => {});
    } finally { clearTimeout(timeout); controller.abort(); controller = null; }
  }
  const prepare = () => {
    if (!supported) throw fail('此环境请从正式发布页下载安装包');
    if (!release?.available) throw fail('请先检查可用的正式版本');
    if (!task && state.phase !== 'ready') { state = { ...state, phase: 'downloading', received: state.received || 0, total: release.archive.size, error: undefined }; task = download().finally(() => { task = null; }); }
    return status();
  };
  const activate = async backup => {
    if (state.phase !== 'ready') throw fail('新版安装包尚未准备完成');
    try { await verifyPrepared(true); }
    catch (error) { state = { ...state, phase: 'failed', error: `${error.message}；点击重新准备会复用已下载的压缩包。` }; await saveJob('failed'); throw error; }
    receipt = { schemaVersion: 1, previousProgramDirectory: programDirectory, installedProgramDirectory: state.directory, dataBackupDirectory: backup.backup, createdAt: new Date().toISOString() };
    await saveFile(receiptFile, JSON.stringify(receipt, null, 2), true); return state.directory;
  };
  const pause = async () => { controller?.abort(); await task; return status(); };
  return { status, check, prepare, activate, pause, wait: () => task, close: pause };
}
