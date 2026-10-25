import React, {useEffect, useRef, useState} from 'react';
import {createBook, identifyBook} from './book-entry.js';
import {uploadCover} from './books.js';
import CameraCapture from './CameraCapture.jsx';
import './book-entry-dropzone.css';

export default function BookEntry({getToken, onCreated}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [text, setText] = useState('');
  const [lines, setLines] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const request = useRef(null);
  const saving = useRef(false);
  const toggle = useRef(null);
  const cameraButton = useRef(null);
  const previewRef = useRef(null);

  function revokePreview() {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setPreviewUrl(null);
  }

  function setPreview(file) {
    revokePreview();
    if (file) {
      const url = URL.createObjectURL(file);
      previewRef.current = url;
      setPreviewUrl(url);
    }
  }

  useEffect(() => () => {
    request.current?.abort();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function close() {
    request.current?.abort();
    revokePreview();
    setLines([]);
    setOpen(false); setTitle(''); setAuthor(''); setText(''); setError(''); setStatus('idle'); setDragOver(false); setCoverFile(null); setCameraOpen(false);
    toggle.current?.focus();
  }

  async function read(file) {
    if (!file || saving.current) return;
    request.current?.abort();
    revokePreview(); setLines([]);
    const controller = new AbortController(); request.current = controller;
    setStatus('reading'); setError(''); setText(''); setCoverFile(file);
    try {
      const result = await identifyBook(getToken, file, {signal: controller.signal});
      if (controller.signal.aborted) return;
      setTitle(result.title); setAuthor(result.author || ''); setText(result.text);
      if (Array.isArray(result.lines) && result.lines.length > 0) {
        setLines(result.lines);
        setPreview(file);
      } else {
        setLines([]);
        revokePreview();
      }
      if (!result.title) setError('No readable title was found. Enter the details manually or try a clearer photo.');
    } catch (problem) {
      setCoverFile(null);
      setLines([]);
      revokePreview();
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
      <div className="cover-photo-controls" role="group" aria-label="Cover photo options">
        <button
          ref={cameraButton}
          type="button"
          className="take-cover-button"
          onClick={() => {setCameraOpen(true); setError('');}}
          disabled={status !== 'idle'}>
          Take cover photo
        </button>
        <div className={`cover-dropzone${dragOver ? ' is-drag-over' : ''}`}
          onDragEnter={event => {event.preventDefault(); if (status === 'idle') setDragOver(true);}}
          onDragOver={event => {event.preventDefault(); if (status === 'idle') setDragOver(true);}}
          onDragLeave={event => {event.preventDefault(); setDragOver(false);}}
          onDrop={event => {event.preventDefault(); setDragOver(false); if (status === 'idle') read(event.dataTransfer.files?.[0]);}}>
          <input id="cover-photo" type="file" accept="image/jpeg,image/png" disabled={status !== 'idle'} onChange={event => {read(event.target.files?.[0]); event.target.value = '';}} aria-describedby="cover-help" />
          <span className="cover-dropzone-copy"><strong>Choose from gallery</strong><span>or drop a photo here</span></span>
        </div>
      </div>
      <p id="cover-help" className="field-help">JPEG or PNG, up to 6 MiB and 20 megapixels. Used to suggest details and kept as a fallback cover if no catalog match is found.</p>
      {cameraOpen ? (
        <CameraCapture
          guide="cover"
          onCapture={file => {
            setCameraOpen(false);
            cameraButton.current?.focus();
            read(file);
          }}
          onClose={() => {
            setCameraOpen(false);
            cameraButton.current?.focus();
          }}
          onError={msg => {
            setError(msg);
          }}
        />
      ) : null}
      {status === 'reading' ? <p role="status">Reading cover… You can cancel at any time.</p> : null}
      {previewUrl && lines.length > 0 ? (
        <figure className="cover-ocr-preview">
          <div className="cover-ocr-wrap">
            <img
              src={previewUrl}
              alt="Cover photo with detected text highlighted"
              className="cover-ocr-photo"
            />
            <div className="cover-ocr-boxes" aria-hidden="true">
              {lines.map((line, index) => (
                <span
                  key={index}
                  className={`ocr-box${line.role ? ` ${line.role} ocr-box-${line.role}` : ''}`}
                  style={{
                    left: `${line.box[0] * 100}%`,
                    top: `${line.box[1] * 100}%`,
                    width: `${line.box[2] * 100}%`,
                    height: `${line.box[3] * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
          <figcaption className="cover-ocr-legend">
            Highlighted: text the photo reading found. Darker: used for the title and author.
          </figcaption>
        </figure>
      ) : null}
      {text ? <><p className="field-help">These are OCR suggestions, not a verified catalog match. Check the title and author.</p><details><summary>Detected text</summary><p className="detected-text">{text}</p></details></> : null}
      <label htmlFor="book-title">Title</label>
      <input id="book-title" name="title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={300} autoFocus disabled={status !== 'idle'} />
      <label htmlFor="book-author">Author <span className="field-help">(optional)</span></label>
      <input id="book-author" name="author" value={author} onChange={event => setAuthor(event.target.value)} maxLength={300} disabled={status !== 'idle'} />
      {error ? <p role="alert">{error}</p> : null}
      <div className="entry-actions"><button type="submit" disabled={status !== 'idle' || !title.trim()} aria-busy={status !== 'idle'}>{status === 'saving' ? 'Saving book…' : 'Save book'}</button><button type="button" className="cancel-button" onClick={close} disabled={status === 'saving'}>Cancel</button></div>
    </form> : null}
  </section>;
}
