import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import AdminSidebar from '../../components/admin/AdminSidebar';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Box sx={{ display: 'flex', height: '100%', flexGrow: 1, overflow: 'hidden', backgroundColor: 'background.default' }}>
      <AdminSidebar
        collapsed={collapsed}
        currentPath={location.pathname}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        onNavigate={navigate}
      />

      <Box component="main" sx={{ flexGrow: 1, pt: 3, px: 3, pb: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
