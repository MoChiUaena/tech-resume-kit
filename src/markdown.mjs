import MarkdownIt from 'markdown-it';
import { ResumeError } from './errors.mjs';

export const markdown = new MarkdownIt('commonmark', { html: true, linkify: false });
// Parse all destinations, then reject unsupported schemes ourselves with source locations.
markdown.validateLink = () => true;
export function validateLink(href, where = {}) {
  if (!/^(https?:\/\/|mailto:|tel:)/i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) {
    throw new ResumeError('链接只支持 http://、https://、mailto: 或 tel:，且不能含空白', where);
  }
  try { new URL(href); } catch { throw new ResumeError(`链接格式错误：${href}`, where); }
  return href;
}
export function validateInline(content, where = {}) {
  const children = markdown.parseInline(content, {})[0].children || [];
  for (const token of children) {
    if (!['text', 'softbreak', 'hardbreak', 'strong_open', 'strong_close', 'em_open', 'em_close', 'code_inline', 'link_open', 'link_close'].includes(token.type)) {
      throw new ResumeError('正文不支持 HTML 或内嵌图片；照片和 Logo 请通过 assets 配置', where);
    }
    if (token.type === 'link_open') validateLink(token.attrGet('href'), where);
  }
}
export function inline(content) {
  validateInline(content);
  return markdown.renderInline(content);
}
export const escapeHtml = value => markdown.utils.escapeHtml(String(value ?? ''));
