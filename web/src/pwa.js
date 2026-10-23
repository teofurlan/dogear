export function registerPwa({production, secureContext, navigator}) {
  if (!production || !secureContext || !navigator?.serviceWorker) return false;
  try {
    Promise.resolve(navigator.serviceWorker.register('/sw.js', {scope: '/'})).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
