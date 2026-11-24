import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@pmd/shared";
import { ApiError, api } from "./api";

interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  /** The server could not be reached when the app opened (no signal), so we don't know yet who is signed in. */
  offline: boolean;
  retry: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const [offline, setOffline] = useState(false);
  const check = () => {
    api.get<{ user: SessionUser | null }>("/auth/me")
      .then((r) => { setOffline(false); setUser(r.user); })
      .catch((e) => { setUser(null); setOffline(!(e instanceof ApiError)); })
      .finally(() => setLoading(false));
  };
  useEffect(check, []);
  useEffect(() => {
    if (!offline) return;
    window.addEventListener("online", check);
    return () => window.removeEventListener("online", check);
  }, [offline]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (email: string, password: string) => {
    const r = await api.post<{ user: SessionUser }>("/auth/login", { email, password });
    qc.clear();
    setUser(r.user);
  };
  const logout = async () => {
    await api.post("/auth/logout");
    qc.clear();
    setUser(null);
  };
  return <Ctx.Provider value={{ user, loading, offline, retry: check, login, logout }}>{children}</Ctx.Provider>;
}
