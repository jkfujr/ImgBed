function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error(reason || '操作已中止');
}

export {
  throwIfAborted,
};
