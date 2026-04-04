/**
 * 统一日志工具，便于后续接入日志服务
 */
 
const _c = console;
const logger = {
  error: _c.error.bind(_c),
  warn: _c.warn.bind(_c),
  info: _c.info.bind(_c),
};

export default logger;
