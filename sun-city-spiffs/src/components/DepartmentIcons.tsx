// Department icons for the dashboard tiles. One hand-built 24×24 SVG per department, inline so
// there is nothing extra to load. Each icon carries its own department color; the main shapes use
// `currentColor` (defaulted via `style.color`), so a parent can still recolor them if ever needed.
import { useId, type ComponentType, type CSSProperties, type ReactNode } from "react";

export interface DeptIconProps {
  className?: string;
  /** Accessible label. Omit for decorative use (the tile already shows the department name). */
  title?: string;
}

const COLORS = {
  gold: "#C99A1E",
  goldDark: "#9A7210",
  ruby: "#B4233C",
  sapphire: "#2B6CB0",
  warehouse: "#6B7280",
  hvacLight: "#E5605F",
  hvacDeep: "#9B1C1C",
  construction: "#E07B1A",
  plumbingLight: "#3A9AD9",
  heater: "#5B6B7C",
  office: "#6B7280",
  maroon: "#7A1F35",
  fallback: "#78716C",
} as const;

/** Mask / clip ids must be unique per instance and safe inside url(#…). */
function useSvgId(prefix: string) {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function Svg({ className, title, color, children }: DeptIconProps & { color: string; children: ReactNode }) {
  const style: CSSProperties = { color };
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} focusable="false">
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

// Small shared wrench shape (open-end + ring), drawn as a stroke in its own local space.
// Used by Plumbing Service/Install and HVAC Service/Install so they share one recognizable glyph.
const WRENCH_D = "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";

// ---------- Managers: gold crown with jewels ----------
export function ManagersIcon(props: DeptIconProps) {
  return (
    <Svg {...props} color={COLORS.gold}>
      <path d="M3.2 8.6 7.6 12.4 12 5.6l4.4 6.8 4.4-3.8-1.6 8.4H4.8z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="4.4" y="17.2" width="15.2" height="3.6" rx="1.2" fill={COLORS.goldDark} />
      <circle cx="3.2" cy="8.2" r="1.6" fill="currentColor" />
      <circle cx="12" cy="4.8" r="1.7" fill="currentColor" />
      <circle cx="20.8" cy="8.2" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.25" fill={COLORS.ruby} />
      <circle cx="7.9" cy="19" r="0.95" fill={COLORS.sapphire} />
      <circle cx="16.1" cy="19" r="0.95" fill={COLORS.sapphire} />
      <path d="M12 10.6l1.3 1.9-1.3 1.9-1.3-1.9z" fill={COLORS.ruby} />
    </Svg>
  );
}

// ---------- Shop: gray warehouse with roll-up loading door ----------
export function ShopIcon(props: DeptIconProps) {
  const m = useSvgId("shop");
  return (
    <Svg {...props} color={COLORS.warehouse}>
      <mask id={m}>
        <rect width="24" height="24" fill="#fff" />
        <rect x="7" y="12" width="10" height="9.5" rx="0.6" fill="#000" />
      </mask>
      <path d="M2.5 9.6 11.2 4.2a1.5 1.5 0 0 1 1.6 0l8.7 5.4V20a1.5 1.5 0 0 1-1.5 1.5h-16A1.5 1.5 0 0 1 2.5 20z" fill="currentColor" mask={`url(#${m})`} />
      <path d="M8.2 14.2h7.6M8.2 16.6h7.6M8.2 19h7.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="10" y="7.6" width="4" height="1.8" rx="0.6" fill="#fff" opacity="0.85" />
    </Svg>
  );
}

// ---------- HVAC Service: light-red snowflake + small wrench ----------
export function HVACServiceIcon(props: DeptIconProps) {
  const m = useSvgId("hvacsvc");
  const wrench = "translate(12.4 12.4) scale(0.48)";
  return (
    <Svg {...props} color={COLORS.hvacLight}>
      <mask id={m}>
        <rect width="24" height="24" fill="#fff" />
        <path d={WRENCH_D} transform={wrench} fill="#000" stroke="#000" strokeWidth="7" strokeLinejoin="round" />
      </mask>
      <g mask={`url(#${m})`} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M11 2v18M3.2 6.5l15.6 9M3.2 15.5l15.6-9" />
        <path d="M8.4 3.6 11 5.6l2.6-2M8.4 18.4l2.6-2 2.6 2M3.6 9.9l3.1-.9-.6-3.2M15.9 6l-.6 3.2 3.1.9M3.6 12.1l3.1.9-.6 3.2M18.4 12.1l-3.1.9.6 3.2" />
      </g>
      <path d={WRENCH_D} transform={wrench} fill={COLORS.hvacDeep} stroke={COLORS.hvacDeep} strokeWidth="2.5" strokeLinejoin="round" />
    </Svg>
  );
}

// ---------- HVAC Install: deep-red house (with chimney) + white wrench ----------
export function HVACInstallIcon(props: DeptIconProps) {
  return (
    <Svg {...props} color={COLORS.hvacDeep}>
      <rect x="15.4" y="3.6" width="2.8" height="5" rx="0.6" fill="currentColor" />
      <path d="M2.6 11.4 11 3.9a1.5 1.5 0 0 1 2 0l8.4 7.5H19.6V20a1.5 1.5 0 0 1-1.5 1.5H5.9A1.5 1.5 0 0 1 4.4 20v-8.6z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d={WRENCH_D} transform="translate(6.6 9.8) scale(0.46)" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ---------- HVAC New Construction: orange house + plus sign ----------
export function HVACConstructionIcon(props: DeptIconProps) {
  return (
    <Svg {...props} color={COLORS.construction}>
      <path d="M2.6 11.4 11 3.9a1.5 1.5 0 0 1 2 0l8.4 7.5H19.6V20a1.5 1.5 0 0 1-1.5 1.5H5.9A1.5 1.5 0 0 1 4.4 20v-8.6z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M12 11.2v7.2M8.4 14.8h7.2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </Svg>
  );
}

// ---------- Plumbing Service: light-blue wrench ----------
export function PlumbingServiceIcon(props: DeptIconProps) {
  return (
    <Svg {...props} color={COLORS.plumbingLight}>
      <path d={WRENCH_D} fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </Svg>
  );
}

// ---------- Plumbing Install: elbowed pipe run + small light-blue wrench ----------
export function PlumbingInstallIcon(props: DeptIconProps) {
  return (
    <Svg {...props} color={COLORS.heater}>
      <g fill="currentColor">
        <path d="M3.6 5.4h14.2v14.4" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
        <rect x="14.9" y="2.5" width="5.8" height="5.8" rx="1.4" />
        <rect x="8.3" y="2.7" width="3.4" height="5.4" rx="0.8" />
        <rect x="1.6" y="2.3" width="2.4" height="6.2" rx="0.8" />
        <rect x="14.7" y="19.4" width="6.2" height="2.4" rx="0.8" />
        <rect x="15.1" y="11.4" width="5.4" height="3.4" rx="0.8" />
      </g>
      <path d={WRENCH_D} transform="translate(1.6 9.6) scale(0.52)" fill={COLORS.plumbingLight} stroke={COLORS.plumbingLight} strokeWidth="2.6" strokeLinejoin="round" />
    </Svg>
  );
}

// ---------- Office: gray clipboard with maroon accents ----------
export function OfficeIcon(props: DeptIconProps) {
  return (
    <Svg {...props} color={COLORS.office}>
      <rect x="4.2" y="3.8" width="15.6" height="18.4" rx="2.2" fill="currentColor" />
      <rect x="6.4" y="6.6" width="11.2" height="13.4" rx="1" fill="#fff" />
      <rect x="8.4" y="2" width="7.2" height="4.4" rx="1.4" fill={COLORS.maroon} />
      <circle cx="12" cy="3.6" r="0.8" fill="#fff" />
      <path d="m8.2 10.4 1 1 1.6-1.8" stroke={COLORS.maroon} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="m8.2 14.4 1 1 1.6-1.8" stroke={COLORS.maroon} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M12.6 10.6h3.2M12.6 14.6h3.2M8.4 17.9h7.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </Svg>
  );
}

// ---------- Fallback for departments added later ----------
export function FallbackDepartmentIcon(props: DeptIconProps) {
  return (
    <Svg {...props} color={COLORS.fallback}>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
      <circle cx="8" cy="12" r="1.6" fill="#fff" />
      <circle cx="12" cy="12" r="1.6" fill="#fff" />
      <circle cx="16" cy="12" r="1.6" fill="#fff" />
    </Svg>
  );
}

/** Explicit department → icon mapping. Keys are the department names from the directory. */
export const DEPARTMENT_ICONS: Readonly<Record<string, ComponentType<DeptIconProps>>> = {
  Managers: ManagersIcon,
  Shop: ShopIcon,
  "HVAC Service": HVACServiceIcon,
  "HVAC Install": HVACInstallIcon,
  "HVAC New Construction": HVACConstructionIcon,
  "Plumbing Service": PlumbingServiceIcon,
  "Plumbing Install": PlumbingInstallIcon,
  Office: OfficeIcon,
};

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const BY_NORMALIZED = new Map(Object.entries(DEPARTMENT_ICONS).map(([k, v]) => [normalize(k), v]));

/** Icon for a department name (case/spacing-insensitive); unknown names get the fallback. */
export function getDepartmentIcon(department: string): ComponentType<DeptIconProps> {
  return BY_NORMALIZED.get(normalize(department)) ?? FallbackDepartmentIcon;
}

export function DepartmentIcon({ department, ...props }: DeptIconProps & { department: string }) {
  const Icon = getDepartmentIcon(department);
  return <Icon {...props} />;
}
