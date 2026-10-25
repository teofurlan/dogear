export const MAX_SIDE = 2400;
export const JPEG_QUALITY = 0.85;

export class ImageDecodeError extends Error {
  constructor(message = 'Image decoding failed', options) {
    super(message, options);
    this.name = 'ImageDecodeError';
  }
}

export function fitWithin(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {width: Math.round(width * scale), height: Math.round(height * scale)};
}

// Re-encodes any browser-readable photo as a JPEG whose long side is at most 2400 px.
export async function prepareImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (cause) {
    throw new ImageDecodeError('Could not decode photo', {cause});
  }
  try {
    const {width, height} = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new ImageDecodeError('Image encoding failed');
    return blob;
  } catch (error) {
    if (error instanceof ImageDecodeError) throw error;
    throw new ImageDecodeError('Image processing failed', {cause: error});
  } finally {
    bitmap.close?.();
  }
}
