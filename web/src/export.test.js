import {beforeEach, describe, expect, it, vi} from 'vitest';
import {exportAllQuotes, exportBookQuotes, triggerDownload} from './export.js';
import * as apiModule from './api.js';

vi.mock('./api.js', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(status) {
      super('Request failed');
      this.status = status;
    }
  },
}));

describe('export helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exportBookQuotes calls api with as blob and triggers download', async () => {
    const mockBlob = new Blob(['# Book\n> Quote'], {type: 'text/markdown'});
    apiModule.api.mockResolvedValueOnce(mockBlob);

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const getToken = vi.fn().mockResolvedValue('token');
    await exportBookQuotes(getToken, 'book-123');

    expect(apiModule.api).toHaveBeenCalledWith(getToken, '/quotes/export?book_id=book-123', {
      as: 'blob',
      signal: undefined,
    });
    expect(createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test');

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  });

  it('exportAllQuotes calls api with as blob and triggers download', async () => {
    const mockBlob = new Blob(['# All\n> Quote'], {type: 'text/markdown'});
    apiModule.api.mockResolvedValueOnce(mockBlob);

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/test-all');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const getToken = vi.fn().mockResolvedValue('token');
    await exportAllQuotes(getToken);

    expect(apiModule.api).toHaveBeenCalledWith(getToken, '/quotes/export', {
      as: 'blob',
      signal: undefined,
    });
    expect(createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-all');

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  });
});
