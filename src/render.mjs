import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepareImages } from './assets.mjs';
import { inline, escapeHtml as escape, validateLink } from './markdown.mjs';
import { documentSchema, layoutSchema, validate, resolveSectionOrder } from './schema.mjs';

export const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cssPromise;
async function templateCss() {
  if (!cssPromise) cssPromise = (async () => {
    let css = await readFile(path.join(kitRoot, 'src/resume.css'), 'utf8');
    for (const [token, weight] of [['REGULAR', 'Regular'], ['SEMIBOLD', 'SemiBold'], ['BOLD', 'Bold']]) {
      const font = await readFile(path.join(kitRoot, `assets/fonts/ResumeSansSC-${weight}.ttf`));
      css = css.replace(`__FONT_${token}__`, `data:font/ttf;base64,${font.toString('base64')}`);
    }
    return css;
  })();
  return cssPromise;
}

function blocks(items, paragraphClass) {
  let html = '', paragraphs = [];
  const flush = () => { if (paragraphs.length) { html += `<div class="${paragraphClass}">${paragraphs.join('')}</div>`; paragraphs = []; } };
  for (const block of items) {
    if (block.type === 'paragraph') paragraphs.push(`<p>${inline(block.text)}</p>`);
    else {
      flush();
      const tag = block.ordered ? 'ol' : 'ul';
      const markerChars = String((block.start || 1) + block.items.length - 1).length + 2;
      html += `<${tag}${block.ordered ? ` start="${block.start || 1}" style="padding-left:max(6mm,${markerChars}ch)"` : ''}>${block.items.map(text => `<li>${inline(text)}</li>`).join('')}</${tag}>`;
    }
  }
  flush();
  return html;
}
function entry(item) {
  return `<article class="entry">
    <div class="entry-heading"><div class="entry-title"><h3>${escape(item.title)}</h3>${item.subtitle ? `<span class="entry-subtitle">${escape(item.subtitle)}</span>` : ''}</div>${item.date ? `<span class="date">${escape(item.date)}</span>` : ''}</div>
    ${item.stack ? `<p class="stack">${escape(item.stack)}</p>` : ''}
    ${blocks(item.blocks, 'entry-lines')}
  </article>`;
}
function section(item, theme) {
  const content = item.kind === 'entries' ? item.entries.map(entry).join('')
    : item.kind === 'skills' ? item.items.map(skill => `<div class="skill"><span class="skill-label">${escape(skill.label)}</span><p>${inline(skill.text)}</p></div>`).join('')
    : blocks(item.blocks, 'additional-lines');
  const body = theme === 'forest-rail' ? `<div class="section-content">${content}</div>` : content;
  return `<section aria-labelledby="${escape(item.id)}"><h2 id="${escape(item.id)}">${escape(item.title)}</h2>${body}</section>`;
}
function image(key, asset) {
  const align = { top: 'flex-start', center: 'center', bottom: 'flex-end' }[asset.align];
  return `<img class="${key === 'portrait' ? 'portrait' : 'school-logo'}" data-asset="${key}" alt="${escape(asset.alt)}" src="${asset.data}" style="width:${asset.widthMm}mm;height:${asset.heightMm}mm;align-self:${align}">`;
}

export async function renderResume(inputDocument, inputLayout, options = {}) {
  const locations = options.locations || new Map();
  const layoutLocations = options.layoutLocations || new Map();
  const document = validate(documentSchema, inputDocument, locations);
  const layout = validate(layoutSchema, inputLayout, layoutLocations);
  layout.sectionOrder = resolveSectionOrder(document, layout, layoutLocations);
  const prepared = await prepareImages(document, layout, { ...options, assetBase: options.assetBase || kitRoot, locations, layoutLocations });
  const person = document.person;
  const contacts = person.contacts.map(item => `<a href="${escape(validateLink(item.href))}">${escape(item.text)}</a>`).join('');
  const slots = { start: '', end: '' };
  for (const key of ['portrait', 'schoolLogo']) if (prepared.images[key]?.slot === 'start') slots.start += image(key, prepared.images[key]);
  for (const key of ['schoolLogo', 'portrait']) if (prepared.images[key]?.slot === 'end') slots.end += image(key, prepared.images[key]);
  const css = await templateCss();
  const body = layout.sectionOrder.map(id => section(document.sections.find(item => item.id === id), layout.theme)).join('');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(person.name)} - 简历</title>
<style>${css}\n:root{--accent:${layout.accent};--body-pt:${layout.bodyPt}pt;--leading:${layout.lineHeight};--page-margin:${layout.page.marginMm}mm;--name-pt:${layout.namePt}pt;--header-gap:${layout.header.gapMm}mm;--section-gap:${layout.spacing.sectionMm}mm;--entry-gap:${layout.spacing.entryMm}mm;}@page{margin:${layout.page.marginMm}mm;}</style></head>
<body class="theme-${layout.theme}"><main class="sheet"><header class="resume-header">
  ${slots.start}<div class="identity"><div class="name-row"><h1>${escape(person.name)}</h1>${person.label ? `<span class="graduate-label">${escape(person.label)}</span>` : ''}</div>
  <p class="target">${escape(person.target)}</p>${person.availability ? `<p class="availability">${escape(person.availability)}</p>` : ''}<div class="contacts">${contacts}</div></div>${slots.end}
</header>${body}${document.notice ? `<footer class="sample-note">${escape(document.notice)}</footer>` : ''}</main></body></html>`;
  return { html, document, layout, ...prepared };
}
