const fs = require('fs');
const path = require('path');

async function runTest() {
  const baseURL = 'http://localhost:13000';
  const testFilePath = path.join(__dirname, 'test_temp.txt');
  const testContent = `Test Content ${Date.now()} ${Math.random()}`;
  
  console.log('--- 开始图片路径优化验证测试 (原生 Fetch 实现) ---');
  
  try {
    // 1. 准备测试文件
    fs.writeFileSync(testFilePath, testContent);
    console.log('1. 测试文件准备就绪:', testContent);

    // 2. 测试上传 API
    console.log('2. 正在执行上传...');
    const formData = new FormData();
    const fileBlob = new Blob([testContent], { type: 'text/plain' });
    formData.append('file', fileBlob, 'test_temp.txt');
    
    const uploadRes = await fetch(`${baseURL}/api/upload`, {
      method: 'POST',
      body: formData
    });
    
    const uploadData = await uploadRes.json();

    if (uploadData.code === 0) {
      const fileData = uploadData.data;
      const newUrl = fileData.url;
      const fileId = fileData.id;
      
      console.log('   [成功] 上传返回 URL:', newUrl);
      console.log('   [验证] URL 是否为短路径:', !newUrl.startsWith('/f/') ? '通过' : '未通过');

      // 3. 验证新路径访问
      console.log(`3. 正在尝试访问新路径: ${baseURL}${newUrl}`);
      const viewRes = await fetch(`${baseURL}${newUrl}`);
      const viewedContent = await viewRes.text();
      
      if (viewRes.status === 200 && viewedContent.includes(testContent)) {
        console.log('   [成功] 新路径直接访问返回内容匹配');
      } else {
        console.log('   [失败] 新路径访问异常:', viewRes.status);
      }

      // 4. 验证旧路径是否失效
      const oldUrl = `/f/${fileId}`;
      console.log(`4. 正在验证旧路径是否失效: ${baseURL}${oldUrl}`);
      const oldRes = await fetch(`${baseURL}${oldUrl}`);
      if (oldRes.status === 404) {
        console.log('   [成功] 旧路径已正确返回 404');
      } else {
        console.log('   [失败] 旧路径竟然还能访问, 状态码:', oldRes.status);
      }

      // 5. 验证 API 路由是否未被误伤
      console.log('5. 验证核心 API 路由访问...');
      const apiRes = await fetch(`${baseURL}/api/auth`); 
      // 即使返回 401 也说明路由匹配到了 auth 模块而不是被 view 拦截了
      if (apiRes.status === 401 || apiRes.status === 200) {
           console.log('   [成功] API 路由正常工作 (状态码: ' + apiRes.status + ')');
      } else {
           console.log('   [警告] API 路由测试异常: 状态码 ' + apiRes.status);
      }

    } else {
      console.log('   [失败] 上传 API 返回执行错误:', uploadData.message);
    }

  } catch (error) {
    console.error('--- 测试执行过程中发生致命错误 ---');
    console.error(error.message);
  } finally {
    // 清理
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    console.log('--- 测试结束，已清理临时文件 ---');
  }
}

runTest();
