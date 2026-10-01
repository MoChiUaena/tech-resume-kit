import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
import { initializeProject } from '../src/files.mjs';
import { openLibrary } from '../src/library.mjs';
import { openProject } from '../src/project.mjs';
import { decodeBackup, applyBackup } from '../src/backup.mjs';
import { parseResume } from '../src/input.mjs';
import { inventory } from '../src/storage.mjs';

async function fixture(t) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-draft-')), root = path.join(outer, '原资料');
  await initializeProject(root, 'campus');
  const source = await readFile(path.join(root, 'resume.md'), 'utf8');
  await writeFile(path.join(root, 'resume.md'), '\uFEFF' + source.replace('schemaVersion: 0.2.0', 'schemaVersion: 0.2.0 # 保留填写说明').replace(/\n/g, '\r\n'));
  const library = await openLibrary(root, { historyIntervalMs: 0 });
  t.after(async () => {
    await library.close(); const actual = await realpath(outer);
    assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-draft-')));
    await rm(actual, { recursive: true, force: true, maxRetries: 3 });
  });
  return { outer, root, library, original: await library.read() };
}

function rewriteArchiveSource(buffer, change) {
  const files = unzipSync(buffer), manifest = JSON.parse(Buffer.from(files['backup.json']).toString('utf8'));
  files['resume.md'] = Buffer.from(change(Buffer.from(files['resume.md']).toString('utf8')));
  const entry = manifest.files.find(item => item.name === 'resume.md');
  entry.size = files['resume.md'].length; entry.sha256 = createHash('sha256').update(files['resume.md']).digest('hex');
  manifest.fingerprint = createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex');
  files['backup.json'] = Buffer.from(JSON.stringify(manifest)); return Buffer.from(zipSync(files));
}

test('a conflicting form draft exports its current text, layout and images without changing any library file', async t => {
  const { outer, root, library, original } = await fixture(t);
  const front = structuredClone(original.front), layout = structuredClone(original.layout);
  front.person.name = '本页草稿姓名'; layout.page.marginMm = 16;
  const body = original.body + '\r\n仍未保存的补充说明。\r\n';
  const externalSource = original.source.replace(original.front.person.name, '外部保存姓名');
  await writeFile(path.join(root, 'resume.md'), externalSource);
  const before = await inventory(root);
  const exported = await library.exportDraft({ resumeId: original.resumeId, revision: original.revision, baseSource: original.source, front, body, layout });
  const decoded = decodeBackup(exported.buffer), model = parseResume(decoded.source).document;
  assert.equal(model.person.name, '本页草稿姓名'); assert.equal(decoded.layout.page.marginMm, 16);
  assert.match(decoded.source, /仍未保存的补充说明/); assert.match(decoded.source, /# 保留填写说明/);
  assert.ok(decoded.source.startsWith('\uFEFF---\r\n')); assert.equal(/(?<!\r)\n/.test(decoded.source), false);
  assert.equal(decoded.manifest.kind, 'draft'); assert.equal(decoded.manifest.resumeId, original.resumeId);
  for (const asset of Object.values(model.assets)) assert.deepEqual(decoded.files[asset.src], await readFile(path.join(root, asset.src)));
  assert.deepEqual(await inventory(root), before); assert.equal((await library.read()).source, externalSource);
  const other = await openLibrary(path.join(outer, '恢复资料'), { historyIntervalMs: 0 });
  try {
    const restored = await other.restore(await other.read(), exported.buffer);
    assert.equal(restored.front.person.name, '本页草稿姓名'); assert.equal(restored.layout.page.marginMm, 16);
    assert.ok(restored.source.includes('# 保留填写说明')); assert.ok(restored.source.startsWith('\uFEFF---\r\n'));
    assert.match(restored.body, /仍未保存的补充说明/);
    for (const [key, asset] of Object.entries(restored.front.assets)) assert.deepEqual(await readFile(path.join(other.root, asset.src)), decoded.files[model.assets[key].src]);
  } finally { await other.close(); }
});

test('rebasing a relative external image keeps the draft comments and Windows line endings', async t => {
  const { outer, root, library, original } = await fixture(t);
  const image = await readFile(path.join(root, original.front.assets.portrait.src));
  await writeFile(path.join(outer, '外部照片.jpg'), image);
  const front = structuredClone(original.front); front.assets.portrait.src = '../外部照片.jpg';
  const before = await inventory(root);
  const exported = await library.exportDraft({ resumeId: original.resumeId, baseSource: original.source, front, body: original.body, layout: original.layout });
  const decoded = decodeBackup(exported.buffer), model = parseResume(decoded.source).document;
  assert.match(model.assets.portrait.src, /^assets\/portrait-/); assert.deepEqual(decoded.files[model.assets.portrait.src], image);
  assert.ok(decoded.source.includes('# 保留填写说明')); assert.ok(decoded.source.startsWith('\uFEFF---\r\n'));
  assert.equal(/(?<!\r)\n/.test(decoded.source), false); assert.deepEqual(await inventory(root), before);
});

test('a malformed full Markdown draft is recoverable with its original bytes and local images', async t => {
  const { outer, root, library, original } = await fixture(t);
  const source = '\uFEFF---\r\nperson: [\r\n---\r\n尚未完成的草稿。\r\n', before = await inventory(root);
  const exported = await library.exportDraft({ resumeId: original.resumeId, source, layout: original.layout });
  const decoded = decodeBackup(exported.buffer); assert.equal(decoded.source, source);
  for (const asset of Object.values(original.front.assets)) assert.deepEqual(decoded.files[asset.src], await readFile(path.join(root, asset.src)));
  assert.deepEqual(await inventory(root), before);
  const other = await openLibrary(path.join(outer, '恢复未完成内容'), { historyIntervalMs: 0 });
  try { assert.equal((await other.restore(await other.read(), exported.buffer)).source, source); }
  finally { await other.close(); }
});

test('exporting an older page draft keeps another selected resume and all its files intact', async t => {
  const { root, library, original } = await fixture(t);
  const current = await library.create({ ...original, name: '另一份简历', template: 'blank' });
  const before = await inventory(root), source = original.source.replace(original.front.person.name, '旧页面草稿');
  const exported = await library.exportDraft({ resumeId: original.resumeId, source, layout: original.layout });
  assert.equal(parseResume(decodeBackup(exported.buffer).source).document.person.name, '旧页面草稿');
  assert.equal((await library.read()).resumeId, current.resumeId); assert.deepEqual(await inventory(root), before);
});

test('invalid or oversized draft requests leave the existing library unchanged', async t => {
  const { root, library, original } = await fixture(t), before = await inventory(root);
  await assert.rejects(library.exportDraft({ resumeId: original.resumeId, source: 'x'.repeat(500001), layout: original.layout }), /500 KB/);
  await assert.rejects(library.exportDraft({ resumeId: original.resumeId, baseSource: original.source, front: [], body: original.body, layout: original.layout }), /格式|填写/);
  await assert.rejects(library.exportDraft({ resumeId: original.resumeId, source: original.source, layout: { ...original.layout, bodyPt: 99 } }), /bodyPt/);
  assert.deepEqual(await inventory(root), before);
});

test('a long missing-image reference cannot produce an oversized backup manifest', async t => {
  const { root, library, original } = await fixture(t), before = await inventory(root);
  const source = original.source.replace(original.front.assets.portrait.src, 'x'.repeat(101000));
  await assert.rejects(library.exportDraft({ resumeId: original.resumeId, source, layout: original.layout }), /backup.json|大小|上限/);
  assert.deepEqual(await inventory(root), before);
});

test('draft export checks both image path rewrites against the recoverable Markdown limit', async t => {
  const { outer, root, library, original } = await fixture(t);
  await writeFile(path.join(outer, 'x.jpg'), await readFile(path.join(root, original.front.assets.portrait.src)));
  const before = await inventory(root);
  for (const base of [original.source, original.source.replace(original.front.assets.portrait.src, '../x.jpg')]) {
    const source = base + 'x'.repeat(500000 - Buffer.byteLength(base));
    await assert.rejects(library.exportDraft({ resumeId: original.resumeId, source, layout: original.layout }), /500 KB|大小|上限/);
  }
  const shorter = original.source + 'x'.repeat(499000 - Buffer.byteLength(original.source));
  const exported = await library.exportDraft({ resumeId: original.resumeId, source: shorter, layout: original.layout });
  const other = await openLibrary(path.join(outer, '接近上限恢复'), { historyIntervalMs: 0 });
  try { assert.ok(Buffer.byteLength((await other.restore(await other.read(), exported.buffer)).source) <= 500000); }
  finally { await other.close(); }
  assert.deepEqual(await inventory(root), before);
});

test('an older ZIP that would exceed the restored source limit is rejected before writing images', async t => {
  const { outer, library, original } = await fixture(t);
  const exported = await library.exportDraft({ resumeId: original.resumeId, source: original.source, layout: original.layout });
  const legacy = rewriteArchiveSource(exported.buffer, source => source + 'x'.repeat(500000 - Buffer.byteLength(source)));
  const target = await openProject(path.join(outer, '旧包恢复目标')), before = await inventory(target.root);
  await assert.rejects(applyBackup(target, decodeBackup(legacy)), /500 KB|大小|上限/);
  assert.deepEqual(await inventory(target.root), before);
});

for (const reference of ['./assets/images/nailong-avatar.jpg', 'assets/images/../images/nailong-avatar.jpg']) {
  test(`a draft normalizes ${reference} and restores its photo in a new directory`, async t => {
    const { outer, root, library, original } = await fixture(t);
    const source = original.source.replace(original.front.assets.portrait.src, reference), before = await inventory(root);
    const exported = await library.exportDraft({ resumeId: original.resumeId, source, layout: original.layout });
    const decoded = decodeBackup(exported.buffer), model = parseResume(decoded.source).document;
    assert.equal(model.assets.portrait.src, 'assets/images/nailong-avatar.jpg');
    const other = await openLibrary(path.join(outer, '路径恢复'), { historyIntervalMs: 0 });
    try {
      const restored = await other.restore(await other.read(), exported.buffer);
      assert.deepEqual(await readFile(path.join(other.root, restored.front.assets.portrait.src)), await readFile(path.join(root, original.front.assets.portrait.src)));
    } finally { await other.close(); }
    assert.deepEqual(await inventory(root), before);
  });
  test(`an older ZIP with ${reference} restores through normalized image lookup`, async t => {
    const { outer, root, library, original } = await fixture(t);
    const exported = await library.exportDraft({ resumeId: original.resumeId, source: original.source, layout: original.layout });
    const legacy = rewriteArchiveSource(exported.buffer, source => source.replace(original.front.assets.portrait.src, reference));
    const other = await openLibrary(path.join(outer, '旧路径恢复'), { historyIntervalMs: 0 });
    try {
      const restored = await other.restore(await other.read(), legacy);
      assert.ok(restored.front.assets.portrait.src.startsWith('assets/restored-'));
      assert.deepEqual(await readFile(path.join(other.root, restored.front.assets.portrait.src)), await readFile(path.join(root, original.front.assets.portrait.src)));
    } finally { await other.close(); }
  });
}
