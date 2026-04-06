/**
 * 包装异步路由处理函数，自动捕获异常并委托给 next()
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
