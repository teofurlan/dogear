import React, {useEffect, useRef, useState} from 'react';
import {createBook, identifyBook} from './book-entry.js';
import {uploadCover} from './books.js';
import './book-entry-dropzone.css';

export default function BookEntry({getToken, onCreated}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [text, setText] = useState('');
  const [coverFile, setCoverFile] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const request = useRef(null);
  const saving = useRef(false);
  const toggle = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  function close() {
    request.current?.abort();
    setOpen(false); setTitle(''); setAuthor(''); setText(''); setError(''); setStatus('idle'); setDragOver(false); setCoverFile(null);
    toggle.current?.focus();
  }

  async function read(file) {
    if (!file || saving.current) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setStatus('reading'); setError(''); setText(''); setCoverFile(file);
    try {
      const result = await identifyBook(getToken, file, {signal: controller.signal});
      if (controller.signal.aborted) return;
      setTitle(result.title); setAuthor(result.author || ''); setText(result.text);
      if (!result.title) setError('No readable title was found. Enter the details manually or try a clearer photo.');
    } catch (problem) {
      setCoverFile(null);
      if (!controller.signal.aborted) setError(problem.status === 401
        ? 'Your session ended. Sign in again before reading or saving a book.'
        : 'The cover could not be read. Enter the details manually, or try a JPEG or PNG under 6 MiB and 20 megapixels.');
    } finally {if (!controller.signal.aborted) setStatus('idle');}
  }

  async function save(event) {
    event.preventDefault();
    if (!title.trim() || status === 'reading' || saving.current) return;
    const controller = new AbortController(); request.current = controller;
    saving.current = true; setStatus('saving'); setError('');
    try {
      let book = await createBook(getToken, {title: title.trim(), author: author.trim() || null}, {signal: controller.signal});
      if (controller.signal.aborted) return;
      let photoFailed = false;
      if (coverFile) {
        try {
          const updated = await uploadCover(getToken, book.id, coverFile, {signal: controller.signal});
          if (updated && typeof updated.id === 'string' && typeof updated.title === 'string') book = updated;
        } catch {
          // The book is already saved; keep it and tell the reader the photo was not stored.
          photoFailed = true;
        }
      }
      onCreated(book); close();
      setNotice(photoFailed
        ? `Saved “${book.title}” to your library, but its cover photo could not be stored.`
        : `Saved “${book.title}” to your library.`);
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.status === 401
        ? 'Your session ended. Sign in again before saving a book.'
        : 'We could not confirm the save. Your details are still here. Refresh the library before trying again to avoid duplicates.');
    } finally {saving.current = false; if (!controller.signal.aborted) setStatus('idle');}
  }

  return <section className="book-entry" aria-label="Book entry">
    <button ref={toggle} type="button" className="add-book-button" aria-expanded={open} onClick={() => {setOpen(true); setNotice('');}} disabled={open}>Add book</button>
    {notice ? <p role="status">{notice}</p> : null}
    {open ? <form aria-label="Add a book" onSubmit={save}>
      <h2>Add a book</h2>
      <p>Photograph the cover to suggest details, or enter them yourself. Review everything before saving.</p>
      <label className="cover-photo-label" htmlFor="cover-photo">Cover photo</label>
      <div className={`cover-dropzone${dragOver ? ' is-drag-over' : ''}`} role="group" aria-label="Cover photo options"
        onDragEnter={event => {event.preventDefault(); if (!saving.current) setDragOver(true);}}
        onDragOver={event => {event.preventDefault(); if (!saving.current) setDragOver(true);}}
        onDragLeave={event => {event.preventDefault(); setDragOver(false);}}
        onDrop={event => {event.preventDefault(); setDragOver(false); if (!saving.current) read(event.dataTransfer.files?.[0]);}}>
        <input id="cover-photo" type="file" accept="image/jpeg,image/png" capture="environment" disabled={status === 'saving'} onChange={event => {read(event.target.files?.[0]); event.target.value = '';}} aria-describedby="cover-help" />
        <span className="cover-dropzone-copy cover-dropzone-desktop"><strong>Drop a cover photo here</strong><span>or click anywhere to choose a photo</span></span>
        <span className="cover-dropzone-copy cover-dropzone-touch">
          <svg aria-hidden="true" viewBox="0 0 32 26" width="32" height="26" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h6l2-4h8l2 4h6v16H4Z" /><circle className="cover-camera-lens" cx="16" cy="14" r="5" /></svg>
          <strong>Take a cover photo</strong><span>Tap to open your camera or photo picker</span>
        </span>
      </div>
      <p id="cover-help" className="field-help">JPEG or PNG, up to 6 MiB and 20 megapixels. Used to suggest details and kept as a fallback cover if no catalog match is found.</p>
      {status === 'reading' ? <p role="status">Reading cover… You can cancel at any time.</p> : null}
      {text ? <><p className="field-help">These are OCR suggestions, not a verified catalog match. Check the title and author.</p><details><summary>Detected text</summary><p className="detected-text">{text}</p></details></> : null}
      <label htmlFor="book-title">Title</label>
      <input id="book-title" name="title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={300} autoFocus disabled={status !== 'idle'} />
      <label htmlFor="book-author">Author <span className="field-help">(optional)</span></label>
      <input id="book-author" name="author" value={author} onChange={event => setAuthor(event.target.value)} maxLength={300} disabled={status !== 'idle'} />
      {error ? <p role="alert">{error}</p> : null}
      <div className="entry-actions"><button type="submit" disabled={status !== 'idle' || !title.trim()}>{status === 'saving' ? 'Saving book…' : 'Save book'}</button><button type="button" className="cancel-button" onClick={close} disabled={status === 'saving'}>Cancel</button></div>
    </form> : null}
  </section>;
}
