import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { EmployeeLite, SpiffType } from "../shared/schemas";
import { api } from "./api";

export interface DirEmployee extends EmployeeLite {
  aliases: string[];
}
export interface Department {
  id: number;
  name: string;
  spiff_type: SpiffType;
  sort_order: number;
}

interface DirCtx {
  employees: DirEmployee[];
  departments: Department[];
  loaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
  byId: (id: number) => DirEmployee | undefined;
}

const Ctx = createContext<DirCtx | null>(null);

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const [employees, setEmployees] = useState<DirEmployee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([
        api<{ employees: DirEmployee[] }>("/api/employees?include_inactive=1"),
        api<{ departments: Department[] }>("/api/departments"),
      ]);
      setEmployees(e.employees);
      setDepartments(d.departments);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the directory");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byId = useCallback((id: number) => employees.find((e) => e.id === id), [employees]);
  return <Ctx.Provider value={{ employees, departments, loaded, error, reload, byId }}>{children}</Ctx.Provider>;
}

export function useDirectory(): DirCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("DirectoryProvider missing");
  return c;
}
