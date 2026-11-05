import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface RouteCtx {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const Ctx = createContext<RouteCtx | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: location.pathname, search: location.search });
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
    setLoc({ path: location.pathname, search: location.search });
    window.scrollTo(0, 0);
  }, []);
  return <Ctx.Provider value={{ path: loc.path, query: new URLSearchParams(loc.search), navigate }}>{children}</Ctx.Provider>;
}

export function useRouter(): RouteCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("RouterProvider missing");
  return c;
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
