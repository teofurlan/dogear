import React, {useCallback, useEffect, useRef, useState} from 'react';
import {listPages, uploadPage} from './pages.js';
import {prepareImage} from './downscale.js';

const DECODE_MESSAGE = 'This photo format could not be read on this device. Try a JPEG or PNG, or take the photo with the camera.';
const MESSAGES = {
  401: 'Your session ended. Sign in again before uploading.',
  413: 'That photo is too large. Try again with a smaller one.',
  415: 'Only JPEG or PNG photos are supported.',
  422: 'That photo could not be read. Try a sharper, well-lit photo.',
  503: 'Page storage is not available right now. Try again later.'
};
const failure = problem => MESSAGES[problem?.status] || 'The upload failed. Check your connection and try again.';

function status(waiting, read) {
  if (waiting === null) return '';
  if (waiting > 0) return `${waiting} ${waiting === 1 ? 'page' : 'pages'} waiting for tonight's run`;
  if (read > 0) return read === 1 ? 'Your photographed page has been read. Its quotes are in the review below.'
    : `All ${read} photographed pages have been read. Their quotes are in the review below.`;
  return 'No pages yet. Photograph a page you highlighted.';
}

export default function PageCapture({getToken, bookId, onSessionExpired, onUploadingChange}) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [waiting, setWaiting] = useState(null);
  const [read, setRead] = useState(0);
  const alive = useRef(true);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const pages = await listPages(getToken, bookId);
      if (!alive.current || !Array.isArray(pages)) return;
      setWaiting(pages.filter(page => page.status === 'pending' || page.status === 'processing').length);
      setRead(pages.filter(page => page.status === 'processed').length);
    } catch (problem) {
      if (problem?.status === 401) onSessionExpired?.();
    }
  }, [getToken, bookId, onSessionExpired]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {alive.current = false;};
  }, [refresh]);

  async function upload(files) {
    if (!files.length || running.current) return;
    running.current = true; setBusy(true); onUploadingChange?.(true);
    const patch = (index, state, message = '') => alive.current && setItems(previous => previous.map((item, i) => i === index ? {...item, state, message} : item));
    setItems(files.map(file => ({name: file.name || 'Photo', state: 'waiting', message: ''})));
    for (const [index, file] of files.entries()) {
      if (!alive.current) break;
      setProgress({current: index + 1, total: files.length});
      patch(index, 'uploading');
      let image;
      try {
        image = await prepareImage(file);
      } catch {
        patch(index, 'error', DECODE_MESSAGE);
        continue;
      }
      try {
        await uploadPage(getToken, bookId, image);
        patch(index, 'done');
      } catch (problem) {
        patch(index, 'error', failure(problem));
        if (problem?.status === 401) {
          onSessionExpired?.();
          break;
        }
      }
    }
    running.current = false;
    if (alive.current) {
      setBusy(false);
      setProgress(null);
      onUploadingChange?.(false);
      refresh();
    }
  }

  const line = item => item.state === 'error' ? `${item.name}: ${item.message}`
    : `${item.name}: ${{waiting: 'waiting', uploading: 'uploading…', done: 'uploaded'}[item.state]}`;

  return <section className="page-capture" aria-labelledby="capture-title">
    <h2 id="capture-title">Pages</h2>
    {progress ? <p className="upload-progress-summary" role="status">Uploading {progress.current} of {progress.total}…</p> : null}
    <label className="capture-zone">
      <input type="file" accept="image/*" capture="environment" multiple disabled={busy}
        onChange={event => {upload([...event.target.files]); event.target.value = '';}} />
      <strong>Photograph a page</strong>
      <span>Tap to open your camera or choose photos. Photos are read tonight, then deleted.</span>
    </label>
    {items.length ? <ul className="upload-list" aria-label="Upload progress">{items.map((item, index) => <li key={index} className={item.state === 'error' ? 'is-error' : ''} role={item.state === 'error' ? 'alert' : undefined}>{line(item)}</li>)}</ul> : null}
    <p className="capture-status" role="status">{status(waiting, read)}</p>
  </section>;
}
