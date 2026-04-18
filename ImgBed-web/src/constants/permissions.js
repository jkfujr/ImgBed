export const PERMISSION_OPTIONS = [
  {
    key: 'upload:image',
    label: '上传图片',
    description: '允许调用上传接口',
    defaultChecked: true
  },
  {
    key: 'files:read',
    label: '查看文件列表',
    description: '允许读取文件列表与文件详情'
  },
  {
    key: 'directories:read',
    label: '查看目录树',
    description: '允许读取目录结构'
  }
];
