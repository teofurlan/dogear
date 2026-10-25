// AbortSignal.any is missing before iOS Safari 17.4, where phone captures happen.
export function anySignal(signals) {
  if (AbortSignal.any) return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(signal.reason); break; }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {once: true});
  }
  return controller.signal;
}
