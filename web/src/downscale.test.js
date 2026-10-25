import {afterEach, expect, test, vi} from 'vitest';
import {fitWithin, ImageDecodeError, prepareImage} from './downscale.js';

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});

test('fitWithin caps the long side at 2400 px keeping the ratio', () => {
  expect(fitWithin(4800, 3200)).toEqual({width: 2400, height: 1600});
  expect(fitWithin(3000, 6000)).toEqual({width: 1200, height: 2400});
  expect(fitWithin(1000, 800)).toEqual({width: 1000, height: 800});
});

test('prepareImage re-encodes to JPEG at quality 0.85', async () => {
  const close = vi.fn(), drawImage = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 4800, height: 3200, close}));
  const out = new Blob(['j'], {type: 'image/jpeg'});
  const toBlob = vi.fn((cb) => cb(out));
  const canvas = {getContext: () => ({drawImage}), toBlob};
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  expect(await prepareImage(new File(['x'], 'p.png', {type: 'image/png'}))).toBe(out);
  expect(canvas.width).toBe(2400); expect(canvas.height).toBe(1600);
  expect(toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', 0.85]);
  expect(close).toHaveBeenCalled();
});

test('prepareImage throws ImageDecodeError when decoding fails', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
  await expect(prepareImage(new File(['bad'], 'bad.heic', {type: 'image/heic'})))
    .rejects.toThrow(ImageDecodeError);
});

test('prepareImage throws ImageDecodeError and closes bitmap when encoding fails', async () => {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 100, height: 100, close}));
  const canvas = {getContext: () => ({drawImage: vi.fn()}), toBlob: vi.fn(cb => cb(null))};
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  await expect(prepareImage(new File(['x'], 'p.jpg', {type: 'image/jpeg'})))
    .rejects.toThrow(ImageDecodeError);
  expect(close).toHaveBeenCalled();
});
