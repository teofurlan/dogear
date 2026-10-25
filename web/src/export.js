import {api} from './api.js';

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportBookQuotes(getToken, bookId, formatOrOptions = 'markdown', maybeOptions = {}) {
  const format = typeof formatOrOptions === 'string' ? formatOrOptions : (formatOrOptions?.format || 'markdown');
  const signal = typeof formatOrOptions === 'object' ? formatOrOptions?.signal : maybeOptions?.signal;
  const ext = format === 'csv' ? 'csv' : 'md';
  const query = new URLSearchParams({book_id: bookId, format});
  const blob = await api(getToken, `/quotes/export?${query.toString()}`, {
    as: 'blob',
    signal,
  });
  triggerDownload(blob, `quotes-${bookId}.${ext}`);
}

export async function exportAllQuotes(getToken, formatOrOptions = 'markdown', maybeOptions = {}) {
  const format = typeof formatOrOptions === 'string' ? formatOrOptions : (formatOrOptions?.format || 'markdown');
  const signal = typeof formatOrOptions === 'object' ? formatOrOptions?.signal : maybeOptions?.signal;
  const ext = format === 'csv' ? 'csv' : 'md';
  const query = new URLSearchParams({format});
  const blob = await api(getToken, `/quotes/export?${query.toString()}`, {
    as: 'blob',
    signal,
  });
  triggerDownload(blob, `quotes.${ext}`);
}

