import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadResume } from '../src/input.mjs';
import { renderResume, kitRoot } from '../src/render.mjs';
import { inspectAndExport } from '../src/export.mjs';
import { pdfExpectations } from './pdf-expectations.mjs';
import { ResumeError } from '../src/errors.mjs';

const output = path.join(kitRoot, 'output/pdf');
await mkdir(output, { recursive: true });
for (const [input, stem, pages] of [['resume.md', 'campus-ink-blue', 1], ['examples/ai-intern/resume.md', 'ai-intern-ink-blue', 1], ['examples/experienced/resume.md', 'experienced-ink-blue', 2]]) {
  try {
    const loaded = await loadResume(path.join(kitRoot, input));
    const rendered = await renderResume(loaded.document, loaded.layout, loaded);
    const { buffer, metrics } = await inspectAndExport(rendered, { pdf: true });
    const expectations = pdfExpectations(rendered, pages);
    for (const [suffix, data] of [['pdf', buffer], ['html', rendered.html], ['metrics.json', JSON.stringify(metrics, null, 2) + '\n'], ['expected.json', JSON.stringify(expectations, null, 2) + '\n']]) await writeFile(path.join(output, `${stem}.${suffix}`), data);
    console.log(`${stem}.pdf：由 ${input} 生成，${metrics.pageCount} 页 A4，${Object.keys(rendered.images).length} 张图片。`);
  } catch (error) {
    console.error(error instanceof ResumeError ? error.toString() : error.message);
    process.exitCode = 1;
    break;
  }
}
