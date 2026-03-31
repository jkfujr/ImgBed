import React, { useState, useEffect } from 'react';
import { AuthDocs, api } from '../api';
import { AuthContext } from '../hooks/useAuth';

/**
 * 身份验证提供者组件：
 * 仅导出此组件以满足 Fast Refresh 规则
 */
export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkLoginState = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
             setIsAuthenticated(false);
             setUser(null);
             setLoading(false);
             return;
        }

        try {
             const res = await AuthDocs.me();
             if (res.code === 0) {
                 setIsAuthenticated(true);
                 setUser(res.data);
             } else {
                 throw new Error('User not admin');
             }
        } catch {
             localStorage.removeItem('token');
             setIsAuthenticated(false);
             setUser(null);
        } finally {
             setLoading(false);
        }
    };

    useEffect(() => {
        checkLoginState();
    }, []);

    const login = async (credentials) => {
        const res = await AuthDocs.login(credentials);
        if (res.code !== 0) {
            throw new Error(res.message);
        }
        
        const token = res.data?.token;
        if (token) {
            localStorage.setItem('token', token);
            api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            await checkLoginState();
        }
    };

    const logout = async () => {
         try {
            await AuthDocs.logout();
         } catch {
            // 忽略失败
         }
         
         localStorage.removeItem('token');
         delete api.defaults.headers.common['Authorization'];
         setIsAuthenticated(false);
         setUser(null);
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, user, loading, login, logout }}>
             {children}
        </AuthContext.Provider>
    );
};
