import { createContext, useContext, useState, useCallback } from 'react';

const RefreshContext = createContext();

export function RefreshProvider({ children }) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [listeners, setListeners] = useState([]);

  const triggerRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    listeners.forEach(callback => callback());
  }, [listeners]);

  const subscribe = useCallback((callback) => {
    setListeners(prev => [...prev, callback]);
    return () => {
      setListeners(prev => prev.filter(cb => cb !== callback));
    };
  }, []);

  return (
    <RefreshContext.Provider value={{ refreshTrigger, triggerRefresh, subscribe }}>
      {children}
    </RefreshContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRefresh() {
  return useContext(RefreshContext);
}
