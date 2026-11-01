// React Native 0.88 removed InteractionManager. This keeps its `runAfterInteractions(...).cancel()` shape:
// the callback runs when the JS thread is idle (requestIdleCallback), or on the next tick where that is missing.
export const runAfterInteractions = (callback: () => void): { cancel: () => void } => {
  const ric = (globalThis as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
  const cic = (globalThis as any).cancelIdleCallback as ((id: number) => void) | undefined;
  if (typeof ric === 'function') {
    // timeout: never wait more than half a second for an idle moment.
    const id = ric(callback, { timeout: 500 });
    return { cancel: () => cic?.(id) };
  }
  const id = setTimeout(callback, 0);
  return { cancel: () => clearTimeout(id) };
};
