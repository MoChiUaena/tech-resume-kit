import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { resumeThemes, applyResumeTheme } from '../src/resume-themes.mjs';
import { loadResume } from '../src/input.mjs';
import { renderResume, kitRoot } from '../src/render.mjs';
import { inspectAndExport } from '../src/export.mjs';
import { pdfExpectations } from './pdf-expectations.mjs';

const run = promisify(execFile), qa = path.join(kitRoot, 'tmp/pdfs/themes');
const thumbnails = path.join(kitRoot, 'app/theme-previews');
await mkdir(qa, { recursive: true }); await mkdir(thumbnails, { recursive: true });
const loaded = await loadResume(path.join(kitRoot, 'templates/java-backend/resume.md'));
for (const theme of resumeThemes) {
  const rendered = await renderResume(loaded.document, applyResumeTheme(loaded.layout, theme.id), loaded);
  const result = await inspectAndExport(rendered, { pdf: true });
  if (result.metrics.pageCount !== 1) throw new Error('Theme preview must be one complete page: ' + theme.id);
  const stem = path.join(qa, theme.id + '-single');
  await writeFile(stem + '.pdf', result.buffer);
  await writeFile(path.join(thumbnails, theme.id + '.pdf'), result.buffer);
  await writeFile(stem + '.expected.json', JSON.stringify(pdfExpectations(rendered, 1), null, 2));
  await run('pdftoppm', ['-singlefile', '-scale-to-x', '380', '-scale-to-y', '-1', '-png', stem + '.pdf', path.join(thumbnails, theme.id)], { windowsHide: true });
  console.log(theme.label + ': actual one-page PDF preview generated');
}
