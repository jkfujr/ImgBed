import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * 路由守卫组件：
 * 如果未登录则重定向到 /login
 */
const RequireAuth = ({ children }) => {
    const { isAuthenticated, loading } = useAuth();
    
    if (loading) {
        return <div style={{ padding: '2rem', textAlign: 'center' }}>正在验证...</div>;
    }
    
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }
    
    return children;
};

export default RequireAuth;
