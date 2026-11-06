import { useEffect, useState } from "react";
import { api } from "./api";
import { Banner } from "./components/ui";
import { useDirectory } from "./directory";
import { cx } from "./lib";
import { AddNew } from "./pages/AddNew";
import { EntryDetail } from "./pages/EntryDetail";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { Link, useRouter } from "./router";

export function App() {
  const { path } = useRouter();
  const { error: dirError } = useDirectory();
  const [me, setMe] = useState<{ email: string; environment: string } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    api<{ email: string; environment: string }>("/api/me")
      .then(setMe)
      .catch((e) => setAuthError(e.message));
  }, []);

  let page;
  const entry = path.match(/^\/entry\/(\d+)$/);
  const settings = path.match(/^\/settings(?:\/([a-z]+))?$/);
  if (path === "/new") page = <AddNew />;
  else if (entry) page = <EntryDetail id={Number(entry[1])} />;
  else if (settings) page = <Settings tab={settings[1] ?? "reply"} />;
  else page = <Home />;

  const onDashboard = path === "/";

  const nav = (to: string, label: string, active: boolean) => (
    <Link to={to} className={cx("inline-flex min-h-11 items-center rounded-xl px-3.5 font-bold transition", onDashboard ? "text-sm sm:text-[1.18125rem]" : "text-sm", active ? "bg-white text-brand shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white")}>
      {label}
    </Link>
  );

  return (
    <div className="min-h-dvh">
      <header className="pt-safe sticky top-0 z-30 bg-gradient-to-r from-brand to-brand-dark text-white shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-1.5">
          <Link to="/" className={cx("flex min-h-11 items-center gap-2.5 font-extrabold tracking-tight", onDashboard ? "text-lg sm:text-[1.51875rem]" : "text-lg")}>
            <span className="inline-block size-6 rounded-full bg-gold ring-2 ring-white/30" aria-hidden />
            <span className="leading-tight">
              Review Spiffs <span className="hidden font-normal text-white/70 sm:inline">· Sun City</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav("/", "Dashboard", path === "/" || path.startsWith("/entry"))}
            {nav("/settings", "Settings", path.startsWith("/settings"))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 py-4">
        {authError && (
          <div className="mb-4">
            <Banner tone="error">{authError}</Banner>
          </div>
        )}
        {dirError && !authError && (
          <div className="mb-4">
            <Banner tone="error">Couldn’t load the employee directory: {dirError}</Banner>
          </div>
        )}
        {page}
        {me && <p className="mt-8 text-center text-xs text-stone-400 lg:mb-0">Signed in as {me.email}{me.environment !== "production" ? ` · ${me.environment}` : ""}</p>}
      </main>
    </div>
  );
}
