import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthDocs, api } from '../api';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // 验证登录令牌
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
        // 调用登录接口
        const res = await AuthDocs.login(credentials);
        if (res.code !== 0) {
            throw new Error(res.message);
        }
        
        const token = res.data?.token;
        if (token) {
            localStorage.setItem('token', token);
            // 立即附加上全局请求头
            api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            await checkLoginState();
        }
    };

    const logout = async () => {
         try {
            await AuthDocs.logout();
         } catch {
            // 忽略登出请求失败
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
