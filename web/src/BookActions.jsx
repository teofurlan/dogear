import React, {useEffect, useRef, useState} from 'react';
import {deleteBook, updateBook} from './books.js';
import {listQuotes} from './quotes.js';

function lossNote(kept) {
  if (kept === undefined) return 'Counting kept quotes…';
  const quotes = kept === null ? 'its kept quotes' : kept === 0 ? 'no kept quotes' : kept === 1 ? '1 kept quote' : `${kept} kept quotes`;
  return `This deletes ${quotes}, its waiting pages and their photos. This cannot be undone.`;
}

export default function BookActions({book, getToken, uploading, onSessionExpired, onChanged, onDeleted}) {
  const [mode, setMode] = useState(null);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author || '');
  const [kept, setKept] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const first = useRef(null);
  const buttons = {edit: useRef(null), delete: useRef(null)};
  const last = useRef(null);
  useEffect(() => {
    if (mode) {last.current = mode; first.current?.focus();}
    else if (last.current) buttons[last.current].current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'delete') return undefined;
    const controller = new AbortController();
    setKept(undefined);
    listQuotes(getToken, {bookId: book.id, status: 'kept'}, {signal: controller.signal})
      .then(quotes => {if (!controller.signal.aborted) setKept(Array.isArray(quotes) ? quotes.length : null);})
      .catch(problem => {
        if (controller.signal.aborted) return;
        if (problem?.status === 401) onSessionExpired();
        setKept(null);
      });
    return () => controller.abort();
  }, [mode, book.id, getToken, onSessionExpired]);

  function open(next) {
    setError(null); setTitle(book.title); setAuthor(book.author || ''); setMode(next);
  }

  async function run(action, failure) {
    setBusy(true); setError(null);
    try {
      await action();
    } catch (problem) {
      if (problem?.status === 401) onSessionExpired();
      else setError(problem?.status === 404 ? 'This book is no longer in your library.' : failure);
    } finally {
      setBusy(false);
    }
  }

  function save(event) {
    event.preventDefault();
    if (!title.trim()) {setError('Add a title.'); return;}
    run(async () => {
      onChanged(await updateBook(getToken, book.id, {title: title.trim(), author: author.trim() || null}));
      setMode(null);
    }, 'The changes were not saved. Please try again.');
  }

  const remove = () => run(async () => {
    await deleteBook(getToken, book.id);
    onDeleted(book.id);
  }, 'The book was not deleted. Please try again.');

  const failure = error ? <p className="quote-error" role="alert">{error}</p> : null;

  if (mode === 'edit') return <form className="book-edit" onSubmit={save} aria-label="Edit book details" noValidate>
    <label htmlFor="edit-title">Title</label>
    <input ref={first} id="edit-title" value={title} maxLength={300} onChange={event => setTitle(event.target.value)} />
    <label htmlFor="edit-author">Author <span>(optional)</span></label>
    <input id="edit-author" value={author} maxLength={300} onChange={event => setAuthor(event.target.value)} />
    {failure}
    <div className="leave-confirm-actions">
      <button type="submit" className="primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save details'}</button>
      <button type="button" className="quiet" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
    </div>
  </form>;

  if (mode === 'delete') return <div className="leave-confirm-dialog" role="alertdialog" aria-labelledby="delete-book-title" aria-describedby="delete-book-note">
    <p id="delete-book-title">Delete “{book.title}”?</p>
    <p id="delete-book-note" className="book-delete-note">{lossNote(kept)}</p>
    {failure}
    <div className="leave-confirm-actions">
      <button ref={first} type="button" className="quiet" onClick={() => setMode(null)} disabled={busy}>Keep book</button>
      <button type="button" className="primary" onClick={remove} disabled={busy || kept === undefined} aria-busy={busy || undefined}>{busy ? 'Deleting…' : 'Delete book'}</button>
    </div>
  </div>;

  return <div className="book-actions">
    <button ref={buttons.edit} type="button" className="quiet" onClick={() => open('edit')}>Edit details</button>
    <button ref={buttons.delete} type="button" className="quiet" onClick={() => open('delete')} disabled={uploading}
      title={uploading ? 'Wait for the photos to finish uploading' : undefined}>Delete book</button>
  </div>;
}
