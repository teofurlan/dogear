import React, {useCallback, useEffect, useRef, useState} from 'react';
import {listPages, uploadPage} from './pages.js';
import {prepareImage} from './downscale.js';

const MESSAGES = {
  401: 'Your session ended. Sign in again before uploading.',
  413: 'That photo is too large. Try again with a smaller one.',
  415: 'Only JPEG or PNG photos are supported.',
  422: 'That photo could not be read. Try a sharper, well-lit photo.',
  503: 'Page storage is not available right now. Try again later.'
};
const failure = problem => MESSAGES[problem?.status] || 'The upload failed. Check your connection and try again.';

export default function PageCapture({getToken, bookId}) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(null);
  const alive = useRef(true);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const pages = await listPages(getToken, bookId);
      if (alive.current && Array.isArray(pages)) setWaiting(pages.filter(page => page.status === 'pending' || page.status === 'processing').length);
    } catch { /* the count is a hint; uploads still work without it */ }
  }, [getToken, bookId]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {alive.current = false;};
  }, [refresh]);

  async function upload(files) {
    if (!files.length || running.current) return;
    running.current = true; setBusy(true);
    const patch = (index, state, message = '') => alive.current && setItems(previous => previous.map((item, i) => i === index ? {...item, state, message} : item));
    setItems(files.map(file => ({name: file.name || 'Photo', state: 'waiting', message: ''})));
    for (const [index, file] of files.entries()) {
      if (!alive.current) break;
      patch(index, 'uploading');
      try {
        await uploadPage(getToken, bookId, await prepareImage(file));
        patch(index, 'done');
      } catch (problem) {
        patch(index, 'error', failure(problem));
        if (problem?.status === 401) break;
      }
    }
    running.current = false;
    if (alive.current) {setBusy(false); refresh();}
  }

  const line = item => item.state === 'error' ? `${item.name}: ${item.message}`
    : `${item.name}: ${{waiting: 'waiting', uploading: 'uploading…', done: 'uploaded'}[item.state]}`;

  return <section className="page-capture" aria-labelledby="capture-title">
    <h2 id="capture-title">Pages</h2>
    <label className="capture-zone">
      <input type="file" accept="image/*" capture="environment" multiple disabled={busy}
        onChange={event => {upload([...event.target.files]); event.target.value = '';}} />
      <strong>Photograph a page</strong>
      <span>Tap to open your camera or choose photos. Photos are read tonight, then deleted.</span>
    </label>
    {items.length ? <ul className="upload-list" aria-label="Upload progress">{items.map((item, index) => <li key={index} className={item.state === 'error' ? 'is-error' : ''} role={item.state === 'error' ? 'alert' : undefined}>{line(item)}</li>)}</ul> : null}
    <p className="capture-status" role="status">{waiting === null ? '' : waiting > 0 ? `${waiting} ${waiting === 1 ? 'page' : 'pages'} waiting for tonight's run` : items.length || waiting === 0 ? 'No pages yet. Photograph a page you highlighted.' : ''}</p>
  </section>;
}
