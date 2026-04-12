export function createRequestGuard() {
  let currentRequestId = 0;
  let disposed = false;

  return {
    begin() {
      currentRequestId += 1;
      return currentRequestId;
    },

    isCurrent(requestId) {
      return !disposed && requestId === currentRequestId;
    },

    dispose() {
      disposed = true;
      currentRequestId += 1;
    },
  };
}
