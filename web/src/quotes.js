import {api} from './api.js';

export function listQuotes(getToken, {bookId, status} = {}, {signal} = {}) {
  const query = new URLSearchParams();
  if (bookId) query.set('book_id', bookId);
  if (status) query.set('status', status);
  const suffix = query.size ? '?' + query : '';
  return api(getToken, '/quotes' + suffix, {signal});
}

const json = {contentType: 'application/json'};

export const updateQuote = (getToken, id, changes) =>
  api(getToken, `/quotes/${id}`, {method: 'PATCH', body: JSON.stringify(changes), ...json});

export const deleteQuote = (getToken, id) => api(getToken, `/quotes/${id}`, {method: 'DELETE'});

export const addQuote = (getToken, bookId, text) =>
  api(getToken, `/books/${bookId}/quotes`, {method: 'POST', body: JSON.stringify({text}), ...json});

export const fetchCrop = (getToken, id, {signal} = {}) => api(getToken, `/quotes/${id}/crop`, {as: 'blob', signal});
