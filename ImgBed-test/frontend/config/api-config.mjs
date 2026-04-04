export const API_IMPORT_WHITELIST = ['api.js', 'AuthProvider.jsx'];

export const API_CALL_WHITELIST = ['api.js'];

export function isWhitelistedByFileName(file, whitelist) {
  const fileName = file.relativePath.split('/').pop();
  return whitelist.includes(fileName);
}
