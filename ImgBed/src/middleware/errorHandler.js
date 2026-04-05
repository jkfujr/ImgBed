const registerErrorHandlers = (app) => {
  app.onError((err, c) => {
    console.error('[应用错误]', err);
    return c.json({
      code: 500,
      message: err.message || '内部服务器错误',
      error: {}
    }, 500);
  });

  app.notFound((c) => {
    return c.json({
      code: 404,
      message: '未找到请求的资源',
      data: {}
    }, 404);
  });
};

export { registerErrorHandlers };
