import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSchema, validate } from '../src/schema.mjs';
import { loadResume } from '../src/input.mjs';
import { renderResume, kitRoot } from '../src/render.mjs';
import { inspectAndExport } from '../src/export.mjs';
import path from 'node:path';

test('optional compact typography, asymmetric margins and header controls validate without changing old layouts', () => {
  const existing = validate(layoutSchema, { schemaVersion: '0.2.0' }, new Map());
  assert.equal(existing.page.marginMm, 15);
  assert.equal(existing.density, 'standard');
  assert.equal(existing.fontFamily, 'sans');

  const layout = validate(layoutSchema, {
    schemaVersion: '0.2.0', density: 'compact', fontFamily: 'serif', bodyPt: 9.75,
    lineHeight: 1.15,
    page: { marginMm: 14, marginHorizontalMm: 9, marginTopMm: 9, marginBottomMm: 9 },
    header: { align: 'center', contactStyle: 'labeled' },
    spacing: { sectionMm: 1.4, entryMm: 1.5 },
    images: { portrait: { slot: 'end' } },
  }, new Map());
  assert.equal(layout.page.marginHorizontalMm, 9);
  assert.equal(layout.page.marginTopMm, 9);
  assert.equal(layout.page.marginBottomMm, 9);
  assert.equal(layout.images.portrait.slot, 'end');
  assert.equal(layout.header.align, 'center');
  assert.equal(layout.header.contactStyle, 'labeled');
});

test('compact layout renders locally with right-side portrait and independently sized page margins', async () => {
  const loaded = await loadResume(path.join(kitRoot, 'resume.md'));
  const layout = {
    ...loaded.layout, density: 'compact', fontFamily: 'serif',
    page: { ...loaded.layout.page, marginHorizontalMm: 9, marginTopMm: 10, marginBottomMm: 8 },
    header: { ...loaded.layout.header, align: 'center', contactStyle: 'labeled' },
    images: { ...loaded.layout.images, portrait: { ...loaded.layout.images.portrait, slot: 'end' } },
  };
  const rendered = await renderResume(loaded.document, layout, loaded);
  assert.ok(rendered.html.includes('density-compact'));
  assert.ok(rendered.html.includes('font-serif'));
  assert.ok(rendered.html.includes('@page{margin:10mm 9mm 8mm;}'));
  assert.ok(rendered.html.includes('@page{@bottom-right{content:none}}'));
  assert.ok(rendered.html.includes('contact-label'));
  const result = await inspectAndExport(rendered, { pdf: true });
  assert.equal(result.metrics.pageCount, 1);
  assert.equal(result.metrics.outOfBounds.length, 0);
  assert.equal(result.metrics.overlap, false);
  const identityCenter = result.metrics.identity.x + result.metrics.identity.width / 2;
  const pageCenter = result.metrics.sheet.x + result.metrics.sheet.width / 2;
  assert.ok(Math.abs(identityCenter - pageCenter) < 12, `header center offset ${Math.round(identityCenter - pageCenter)}px`);
  assert.ok(result.metrics.images.find(image => image.asset === 'portrait').x > result.metrics.identity.x);
  assert.ok(Math.abs(result.metrics.contentWidthPx - 192 * 96 / 25.4) < 0.1);
});

test('spread header places contacts before the age and role while keeping the name centered', async () => {
  const loaded = await loadResume(path.join(kitRoot, 'resume.md'));
  const layout = {
    ...loaded.layout, density: 'compact',
    header: { ...loaded.layout.header, align: 'spread' },
    images: { ...loaded.layout.images, portrait: { ...loaded.layout.images.portrait, slot: 'end' } },
  };
  const rendered = await renderResume(loaded.document, layout, loaded);
  const header = rendered.html.split('<header class="resume-header"')[1].split('</header>')[0];
  assert.ok(header.indexOf('class="contacts"') < header.indexOf('class="details-row"'));
  assert.ok(header.indexOf('class="graduate-label"') > header.indexOf('class="contacts"'));
  const result = await inspectAndExport(rendered, { pdf: true });
  assert.equal(result.metrics.overlap, false);
  assert.equal(result.metrics.pageCount, 1);
  const identityCenter = result.metrics.identity.x + result.metrics.identity.width / 2;
  const pageCenter = result.metrics.sheet.x + result.metrics.sheet.width / 2;
  assert.ok(Math.abs(identityCenter - pageCenter) < 12);
});
