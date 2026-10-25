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

async function download(getToken, query, basename, format, signal) {
  const blob = await api(getToken, `/quotes/export?${query}`, {as: 'blob', signal});
  triggerDownload(blob, `${basename}.${format === 'csv' ? 'csv' : 'md'}`);
}

export function exportBookQuotes(getToken, bookId, format = 'markdown', {signal} = {}) {
  return download(getToken, new URLSearchParams({book_id: bookId, format}), `quotes-${bookId}`, format, signal);
}

export function exportAllQuotes(getToken, format = 'markdown', {signal} = {}) {
  return download(getToken, new URLSearchParams({format}), 'quotes', format, signal);
}
