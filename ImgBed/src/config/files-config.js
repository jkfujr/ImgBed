const DEFAULT_MAX_DIRECTORY_PATH_LENGTH = 4096;

function normalizeMaxDirectoryPathLength(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DIRECTORY_PATH_LENGTH;
}

export {
  DEFAULT_MAX_DIRECTORY_PATH_LENGTH,
  normalizeMaxDirectoryPathLength,
};
