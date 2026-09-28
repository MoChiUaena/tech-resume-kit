export const portraitFrame = { width: 460, height: 620, outputWidth: 690, outputHeight: 930 };

export function createCropModel(sourceWidth, sourceHeight) {
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error('照片尺寸不正确');
  const model = { sourceWidth, sourceHeight, angle: 0, zoom: 1, x: 0, y: 0 };
  return normalizeCrop(model);
}

export function normalizeCrop(model) {
  const rotated = Math.abs(model.angle % 2) === 1;
  const width = rotated ? model.sourceHeight : model.sourceWidth;
  const height = rotated ? model.sourceWidth : model.sourceHeight;
  model.zoom = Math.max(1, Math.min(4, Number(model.zoom) || 1));
  model.scale = Math.max(portraitFrame.width / width, portraitFrame.height / height) * model.zoom;
  const maxX = Math.max(0, (width * model.scale - portraitFrame.width) / 2);
  const maxY = Math.max(0, (height * model.scale - portraitFrame.height) / 2);
  model.x = Math.max(-maxX, Math.min(maxX, Number(model.x) || 0));
  model.y = Math.max(-maxY, Math.min(maxY, Number(model.y) || 0));
  return model;
}

export function rotateCrop(model, quarterTurns) {
  model.angle = ((model.angle + quarterTurns) % 4 + 4) % 4;
  model.x = 0; model.y = 0;
  return normalizeCrop(model);
}

export function paintCrop(canvas, image, model) {
  normalizeCrop(model);
  const context = canvas.getContext('2d'), ratio = canvas.width / portraitFrame.width;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(ratio, ratio);
  context.translate(portraitFrame.width / 2 + model.x, portraitFrame.height / 2 + model.y);
  context.rotate(model.angle * Math.PI / 2);
  context.scale(model.scale, model.scale);
  context.drawImage(image, -model.sourceWidth / 2, -model.sourceHeight / 2);
  context.restore();
}

export async function exportCrop(image, model) {
  const canvas = document.createElement('canvas');
  canvas.width = portraitFrame.outputWidth; canvas.height = portraitFrame.outputHeight;
  paintCrop(canvas, image, model);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
  if (!blob) throw new Error('照片无法保存，请重新选择图片');
  return new File([blob], 'portrait-cropped.jpg', { type: 'image/jpeg' });
}
