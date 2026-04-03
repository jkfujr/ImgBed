import React, { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import SystemConfigPanel from '../../components/admin/SystemConfigPanel';
import LoadBalancePanel from '../../components/admin/LoadBalancePanel';
import UploadConfigPanel from '../../components/admin/UploadConfigPanel';

export default function SystemPage() {
  const [currentTab, setCurrentTab] = useState(0);

  return (
    <Box sx={{ maxWidth: 800 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={(e, newValue) => setCurrentTab(newValue)}>
          <Tab label="系统配置" />
          <Tab label="存储策略" />
          <Tab label="上传配置" />
        </Tabs>
      </Box>

      {currentTab === 0 && <SystemConfigPanel />}
      {currentTab === 1 && <LoadBalancePanel />}
      {currentTab === 2 && <UploadConfigPanel />}
    </Box>
  );
}
