import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDate, isValidDate, todayDenver } from "../../shared/dates";
import { normalizeName } from "../../shared/names";
import type { Settings as SettingsT, SpiffType } from "../../shared/schemas";
import { formatCents, pickBucket, wordCount, type LengthBucket } from "../../shared/text";
import { api, ApiError } from "../api";
import { AddEmployeeModal, EmployeeChip } from "../components/EmployeePicker";
import { Banner, Button, Card, Confirm, EmptyState, Field, inputCls, Modal, PageTitle, Spinner, useToast } from "../components/ui";
import { useDirectory, type DirEmployee } from "../directory";
import { cx } from "../lib";
import { useRouter } from "../router";

const TABS = [
  ["reply", "Reply instructions"],
  ["examples", "Examples"],
  ["spiffs", "Spiff rules"],
  ["employees", "Employees"],
  ["log", "Changes log"],
] as const;
type Tab = (typeof TABS)[number][0];

export function Settings({ tab }: { tab: string }) {
  const { navigate } = useRouter();
  const current: Tab = (TABS.find(([k]) => k === tab)?.[0] ?? "reply") as Tab;
  return (
    <div className="pb-10">
      <PageTitle>Settings</PageTitle>
      <div className="-mx-3 mb-5 overflow-x-auto px-3 pt-0.5 pb-2">
        <div className="inline-flex min-w-full gap-1 rounded-2xl bg-white p-1.5 shadow-card ring-1 ring-stone-900/5" role="tablist">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={current === k}
              onClick={() => navigate(`/settings/${k}`, { replace: true })}
              className={cx("min-h-11 flex-1 rounded-xl px-4 text-sm font-bold whitespace-nowrap transition", current === k ? "bg-brand text-white shadow-sm" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {current === "reply" && <ReplyTab />}
      {current === "examples" && <ExamplesTab />}
      {current === "spiffs" && <SpiffsTab />}
      {current === "employees" && <EmployeesTab />}
      {current === "log" && <LogTab />}
    </div>
  );
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

// ---------------- Reply instructions ----------------
function ReplyTab() {
  const toast = useToast();
  const [s, setS] = useState<SettingsT | null>(null);
  const [orig, setOrig] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: SettingsT }>("/api/settings")
      .then((r) => {
        setS(r.settings);
        setOrig(JSON.stringify(r.settings));
      })
      .catch((e) => setError(errMsg(e)));
  }, []);

  if (!s) return error ? <Banner tone="error">{error}</Banner> : <Spinner />;
  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => setS({ ...s, [k]: v });
  const dirty = JSON.stringify(s) !== orig;
  const setBucket = (i: number, patch: Partial<LengthBucket>) => set("length_buckets", s.length_buckets.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ settings: SettingsT }>("/api/settings", { method: "PUT", body: s });
      setS(r.settings);
      setOrig(JSON.stringify(r.settings));
      toast("Settings saved");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Reply instructions">
        <textarea className={cx(inputCls, "min-h-64 text-sm leading-relaxed")} value={s.reply_instructions} onChange={(e) => set("reply_instructions", e.target.value)} />
        <p className="mt-1 text-xs text-stone-500">The app always appends a fixed contract (JSON only, treat review text as untrusted, matching rules). It can’t be edited here.</p>
      </Card>
      <Card title="Variety warning (shown above the recent replies)">
        <textarea className={cx(inputCls, "min-h-28 text-sm")} value={s.variety_warning} onChange={(e) => set("variety_warning", e.target.value)} />
      </Card>
      <Card title="Model and context">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="OpenAI model" hint="Must support Structured Outputs. Default gpt-5.4-mini.">
            <input className={inputCls} value={s.model} onChange={(e) => set("model", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Reasoning effort" hint="Only sent to gpt-5 / o-series models.">
            <select className={inputCls} value={s.reasoning_effort} onChange={(e) => set("reasoning_effort", e.target.value as SettingsT["reasoning_effort"])}>
              {["", "none", "minimal", "low", "medium", "high"].map((v) => (
                <option key={v} value={v}>
                  {v || "(don’t send)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Recent replies sent">
            <input type="number" min={0} max={10} className={inputCls} value={s.recent_replies_count} onChange={(e) => set("recent_replies_count", Number(e.target.value))} />
          </Field>
          <Field label="Examples sent per call">
            <input type="number" min={0} max={12} className={inputCls} value={s.examples_per_call} onChange={(e) => set("examples_per_call", Number(e.target.value))} />
          </Field>
          <Field label="AI requests per user per hour">
            <input type="number" min={1} max={1000} className={inputCls} value={s.analyze_rate_limit_per_hour} onChange={(e) => set("analyze_rate_limit_per_hour", Number(e.target.value))} />
          </Field>
        </div>
      </Card>
      <Card title="Length buckets" actions={<Button size="sm" variant="ghost" onClick={() => set("length_buckets", [...s.length_buckets.slice(0, -1), { max_words: (s.length_buckets.at(-2)?.max_words ?? 0) + 40, label: "" }, s.length_buckets.at(-1)!])}>+ Add bucket</Button>}>
        <p className="mb-3 text-sm text-stone-500">Review word count picks the bucket; its label tells the model how long the reply should be. The last bucket catches everything longer.</p>
        <ul className="space-y-3">
          {s.length_buckets.map((b, i) => {
            const last = i === s.length_buckets.length - 1;
            return (
              <li key={i} className="grid grid-cols-[7rem_1fr_auto] items-end gap-2">
                <Field label={last ? "Over" : "Up to (words)"}>
                  {last ? (
                    <input className={inputCls} disabled value={`${s.length_buckets[i - 1]?.max_words ?? 0}`} />
                  ) : (
                    <input type="number" min={1} className={inputCls} value={b.max_words ?? ""} onChange={(e) => setBucket(i, { max_words: Number(e.target.value) })} />
                  )}
                </Field>
                <Field label="Reply target">
                  <input className={inputCls} value={b.label} onChange={(e) => setBucket(i, { label: e.target.value })} />
                </Field>
                <Button size="sm" variant="ghost" disabled={last || s.length_buckets.length <= 1} onClick={() => set("length_buckets", s.length_buckets.filter((_, j) => j !== i))} aria-label="Remove bucket">
                  ✕
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="sticky bottom-3">
        <Button variant="primary" size="lg" className="w-full" disabled={!dirty || busy} onClick={save}>
          {busy && <Spinner />} {dirty ? "Save settings" : "Saved"}
        </Button>
      </div>
    </div>
  );
}

// ---------------- Examples ----------------
interface Example {
  id: number;
  customer_name: string | null;
  review_text: string;
  reply_text: string;
  word_count: number;
  active: boolean;
}

function ExamplesTab() {
  const toast = useToast();
  const [list, setList] = useState<Example[] | null>(null);
  const [buckets, setBuckets] = useState<LengthBucket[]>([]);
  const [edit, setEdit] = useState<Partial<Example> | null>(null);
  const [del, setDel] = useState<Example | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ examples: Example[] }>("/api/examples").then((r) => setList(r.examples)).catch((e) => setError(errMsg(e)));
    api<{ settings: SettingsT }>("/api/settings").then((r) => setBuckets(r.settings.length_buckets)).catch(() => {});
  }, []);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const body = { customer_name: edit.customer_name ?? null, review_text: edit.review_text ?? "", reply_text: edit.reply_text ?? "", active: edit.active ?? true };
    try {
      const r = edit.id ? await api<{ examples: Example[] }>(`/api/examples/${edit.id}`, { method: "PUT", body }) : await api<{ examples: Example[] }>("/api/examples", { method: "POST", body });
      setList(r.examples);
      setEdit(null);
      toast("Example saved");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (ex: Example) => {
    try {
      const r = await api<{ examples: Example[] }>(`/api/examples/${ex.id}`, { method: "PUT", body: { customer_name: ex.customer_name, review_text: ex.review_text, reply_text: ex.reply_text, active: !ex.active } });
      setList(r.examples);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const remove = async () => {
    if (!del) return;
    setBusy(true);
    try {
      const r = await api<{ examples: Example[] }>(`/api/examples/${del.id}`, { method: "DELETE" });
      setList(r.examples);
      setDel(null);
      toast("Example deleted");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const bucketLabel = (wc: number) => (buckets.length ? pickBucket(buckets, wc).bucket.label : "");

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEdit({ active: true })}>
          + Add example
        </Button>
      </div>
      {!list && !error && <Spinner />}
      {error && !edit && <Banner tone="error">{error}</Banner>}
      {list?.length === 0 && <EmptyState title="No examples yet" />}
      {list?.map((ex) => (
        <Card
          key={ex.id}
          className={cx(!ex.active && "opacity-60")}
          title={
            <span>
              {ex.customer_name ?? "Example"} <span className="text-sm font-medium text-white/75">· {ex.word_count} words · {bucketLabel(ex.word_count)}</span>
            </span>
          }
          actions={
            <>
              <Button size="sm" onClick={() => toggle(ex)}>
                {ex.active ? "Deactivate" : "Activate"}
              </Button>
              <Button size="sm" onClick={() => setEdit(ex)}>
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDel(ex)}>
                Delete
              </Button>
            </>
          }
        >
          <p className="line-clamp-3 text-sm whitespace-pre-wrap text-stone-700">{ex.review_text}</p>
          <p className="mt-2 line-clamp-3 rounded-lg bg-brand-light p-2 text-sm whitespace-pre-wrap text-stone-800">
            {ex.reply_text} <span className="text-xs text-stone-500">({wordCount(ex.reply_text)} words)</span>
          </p>
        </Card>
      ))}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit example" : "Add example"}
        wide
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy || !edit?.review_text?.trim() || !edit?.reply_text?.trim()}>
              {busy && <Spinner />} Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label="Customer name (optional)">
              <input className={inputCls} value={edit.customer_name ?? ""} onChange={(e) => setEdit({ ...edit, customer_name: e.target.value })} />
            </Field>
            <Field label={`Review (${wordCount(edit.review_text ?? "")} words)`}>
              <textarea className={cx(inputCls, "min-h-36")} value={edit.review_text ?? ""} onChange={(e) => setEdit({ ...edit, review_text: e.target.value })} />
            </Field>
            <Field label={`Reply (${wordCount(edit.reply_text ?? "")} words)`}>
              <textarea className={cx(inputCls, "min-h-32")} value={edit.reply_text ?? ""} onChange={(e) => setEdit({ ...edit, reply_text: e.target.value })} />
            </Field>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active (used as an example)
            </label>
            {error && <Banner tone="error">{error}</Banner>}
          </div>
        )}
      </Modal>
      <Confirm open={!!del} title="Delete this example?" message="It will no longer be sent to the AI. The change log keeps a copy." confirmLabel="Delete" danger busy={busy} onConfirm={remove} onClose={() => setDel(null)} />
    </div>
  );
}

// ---------------- Spiff rules + departments ----------------
interface Rule {
  id: number;
  spiff_type: "install" | "service";
  solo_amount_cents: number;
  shared_amount_cents: number;
  effective_from: string;
  created_by: string;
}
interface RulesResp {
  rules: Rule[];
  current: { install: Rule | null; service: Rule | null };
  today: string;
}

const toCents = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};

function SpiffsTab() {
  const toast = useToast();
  const { departments, reload } = useDirectory();
  const [data, setData] = useState<RulesResp | null>(null);
  const [form, setForm] = useState({ spiff_type: "service" as "install" | "service", solo: "", shared: "", effective_from: todayDenver() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RulesResp>("/api/spiff-rules").then(setData).catch((e) => setError(errMsg(e)));
  }, []);

  const solo = toCents(form.solo);
  const shared = toCents(form.shared);
  const valid = !Number.isNaN(solo) && !Number.isNaN(shared) && form.solo !== "" && form.shared !== "" && isValidDate(form.effective_from);

  const addRate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<RulesResp>("/api/spiff-rules", { method: "POST", body: { spiff_type: form.spiff_type, solo_amount_cents: solo, shared_amount_cents: shared, effective_from: form.effective_from } });
      setData(r);
      setForm({ ...form, solo: "", shared: "" });
      toast("New rate added");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const setDeptType = async (id: number, spiff_type: SpiffType) => {
    try {
      await api(`/api/departments/${id}`, { method: "PUT", body: { spiff_type } });
      await reload();
      toast("Department updated. Saved entries keep their amounts.");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {(["install", "service"] as const).map((t) => {
          const c = data?.current[t];
          return (
            <Card key={t} title={`${t === "install" ? "Install" : "Service"} rate today`}>
              {c ? (
                <>
                  <p className="text-2xl font-extrabold text-brand">
                    {formatCents(c.solo_amount_cents)} <span className="text-base font-normal text-stone-500">solo</span> · {formatCents(c.shared_amount_cents)}{" "}
                    <span className="text-base font-normal text-stone-500">each when shared</span>
                  </p>
                  <p className="text-sm text-stone-500">since {formatDate(c.effective_from)}</p>
                </>
              ) : (
                <p className="text-stone-500">{data ? "No rate in effect" : "Loading…"}</p>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Add new rate effective from…">
        <p className="mb-3 text-sm text-stone-500">Rates are never overwritten. A review uses the latest rate whose start date is on or before its posted date. “Shared” applies when more than one install/service employee is on the review (managers don’t count).</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Type">
            <select className={inputCls} value={form.spiff_type} onChange={(e) => setForm({ ...form, spiff_type: e.target.value as "install" | "service" })}>
              <option value="service">Service</option>
              <option value="install">Install</option>
            </select>
          </Field>
          <Field label="Solo amount ($)">
            <input className={inputCls} inputMode="decimal" placeholder="30.00" value={form.solo} onChange={(e) => setForm({ ...form, solo: e.target.value })} />
          </Field>
          <Field label="Shared amount each ($)">
            <input className={inputCls} inputMode="decimal" placeholder="15.00" value={form.shared} onChange={(e) => setForm({ ...form, shared: e.target.value })} />
          </Field>
          <Field label="Effective from">
            <input type="date" className={inputCls} value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
          </Field>
        </div>
        {error && (
          <div className="mt-3">
            <Banner tone="error">{error}</Banner>
          </div>
        )}
        <Button variant="primary" className="mt-3" disabled={!valid || busy} onClick={addRate}>
          {busy && <Spinner />} Add rate
        </Button>
      </Card>

      <Card title="Rate history">
        {!data ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-white">
                <tr>
                  <th className="rounded-l-xl bg-stone-800 px-3 py-2 font-bold">Type</th>
                  <th className="bg-stone-800 px-3 py-2 font-bold">From</th>
                  <th className="bg-stone-800 px-3 py-2 font-bold">Solo</th>
                  <th className="bg-stone-800 px-3 py-2 font-bold">Shared</th>
                  <th className="rounded-r-xl bg-stone-800 px-3 py-2 font-bold">Added by</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id} className={cx("even:bg-stone-50", r.effective_from > data.today && "text-sky-800")}>
                    <td className="rounded-l-xl px-3 py-2.5 font-semibold capitalize">{r.spiff_type}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {formatDate(r.effective_from)}
                      {r.effective_from > data.today && " (future)"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{formatCents(r.solo_amount_cents)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{formatCents(r.shared_amount_cents)}</td>
                    <td className="rounded-r-xl px-3 py-2.5 break-all text-stone-500">{r.created_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Departments">
        <ul className="divide-y divide-stone-100">
          {departments.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-bold">{d.name}</span>
              <select className={cx(inputCls, "w-auto!")} value={d.spiff_type} onChange={(e) => setDeptType(d.id, e.target.value as SpiffType)}>
                <option value="install">Install</option>
                <option value="service">Service</option>
                <option value="none">None (recognition only)</option>
              </select>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------- Employees ----------------
function EmployeesTab() {
  const { employees, departments, reload } = useDirectory();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<{ emp: DirEmployee; name: string; dept: number; aliases: string; active: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => {
    const nq = normalizeName(q);
    return employees.filter((e) => (showInactive || e.active) && (!nq || [e.full_name, ...e.aliases, e.department_name].some((n) => normalizeName(n).includes(nq))));
  }, [employees, q, showInactive]);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/employees/${edit.emp.id}`, {
        method: "PUT",
        body: { full_name: edit.name.trim(), department_id: edit.dept, active: edit.active, aliases: edit.aliases.split(",").map((a) => a.trim()).filter(Boolean) },
      });
      await reload();
      setEdit(null);
      toast("Employee saved");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input type="search" className={cx(inputCls, "flex-1")} placeholder="Search name, alias or department…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="primary" onClick={() => setAdding(true)}>
          + Add employee
        </Button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show deactivated
      </label>
      <Card>
        <ul className="divide-y divide-stone-100">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className={cx("min-w-0", !e.active && "opacity-50")}>
                <EmployeeChip name={e.full_name} department={e.department_name} />
                {e.aliases.length > 0 && <p className="mt-1 text-xs text-stone-500">aka {e.aliases.join(", ")}</p>}
                {!e.active && <p className="text-xs font-semibold text-stone-600">Deactivated</p>}
              </div>
              <Button size="sm" onClick={() => setEdit({ emp: e, name: e.full_name, dept: e.department_id, aliases: e.aliases.join(", "), active: e.active })}>
                Edit
              </Button>
            </li>
          ))}
          {list.length === 0 && <li className="py-6 text-center text-stone-500">No one matches.</li>}
        </ul>
      </Card>

      <AddEmployeeModal open={adding} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Edit employee"
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy || !edit?.name.trim()}>
              {busy && <Spinner />} Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label="Full name">
              <input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Department">
              <select className={inputCls} value={edit.dept} onChange={(e) => setEdit({ ...edit, dept: Number(e.target.value) })}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Aliases" hint="Comma separated. Old spellings and nicknames with last names.">
              <input className={inputCls} value={edit.aliases} onChange={(e) => setEdit({ ...edit, aliases: e.target.value })} />
            </Field>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
            </label>
            <p className="text-xs text-stone-500">Employees are never deleted, only deactivated, so past spiffs stay intact.</p>
            {error && <Banner tone="error">{error}</Banner>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------- Change log ----------------
interface LogEntry {
  id: number;
  at: string;
  user_email: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  summary: string;
}

function short(v: string | null) {
  if (v === null) return "—";
  return v.length > 160 ? `${v.slice(0, 160)}…` : v;
}

function LogTab() {
  const [filters, setFilters] = useState({ user: "", entity_type: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ entries: LogEntry[]; total: number; page_size: number; users: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<LogEntry | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    api<typeof data>(`/api/changelog?${p}`)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)));
  }, [filters, page]);
  useEffect(load, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const setF = (k: keyof typeof filters, v: string) => {
    setPage(1);
    setFilters({ ...filters, [k]: v });
  };

  return (
    <div className="space-y-3">
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="User">
            <select className={inputCls} value={filters.user} onChange={(e) => setF("user", e.target.value)}>
              <option value="">Everyone</option>
              {data?.users.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </Field>
          <Field label="What">
            <select className={inputCls} value={filters.entity_type} onChange={(e) => setF("entity_type", e.target.value)}>
              <option value="">Everything</option>
              {["review", "review_mention", "employee", "employee_alias", "department", "spiff_rule", "setting", "reply_example"].map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="date" className={inputCls} value={filters.from} onChange={(e) => setF("from", e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className={inputCls} value={filters.to} onChange={(e) => setF("to", e.target.value)} />
          </Field>
        </div>
      </Card>
      {error && <Banner tone="error">{error}</Banner>}
      {!data && !error && <Spinner />}
      {data?.entries.length === 0 && <EmptyState title="No changes match" />}
      <ul className="space-y-2">
        {data?.entries.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => setOpen(e)} className="w-full rounded-xl bg-white p-3.5 text-left shadow-card ring-1 ring-stone-900/5 transition hover:ring-brand/40">
              <p className="font-bold">{e.summary}</p>
              <p className="text-sm text-stone-500">
                {new Date(e.at).toLocaleString()} · {e.user_email} · {e.action} {e.entity_type.replace("_", " ")}
                {e.entity_id ? ` #${e.entity_id}` : ""}
              </p>
              {e.field && (e.old_value !== null || e.new_value !== null) && (
                <p className="mt-1 text-xs break-words text-stone-600">
                  <span className="line-through decoration-red-400">{short(e.old_value)}</span> → <span className="text-emerald-800">{short(e.new_value)}</span>
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
      {data && pages > 1 && (
        <div className="flex items-center justify-between">
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹ Newer
          </Button>
          <span className="text-sm text-stone-500">
            Page {page} of {pages}
          </span>
          <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Older ›
          </Button>
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title="Change details" wide>
        {open && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{open.summary}</p>
            <p className="text-stone-500">
              {new Date(open.at).toLocaleString()} · {open.user_email}
            </p>
            <div>
              <p className="mb-1 font-semibold">Old value</p>
              <pre className="max-h-60 overflow-auto rounded-lg bg-stone-100 p-2 text-xs whitespace-pre-wrap">{open.old_value ?? "—"}</pre>
            </div>
            <div>
              <p className="mb-1 font-semibold">New value</p>
              <pre className="max-h-60 overflow-auto rounded-lg bg-stone-100 p-2 text-xs whitespace-pre-wrap">{open.new_value ?? "—"}</pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
