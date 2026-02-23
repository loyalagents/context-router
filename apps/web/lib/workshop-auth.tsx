"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface WorkshopAuth {
  apiKey: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  login: (apiKey: string, userId: string) => void;
  logout: () => void;
  switchUser: () => void;
}

const WorkshopAuthContext = createContext<WorkshopAuth>({
  apiKey: null,
  userId: null,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
  switchUser: () => {},
});

export function WorkshopAuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setApiKey(localStorage.getItem("workshopApiKey"));
    setUserId(localStorage.getItem("workshopUserId"));
    setLoaded(true);
  }, []);

  const login = (key: string, uid: string) => {
    localStorage.setItem("workshopApiKey", key);
    localStorage.setItem("workshopUserId", uid);
    setApiKey(key);
    setUserId(uid);
  };

  const logout = () => {
    localStorage.removeItem("workshopApiKey");
    localStorage.removeItem("workshopUserId");
    setApiKey(null);
    setUserId(null);
  };

  const switchUser = () => {
    localStorage.removeItem("workshopUserId");
    setUserId(null);
  };

  if (!loaded) return null;

  return (
    <WorkshopAuthContext.Provider
      value={{
        apiKey,
        userId,
        isAuthenticated: !!apiKey && !!userId,
        login,
        logout,
        switchUser,
      }}
    >
      {children}
    </WorkshopAuthContext.Provider>
  );
}

export function useWorkshopAuth() {
  return useContext(WorkshopAuthContext);
}
