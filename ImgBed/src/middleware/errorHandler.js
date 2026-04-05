const registerErrorHandlers = (app) => {
  app.use((err, _req, res, _next) => {
    console.error('[应用错误]', err);
    return res.status(500).json({
      code: 500,
      message: err.message || '内部服务器错误',
      error: {}
    });
  });
};

const notFoundHandler = (_req, res) => {
  return res.status(404).json({
    code: 404,
    message: '未找到请求的资源',
    data: {}
  });
};

export { registerErrorHandlers, notFoundHandler };
