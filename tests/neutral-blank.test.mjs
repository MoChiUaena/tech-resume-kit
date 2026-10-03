import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadResume } from '../src/input.mjs';
import { kitRoot } from '../src/render.mjs';

test('blank starter uses neutral editable prompts rather than a career or graduation assumption', async () => {
  const loaded=await loadResume(path.join(kitRoot,'templates/blank/resume.md'));
  assert.equal(loaded.document.person.target,'目标岗位 / 职务');
  assert.equal(loaded.document.person.label,'学历 / 毕业届别');
  assert.doesNotMatch(loaded.source || loaded.document.person.availability,/每周到岗天数|实习时长/);
  const labels=loaded.document.sections.find(section=>section.id==='skills').items.map(item=>item.label);
  assert.deepEqual(labels,['专业能力','工具与方法']);
  const dates=loaded.document.sections.filter(section=>section.kind==='entries').flatMap(section=>section.entries.map(entry=>entry.date));
  assert.ok(dates.every(date=>!/20\d\d/.test(date)));
  assert.deepEqual(loaded.document.assets,{});
});
