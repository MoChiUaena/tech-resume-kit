import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPortable } from '../src/portable.mjs';

test('portable preflight rejects the wrong host, modified runtimes and an external browser path before creating user data', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tech-resume-portable-preflight-'));
  t.after(async () => { const actual = await realpath(root); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-portable-preflight-'))); await rm(actual, { recursive: true, force: true }); });
  const browser = 'browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', bytes = Buffer.from('test runtime'), hash = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.join(root, 'runtime/bin'), { recursive: true }); await mkdir(path.dirname(path.join(root, 'runtime', browser)), { recursive: true }); await mkdir(path.join(root, 'toolkit'));
  await writeFile(path.join(root, 'runtime/bin/node'), bytes); await writeFile(path.join(root, 'runtime', browser), bytes); await writeFile(path.join(root, 'toolkit/package.json'), '{"version":"0.8.0-dev.3"}');
  const manifest = { kit: '0.8.0-dev.3', node: '24.18.0', platform: 'linux', arch: 'x64', playwright: '1.63.0', chromiumHeadlessRevision: '1243', chromiumExecutable: browser, nodeBinarySha256: hash, chromiumBinarySha256: hash };
  const save = value => writeFile(path.join(root, 'runtime/versions.json'), JSON.stringify(value));
  await save(manifest); assert.equal((await inspectPortable(root, { platform: 'linux', arch: 'x64' })).versions.arch, 'x64');
  await assert.rejects(inspectPortable(root, { platform: 'darwin', arch: 'arm64' }), /系统和芯片/);
  await writeFile(path.join(root, 'runtime/bin/node'), 'changed'); await assert.rejects(inspectPortable(root, { platform: 'linux', arch: 'x64' }), /校验失败/); await writeFile(path.join(root, 'runtime/bin/node'), bytes);
  await save({ ...manifest, chromiumExecutable: '../../outside' }); await assert.rejects(inspectPortable(root, { platform: 'linux', arch: 'x64' }), /版本不匹配/);
  await assert.rejects(access(path.join(root, 'data')));
});
