import { cacheMiddleware, buildIdentityCacheKey } from '../../middleware/cache.js';
import { FILES_LIST_CACHE_PREFIX } from '../../services/cache/cache-groups.js';

function filesListCache() {
  return cacheMiddleware({
    prefix: FILES_LIST_CACHE_PREFIX,
    keyBuilder: (req) => {
      const search = typeof req.query.search === 'string' ? req.query.search : '';
      const directory = typeof req.query.directory === 'string' ? req.query.directory : undefined;
      return buildIdentityCacheKey(FILES_LIST_CACHE_PREFIX, req, {
        mode: search.trim() ? 'search' : 'browse',
        page: req.query.page || '1',
        pageSize: req.query.pageSize || '20',
        directory: directory === undefined ? '__missing__' : directory,
        search,
      });
    },
    ttl: 30,
  });
}

export {
  filesListCache,
};
