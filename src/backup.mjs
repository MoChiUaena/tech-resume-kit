import { readFile, readdir, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, Unzip, UnzipInflate } from 'fflate';
import { stringify } from 'yaml';
import { imageSize } from 'image-size';
import { readYaml } from './input.mjs';
import { validate, layoutSchema } from './schema.mjs';
import { assetPath } from './assets.mjs';
import { saveFile } from './files.mjs';
import { ResumeError } from './errors.mjs';
import { saveStructuredSource } from './frontmatter.mjs';

export const backupLimit = 32_000_000;
const hash = data => createHash('sha256').update(data).digest('hex');
const fail = message => new ResumeError(`备份无法恢复：${message}`, { code: 'BACKUP' });
function allowed(filename) {
  if (['resume.md', 'layout.yaml', 'backup.json'].includes(filename)) return true;
  return /^assets\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:png|jpe?g)$/i.test(filename) && !filename.split('/').some(part => part === '.' || part === '..');
}
function limitFor(filename) { return filename === 'resume.md' ? 500_000 : filename.startsWith('assets/') ? 5_000_000 : 100_000; }

function restoration(source, files) {
  const plain = source.replace(/^\uFEFF/, ''), match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(plain);
  let front;
  try { if (match) front = readYaml(match[1]); } catch {}
  const remapped = new Map();
  for (const [filename, content] of Object.entries(files)) if (filename.startsWith('assets/')) {
    remapped.set(filename, front && typeof front.assets === 'object' ? `assets/restored-${hash(content)}${path.extname(filename).toLowerCase()}` : filename);
  }
  if (front && typeof front.assets === 'object' && front.assets) {
    const previousFront = structuredClone(front); let changed = false;
    for (const asset of Object.values(front.assets)) if (asset && typeof asset.src === 'string') {
      const replacement = remapped.get(path.posix.normalize(asset.src.replaceAll('\\', '/')));
      if (replacement && replacement !== asset.src) { asset.src = replacement; changed = true; }
    }
    if (changed) source = saveStructuredSource(source, previousFront, front, plain.slice(match[0].length));
  }
  return { source, remapped };
}
function checkRestoredSource(source) {
  if (Buffer.byteLength(source, 'utf8') > limitFor('resume.md')) throw fail('恢复后的 Markdown 超过 500 KB，请精简草稿后重试');
}

export function draftState(payload) {
  function text(value) {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 500_000) throw new ResumeError('草稿内容超过 500 KB 或格式不正确');
    return value;
  }
  function parts(source) {
    const plain = source.replace(/^\uFEFF/, ''), match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(plain);
    let front = null;
    if (match) { try { front = readYaml(match[1]); } catch {} }
    return { front, body: match ? plain.slice(match[0].length) : source };
  }
  let source;
  if (typeof payload.source === 'string') source = text(payload.source);
  else {
    const base = text(payload.baseSource);
    if (!payload.front || typeof payload.front !== 'object' || Array.isArray(payload.front)) throw new ResumeError('草稿填写内容格式不正确');
    source = text(saveStructuredSource(base, parts(base).front, payload.front, text(payload.body)));
  }
  const layout = validate(layoutSchema, payload.layout, new Map()), config = stringify(layout);
  return { source, config, ...parts(source), layout, revision: hash(source + '\0' + config) };
}
export async function captureDraftBackup(project, payload, details) {
  const state = draftState(payload);
  return captureBackup({ root: project.root, read: async () => state }, details);
}

export async function captureBackup(project, details) {
  const state = await project.read(), files = { 'resume.md': Buffer.from(state.source), 'layout.yaml': Buffer.from(state.config) };
  const missingAssets = [];
  let source = state.source;
  if (state.front && typeof state.front.assets === 'object' && state.front.assets) {
    const front = structuredClone(state.front); let rebased = false;
    for (const [key, asset] of Object.entries(front.assets)) {
      if (!asset || typeof asset.src !== 'string') continue;
      try {
        const filename = assetPath(project.root, asset.src);
        const info = await lstat(filename); if (!info.isFile() || info.isSymbolicLink()) throw new Error('不是普通图片文件');
        const content = await readFile(filename), dimensions = imageSize(content);
        if (!['png', 'jpg'].includes(dimensions.type) || content.length > 5_000_000) throw new Error('图片格式或大小不支持');
        const relative = path.relative(project.root, filename).split(path.sep).join('/');
        let destination = relative;
        if (!allowed(relative) || relative.startsWith('../') || path.isAbsolute(relative)) { const label = /^[a-z0-9_-]{1,32}$/i.test(key) ? key : 'image'; destination = `assets/${label}-${hash(content).slice(0, 20)}.${dimensions.type === 'jpg' ? 'jpg' : 'png'}`; }
        if (destination !== asset.src) { asset.src = destination; rebased = true; }
        files[destination] = content;
      } catch { missingAssets.push(asset.src); }
    }
    if (rebased) source = saveStructuredSource(state.source, state.front, front, state.body);
  } else {
    // Invalid front matter still needs a recoverable draft and local images.
    async function collect(directory, prefix = 'assets') {
      let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        const relative = `${prefix}/${entry.name}`;
        if (entry.isDirectory() && !entry.isSymbolicLink()) await collect(path.join(directory, entry.name), relative);
        else if (entry.isFile() && allowed(relative)) {
          const content = await readFile(path.join(directory, entry.name));
          if (content.length > 5_000_000) throw fail('图片超过 5 MB'); files[relative] = content;
        }
      }
    }
    await collect(path.join(project.root, 'assets'));
  }
  files['resume.md'] = Buffer.from(source);
  const entries = Object.entries(files).map(([name, content]) => ({ name, size: content.length, sha256: hash(content) })).sort((a,b) => a.name.localeCompare(b.name));
  checkRestoredSource(restoration(source, files).source);
  if (entries.length > 64) throw fail('完整资料超过 64 项文件');
  const fingerprint = hash(JSON.stringify(entries));
  const manifest = { schemaVersion: 1, ...details, fingerprint, sourceRevision: state.revision, files: entries, missingAssets };
  files['backup.json'] = Buffer.from(JSON.stringify(manifest, null, 2));
  for (const [name, content] of Object.entries(files)) if (content.length > limitFor(name)) throw fail(`${name} 超过备份文件大小上限`);
  if (Object.values(files).reduce((sum, content) => sum + content.length, 0) > backupLimit) throw fail('完整资料超过 32 MB');
  const buffer = Buffer.from(zipSync(files, { level: 6 }));
  if (buffer.length > backupLimit) throw fail('完整备份 ZIP 超过 32 MB');
  return { buffer, manifest };
}

export function decodeBackup(buffer) {
  if (buffer.length > backupLimit) throw fail('文件超过 32 MB');
  const files = {}, seen = new Set(); let total = 0, parseError;
  const unzip = new Unzip(file => {
    try {
      if (!allowed(file.name) || seen.has(file.name) || seen.size >= 65) throw fail('压缩包包含不支持或重复的文件路径');
      seen.add(file.name);
      if (file.originalSize > limitFor(file.name)) throw fail('解压后的文件太大');
      let size = 0; const chunks = [];
      file.ondata = (error, data, final) => {
        if (parseError) return;
        if (error) { parseError = fail('压缩文件损坏'); return; }
        size += data.length; total += data.length;
        if (size > limitFor(file.name) || total > backupLimit) { parseError = fail('解压后的资料超过大小上限'); file.terminate(); return; }
        chunks.push(Buffer.from(data)); if (final) files[file.name] = Buffer.concat(chunks);
      };
      file.start();
    } catch (error) { parseError = error; file.terminate(); }
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < buffer.length && !parseError; offset += 16384) unzip.push(buffer.subarray(offset, offset + 16384), offset + 16384 >= buffer.length);
  } catch { throw fail('不是有效的完整备份 ZIP'); }
  if (parseError) throw parseError;
  let manifest;
  try { manifest = JSON.parse(files['backup.json']?.toString('utf8')); } catch { throw fail('缺少有效的备份说明'); }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files) || !files['resume.md'] || !files['layout.yaml']) throw fail('备份格式或版本不支持');
  const listed = new Set();
  for (const entry of manifest.files) {
    if (!entry || entry.name === 'backup.json' || !allowed(entry.name) || listed.has(entry.name)) throw fail('文件清单不正确');
    listed.add(entry.name);
    const content = files[entry.name];
    if (!content || content.length !== entry.size || hash(content) !== entry.sha256) throw fail('文件不完整或校验值不一致');
    if (entry.name.startsWith('assets/')) {
      try { if (!['png', 'jpg'].includes(imageSize(content).type)) throw new Error(); } catch { throw fail('图片文件不正确'); }
    }
  }
  if (Object.keys(files).length !== listed.size + 1 || seen.size !== Object.keys(files).length) throw fail('文件清单与压缩包不一致');
  validate(layoutSchema, readYaml(files['layout.yaml'].toString('utf8')), new Map());
  return { files, manifest, source: files['resume.md'].toString('utf8'), layout: readYaml(files['layout.yaml'].toString('utf8')) };
}

export async function applyBackup(project, decoded) {
  const { source, remapped } = restoration(decoded.source, decoded.files);
  checkRestoredSource(source);
  for (const [filename, content] of Object.entries(decoded.files)) if (filename.startsWith('assets/')) {
    const relative = remapped.get(filename);
    const destination = path.resolve(project.root, relative);
    if (!destination.startsWith(project.root + path.sep)) throw fail('图片路径不正确');
    let parent = project.root;
    for (const segment of relative.split('/').slice(0, -1)) {
      parent = path.join(parent, segment);
      try { const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw fail('素材目录不是普通目录'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(parent); }
    }
    await saveFile(destination, content, true);
  }
  const state = await project.read();
  return project.save({ revision: state.revision, source, layout: decoded.layout });
}
