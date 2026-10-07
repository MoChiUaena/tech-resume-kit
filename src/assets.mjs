import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { ResumeError, locationFor } from './errors.mjs';

export const imageLabels = { schoolLogo: '学校 Logo', portrait: '证件照' };
export function assetPath(base, src, where = {}) {
  if (path.isAbsolute(src) || /^[a-z]+:/i.test(src) || src.startsWith('\\')) throw new ResumeError('图片需要本地相对路径，不能使用网址或绝对路径', where);
  return path.resolve(base, src.replaceAll('\\', '/'));
}
export async function prepareImages(document, layout, { assetBase, locations = new Map(), layoutLocations = new Map() }) {
  const images = {}, warnings = [], files = [];
  for (const key of ['portrait', 'schoolLogo']) {
    const config = layout.images[key];
    if (!config.enabled) continue;
    const field = `assets.${key}`;
    const where = { ...locationFor(locations, field), field };
    const label = imageLabels[key];
    const asset = document.assets[key];
    if (!asset) throw new ResumeError(`${label}已开启，请填写 ${field}.src 和 alt，或关闭图片`, where);
    const filename = assetPath(assetBase, asset.src, where);
    const type = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg' }[path.extname(filename).toLowerCase()];
    if (!type) throw new ResumeError(`${label}仅支持 PNG/JPEG：${asset.src}`, where);
    let bytes;
    try { bytes = await readFile(filename); } catch { throw new ResumeError(`${label}路径不存在或不可读：${asset.src}`, where); }
    let dimensions;
    try { dimensions = imageSize(bytes); } catch { throw new ResumeError(`${label}无法解码，请检查图片是否损坏：${asset.src}`, where); }
    if (dimensions.type !== type) throw new ResumeError(`${label}扩展名与文件内容不一致：${asset.src}`, where);
    if (!dimensions.width || !dimensions.height) throw new ResumeError(`${label}尺寸无效`, where);
    const rotated = dimensions.orientation >= 5 && dimensions.orientation <= 8;
    const width = rotated ? dimensions.height : dimensions.width;
    const height = rotated ? dimensions.width : dimensions.height;
    const dpi = Math.min(width / config.widthMm, height / config.heightMm) * 25.4;
    if (dpi < 150) warnings.push(`${label}预计分辨率 ${Math.round(dpi)} DPI，建议使用更清晰的原图`);
    images[key] = { ...asset, ...config, width, height, filename, data: `data:image/${type === 'jpg' ? 'jpeg' : 'png'};base64,${bytes.toString('base64')}` };
    files.push(filename);
  }
  const enabled = Object.values(images);
  const identityWidth = 210 - 2 * (layout.page.marginHorizontalMm ?? layout.page.marginMm) - enabled.reduce((sum, image) => sum + image.widthMm, 0) - enabled.length * layout.header.gapMm;
  if (identityWidth < 76) throw new ResumeError(`页眉图片与间距占位过大，姓名和联系方式仅剩 ${identityWidth.toFixed(1)} mm；请减小图片宽度或 header.gapMm，至少保留 76 mm`, { ...locationFor(layoutLocations, 'images'), field: 'images' });
  return { images, warnings, files };
}
