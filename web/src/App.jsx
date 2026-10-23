import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {listBooks, PAGE_SIZE} from './books.js';
import {loadCovers} from './covers.js';
import {chooseExampleBooks} from './example-books.js';
import BookEntry from './BookEntry.jsx';
import BookCover from './BookCover.jsx';

function ExampleGallery() {
  const [familiarBooks] = useState(() => chooseExampleBooks());
  return <section className="example-gallery" aria-labelledby="example-gallery-title">
    <div className="example-gallery-intro">
      <h2 id="example-gallery-title">A few familiar covers</h2>
      <p>Public catalog examples, not books in your library.</p>
    </div>
    <ul className="book-grid" aria-label="Example book covers">
      {familiarBooks.map(book => <li className="book" key={book.coverId}>
        <BookCover book={book} url={`https://covers.openlibrary.org/b/id/${book.coverId}-M.jpg?default=false`} />
        <div className="book-copy"><h3 className="book-title">{book.title}</h3><p className="book-author">{book.author}</p></div>
      </li>)}
    </ul>
  </section>;
}

function Library({getToken, signIn}) {
  const [books, setBooks] = useState([]);
  const [addedBooks, setAddedBooks] = useState([]);
  // Newly saved books must not move the server pagination cursor past unseen books.
  const visibleBooks = useMemo(() => [...new Map([...books, ...addedBooks].map(book => [book.id, book])).values()], [books, addedBooks]);
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
    const missing = visibleBooks.filter(book => !coverCache.current.has(book.id));
    loadCovers(missing, (id, cover) => {
      if (controller.signal.aborted) return;
      coverCache.current.set(id, cover);
      setCovers(previous => ({...previous, [id]: cover}));
    }, controller.signal);
    return () => controller.abort();
  }, [visibleBooks]);

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
    <div className="heading-row"><h1>Your library</h1>{status !== 'loading' && status !== 'error' ? <span className="catalog-count">{visibleBooks.length} {visibleBooks.length === 1 ? 'book' : 'books'}{hasMore ? ' loaded' : ''}</span> : null}</div>
    <p className="intro-copy">A shelf of books worth finding again.</p>
    {status !== 'loading' ? <BookEntry getToken={getToken} onCreated={book => setAddedBooks(previous => [...previous, book])} /> : null}
    {status === 'loading' ? <><p role="status" className="feedback">Loading your library…</p><ul className="book-grid skeleton-grid" aria-hidden="true">{[0,1,2,3].map(index => <li key={index} className="book skeleton"><div className="cover-wrap" /><div className="book-copy" /></li>)}</ul></> : null}
    {error ? <section className="feedback" role="status"><p>{error === 'session' ? 'Your session ended. Sign in again to view your books.' : 'Your library could not load. Your books have not changed.'}</p><button className="retry-button" onClick={error === 'session' ? signIn : () => books.length ? more() : setRetry(value => value + 1)}>{error === 'session' ? 'Sign in again' : 'Try again'}</button></section> : null}
    {status === 'ready' && !visibleBooks.length && !error ? <section className="empty-library" role="status"><h2>Your library is empty.</h2><p>Add your first book from its cover photo or enter the details yourself.</p></section> : null}
    {visibleBooks.length ? <ul className="book-grid" aria-label="Books in your library">{visibleBooks.map(book => <li key={book.id} className="book"><BookCover book={book} url={covers[book.id]} pending={!Object.hasOwn(covers, book.id)} /><div className="book-copy"><h2 className="book-title">{book.title}</h2><p className="book-author">{book.author || 'Author not provided'}</p></div></li>)}</ul> : null}
    {hasMore && !error ? <button className="load-more" disabled={status === 'more'} onClick={more}>{status === 'more' ? 'Loading more books…' : 'Load more books'}</button> : null}
  </>;
}

export default function App() {
  const {isLoading, isAuthenticated, user, error, loginWithRedirect, logout, getAccessTokenSilently} = useAuth0();
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState(false);
  const showSignIn = !isLoading && !(isAuthenticated && user?.sub && !error);
  async function signIn() {
    setActionError(false); setStarting(true);
    try {await loginWithRedirect();} catch {setActionError(true); setStarting(false);}
  }
  async function signOut() {
    setStarting(true); setActionError(false);
    try {await logout({logoutParams: {returnTo: window.location.origin}});} catch {setActionError(true); setStarting(false);}
  }
  return <div className={`catalog-shell${showSignIn ? ' catalog-shell--signin' : ''}`}>
    <header className="catalog-header"><a className="wordmark" href="/" aria-label="Dogear home">dogear<span aria-hidden="true">.</span></a>{isAuthenticated ? <button className="signout-button" onClick={signOut} disabled={starting}>Sign out</button> : null}</header>
    <main className="catalog-main">
      {isLoading ? <p className="feedback" role="status">Checking your session…</p> : isAuthenticated && user?.sub && !error ? <Library key={user.sub} getToken={getAccessTokenSilently} signIn={signIn} /> : <>
        <div className="catalog-intro"><div className="heading-row"><h1>Your books, together.</h1></div></div>
        <section className="login-panel">
          <div className="login-copy">
            <h2>Keep the lines worth keeping.</h2>
            <p>One home for your books and favorite quotes. Photograph your highlighted pages—no copying, no retyping.</p>
            <p className="login-availability">Photo-to-quote capture is coming next. Sign in to view your library today.</p>
            {error ? <p role="alert">Sign-in could not finish. Try again to start a new session.</p> : null}
          </div>
          <button onClick={signIn} disabled={starting}>{starting ? 'Opening sign-in…' : 'Sign in to library'}</button>
        </section>
        <ExampleGallery />
      </>}
      {actionError ? <p className="feedback" role="alert">The account action could not finish. Check your connection and try again.</p> : null}
    </main>
    <footer className="catalog-footer"><span>Dogear</span><span>Representative covers from <a href="https://openlibrary.org/" target="_blank" rel="noreferrer">Open Library</a>.</span></footer>
  </div>;
}
