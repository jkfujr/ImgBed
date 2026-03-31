import { createContext, useContext } from 'react';

/**
 * 身份验证 Context 对象
 */
export const AuthContext = createContext(null);

/**
 * 访问身份验证状态的 Hook
 */
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
