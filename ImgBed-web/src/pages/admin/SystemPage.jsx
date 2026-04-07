import { useState } from 'react';
import { Box, Tabs, Tab, Paper } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SecurityIcon from '@mui/icons-material/Security';
import SystemConfigPanel from '../../components/admin/SystemConfigPanel';
import LoadBalancePanel from '../../components/admin/LoadBalancePanel';
import UploadConfigPanel from '../../components/admin/UploadConfigPanel';
import SecurityConfigPanel from '../../components/admin/SecurityConfigPanel';
import { BORDER_RADIUS } from '../../utils/constants';

export default function SystemPage() {
  const [currentTab, setCurrentTab] = useState(0);

  return (
    <Box sx={{ maxWidth: 800 }}>
      <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md }}>
        <Tabs value={currentTab} onChange={(e, newValue) => setCurrentTab(newValue)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab icon={<SettingsIcon fontSize="small" />} iconPosition="start" label="系统配置" />
          <Tab icon={<CloudUploadIcon fontSize="small" />} iconPosition="start" label="上传配置" />
          <Tab icon={<StorageIcon fontSize="small" />} iconPosition="start" label="存储策略" />
          <Tab icon={<SecurityIcon fontSize="small" />} iconPosition="start" label="安全策略" />
        </Tabs>

        <Box sx={{ px: 3, pb: 3, pt: 3 }}>
          {currentTab === 0 && <SystemConfigPanel />}
          {currentTab === 1 && <UploadConfigPanel />}
          {currentTab === 2 && <LoadBalancePanel />}
          {currentTab === 3 && <SecurityConfigPanel />}
        </Box>
      </Paper>
    </Box>
  );
}
