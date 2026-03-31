const fs = require('fs');
const path = require('path');

async function runTest() {
  const baseURL = 'http://localhost:13000';
  const testImgPath = path.join(__dirname, 'test_img.png');
  const testTxtPath = path.join(__dirname, 'test_bad.txt');
  
  console.log('--- 开始综合验证测试 (路径优化 + 类型过滤) ---');
  
  try {
    // 准备文件
    fs.writeFileSync(testImgPath, 'fake-image-content-' + Date.now());
    fs.writeFileSync(testTxtPath, 'this is a text file');

    // 1. 测试图片上传 (应成功)
    console.log('1. 尝试上传图片...');
    const imgData = new FormData();
    imgData.append('file', new Blob(['fake-img'], { type: 'image/png' }), 'test.png');
    
    const imgRes = await fetch(`${baseURL}/api/upload`, { method: 'POST', body: imgData });
    const imgJson = await imgRes.json();
    
    if (imgJson.code === 0) {
      console.log('   [成功] 图片上传成功, URL:', imgJson.data.url);
      
      // 验证访问
      const viewRes = await fetch(`${baseURL}${imgJson.data.url}`);
      if (viewRes.status === 200) {
        console.log('   [成功] 新路径直接访问成功');
      }
    } else {
      console.log('   [失败] 图片上传失败:', imgJson.message);
    }

    // 2. 测试非图片上传 (应被后端拒绝)
    console.log('2. 尝试上传非图片文件 (.txt)...');
    const txtData = new FormData();
    txtData.append('file', new Blob(['some text'], { type: 'text/plain' }), 'test.txt');
    
    const txtRes = await fetch(`${baseURL}/api/upload`, { method: 'POST', body: txtData });
    const txtJson = await txtRes.json();
    
    if (txtRes.status === 400 && txtJson.message.includes('非法文件格式')) {
      console.log('   [成功] 后端正确拦截了非图片上传, 提示:', txtJson.message);
    } else {
      console.log('   [失败] 后端尝试处理了非法文件或返回了非预期状态:', txtRes.status);
    }

    // 3. 验证旧路径失效
    console.log('3. 验证旧路径 /f/ 是否已彻底移除...');
    const oldRes = await fetch(`${baseURL}/f/any-id`);
    if (oldRes.status === 404) {
      console.log('   [成功] 旧路径已失效');
    } else {
      console.log('   [失败] 旧路径仍有响应, 状态:', oldRes.status);
    }

  } catch (error) {
    console.error('测试崩溃:', error.message);
  } finally {
    if (fs.existsSync(testImgPath)) fs.unlinkSync(testImgPath);
    if (fs.existsSync(testTxtPath)) fs.unlinkSync(testTxtPath);
  }
}

runTest();
