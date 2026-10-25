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

export async function exportBookQuotes(getToken, bookId, {signal} = {}) {
  const blob = await api(getToken, `/quotes/export?book_id=${encodeURIComponent(bookId)}`, {
    as: 'blob',
    signal,
  });
  triggerDownload(blob, `quotes-${bookId}.md`);
}

export async function exportAllQuotes(getToken, {signal} = {}) {
  const blob = await api(getToken, '/quotes/export', {
    as: 'blob',
    signal,
  });
  triggerDownload(blob, 'quotes.md');
}
