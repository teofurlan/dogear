export const MAX_SIDE = 2400;
export const JPEG_QUALITY = 0.85;

export function fitWithin(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {width: Math.round(width * scale), height: Math.round(height * scale)};
}

// Re-encodes any browser-readable photo as a JPEG whose long side is at most 2400 px.
export async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const {width, height} = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Image encoding failed');
    return blob;
  } finally {
    bitmap.close?.();
  }
}
