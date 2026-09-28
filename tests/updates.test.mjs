import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { compareVersions, checkRelease, createUpdater, extractPackage } from '../src/updates.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function release(version, buffer) {
  const archiveName = `tech-resume-windows-x64-${version}.zip`;
  const assets = [archiveName, 'SHA256SUMS.txt'].map(name => ({ name, size: name === archiveName ? buffer.length : 150, browser_download_url: `https://github.com/MoChiUaena/tech-resume-kit/releases/download/v${version}/${name}` }));
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets };
}
function packageBytes(version, extras = {}) {
  const root = `tech-resume-windows-x64-${version}`, node = Buffer.from('test runtime');
  return Buffer.from(zipSync(Object.fromEntries(Object.entries({
    '启动简历.exe': Buffer.from('fixture executable, never run'), 'runtime/node.exe': node,
    'runtime/versions.json': Buffer.from(JSON.stringify({ kit: version, nodeExeSha256: sha(node) })),
    'toolkit/package.json': Buffer.from(JSON.stringify({ version })), 'toolkit/src/app.mjs': Buffer.from('// fixture'), ...extras,
  }).map(([name, bytes]) => [`${root}/${name}`, bytes]))));
}
async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'tech-resume-update-'));
  t.after(async () => { const actual = await realpath(home); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-update-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  return home;
}
function fakeFetch(metadata, buffer, expected = sha(buffer)) {
  return async url => url.endsWith('/latest') ? new Response(JSON.stringify(metadata)) : url.endsWith('/SHA256SUMS.txt') ? new Response(`${expected}  tech-resume-windows-x64-${metadata.tag_name.slice(1)}.zip\n`) : new Response(buffer);
}
test('formal version checks never downgrade a newer development version and compare prerelease versions correctly', async () => {
  assert.equal(compareVersions('0.7.0-dev.2', '0.6.0'), 1); assert.equal(compareVersions('0.7.0', '0.7.0-dev.2'), 1);
  assert.equal(compareVersions('0.7.0-dev.10', '0.7.0-dev.2'), 1); assert.equal(compareVersions('0.7.0-dev.2', '0.7.0-dev.2'), 0);
  const buffer = packageBytes('0.6.0'), metadata = release('0.6.0', buffer);
  assert.equal((await checkRelease('0.7.0-dev.2', fakeFetch(metadata, buffer))).available, false);
  assert.equal((await checkRelease('0.5.0', fakeFetch(metadata, buffer))).available, true);
  metadata.assets[0].browser_download_url = 'https://example.com/unknown.zip';
  await assert.rejects(checkRelease('0.5.0', fakeFetch(metadata, buffer)), /来源/);
});
test('download verifies SHA-256 and runtime, stages a separate version, and records a rollback path', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0'), previous = path.join(home, 'original-program');
  const manager = await createUpdater({ version: '0.7.0-dev.2', home, programDirectory: previous, supported: true, fetcher: fakeFetch(release('0.8.0', buffer), buffer) });
  assert.equal((await manager.check()).available, true); assert.equal(manager.prepare().phase, 'downloading'); await manager.wait();
  const ready = manager.status(); assert.equal(ready.phase, 'ready'); assert.notEqual(ready.directory, previous); assert.equal(ready.sha256, sha(buffer));
  assert.match(await readFile(path.join(ready.directory, '启动简历.exe'), 'utf8'), /fixture executable/);
  assert.equal(await manager.activate({ backup: path.join(home, 'whole-library-snapshot') }), ready.directory);
  const reopened = await createUpdater({ version: '0.8.0', home, programDirectory: ready.directory, supported: true });
  assert.equal(reopened.status().rollbackDirectory, previous); await manager.close(); await reopened.close();
});
test('corrupted downloads and unsafe archives fail without becoming launchable', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0');
  const manager = await createUpdater({ version: '0.7.0-dev.2', home, supported: true, fetcher: fakeFetch(release('0.8.0', buffer), buffer, '0'.repeat(64)) });
  await manager.check(); manager.prepare(); await manager.wait(); assert.equal(manager.status().phase, 'failed'); assert.match(manager.status().error, /SHA-256/);
  await assert.rejects(manager.activate({ backup: 'never' }), /尚未/);
  const unsafe = path.join(home, 'unsafe.zip'); await writeFile(unsafe, packageBytes('0.8.0', { '../outside.txt': Buffer.from('unsafe') }));
  await assert.rejects(extractPackage(unsafe, path.join(home, 'unsafe-stage'), '0.8.0'), /不安全/);
  const mismatch = path.join(home, 'mismatch.zip'); await writeFile(mismatch, packageBytes('0.8.0', { 'runtime/node.exe': Buffer.from('changed') }));
  await assert.rejects(extractPackage(mismatch, path.join(home, 'mismatch-stage'), '0.8.0'), /运行时/);
  await manager.close();
});
test('network failure and an unsupported environment keep local editing independent of updates', async t => {
  const home = await fixture(t);
  await assert.rejects(checkRelease('0.7.0-dev.2', async () => { throw new Error('offline'); }), /本地简历可以继续/);
  const manager = await createUpdater({ version: '0.7.0-dev.2', home, supported: false });
  assert.throws(() => manager.prepare(), /正式发布页/); await manager.close();
});
test('unwritable update folders and incomplete ZIP files fail without leaving a pending update', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0'); await writeFile(path.join(home, 'updates'), 'occupied');
  const manager = await createUpdater({ version: '0.7.0-dev.2', home, supported: true, fetcher: fakeFetch(release('0.8.0', buffer), buffer) });
  await manager.check(); manager.prepare(); await manager.wait(); assert.equal(manager.status().phase, 'failed');
  const truncated = path.join(home, 'truncated.zip'); await writeFile(truncated, buffer.subarray(0, -15));
  await assert.rejects(extractPackage(truncated, path.join(home, 'stage'), '0.8.0'), /不完整/); await manager.close();
});
test('damaged update records disable rollback without preventing local startup', async t => {
  const home = await fixture(t); await writeFile(path.join(home, 'update-state.json'), '{broken');
  const manager = await createUpdater({ version: '0.7.0-dev.2', home, supported: true });
  assert.equal(manager.status().rollbackDirectory, null); assert.match(manager.status().warning, /记录无法读取/); await manager.close();
});
