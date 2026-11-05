import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEPARTMENT_ICONS,
  DepartmentIcon,
  FallbackDepartmentIcon,
  getDepartmentIcon,
  HVACConstructionIcon,
  HVACInstallIcon,
  HVACServiceIcon,
  ManagersIcon,
  OfficeIcon,
  PlumbingInstallIcon,
  PlumbingServiceIcon,
  ShopIcon,
} from "../src/components/DepartmentIcons";

const EXPECTED = [
  ["Managers", ManagersIcon],
  ["Shop", ShopIcon],
  ["HVAC Service", HVACServiceIcon],
  ["HVAC Install", HVACInstallIcon],
  ["HVAC New Construction", HVACConstructionIcon],
  ["Plumbing Service", PlumbingServiceIcon],
  ["Plumbing Install", PlumbingInstallIcon],
  ["Office", OfficeIcon],
] as const;

describe("department icon mapping", () => {
  it.each(EXPECTED)("%s gets its own icon", (name, Icon) => expect(getDepartmentIcon(name)).toBe(Icon));

  it("all eight departments have distinct icons, none of them the fallback", () => {
    const icons = EXPECTED.map(([n]) => getDepartmentIcon(n));
    expect(new Set(icons).size).toBe(8);
    expect(icons).not.toContain(FallbackDepartmentIcon);
    expect(Object.keys(DEPARTMENT_ICONS)).toHaveLength(8);
  });

  it("tolerates case and spacing differences", () => {
    expect(getDepartmentIcon("  hvac   new construction ")).toBe(HVACConstructionIcon);
  });

  it.each(["Electrical", "", "Plumbing"])("unknown department %j gets the safe fallback", (name) => {
    expect(getDepartmentIcon(name)).toBe(FallbackDepartmentIcon);
  });
});

describe("department icon rendering", () => {
  const render = (department: string) => renderToStaticMarkup(createElement(DepartmentIcon, { department, className: "size-6" }));

  it.each([...EXPECTED.map(([n]) => n), "Unknown Dept"])("%s renders a 24×24 decorative SVG with no external resources", (name) => {
    const html = render(name);
    expect(html).toMatch(/^<svg[^>]*viewBox="0 0 24 24"/);
    expect(html).toContain('class="size-6"');
    expect(html).toContain('aria-hidden="true"');
    expect(html.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/<image|href=|https?:/i);
  });

  it("each department renders different artwork", () => {
    const strip = (h: string) => h.replace(/id="[^"]*"|url\(#[^)]*\)/g, "");
    expect(new Set(EXPECTED.map(([n]) => strip(render(n)))).size).toBe(8);
  });

  it("mask ids are unique when the same icon appears twice", () => {
    const html = renderToStaticMarkup(createElement("div", null, createElement(ShopIcon), createElement(ShopIcon)));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("title prop makes the icon an accessible image", () => {
    const html = renderToStaticMarkup(createElement(OfficeIcon, { title: "Office" }));
    expect(html).toContain('role="img"');
    expect(html).toContain("<title>Office</title>");
  });
});
