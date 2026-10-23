import React, {useCallback, useState} from 'react';

export default function BookCover({book, url, pending = false}) {
  const [loadedUrl, setLoadedUrl] = useState(null);
  const [failedUrl, setFailedUrl] = useState(null);
  const loaded = Boolean(url && loadedUrl === url);
  const failed = Boolean(url && failedUrl === url);
  const loading = pending || Boolean(url && !loaded && !failed);
  const handleLoad = useCallback(event => {
    if (event.currentTarget.src === url) setLoadedUrl(url);
  }, [url]);
  const handleError = useCallback(event => {
    if (event.currentTarget.src === url) setFailedUrl(url);
  }, [url]);
  const imageRef = useCallback(image => {
    if (image?.complete && image.naturalWidth > 0) setLoadedUrl(url);
  }, [url]);

  return <div className={`cover-wrap book-cover${loaded ? ' is-loaded' : ''}`} aria-busy={loading}>
    <div className="cover-fallback" aria-hidden="true">{!loading ? <span className="fallback-author">No cover available</span> : null}</div>
    {loading ? <span className="cover-loader" role="progressbar" aria-label={`Loading cover of ${book.title}`} aria-valuetext="Loading" /> : null}
    {url && !failed ? <img ref={imageRef} className="cover-image" src={url} alt={`Representative cover of ${book.title}`} width="200" height="300" loading="lazy" referrerPolicy="no-referrer" onLoad={handleLoad} onError={handleError} /> : null}
  </div>;
}
