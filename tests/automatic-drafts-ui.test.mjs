import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { initializeProject } from '../src/files.mjs';
import { startEditor } from '../src/app.mjs';
import { kitRoot } from '../src/render.mjs';

async function fixture(t, cacheUnavailable = false, theme) {
  const outer = await mkdtemp(path.join(tmpdir(), 'tech-resume-auto-ui-')), root = path.join(outer, '资料'); await initializeProject(root, theme ? 'java-backend' : 'campus', { theme });
  let app = await startEditor(root, { historyIntervalMs: 0 }); const browser = await chromium.launch({ channel: 'chromium' }), context = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  if (cacheUnavailable) await context.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage disabled', 'QuotaExceededError'); }; });
  const errors = [], external = [];
  async function page() { const result = await context.newPage(); result.on('pageerror', error => errors.push(error.message)); result.on('dialog', dialog => dialog.accept()); result.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); }); await result.goto(app.url); await result.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 }); return result; }
  t.after(async () => { await browser.close(); await app.close(); const actual = await realpath(outer); assert.ok(actual.startsWith(path.join(await realpath(tmpdir()), 'tech-resume-auto-ui-'))); await rm(actual, { recursive: true, force: true, maxRetries: 3 }); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  return { root, page, get app() { return app; }, restart: async () => { await app.close(); app = await startEditor(root, { historyIntervalMs: 0 }); } };
}
const failSave = page => page.route('**/api/save', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '保存暂时不可用' } }) }));
async function edit(page, value) { const persisted = page.waitForResponse(response => response.url().endsWith('/api/drafts/write') && response.status() === 200); await page.getByLabel('姓名', { exact: true }).fill(value); await persisted; await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor(); }
async function candidates(f) { const state = await f.app.project.read(); return (await f.app.project.listDrafts({ scope: state.draftScope, resumeId: state.resumeId })).drafts; }

test('refresh offers a recoverable draft without replacing saved input until explicit recovery', async t => {
  const f = await fixture(t), page = await f.page(), original = await readFile(path.join(f.root, 'resume.md'), 'utf8');
  await failSave(page); await edit(page, '刷新后找回姓名');
  await page.reload(); await page.locator('#draft-recovery:not([hidden])').waitFor();
  assert.notEqual(await page.getByLabel('姓名', { exact: true }).inputValue(), '刷新后找回姓名'); assert.equal(await readFile(path.join(f.root, 'resume.md'), 'utf8'), original);
  await page.locator('#page-status').filter({ hasText: 'A4' }).waitFor({ timeout: 30000 });
  const qa = path.join(kitRoot, 'tmp/ui/automatic-drafts'); await mkdir(qa, { recursive: true }); await page.screenshot({ path: path.join(qa, 'desktop-recovery.png') });
  await page.setViewportSize({ width: 390, height: 760 }); await page.locator('#draft-recovery').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(qa, 'small-recovery.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#draft-resume').click(); assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '刷新后找回姓名');
  await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor(); await page.unroute('**/api/save');
  const cleared = page.waitForResponse(response => response.url().endsWith('/api/drafts/clear') && response.status() === 200); await page.locator('#save-retry').click();
  await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  await cleared;
  assert.match(await readFile(path.join(f.root, 'resume.md'), 'utf8'), /刷新后找回姓名/); assert.deepEqual(await candidates(f), []);
});
test('restarting on a new port recovers a conflicted draft and preserves the externally saved file', async t => {
  const f = await fixture(t), first = await f.page(); await failSave(first); await edit(first, '重启前的草稿');
  const original = await f.app.project.read(), changed = original.source.replace(original.front.person.name, '外部正式姓名'); await writeFile(path.join(f.root, 'resume.md'), changed);
  await first.close(); await f.restart(); const page = await f.page(); await page.locator('#draft-recovery:not([hidden])').waitFor();
  assert.match(await page.locator('#draft-description').innerText(), /其他窗口|变化|冲突/);
  await page.locator('#draft-resume').click(); await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '重启前的草稿'); assert.equal(await readFile(path.join(f.root, 'resume.md'), 'utf8'), changed);
  assert.equal(await page.locator('#save-draft').isVisible(), true);
});
test('two windows keep independent drafts and deleting one leaves the other recoverable', async t => {
  const f = await fixture(t), a = await f.page(), b = await f.page(); await failSave(a); await failSave(b);
  await edit(a, '窗口甲的草稿'); await edit(b, '窗口乙的草稿'); await a.reload(); await a.locator('#draft-recovery:not([hidden])').waitFor();
  await a.locator('#draft-choice option').nth(1).waitFor({ state: 'attached' });
  const first = (await candidates(f)).find(item => item.payload.front.person.name === '窗口甲的草稿');
  await a.locator('#draft-choice').selectOption(first.id); await a.locator('#draft-delete').click();
  await a.waitForFunction(() => document.querySelector('#draft-choice').options.length === 1);
  assert.equal((await candidates(f))[0].payload.front.person.name, '窗口乙的草稿');
  await a.locator('#draft-later').click(); assert.equal(await a.locator('#draft-recovery').isVisible(), false);
  await a.reload(); await a.locator('#draft-recovery:not([hidden])').waitFor(); assert.equal((await candidates(f)).length, 1);
});
test('full-source drafts survive restart even when browser storage is unavailable', async t => {
  const f = await fixture(t, true), page = await f.page(); await page.locator('#source-mode').click();
  await page.waitForFunction(() => document.querySelector('#person-fields').hidden); await failSave(page);
  const source = '\uFEFF---\r\nperson: [\r\n---\r\n未完成源文件\r\n';
  const persisted = page.waitForResponse(response => response.url().endsWith('/api/drafts/write') && response.status() === 200); await page.locator('#body').fill(source); await persisted;
  const enteredSource = await page.locator('#body').inputValue();
  await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor(); await page.close(); await f.restart();
  const target = await f.page(); await target.locator('#draft-recovery:not([hidden])').waitFor(); await failSave(target); await target.locator('#draft-resume').click();
  assert.equal(await target.locator('#body').inputValue(), enteredSource); assert.equal(await target.locator('#person-fields').isVisible(), false);
});
test('browser cache recovers input on an immediate refresh before a failed file checkpoint', async t => {
  const f = await fixture(t), page = await f.page(); await failSave(page);
  await writeFile(path.join(f.root, 'editor-drafts.local.d'), '文件阻止草稿目录写入');
  await page.getByLabel('姓名', { exact: true }).fill('刚输入就刷新'); await page.reload();
  await page.locator('#draft-recovery:not([hidden])').waitFor(); await assert.rejects(candidates(f), /草稿目录/);
  await page.locator('#draft-resume').click(); assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '刚输入就刷新');
  await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor(); assert.match(await page.locator('#draft-status').innerText(), /暂存失败|草稿文件/);
});
test('switching resumes immediately invalidates recovery choices while the next list is delayed', async t => {
  const f = await fixture(t), initial = await f.app.project.read();
  const second = await f.app.project.create({ ...initial, name: '另一份校招', template: 'campus' });
  await f.app.project.switchResume({ ...second, targetId: initial.resumeId });
  const page = await f.page(); await failSave(page); await edit(page, '只能回填原简历');
  await page.reload(); await page.locator('#draft-recovery:not([hidden])').waitFor();
  let releaseList, enteredList; const gate = new Promise(resolve => releaseList = resolve), entered = new Promise(resolve => enteredList = resolve);
  await page.route('**/api/drafts/list', async route => { if (route.request().postDataJSON().resumeId === second.resumeId) { enteredList(); await gate; } await route.continue(); });
  try {
    await page.locator('#resume-select').selectOption(second.resumeId); await entered;
    assert.equal(await page.locator('#draft-recovery').isVisible(), false);
    await page.evaluate(() => document.querySelector('#draft-resume').click());
    assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), initial.front.person.name);
    assert.equal((await f.app.project.read()).front.person.name, initial.front.person.name);
  } finally { releaseList(); }
});
for (const damage of ['empty payload', 'unknown layout key']) test(`a damaged browser snapshot (${damage}) is preserved but never offered as editor state`, async t => {
  const f = await fixture(t), page = await f.page();
  await page.evaluate(async damage => {
    const state = await (await fetch('/api/state')).json(), id = crypto.randomUUID();
    const payload = damage === 'empty payload' ? {} : { baseSource: state.source, front: state.front, body: state.body + '\n未保存内容', layout: { ...state.layout, unknownOption: true } };
    localStorage.setItem(`tech-resume-draft:${state.draftScope}:${state.resumeId}:${id}`, JSON.stringify({ scope: state.draftScope, resumeId: state.resumeId, id, sequence: 1, baseRevision: state.revision, updatedAt: new Date().toISOString(), payload }));
  }, damage);
  await page.reload(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#draft-recovery').isVisible(), false);
  assert.match(await page.locator('#draft-status').innerText(), /无法读取|损坏/);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('tech-resume-draft:')).length), 1);
  await page.getByLabel('姓名', { exact: true }).fill('仍可正常填写'); await page.locator('#save-status').filter({ hasText: '已自动保存' }).waitFor();
  assert.equal((await f.app.project.read()).front.person.name, '仍可正常填写');
});
for (const cleared of ['false', 1]) test(`a malformed cleared flag ${JSON.stringify(cleared)} cannot erase a valid file draft`, async t => {
  const f = await fixture(t), page = await f.page(), state = await f.app.project.read();
  const record = { scope: state.draftScope, resumeId: state.resumeId, id: crypto.randomUUID(), sequence: 1, baseRevision: state.revision, updatedAt: new Date().toISOString(), payload: { source: state.source + '\n保留的原始草稿', layout: state.layout } };
  await f.app.project.writeDraft(record);
  await page.evaluate(({ record, cleared }) => localStorage.setItem(`tech-resume-draft:${record.scope}:${record.resumeId}:${record.id}`, JSON.stringify({ ...record, cleared })), { record, cleared });
  await page.reload(); await page.locator('#pdf-download:not([disabled])').waitFor({ timeout: 30000 });
  assert.equal((await candidates(f)).length, 1);
  assert.match(await page.locator('#draft-status').innerText(), /无法读取|损坏/);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('tech-resume-draft:')).length), 1);
});
test('an old save acknowledgement does not delete newer input and rebases its own draft revision', async t => {
  const f = await fixture(t), page = await f.page(); let releaseSave, enteredSave, first = true;
  const entered = new Promise(resolve => enteredSave = resolve), gate = new Promise(resolve => releaseSave = resolve);
  await page.route('**/api/save', async route => { if (first) { first = false; enteredSave(); await gate; return route.continue(); } return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '第二次保存失败' } }) }); });
  await page.getByLabel('姓名', { exact: true }).fill('第一次输入'); await entered;
  const persisted = page.waitForResponse(response => response.url().endsWith('/api/drafts/write') && response.status() === 200); await page.getByLabel('姓名', { exact: true }).fill('保存途中更新的输入'); await persisted;
  releaseSave(); await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  const drafts = await candidates(f); assert.equal(drafts.length, 1); assert.equal(drafts[0].payload.front.person.name, '保存途中更新的输入'); assert.equal(drafts[0].conflict, false);
  await page.reload(); await page.locator('#draft-recovery:not([hidden])').waitFor(); await page.locator('#draft-resume').click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '保存途中更新的输入');
});

for (const theme of ['minimal-mono','slate-banner','forest-rail','warm-labels','graphite-grid']) test('themed browser draft survives refresh: ' + theme, async t => {
  const f = await fixture(t, false, theme), page = await f.page(), original = await f.app.project.read();
  await failSave(page); await writeFile(path.join(f.root, 'editor-drafts.local.d'), 'Prevent draft-file writes to require the browser cache');
  const name = '恢复草稿-' + theme;
  await page.getByLabel('姓名', { exact: true }).fill(name);
  await page.locator('#save-status').filter({ hasText: '保存失败' }).waitFor();
  await page.reload(); await page.locator('#draft-recovery:not([hidden])').waitFor({ timeout: 10000 });
  assert.equal((await f.app.project.read()).source, original.source);
  await page.locator('#draft-resume').click(); assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), name);
  assert.equal(await page.locator('#visual-theme').inputValue(), theme);
  assert.equal((await f.app.project.read()).source, original.source);
});

test('themed file draft survives a program restart without browser cache', async t => {
  const f = await fixture(t, true, 'slate-banner'), page = await f.page(), original = await f.app.project.read();
  await failSave(page); await edit(page, '重启恢复深蓝草稿');
  await page.close(); await f.restart(); const reopened = await f.page();
  await reopened.locator('#draft-recovery:not([hidden])').waitFor({ timeout: 10000 });
  assert.equal((await f.app.project.read()).source, original.source);
  await failSave(reopened); await reopened.locator('#draft-resume').click();
  assert.equal(await reopened.getByLabel('姓名', { exact: true }).inputValue(), '重启恢复深蓝草稿');
  assert.equal(await reopened.locator('#visual-theme').inputValue(), 'slate-banner');
  assert.equal((await f.app.project.read()).source, original.source);
});
