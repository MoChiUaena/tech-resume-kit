import { access, mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { kitRoot } from './render.mjs';
import { ResumeError } from './errors.mjs';
import { loadResume } from './input.mjs';
import { assetPath } from './assets.mjs';

export async function ensureNewOutput(filename, force = false) {
  try { await access(filename); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!force) throw new ResumeError('文件已存在；请换输出路径，或确认后使用 --force 覆盖', { file: filename, code: 'EXISTS' });
}
export async function saveFile(filename, buffer, force = false) {
  await mkdir(path.dirname(filename), { recursive: true });
  if (!force) {
    try { await writeFile(filename, buffer, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') throw new ResumeError('文件已存在，未覆盖', { file: filename, code: 'EXISTS' }); throw error; }
    return;
  }
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch(() => {}); }
}
export const savePdf = saveFile;
export async function initializeProject(directory, template = 'campus') {
  if (!['campus', 'experience', 'blank'].includes(template)) throw new ResumeError('template 只支持 campus、experience 或 blank');
  const target = path.resolve(directory);
  await ensureNewOutput(target);
  const source = template === 'campus' ? kitRoot : path.join(kitRoot, template === 'experience' ? 'examples/experienced' : 'templates/blank');
  const loaded = await loadResume(path.join(source, 'resume.md'));
  const files = [
    { relative: 'resume.md', bytes: await readFile(loaded.inputFile) },
    { relative: 'layout.yaml', bytes: await readFile(loaded.configFile) },
    { relative: '.gitignore', bytes: Buffer.from('output/\n*.pdf\n*.html\n*.local.*\n') },
  ];
  for (const asset of Object.values(loaded.document.assets)) {
    // Bundled starter assets stay within the starter directory tree.
    if (asset.src.includes('..')) throw new ResumeError('起步文件中的资产路径不能包含 ..');
    files.push({ relative: asset.src, bytes: await readFile(assetPath(source, asset.src)) });
  }
  await mkdir(path.dirname(target), { recursive: true });
  try { await mkdir(target); }
  catch (error) { if (error.code === 'EEXIST') throw new ResumeError('目标目录已存在，未覆盖', { file: target }); throw error; }
  for (const file of files) {
    const destination = path.join(target, file.relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.bytes, { flag: 'wx' });
  }
  return target;
}
