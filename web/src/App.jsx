import React, {useEffect, useRef, useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {listBooks, PAGE_SIZE} from './books.js';
import {loadCovers} from './covers.js';

function Cover({book, url}) {
  const [failed, setFailed] = useState(false);
  return <div className="cover-wrap">
    <div className="cover-fallback" aria-hidden="true"><span className="fallback-title">{book.title}</span><span className="fallback-author">No cover available</span></div>
    {url && !failed ? <img className="cover-image" src={url} alt={`Representative cover of ${book.title}`} width="200" height="300" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : null}
  </div>;
}

function Library({getToken, signIn}) {
  const [books, setBooks] = useState([]);
  const [covers, setCovers] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(null);
  const busy = useRef(false);
  const coverCache = useRef(new Map());

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    setBooks([]); setError(null); setStatus('loading');
    listBooks(getToken, {signal: controller.signal}).then(page => {
      if (controller.signal.aborted) return;
      setBooks(page); setHasMore(page.length === PAGE_SIZE); setStatus('ready');
    }).catch(problem => {
      if (!controller.signal.aborted) {setError(problem.status === 401 ? 'session' : 'storage'); setStatus('error');}
    }).finally(() => {if (!controller.signal.aborted) busy.current = false;});
    return () => {controller.abort(); request.current?.abort();};
  }, [getToken, retry]);

  useEffect(() => {
    const controller = new AbortController();
    const missing = books.filter(book => !coverCache.current.has(book.id));
    loadCovers(missing, (id, cover) => {
      if (controller.signal.aborted) return;
      coverCache.current.set(id, cover);
      setCovers(previous => ({...previous, [id]: cover}));
    }, controller.signal);
    return () => controller.abort();
  }, [books]);

  async function more() {
    if (busy.current || !hasMore) return;
    busy.current = true;
    const controller = new AbortController(); request.current = controller;
    setError(null); setStatus('more');
    try {
      const page = await listBooks(getToken, {after: books.at(-1).id, signal: controller.signal});
      if (controller.signal.aborted) return;
      setBooks(previous => [...new Map([...previous, ...page].map(book => [book.id, book])).values()]);
      setHasMore(page.length === PAGE_SIZE); setStatus('ready');
    } catch (problem) {
      if (!controller.signal.aborted) {setError(problem.status === 401 ? 'session' : 'storage'); setStatus('ready');}
    } finally {if (!controller.signal.aborted) busy.current = false;}
  }

  return <>
    <div className="heading-row"><h1>Your library</h1>{status !== 'loading' && status !== 'error' ? <span className="catalog-count">{books.length} {books.length === 1 ? 'book' : 'books'}{hasMore ? ' loaded' : ''}</span> : null}</div>
    <p className="intro-copy">A shelf of books worth finding again.</p>
    {status === 'loading' ? <><p role="status" className="feedback">Loading your library…</p><ul className="book-grid skeleton-grid" aria-hidden="true">{[0,1,2,3].map(index => <li key={index} className="book skeleton"><div className="cover-wrap" /><div className="book-copy" /></li>)}</ul></> : null}
    {error ? <section className="feedback" role="status"><p>{error === 'session' ? 'Your session ended. Sign in again to view your books.' : 'Your library could not load. Your books have not changed.'}</p><button className="retry-button" onClick={error === 'session' ? signIn : () => books.length ? more() : setRetry(value => value + 1)}>{error === 'session' ? 'Sign in again' : 'Try again'}</button></section> : null}
    {status === 'ready' && !books.length && !error ? <section className="empty-library" role="status"><h2>Your library is empty.</h2><p>Books you save will appear here with their title, author and cover.</p><p>Adding books is not available in this version.</p></section> : null}
    {books.length ? <ul className="book-grid" aria-label="Books in your library">{books.map(book => <li key={book.id} className="book"><Cover book={book} url={covers[book.id]} /><div className="book-copy"><h2 className="book-title">{book.title}</h2><p className="book-author">{book.author || 'Author not provided'}</p></div></li>)}</ul> : null}
    {hasMore && !error ? <button className="load-more" disabled={status === 'more'} onClick={more}>{status === 'more' ? 'Loading more books…' : 'Load more books'}</button> : null}
  </>;
}

export default function App() {
  const {isLoading, isAuthenticated, user, error, loginWithRedirect, logout, getAccessTokenSilently} = useAuth0();
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState(false);
  async function signIn() {
    setActionError(false); setStarting(true);
    try {await loginWithRedirect();} catch {setActionError(true); setStarting(false);}
  }
  async function signOut() {
    setStarting(true); setActionError(false);
    try {await logout({logoutParams: {returnTo: window.location.origin}});} catch {setActionError(true); setStarting(false);}
  }
  return <div className="catalog-shell">
    <header className="catalog-header"><a className="wordmark" href="/" aria-label="Dogear home">dogear<span aria-hidden="true">.</span></a>{isAuthenticated ? <button className="signout-button" onClick={signOut} disabled={starting}>Sign out</button> : null}</header>
    <main className="catalog-main">
      {isLoading ? <p className="feedback" role="status">Checking your session…</p> : isAuthenticated && user?.sub && !error ? <Library key={user.sub} getToken={getAccessTokenSilently} signIn={signIn} /> : <>
        <div className="catalog-intro"><div className="heading-row"><h1>Your books, together.</h1></div></div>
        <section className="login-panel"><h2>Keep your shelf close.</h2><p>Sign in to see the books saved in your own library.</p>{error ? <p role="alert">Sign-in could not finish. Try again to start a new session.</p> : null}<button onClick={signIn} disabled={starting}>{starting ? 'Opening sign-in…' : 'Sign in to library'}</button></section>
      </>}
      {actionError ? <p className="feedback" role="alert">The account action could not finish. Check your connection and try again.</p> : null}
    </main>
    <footer className="catalog-footer"><span>Dogear</span><span>Representative covers from <a href="https://openlibrary.org/" target="_blank" rel="noreferrer">Open Library</a>.</span></footer>
  </div>;
}
