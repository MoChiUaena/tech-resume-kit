import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepareImages } from './assets.mjs';
import { inline, escapeHtml as escape, validateLink } from './markdown.mjs';
import { documentSchema, layoutSchema, validate, resolveSectionOrder } from './schema.mjs';

export const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cssPromise;
let serifCssPromise;
let iconPromise;
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
async function templateSerifCss() {
  if (!serifCssPromise) serifCssPromise = (async () => {
    let css = (await readFile(path.join(kitRoot, 'src/resume.css'), 'utf8'))
      .replace(/@font-face\s*\{[^}]*\}\s*/g, '')
      .replaceAll('"Resume Sans"', '"Resume Serif"');
    let fontFaces = '';
    for (const [weight, style] of [[400, 'Regular'], [600, 'SemiBold'], [700, 'Bold']]) {
      const font = await readFile(path.join(kitRoot, `assets/fonts/ResumeSerifSC-${style}.ttf`));
      fontFaces += `@font-face{font-family: "Resume Serif";src:url("data:font/ttf;base64,${font.toString('base64')}") format("truetype");font-style:normal;font-weight:${weight};font-display:block;}`;
    }
    return fontFaces + css;
  })();
  return serifCssPromise;
}
async function templateIcons() {
  if (!iconPromise) iconPromise = Promise.all(['phone', 'mail', 'link', 'calendar-days', 'target', 'map-pin'].map(async name => [name, await readFile(path.join(kitRoot, `assets/icons/${name}.svg`), 'utf8')]))
    .then(entries => Object.fromEntries(entries));
  return iconPromise;
}
const iconMarkup = (icons, name) => icons ? `<span class="resume-icon" aria-hidden="true">${icons[name]}</span>` : '';

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
  const icons = layout.header.contactStyle === 'icons' ? await templateIcons() : null;
  const contacts = person.contacts.map(item => {
    const href = validateLink(item.href);
    const label = href.startsWith('tel:') ? '电话' : href.startsWith('mailto:') ? '邮箱' : '链接';
    const iconName = href.startsWith('tel:') ? 'phone' : href.startsWith('mailto:') ? 'mail' : 'link';
    return `<a href="${escape(href)}">${layout.header.contactStyle === 'labeled' ? `<span class="contact-label">${label}</span>` : iconMarkup(icons, iconName)}${escape(item.text)}</a>`;
  }).join('');
  const slots = { start: '', end: '' };
  for (const key of ['portrait', 'schoolLogo']) if (prepared.images[key]?.slot === 'start') slots.start += image(key, prepared.images[key]);
  for (const key of ['schoolLogo', 'portrait']) if (prepared.images[key]?.slot === 'end') slots.end += image(key, prepared.images[key]);
  const imageHeight = Math.max(0, ...Object.entries(prepared.images).map(([key, asset]) => (layout.density === 'compact' || layout.header.align === 'spread') && key === 'schoolLogo' ? Math.min(asset.heightMm, 15) : asset.heightMm));
  const otherImageWidth = slot => Object.entries(prepared.images).filter(([key, asset]) => key !== 'schoolLogo' && asset.slot === slot).reduce((width, [, asset]) => width + asset.widthMm + layout.header.gapMm, 0);
  const css = layout.fontFamily === 'serif' ? await templateSerifCss() : await templateCss();
  const body = layout.sectionOrder.map(id => section(document.sections.find(item => item.id === id), layout.theme)).join('');
  const label = person.label ? `<span class="graduate-label">${iconMarkup(icons, 'calendar-days')}${escape(person.label)}</span>` : '';
  const target = `<p class="target">${iconMarkup(icons, 'target')}${escape(person.target)}</p>`;
  const availability = person.availability ? `<span class="availability">${iconMarkup(icons, 'map-pin')}${escape(person.availability)}</span>` : '';
  const availabilityBlock = person.availability ? `<p class="availability">${iconMarkup(icons, 'map-pin')}${escape(person.availability)}</p>` : '';
  const identity = layout.header.align === 'spread'
    ? `<div class="identity"><div class="name-row"><h1>${escape(person.name)}</h1></div><div class="contacts">${contacts}</div><div class="details-row">${label}${target}${availability}</div></div>`
    : `<div class="identity"><div class="name-row"><h1>${escape(person.name)}</h1>${label}</div>${target}${availabilityBlock}<div class="contacts">${contacts}</div></div>`;
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(person.name)} - 简历</title>
<style>${css}\n:root{--accent:${layout.accent};--body-pt:${layout.bodyPt}pt;--leading:${layout.lineHeight};--page-margin:${layout.page.marginMm}mm;--page-margin-x:${layout.page.marginHorizontalMm ?? layout.page.marginMm}mm;--page-margin-top:${layout.page.marginTopMm ?? layout.page.marginMm}mm;--page-margin-bottom:${layout.page.marginBottomMm ?? layout.page.marginMm}mm;--name-pt:${layout.namePt}pt;--header-gap:${layout.header.gapMm}mm;--section-gap:${layout.spacing.sectionMm}mm;--entry-gap:${layout.spacing.entryMm}mm;}@page{margin:${layout.page.marginTopMm ?? layout.page.marginMm}mm ${layout.page.marginHorizontalMm ?? layout.page.marginMm}mm ${layout.page.marginBottomMm ?? layout.page.marginMm}mm;}${layout.page.maxPages === 1 && layout.density === 'compact' ? '@page{@bottom-right{content:none}}' : ''}</style></head>
<body class="theme-${layout.theme} density-${layout.density} font-${layout.fontFamily} header-align-${layout.header.align} contact-style-${layout.header.contactStyle}"><main class="sheet"><header class="resume-header" style="--header-image-height:${imageHeight}mm;--header-start-other-width:${otherImageWidth('start')}mm;--header-end-other-width:${otherImageWidth('end')}mm">
  ${slots.start ? `<div class="header-images-start">${slots.start}</div>` : ''}${identity}${slots.end ? `<div class="header-images-end">${slots.end}</div>` : ''}
</header>${body}${document.notice ? `<footer class="sample-note">${escape(document.notice)}</footer>` : ''}</main></body></html>`;
  return { html, document, layout, ...prepared };
}
