import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCropModel, normalizeCrop, rotateCrop, portraitFrame } from '../app/crop.mjs';
import { insertResumeEntry } from '../app/entries.mjs';
import { parseResume, loadResume } from '../src/input.mjs';
import { kitRoot } from '../src/render.mjs';
import { layoutSchema, validate, resolveSectionOrder } from '../src/schema.mjs';

test('portrait framing covers the whole frame after rotation, zoom and large drag offsets', () => {
  for (const [width,height] of [[2000,600],[500,3000],[690,930]]) {
    const model = createCropModel(width,height);
    for (let angle=0;angle<4;angle++) {
      for (const zoom of [1,1.75,4]) {
        model.zoom = zoom; model.x = 1e6; model.y = -1e6; normalizeCrop(model);
        const rotatedWidth = model.angle % 2 ? height : width, rotatedHeight = model.angle % 2 ? width : height;
        assert.ok(rotatedWidth * model.scale / 2 - Math.abs(model.x) >= portraitFrame.width / 2 - 1e-6);
        assert.ok(rotatedHeight * model.scale / 2 - Math.abs(model.y) >= portraitFrame.height / 2 - 1e-6);
      }
      rotateCrop(model,1);
    }
    assert.equal(model.angle,0);
  }
  assert.equal(portraitFrame.outputWidth / portraitFrame.outputHeight,23/31);
});

test('entry form preserves every existing section and appends into an entries section', async () => {
  const source = await readFile(path.join(kitRoot,'templates/blank/resume.md'),'utf8');
  const frontEnd = source.indexOf('\n---',4)+4, front = source.slice(0,frontEnd), body = source.slice(frontEnd);
  const inserted = insertResumeEntry(body,{kind:'project',title:'C++ / Agent 项目',subtitle:'负责人：开发与测试',date:'2026.03 - 2026.06',stack:'Java · C++',details:'设计 **接口** 并使用 [文档](https://example.com/docs)\n- 编写测试。'});
  const parsed = parseResume(front + '\n' + inserted.body).document;
  const original = parseResume(source).document;
  assert.equal(parsed.sections.length,original.sections.length);
  assert.deepEqual(parsed.sections.find(section=>section.id==='education'),original.sections.find(section=>section.id==='education'));
  const projects = parsed.sections.find(section=>section.id==='projects'); assert.equal(projects.entries.length,2);
  assert.equal(projects.entries[1].date,'2026.03 - 2026.06'); assert.equal(projects.entries[1].subtitle,'负责人：开发与测试');
  assert.deepEqual(projects.entries[1].blocks[0].items,['设计 **接口** 并使用 [文档](https://example.com/docs)','编写测试。']);
});

test('new chapters respect the preset and update an explicit order without duplicate IDs', async () => {
  const loaded = await loadResume(path.join(kitRoot,'templates/blank/resume.md'));
  const source = await readFile(path.join(kitRoot,'templates/blank/resume.md'),'utf8'), end = source.indexOf('\n---',4)+4;
  const body = source.slice(end), order = loaded.document.sections.map(section=>section.id);
  const input = {kind:'internship',title:'我的公司',date:'2026.06 - 至今',details:'负责 API 开发。'};
  const inserted = insertResumeEntry(body,input,{preset:'campus',sectionOrder:order});
  const model = parseResume(source.slice(0,end)+'\n'+inserted.body).document;
  const layout = validate(layoutSchema,{schemaVersion:'0.2.0',sectionOrder:inserted.sectionOrder},new Map());
  assert.deepEqual(resolveSectionOrder(model,layout),['education','skills','internship','projects','additional']);
  const again = insertResumeEntry(inserted.body,input,{preset:'campus',sectionOrder:inserted.sectionOrder});
  const repeated = parseResume(source.slice(0,end)+'\n'+again.body).document;
  assert.equal(repeated.sections.filter(section=>section.id==='internship').length,1);
  assert.equal(repeated.sections.find(section=>section.id==='internship').entries.length,2);
});

test('entry helper rejects incomplete fields and unsafe chapter structures before changing text', () => {
  const input = {kind:'education',title:'学校',date:'2023 - 2027',details:'课程与奖项。'};
  assert.throws(()=>insertResumeEntry('',{...input,date:''}),/时间/);
  assert.throws(()=>insertResumeEntry('',{...input,title:'学校\n## 另一章'}),/同一行/);
  assert.throws(()=>insertResumeEntry('## 教育 {#education .skills}\n',input),/不是经历章节/);
  assert.throws(()=>insertResumeEntry('## 教育 {#education .entries}\n\n## 重复 {#education .entries}\n',input),/重复/);
  assert.throws(()=>insertResumeEntry('```yaml\n',input),/未结束/);
});
