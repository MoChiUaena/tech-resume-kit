import { readFile, mkdir, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { stringify } from 'yaml';
import { readYaml, parseResume } from './input.mjs';
import { layoutSchema, validate } from './schema.mjs';
import { initializeProject, saveFile } from './files.mjs';
import { renderResume, kitRoot } from './render.mjs';
import { inspectAndExport } from './export.mjs';
import { ResumeError } from './errors.mjs';
import { assetPath } from './assets.mjs';

export async function openProject(directory) {
  const root = path.resolve(directory);
  try { await access(root); } catch (error) { if (error.code === 'ENOENT') await initializeProject(root, 'blank'); else throw error; }
  const inputFile = path.join(root, 'resume.md'), configFile = path.join(root, 'layout.yaml');
  const revisionOf = (source, config) => createHash('sha256').update(source).update('\0').update(config).digest('hex');
  async function read() {
    const [source, config] = await Promise.all([readFile(inputFile, 'utf8'), readFile(configFile, 'utf8')]);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source.replace(/^\uFEFF/, ''));
    let front = null, frontError;
    if (match) { try { front = readYaml(match[1], inputFile, 1); } catch (error) { frontError = error.message; } }
    const layout = validate(layoutSchema, readYaml(config, configFile), new Map([['', { file: configFile }]]));
    return { source, config, front, frontError, body: match ? source.replace(/^\uFEFF/, '').slice(match[0].length) : source, layout, revision: revisionOf(source, config) };
  }
  let queue = Promise.resolve(), cached;
  function mutate(action) {
    const result = queue.then(action); queue = result.catch(() => {}); return result;
  }
  function conflict(state, revision) {
    if (revision !== state.revision) throw new ResumeError('文件已经在其他窗口或编辑器中修改，请重新载入后再保存', { code: 'CONFLICT' });
  }
  async function write(source, layout) {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 500_000) throw new ResumeError('Markdown 内容超过 500 KB 或格式不正确');
    const normalized = validate(layoutSchema, layout, new Map());
    await saveFile(inputFile, source, true);
    await saveFile(configFile, stringify(normalized), true);
    cached = undefined;
    return read();
  }
  const save = payload => mutate(async () => {
    const state = await read(); conflict(state, payload.revision);
    let source;
    if (typeof payload.source === 'string') source = payload.source;
    else {
      if (!payload.front || typeof payload.front !== 'object' || Array.isArray(payload.front) || typeof payload.body !== 'string') throw new ResumeError('填写内容格式不正确');
      source = `---\n${stringify(payload.front)}---\n\n${payload.body.replace(/^\s*\n/, '')}`;
    }
    return write(source, payload.layout);
  });
  const useTemplate = payload => mutate(async () => {
    const state = await read(); conflict(state, payload.revision);
    const base = { blank: 'templates/blank', campus: '.', experience: 'examples/experienced' }[payload.template];
    if (!base) throw new ResumeError('请选择填写模板、校招样张或工作经验样张');
    const sourceRoot = path.join(kitRoot, base);
    const [source, config] = await Promise.all([readFile(path.join(sourceRoot, 'resume.md'), 'utf8'), readFile(path.join(sourceRoot, 'layout.yaml'), 'utf8')]);
    const parsed = parseResume(source);
    for (const asset of Object.values(parsed.document.assets)) {
      if (asset.src.includes('..') || path.isAbsolute(asset.src)) throw new ResumeError('模板图片路径不正确');
      const destination = path.join(root, asset.src);
      await mkdir(path.dirname(destination), { recursive: true });
      await saveFile(destination, await readFile(path.join(sourceRoot, asset.src)), true);
    }
    const backup = path.join(root, 'backups', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
    await mkdir(backup, { recursive: true });
    await Promise.all([saveFile(path.join(backup, 'resume.md'), state.source), saveFile(path.join(backup, 'layout.yaml'), state.config)]);
    return write(source, readYaml(config));
  });
  async function preview(revision) {
    await queue;
    const state = await read(); if (revision) conflict(state, revision);
    const parsed = parseResume(state.source, inputFile);
    const images = await Promise.all(Object.entries(parsed.document.assets).filter(([key]) => state.layout.images[key].enabled).map(async ([, asset]) => {
      try { const file = await stat(assetPath(root, asset.src)); return [asset.src, file.size, file.mtimeMs]; } catch { return [asset.src, null]; }
    }));
    const cacheKey = state.revision + JSON.stringify(images);
    if (!cached || cached.key !== cacheKey) {
      const promise = (async () => {
        const rendered = await renderResume(parsed.document, state.layout, { ...parsed, assetBase: root });
        return { ...(await inspectAndExport(rendered, { pdf: true })), name: rendered.document.person.name, document: rendered.document, layout: rendered.layout };
      })();
      cached = { key: cacheKey, promise };
    }
    return { ...(await cached.promise), revision: state.revision };
  }
  return { root, read, save, useTemplate, preview };
}
