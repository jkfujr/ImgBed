function summarizeStorages(storages = []) {
  let enabled = 0;
  let allowUpload = 0;
  const byType = {};

  for (const storage of storages) {
    if (storage.enabled) {
      enabled++;
    }
    if (storage.allowUpload) {
      allowUpload++;
    }
    byType[storage.type] = (byType[storage.type] || 0) + 1;
  }

  return {
    total: storages.length,
    enabled,
    allowUpload,
    byType,
  };
}

export { summarizeStorages };
