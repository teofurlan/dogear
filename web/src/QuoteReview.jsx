import React, {useCallback, useEffect, useState} from 'react';
import {addQuote, deleteQuote, fetchCrop, listQuotes, updateQuote} from './quotes.js';

const SAVE_FAILED = 'The change could not be saved. Your text is still here; try again.';

function flagHint(flags = []) {
  if (!flags.length) return null;
  if (flags.includes('ocr_only') || flags.includes('model_unavailable')) return 'This text came from OCR only — check it against the photo.';
  return 'The two readers disagreed — check it against the photo.';
}

function Crop({getToken, quote}) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!quote.has_crop) return undefined;
    const controller = new AbortController();
    let objectUrl = null;
    fetchCrop(getToken, quote.id, {signal: controller.signal}).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => {});
    return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [getToken, quote.id, quote.has_crop]);
  return url ? <img className="quote-crop" src={url} alt="Photo of the highlighted passage" /> : null;
}

function PendingQuote({getToken, quote, onKept, onDeleted}) {
  const [text, setText] = useState(quote.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hint = flagHint(quote.flags);
  async function run(action) {
    setBusy(true); setError('');
    try {await action();} catch {setError(SAVE_FAILED); setBusy(false);}
  }
  return <li className="quote-card">
    <Crop getToken={getToken} quote={quote} />
    {hint ? <p className="flag-hint">{hint}</p> : null}
    <label htmlFor={`quote-${quote.id}`}>Quote text</label>
    <textarea id={`quote-${quote.id}`} rows={4} maxLength={5000} value={text} onChange={event => setText(event.target.value)} disabled={busy} />
    {error ? <p role="alert" className="quote-error">{error}</p> : null}
    <div className="quote-actions">
      <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => run(async () => onKept(await updateQuote(getToken, quote.id, {text: text.trim(), status: 'kept'})))}>Keep</button>
      <button type="button" className="quiet" disabled={busy} onClick={() => run(async () => {await deleteQuote(getToken, quote.id); onDeleted(quote.id);})}>Delete</button>
    </div>
  </li>;
}

function KeptQuote({getToken, quote, onChanged, onDeleted}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(quote.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action) {
    setBusy(true); setError('');
    try {await action();} catch {setError(SAVE_FAILED);} finally {setBusy(false);}
  }
  const save = () => run(async () => {onChanged(await updateQuote(getToken, quote.id, {text: text.trim()})); setEditing(false);});
  return <li className="quote-card kept">
    {editing ? <>
      <label htmlFor={`edit-${quote.id}`}>Edit quote text</label>
      <textarea id={`edit-${quote.id}`} rows={4} maxLength={5000} value={text} onChange={event => setText(event.target.value)} disabled={busy} autoFocus />
    </> : <blockquote>{quote.text}</blockquote>}
    {error ? <p role="alert" className="quote-error">{error}</p> : null}
    <div className="quote-actions">
      {editing ? <>
        <button type="button" className="primary" disabled={busy || !text.trim()} onClick={save}>Save</button>
        <button type="button" className="quiet" disabled={busy} onClick={() => {setEditing(false); setText(quote.text);}}>Cancel</button>
      </> : <button type="button" className="quiet" onClick={() => setEditing(true)}>Edit quote</button>}
      <button type="button" className="quiet" disabled={busy} onClick={() => run(async () => {await deleteQuote(getToken, quote.id); onDeleted(quote.id);})}>Delete quote</button>
    </div>
  </li>;
}

export default function QuoteReview({getToken, bookId}) {
  const [pending, setPending] = useState(null);
  const [kept, setKept] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setPending(null); setKept(null); setLoadError(false);
    Promise.all([
      listQuotes(getToken, {bookId, status: 'pending'}, {signal: controller.signal}),
      listQuotes(getToken, {bookId, status: 'kept'}, {signal: controller.signal})
    ]).then(([waiting, saved]) => {
      if (controller.signal.aborted) return;
      setPending(waiting); setKept(saved);
    }).catch(() => {if (!controller.signal.aborted) {setLoadError(true); setPending([]); setKept([]);}});
    return () => controller.abort();
  }, [getToken, bookId]);

  const drop = useCallback((id) => {setPending(list => list.filter(q => q.id !== id)); setKept(list => list.filter(q => q.id !== id));}, []);
  const keep = useCallback(quote => {setPending(list => list.filter(q => q.id !== quote.id)); setKept(list => [quote, ...list]);}, []);
  const replace = useCallback(quote => setKept(list => list.map(q => q.id === quote.id ? quote : q)), []);

  async function add(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true); setAddError('');
    try {
      const quote = await addQuote(getToken, bookId, text);
      setKept(list => [quote, ...(list || [])]); setDraft('');
    } catch {setAddError('The passage could not be saved. Your text is still here; try again.');} finally {setAdding(false);}
  }

  const loading = pending === null || kept === null;
  return <section className="quote-review" aria-labelledby="review-title">
    <h2 id="review-title">Morning review</h2>
    {loadError ? <p role="alert" className="quote-error">Your quotes could not load. Reload the page to try again.</p> : null}
    {loading ? <p role="status" className="feedback">Loading quotes…</p> : <>
      {pending.length ? <ul className="quote-list" aria-label="Quotes to review">{pending.map(quote => <PendingQuote key={quote.id} getToken={getToken} quote={quote} onKept={keep} onDeleted={drop} />)}</ul>
        : <p className="empty-note">Tonight's run will find your highlights</p>}
      <h3>Kept quotes</h3>
      {kept.length ? <ul className="quote-list" aria-label="Kept quotes">{kept.map(quote => <KeptQuote key={quote.id} getToken={getToken} quote={quote} onChanged={replace} onDeleted={drop} />)}</ul>
        : <p className="empty-note">No kept quotes yet.</p>}
    </>}
    <form className="add-passage" onSubmit={add}>
      <label htmlFor="add-passage">Add a passage you highlighted</label>
      <textarea id="add-passage" rows={3} maxLength={5000} value={draft} onChange={event => setDraft(event.target.value)} disabled={adding} />
      {addError ? <p role="alert" className="quote-error">{addError}</p> : null}
      <button type="submit" className="primary" disabled={adding || !draft.trim()}>Add passage</button>
    </form>
  </section>;
}
