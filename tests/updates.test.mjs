import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath, mkdir, symlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { createServer } from 'node:http';
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

async function interruptedDownload(home, buffer) {
  const metadata = release('0.8.0', buffer), cut = Math.floor(buffer.length / 2);
  const fetcher = async url => url.endsWith('/latest') ? new Response(JSON.stringify(metadata)) : url.endsWith('/SHA256SUMS.txt') ? new Response(`${sha(buffer)}  tech-resume-windows-x64-0.8.0.zip\n`) : new Response(buffer.subarray(0, cut), { headers: { ETag: '"fixture-v1"', 'Content-Length': String(buffer.length) } });
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, programDirectory: path.join(home, 'old-program'), supported: true, fetcher });
  await manager.check(); manager.prepare(); await manager.wait();
  assert.equal(manager.status().phase, 'failed'); assert.equal(manager.status().received, cut); assert.equal(manager.status().resumable, true);
  await manager.close(); return cut;
}
function rangedResponse(buffer, offset) {
  return new Response(buffer.subarray(offset), { status: 206, headers: { 'Content-Range': `bytes ${offset}-${buffer.length - 1}/${buffer.length}`, ETag: '"fixture-v1"' } });
}
test('a partial download resumes after restart with Range and If-Range; the prepared version survives another offline restart', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0'), cut = await interruptedDownload(home, buffer), requests = [];
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, programDirectory: path.join(home, 'old-program'), supported: true, fetcher: async (url, options) => {
    requests.push(url); assert.ok(url.endsWith('.zip')); assert.equal(options.headers.Range, `bytes=${cut}-`); assert.equal(options.headers['If-Range'], '"fixture-v1"'); return rangedResponse(buffer, cut);
  } });
  assert.equal(manager.status().phase, 'paused'); assert.equal(manager.status().received, cut);
  manager.prepare(); await manager.wait(); assert.equal(manager.status().phase, 'ready'); assert.equal(requests.length, 1);
  const directory = manager.status().directory; await manager.close();
  const offline = await createUpdater({ version: '0.7.0-dev.3', home, programDirectory: path.join(home, 'old-program'), supported: true, fetcher: async () => { throw new Error('network must not be used'); } });
  assert.equal(offline.status().phase, 'ready'); assert.equal(offline.status().directory, directory);
  assert.equal(await offline.activate({ backup: path.join(home, 'backup') }), directory); await offline.close();
});
test('a server that ignores Range restarts the cache file instead of appending a complete package to the old prefix', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0'), cut = await interruptedDownload(home, buffer);
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher: async (url, options) => {
    assert.equal(options.headers.Range, `bytes=${cut}-`); return new Response(buffer, { headers: { ETag: '"fixture-v1"' } });
  } });
  manager.prepare(); await manager.wait(); assert.equal(manager.status().phase, 'ready'); assert.equal(manager.status().sha256, sha(buffer)); await manager.close();
});
test('incorrect ranges retain the old prefix and cannot become a launchable version', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0'), cut = await interruptedDownload(home, buffer);
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher: async () => new Response(buffer.subarray(cut), { status: 206, headers: { 'Content-Range': `bytes ${cut + 1}-${buffer.length - 1}/${buffer.length}`, ETag: '"fixture-v1"' } }) });
  manager.prepare(); await manager.wait(); assert.equal(manager.status().phase, 'failed'); assert.equal(manager.status().received, cut); assert.match(manager.status().error, /续传范围/);
  await assert.rejects(manager.activate({ backup: 'never' }), /尚未/); await manager.close();
});
test('a changed server validator rejects the old prefix rather than joining different downloads', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0'), cut = await interruptedDownload(home, buffer);
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher: async () => new Response(buffer.subarray(cut), { status: 206, headers: { 'Content-Range': `bytes ${cut}-${buffer.length - 1}/${buffer.length}`, ETag: '"fixture-v2"' } }) });
  manager.prepare(); await manager.wait(); assert.equal(manager.status().phase, 'failed'); assert.equal(manager.status().received, 0); assert.match(manager.status().error, /发生变化/); await manager.close();
});
test('a corrupted partial cache is rejected after full SHA-256 verification', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0'), cut = await interruptedDownload(home, buffer);
  const job = JSON.parse(await readFile(path.join(home, 'update-job.json'), 'utf8')), partial = path.join(home, 'updates', job.id, job.release.archive.name + '.download');
  const prefix = await readFile(partial); prefix[0] ^= 1; await writeFile(partial, prefix);
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher: async () => rangedResponse(buffer, cut) });
  manager.prepare(); await manager.wait(); assert.equal(manager.status().phase, 'failed'); assert.equal(manager.status().received, 0); assert.match(manager.status().error, /SHA-256/); await manager.close();
});
test('pause flushes the received prefix and reopening the updater restores the progress', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0'), metadata = release('0.8.0', buffer), cut = Math.floor(buffer.length / 2);
  const fetcher = async (url, options) => {
    if (url.endsWith('/latest')) return new Response(JSON.stringify(metadata));
    if (url.endsWith('/SHA256SUMS.txt')) return new Response(`${sha(buffer)}  tech-resume-windows-x64-0.8.0.zip\n`);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(buffer.subarray(0, cut)); options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true }); }, pull() { return new Promise(() => {}); } }), { headers: { ETag: '"fixture-v1"' } });
  };
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher }); await manager.check(); manager.prepare();
  for (let i = 0; i < 100 && manager.status().received !== cut; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(manager.status().received, cut); const paused = await manager.pause(); assert.equal(paused.phase, 'paused'); assert.equal(paused.received, cut); await manager.close();
  const reopened = await createUpdater({ version: '0.7.0-dev.3', home, supported: true }); assert.equal(reopened.status().phase, 'paused'); assert.equal(reopened.status().received, cut); await reopened.close();
});
test('a prepared file change is rejected and the verified archive can prepare a new copy without network requests', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0', { 'toolkit/other.mjs': Buffer.from('// original') });
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher: fakeFetch(release('0.8.0', buffer), buffer) });
  await manager.check(); manager.prepare(); await manager.wait(); const originalDirectory = manager.status().directory;
  await writeFile(path.join(originalDirectory, 'toolkit/other.mjs'), '// changed');
  await assert.rejects(manager.activate({ backup: 'never' }), /文件发生变化/); assert.equal(manager.status().phase, 'failed'); await manager.close();
  const reopened = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher: async () => { throw new Error('cached archive must be reused'); } });
  reopened.prepare(); await reopened.wait(); assert.equal(reopened.status().phase, 'ready'); assert.notEqual(reopened.status().directory, originalDirectory);
  assert.equal(await readFile(path.join(reopened.status().directory, 'toolkit/other.mjs'), 'utf8'), '// original'); await reopened.close();
});
test('malformed cached metadata and an already-installed version never become a pending update', async t => {
  const home = await fixture(t), buffer = packageBytes('0.8.0');
  const manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher: fakeFetch(release('0.8.0', buffer), buffer) });
  await manager.check(); manager.prepare(); await manager.wait(); await manager.close();
  const current = await createUpdater({ version: '0.8.0', home, supported: true }); assert.equal(current.status().phase, 'idle'); assert.throws(() => current.prepare(), /先检查/); await current.close();
  const filename = path.join(home, 'update-job.json'), saved = JSON.parse(await readFile(filename, 'utf8')); saved.id = '../outside'; await writeFile(filename, JSON.stringify(saved));
  const damaged = await createUpdater({ version: '0.7.0-dev.3', home, supported: true }); assert.equal(damaged.status().phase, 'idle'); assert.match(damaged.status().warning, /下载记录无法读取/); await damaged.close();
});
test('native HTTP fetch resumes a broken response using the persisted byte offset', async t => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'tech-resume-http-update-'))), buffer = packageBytes('0.8.0', { 'toolkit/readme.txt': Buffer.alloc(100000, 'a') }), cut = Math.floor(buffer.length / 2), metadata = release('0.8.0', buffer);
  let manager, server, interrupted = false, resumed = false;
  t.after(async () => { await manager?.close(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); const actual = await realpath(home); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-http-update-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); });
  server = createServer(async (request, response) => {
    if (request.url.endsWith('/latest')) { response.end(JSON.stringify(metadata)); return; }
    if (request.url.endsWith('/SHA256SUMS.txt')) { response.end(`${sha(buffer)}  tech-resume-windows-x64-0.8.0.zip\n`); return; }
    response.setHeader('ETag', '"native-v1"');
    if (request.headers.range) {
      assert.equal(request.headers.range, `bytes=${cut}-`); assert.equal(request.headers['if-range'], '"native-v1"');
      resumed = true; response.writeHead(206, { 'Content-Range': `bytes ${cut}-${buffer.length - 1}/${buffer.length}`, 'Content-Length': buffer.length - cut }); response.end(buffer.subarray(cut)); return;
    }
    response.writeHead(200, { 'Content-Length': buffer.length }); response.flushHeaders(); response.write(buffer.subarray(0, cut));
    for (let i = 0; i < 100 && manager.status().received !== cut; i++) await new Promise(resolve => setTimeout(resolve, 10));
    interrupted = true; response.destroy();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fetcher = (url, options) => fetch(`http://127.0.0.1:${server.address().port}/${url.split('/').at(-1)}`, options);
  manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher }); await manager.check(); manager.prepare(); await manager.wait();
  assert.ok(interrupted); assert.equal(manager.status().phase, 'failed'); assert.equal(manager.status().received, cut); await manager.close();
  manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher }); manager.prepare(); await manager.wait();
  assert.ok(resumed); assert.equal(manager.status().phase, 'ready'); assert.equal(manager.status().sha256, sha(buffer));
});
test('a cache directory link is rejected before any download folder is created through it', async t => {
  const home = await fixture(t), destination = path.join(home, 'outside-cache'); await mkdir(destination); await symlink(destination, path.join(home, 'updates'), process.platform === 'win32' ? 'junction' : 'dir');
  const buffer = packageBytes('0.8.0'), manager = await createUpdater({ version: '0.7.0-dev.3', home, supported: true, fetcher: fakeFetch(release('0.8.0', buffer), buffer) });
  await manager.check(); manager.prepare(); await manager.wait(); assert.equal(manager.status().phase, 'failed'); assert.deepEqual(await readdir(destination), []); await manager.close();
});
