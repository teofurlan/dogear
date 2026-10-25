import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {getBook, listBooks, PAGE_SIZE} from './books.js';
import {loadCovers} from './covers.js';
import {chooseExampleBooks} from './example-books.js';
import BookEntry from './BookEntry.jsx';
import BookCover from './BookCover.jsx';
import BookView from './BookView.jsx';
import {listQuotes} from './quotes.js';

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

const readHash = () => /^#book=([a-f0-9]{24})$/i.exec(window.location.hash)?.[1] || null;

function Library({getToken, signIn}) {
  const [bookId, setBookId] = useState(readHash);
  const [extraBooks, setExtraBooks] = useState({});
  const [notFoundId, setNotFoundId] = useState(null);
  const [bookError, setBookError] = useState(null);
  const [loadingBookId, setLoadingBookId] = useState(null);
  const [waiting, setWaiting] = useState([]);
  const pushed = useRef(false);
  const heading = useRef(null);
  useEffect(() => {
    const sync = () => {
      setNotFoundId(null);
      setBookError(null);
      setBookId(readHash());
    };
    window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync);
    return () => {window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync);};
  }, []);
  function openBook(id) {
    setNotFoundId(null);
    setBookError(null);
    window.history.pushState(null, '', '#book=' + id); pushed.current = true; setBookId(id);
  }
  function closeBook() {
    setNotFoundId(null);
    setBookError(null);
    if (pushed.current) {pushed.current = false; window.history.back();}
    else {window.history.replaceState(null, '', window.location.pathname + window.location.search); setBookId(null);}
  }
  useEffect(() => {
    if (bookId) return undefined;
    const controller = new AbortController();
    listQuotes(getToken, {status: 'pending'}, {signal: controller.signal})
      .then(quotes => {if (!controller.signal.aborted && Array.isArray(quotes)) setWaiting(quotes);})
      .catch(() => {});
    return () => controller.abort();
  }, [getToken, bookId]);
  const wasOpen = useRef(Boolean(bookId));
  useEffect(() => {
    if (!bookId && wasOpen.current) heading.current?.focus();
    wasOpen.current = Boolean(bookId);
  }, [bookId]);

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
  const blobUrls = useRef(new Set());

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
      if (controller.signal.aborted) {
        if (cover?.startsWith('blob:')) URL.revokeObjectURL(cover);
        return;
      }
      if (cover?.startsWith('blob:')) blobUrls.current.add(cover);
      coverCache.current.set(id, cover);
      setCovers(previous => ({...previous, [id]: cover}));
    }, controller.signal, {getToken});
    return () => controller.abort();
  }, [visibleBooks, getToken]);

  useEffect(() => {
    return () => {
      for (const url of blobUrls.current) {
        URL.revokeObjectURL(url);
      }
      blobUrls.current.clear();
    };
  }, []);

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

  useEffect(() => {
    if (!bookId) return undefined;
    if (visibleBooks.some(item => item.id === bookId) || extraBooks[bookId] || notFoundId === bookId || bookError === bookId) return undefined;
    if (status === 'loading') return undefined;
    const controller = new AbortController();
    setLoadingBookId(bookId);
    getBook(getToken, bookId, {signal: controller.signal})
      .then(book => {
        if (!controller.signal.aborted) {
          setExtraBooks(previous => ({...previous, [book.id]: book}));
          setLoadingBookId(null);
        }
      })
      .catch(problem => {
        if (!controller.signal.aborted) {
          setLoadingBookId(null);
          if (problem?.status === 404) setNotFoundId(bookId);
          else setBookError(bookId);
        }
      });
    return () => controller.abort();
  }, [bookId, visibleBooks, extraBooks, notFoundId, bookError, status, getToken]);

  const openBookData = bookId ? (visibleBooks.find(item => item.id === bookId) || extraBooks[bookId] || null) : null;
  if (bookId && (status === 'loading' || loadingBookId === bookId)) return <p role="status" className="feedback">{status === 'loading' ? 'Loading your library…' : 'Loading book…'}</p>;
  if (bookId && notFoundId === bookId) {
    return <section className="feedback" role="status">
      <p>This book is not in your library.</p>
      <button type="button" className="back-button" onClick={closeBook}>Back to library</button>
    </section>;
  }
  if (bookId && bookError === bookId) {
    return <section className="feedback" role="status">
      <p>This book could not load. Your books have not changed.</p>
      <button type="button" className="retry-button" onClick={() => setBookError(null)}>Try again</button>
      <div><button type="button" className="back-button" onClick={closeBook}>Back to library</button></div>
    </section>;
  }
  if (openBookData) return <BookView key={bookId} book={openBookData} coverUrl={covers[bookId]} getToken={getToken} onBack={closeBook} />;
  const waitingBook = waiting.length ? visibleBooks.find(item => item.id === waiting[0].book_id) : null;

  return <>
    <div className="heading-row"><h1 ref={heading} tabIndex={-1}>Your library</h1>{status !== 'loading' && status !== 'error' ? <span className="catalog-count">{visibleBooks.length} {visibleBooks.length === 1 ? 'book' : 'books'}{hasMore ? ' loaded' : ''}</span> : null}</div>
    <p className="intro-copy">A shelf of books worth finding again.</p>
    {waiting.length ? <section className="review-banner" aria-label="Quotes to review"><p>{waiting.length} {waiting.length === 1 ? 'quote is' : 'quotes are'} waiting for review.</p><a href={'#book=' + waiting[0].book_id} onClick={event => {event.preventDefault(); openBook(waiting[0].book_id);}}>Review{waitingBook ? ` “${waitingBook.title}”` : ''}</a></section> : null}
    {status !== 'loading' ? <BookEntry getToken={getToken} onCreated={book => setAddedBooks(previous => [...previous, book])} /> : null}
    {status === 'loading' ? <><p role="status" className="feedback">Loading your library…</p><ul className="book-grid skeleton-grid" aria-hidden="true">{[0,1,2,3].map(index => <li key={index} className="book skeleton"><div className="cover-wrap" /><div className="book-copy" /></li>)}</ul></> : null}
    {error ? <section className="feedback" role="status"><p>{error === 'session' ? 'Your session ended. Sign in again to view your books.' : 'Your library could not load. Your books have not changed.'}</p><button className="retry-button" onClick={error === 'session' ? signIn : () => books.length ? more() : setRetry(value => value + 1)}>{error === 'session' ? 'Sign in again' : 'Try again'}</button></section> : null}
    {status === 'ready' && !visibleBooks.length && !error ? <section className="empty-library" role="status"><h2>Your library is empty.</h2><p>Add your first book from its cover photo or enter the details yourself.</p></section> : null}
    {visibleBooks.length ? <ul className="book-grid" aria-label="Books in your library">{visibleBooks.map(book => <li key={book.id} className="book"><a className="book-link" href={'#book=' + book.id} aria-label={book.author ? `${book.title} by ${book.author}` : book.title} onClick={event => {event.preventDefault(); openBook(book.id);}}><BookCover book={book} url={covers[book.id]} pending={!Object.hasOwn(covers, book.id)} /><div className="book-copy"><h2 className="book-title">{book.title}</h2><p className="book-author">{book.author || 'Author not provided'}</p></div></a></li>)}</ul> : null}
    {hasMore && !error ? <button className="load-more" disabled={status === 'more'} aria-busy={status === 'more'} onClick={more}>{status === 'more' ? 'Loading more books…' : 'Load more books'}</button> : null}
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
    <header className="catalog-header"><a className="wordmark" href="/" aria-label="Dogear home">dogear<span aria-hidden="true">.</span></a>{isAuthenticated ? <button className="signout-button" onClick={signOut} disabled={starting} aria-busy={starting}>Sign out</button> : null}</header>
    <main className="catalog-main">
      {isLoading ? <p className="feedback" role="status">Checking your session…</p> : isAuthenticated && user?.sub && !error ? <Library key={user.sub} getToken={getAccessTokenSilently} signIn={signIn} /> : <>
        <div className="catalog-intro"><div className="heading-row"><h1>Your books, together.</h1></div></div>
        <section className="login-panel">
          <div className="login-copy">
            <h2>Keep the lines worth keeping.</h2>
            <p>One home for your books and favorite quotes. Photograph your highlighted pages—no copying, no retyping.</p>
            <p className="login-availability">Snap a page while you read. A small open model types the highlights overnight; you review them in the morning.</p>
            {error ? <p role="alert">Sign-in could not finish. Try again to start a new session.</p> : null}
          </div>
          <button onClick={signIn} disabled={starting} aria-busy={starting}>{starting ? 'Opening sign-in…' : 'Sign in to library'}</button>
        </section>
        <ExampleGallery />
      </>}
      {actionError ? <p className="feedback" role="alert">The account action could not finish. Check your connection and try again.</p> : null}
    </main>
    <footer className="catalog-footer"><span>Dogear</span><span>Representative covers from <a href="https://openlibrary.org/" target="_blank" rel="noreferrer">Open Library</a>.</span></footer>
  </div>;
}
