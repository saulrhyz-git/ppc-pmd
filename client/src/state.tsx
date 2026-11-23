import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PropertyResult } from "@pmd/shared";
import { api, type DashboardResponse, type Meta } from "./api";

interface FilterCtx {
  building: string; // "All" or a building name
  setBuilding: (b: string) => void;
}
const Ctx = createContext<FilterCtx>({ building: "All", setBuilding: () => {} });
export const useFilter = () => useContext(Ctx);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [building, setBuilding] = useState(() => sessionStorage.getItem("pmd.building") || "All");
  return (
    <Ctx.Provider value={{ building, setBuilding: (b) => { sessionStorage.setItem("pmd.building", b); setBuilding(b); } }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDashboard() {
  const { building } = useFilter();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardResponse>("/dashboard") });
  const visible: PropertyResult[] = q.data ? q.data.properties.filter((p) => building === "All" || p.name === building) : [];
  return { ...q, visible };
}

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/meta") });
}
