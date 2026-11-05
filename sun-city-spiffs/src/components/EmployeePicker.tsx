import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeName } from "../../shared/names";
import { api, ApiError } from "../api";
import { useDirectory, type DirEmployee } from "../directory";
import { cx, deptClasses } from "../lib";
import { Banner, Button, Field, inputCls, Modal, Spinner, useToast } from "./ui";

export function EmployeeChip({ name, department, amount, onClick, selected, disabled }: { name: string; department: string; amount?: string; onClick?: () => void; selected?: boolean; disabled?: boolean }) {
  const body = (
    <>
      <span className="font-semibold">{name}</span>
      <span className="text-xs opacity-80">{department}</span>
      {amount && <span className="ml-1 rounded-md bg-white/70 px-1.5 text-xs font-bold">{amount}</span>}
    </>
  );
  const cls = cx(
    "inline-flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl px-3 py-1.5 text-left ring-1",
    deptClasses(department),
    selected && "ring-2 ring-brand outline-2 outline-offset-1 outline-brand",
    disabled && "opacity-40",
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

export function AddEmployeeModal({ open, initialName, onClose, onCreated }: { open: boolean; initialName?: string; onClose: () => void; onCreated: (e: DirEmployee) => void }) {
  const { departments, reload } = useDirectory();
  const toast = useToast();
  const [name, setName] = useState("");
  const [dept, setDept] = useState<number | "">("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      setDept("");
      setAliases("");
      setError(null);
    }
  }, [open, initialName]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ employee: DirEmployee }>("/api/employees", {
        method: "POST",
        body: {
          full_name: name.trim(),
          department_id: Number(dept),
          aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
        },
      });
      await reload();
      toast(`Added ${r.employee.full_name}`);
      onCreated(r.employee);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add employee");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add new employee"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || name.trim().length < 2 || dept === ""}>
            {busy && <Spinner />} Add employee
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Full name (as in the company directory)">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
        </Field>
        <Field label="Department">
          <select className={inputCls} value={dept} onChange={(e) => setDept(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">Choose…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.spiff_type === "none" ? "recognition only" : d.spiff_type})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Aliases (optional)" hint="Other spellings, separated by commas. Avoid first-name-only aliases.">
          <input className={inputCls} value={aliases} onChange={(e) => setAliases(e.target.value)} autoComplete="off" />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
      </div>
    </Modal>
  );
}

/** Searchable list of all active employees, grouped by department, with "Add new". */
export function EmployeePicker({ open, title, initialQuery, excludeIds, onClose, onPick }: { open: boolean; title: string; initialQuery?: string; excludeIds: number[]; onClose: () => void; onPick: (e: DirEmployee) => void }) {
  const { employees, departments } = useDirectory();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ(initialQuery ?? "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialQuery]);

  const groups = useMemo(() => {
    const nq = normalizeName(q);
    const list = employees.filter((e) => e.active && (!nq || [e.full_name, ...e.aliases].some((n) => normalizeName(n).includes(nq))));
    return departments
      .map((d) => ({ dept: d, people: list.filter((e) => e.department_id === d.id) }))
      .filter((g) => g.people.length);
  }, [q, employees, departments]);

  return (
    <>
      <Modal open={open && !adding} onClose={onClose} title={title} wide>
        <div className="sticky top-0 z-10 -mx-4 -mt-3 flex gap-2 bg-white px-4 pt-3 pb-2">
          <input ref={inputRef} className={inputCls} placeholder="Search name or alias…" value={q} onChange={(e) => setQ(e.target.value)} type="search" autoComplete="off" />
          <Button variant="gold" onClick={() => setAdding(true)} className="shrink-0">
            + Add new
          </Button>
        </div>
        {groups.length === 0 && (
          <div className="py-8 text-center text-stone-600">
            <p>No one matches “{q}”.</p>
            <Button variant="primary" className="mt-3" onClick={() => setAdding(true)}>
              Add “{q}” as a new employee
            </Button>
          </div>
        )}
        <div className="space-y-4 pb-2">
          {groups.map((g) => (
            <div key={g.dept.id}>
              <h3 className="mb-1.5 text-xs font-bold tracking-wide text-stone-500 uppercase">
                {g.dept.name} · {g.dept.spiff_type === "none" ? "recognition" : g.dept.spiff_type}
              </h3>
              <div className="flex flex-wrap gap-2">
                {g.people.map((e) => (
                  <EmployeeChip key={e.id} name={e.full_name} department={e.department_name} onClick={() => onPick(e)} disabled={excludeIds.includes(e.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
      <AddEmployeeModal
        open={open && adding}
        initialName={q}
        onClose={() => setAdding(false)}
        onCreated={(e) => {
          setAdding(false);
          onPick(e);
        }}
      />
    </>
  );
}
