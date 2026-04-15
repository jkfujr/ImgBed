import { createStorageRuntime } from './create-storage-runtime.js';

const storageRuntimeContext = createStorageRuntime();

const storageRuntime = storageRuntimeContext.runtime;
const applyPendingQuotaEvents = (options = {}) =>
  storageRuntimeContext.applyPendingQuotaEvents(options);

export {
  applyPendingQuotaEvents,
  storageRuntime,
};
