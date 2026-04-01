import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, TextField, InputAdornment, Box,
  List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, CircularProgress
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ImageIcon from '@mui/icons-material/Image';
import { useNavigate } from 'react-router-dom';
import { FileDocs } from '../../api';

export default function SearchDialog({ open, onClose }) {
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      setSearchInput('');
      setResults([]);
      return;
    }

    if (!searchInput.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await FileDocs.list({ search: searchInput, page: 1, pageSize: 20 });
        if (res.code === 0) {
          setResults(res.data.list || []);
        }
      } catch (err) {
        console.error('搜索失败:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, open]);

  const handleItemClick = (item) => {
    const dir = item.directory || '';
    navigate(`/admin/files?path=${encodeURIComponent(dir)}`);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          position: 'fixed',
          top: 80,
          m: 0,
          maxHeight: 'calc(100vh - 160px)'
        }
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <TextField
            fullWidth
            autoFocus
            placeholder="搜索文件..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                )
              }
            }}
          />
        </Box>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && searchInput && results.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">未找到匹配的文件</Typography>
          </Box>
        )}

        {!loading && results.length > 0 && (
          <>
            <Divider />
            <List sx={{ maxHeight: 400, overflow: 'auto' }}>
              {results.map((item) => (
                <ListItem key={item.id} disablePadding>
                  <ListItemButton onClick={() => handleItemClick(item)}>
                    <ListItemIcon>
                      <ImageIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary={item.file_name}
                      secondary={item.directory || '/'}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
