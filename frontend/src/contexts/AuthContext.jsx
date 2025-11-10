import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check if user is logged in on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (token && storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        setUser(userData);
        
        // Verify token is still valid by calling /auth/me
        api.get('/auth/me')
          .then(response => {
            if (response.data.success) {
              setUser(response.data.data);
              localStorage.setItem('user', JSON.stringify(response.data.data));
            } else {
              logout();
            }
          })
          .catch(() => {
            logout();
          })
          .finally(() => {
            setLoading(false);
          });
      } catch (error) {
        console.error('Error parsing user data:', error);
        logout();
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    try {
      console.log('🔐 Calling login API...');
      const response = await api.post('/auth/login', { email, password });
      
      console.log('📦 Login API response:', response.data);
      
      if (response.data.success) {
        const { user: userData, token } = response.data.data;
        console.log('👤 User data received:', userData);
        console.log('🔑 Token received:', token ? 'Yes' : 'No');
        
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        setUser(userData);
        
        console.log('✅ User state updated and saved to localStorage');
        return { success: true, user: userData };
      }
      
      console.error('❌ Login failed:', response.data.message);
      return { success: false, message: response.data.message };
    } catch (error) {
      console.error('❌ Login API error:', error);
      console.error('❌ Error response:', error.response?.data);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Login failed'
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    window.location.href = '/login';
  };

  const value = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

