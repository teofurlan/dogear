import {api} from './api.js';

export const listPages = (getToken, bookId, {signal} = {}) => api(getToken, `/books/${bookId}/pages`, {signal});

export const uploadPage = (getToken, bookId, blob, {signal} = {}) =>
  api(getToken, `/books/${bookId}/pages`, {method: 'POST', body: blob, contentType: 'image/jpeg', signal, timeout: 40000});
