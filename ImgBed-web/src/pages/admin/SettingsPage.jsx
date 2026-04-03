import { useState } from 'react';
import {
  Box, Typography, Tabs, Tab, Paper, Divider,
  TextField, Button, CircularProgress, Alert,
  Switch, FormControlLabel, ToggleButton, ToggleButtonGroup, Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import TuneIcon from '@mui/icons-material/Tune';
import LockIcon from '@mui/icons-material/Lock';
import KeyIcon from '@mui/icons-material/Key';
import { useAuth } from '../../hooks/useAuth';
import { useUserPreference } from '../../hooks/useUserPreference';
import { AuthDocs } from '../../api';
import ApiTokenPanel from '../../components/admin/ApiTokenPanel';
import { BORDER_RADIUS } from '../../utils/constants';

function TabPanel({ value, index, children }) {
  return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState(0);

  // 偏好状态 - 自动持久化到 localStorage
  const [prefCols, setPrefCols] = useUserPreference('pref_masonry_cols', '0');
  const [prefPageSize, setPrefPageSize] = useUserPreference('pref_page_size', '20');
  const [prefShowFilename, setPrefShowFilename] = useUserPreference('pref_show_filename', true);

  // 密码安全状态
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdResult, setPwdResult] = useState(null); // { type: 'success'|'error', msg }

  const handlePrefCols = (_, val) => {
    if (val === null) return;
    setPrefCols(val);
  };

  const handlePrefPageSize = (e) => {
    setPrefPageSize(e.target.value);
  };

  const handlePrefShowFilename = (e) => {
    setPrefShowFilename(e.target.checked);
  };

  const handleChangePassword = async () => {
    setPwdResult(null);
    if (!newPassword || newPassword.length < 6) {
      setPwdResult({ type: 'error', msg: '新密码不能少于 6 位' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdResult({ type: 'error', msg: '两次输入的密码不一致' });
      return;
    }
    setPwdLoading(true);
    try {
      const res = await AuthDocs.changePassword({ newPassword });
      if (res.code === 0) {
        setPwdResult({ type: 'success', msg: '密码修改成功，下次登录时生效' });
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPwdResult({ type: 'error', msg: res.message || '修改失败' });
      }
    } catch (err) {
      setPwdResult({ type: 'error', msg: err.response?.data?.message || '网络错误' });
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Paper variant="outlined" sx={{ borderRadius: BORDER_RADIUS.md }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab icon={<AccountCircleIcon fontSize="small" />} iconPosition="start" label="个人资料" />
          <Tab icon={<TuneIcon fontSize="small" />} iconPosition="start" label="偏好" />
          <Tab icon={<LockIcon fontSize="small" />} iconPosition="start" label="密码和安全" />
          <Tab icon={<KeyIcon fontSize="small" />} iconPosition="start" label="API TOKEN" />
        </Tabs>

        <Box sx={{ px: 3, pb: 3 }}>
          {/* 个人资料 */}
          <TabPanel value={tab} index={0}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField label="用户名" value={user?.username || ''} InputProps={{ readOnly: true }} size="small" />
              <TextField label="角色" value={user?.role || 'admin'} InputProps={{ readOnly: true }} size="small" />
              <Typography variant="caption" color="text.secondary">
                当前系统为单用户模式，用户名不可修改。
              </Typography>
            </Box>
          </TabPanel>

          {/* 偏好 */}
          <TabPanel value={tab} index={1}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Box>
                <Typography variant="body2" fontWeight="medium" mb={1}>瀑布流列数</Typography>
                <ToggleButtonGroup value={prefCols} exclusive onChange={handlePrefCols} size="small">
                  <ToggleButton value="0">自动</ToggleButton>
                  <ToggleButton value="2">2 列</ToggleButton>
                  <ToggleButton value="3">3 列</ToggleButton>
                  <ToggleButton value="4">4 列</ToggleButton>
                  <ToggleButton value="5">5 列</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  「自动」根据屏幕宽度动态调整列数。
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="body2" fontWeight="medium" mb={1}>每页显示数量</Typography>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>每页数量</InputLabel>
                  <Select value={prefPageSize} label="每页数量" onChange={handlePrefPageSize}>
                    <MenuItem value="20">20</MenuItem>
                    <MenuItem value="40">40</MenuItem>
                    <MenuItem value="60">60</MenuItem>
                    <MenuItem value="100">100</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Divider />

              <FormControlLabel
                control={<Switch checked={prefShowFilename} onChange={handlePrefShowFilename} />}
                label="卡片显示文件名"
              />
            </Box>
          </TabPanel>

          {/* 密码和安全 */}
          <TabPanel value={tab} index={2}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 360 }}>
              {pwdResult && (
                <Alert severity={pwdResult.type} onClose={() => setPwdResult(null)}>
                  {pwdResult.msg}
                </Alert>
              )}
              <TextField
                label="新密码" type="password" size="small" fullWidth
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                disabled={pwdLoading}
              />
              <TextField
                label="确认新密码" type="password" size="small" fullWidth
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                disabled={pwdLoading}
              />
              <Button variant="contained" onClick={handleChangePassword} disabled={pwdLoading}
                sx={{ alignSelf: 'flex-start' }}>
                {pwdLoading ? <CircularProgress size={18} color="inherit" /> : '修改密码'}
              </Button>
            </Box>
          </TabPanel>

          <TabPanel value={tab} index={3}>
            <ApiTokenPanel />
          </TabPanel>
        </Box>
      </Paper>
    </Box>
  );
}
