import { describe, expect, it } from "vitest";
import { countByDepartment, departmentBars, departmentsOfReview, donutSlices, groupOfDepartment, topEmployees } from "../shared/dashboard";

const m = (department_name_snapshot: string) => ({ department_name_snapshot });

describe("groupOfDepartment (icon choice)", () => {
  it.each([
    ["Plumbing Service", "plumbing"],
    ["HVAC New Construction", "hvac"],
    ["Shop", "install"],
    ["Managers", "other"],
  ])("%s -> %s", (dept, group) => expect(groupOfDepartment(dept)).toBe(group));
});

describe("countByDepartment", () => {
  const reviews = [
    { mentions: [m("Plumbing Service"), m("Plumbing Service")] },
    { mentions: [m("HVAC Service")] },
    { mentions: [m("HVAC Install"), m("Plumbing Service")] },
    { mentions: [] },
  ];
  it("counts reviews, not mentions; a review counts once per department", () => {
    expect(countByDepartment(reviews, ["Plumbing Service", "HVAC Service"])).toEqual([
      { name: "Plumbing Service", count: 2 },
      { name: "HVAC Service", count: 1 },
      { name: "HVAC Install", count: 1 },
    ]);
  });
  it("keeps directory order and shows empty departments", () => {
    expect(countByDepartment([], ["B", "A"])).toEqual([{ name: "B", count: 0 }, { name: "A", count: 0 }]);
  });
  it("departmentsOfReview is distinct, in mention order", () => {
    expect(departmentsOfReview([m("X"), m("Y"), m("X")])).toEqual(["X", "Y"]);
  });
});

describe("departmentBars (progress gallery)", () => {
  it("hides departments with zero reviews, sorts busiest first, and scales to the busiest", () => {
    const items = [
      { name: "Managers", count: 0 },
      { name: "Shop", count: 1 },
      { name: "HVAC Service", count: 9 },
      { name: "HVAC Install", count: 2 },
      { name: "Plumbing Service", count: 4 },
      { name: "Office", count: 0 },
    ];
    expect(departmentBars(items)).toEqual([
      { name: "HVAC Service", count: 9, pct: 100 },
      { name: "Plumbing Service", count: 4, pct: 44.4 },
      { name: "HVAC Install", count: 2, pct: 22.2 },
      { name: "Shop", count: 1, pct: 11.1 },
    ]);
  });
  it("shows only the departments that have reviews", () => {
    const items = ["HVAC Service", "Plumbing Service", "HVAC Install", "Plumbing Install", "Managers", "Shop", "Office", "HVAC New Construction"].map((name) => ({ name, count: 0 }));
    items[0].count = 9;
    items[1].count = 1;
    expect(departmentBars(items).map((b) => b.name)).toEqual(["HVAC Service", "Plumbing Service"]);
  });
  it("is empty when nothing has a review, and a lone department is a full bar", () => {
    expect(departmentBars([{ name: "A", count: 0 }])).toEqual([]);
    expect(departmentBars([])).toEqual([]);
    expect(departmentBars([{ name: "A", count: 0 }, { name: "B", count: 3 }])).toEqual([{ name: "B", count: 3, pct: 100 }]);
  });
  it("breaks ties by the order given, so the layout is stable", () => {
    const items = [{ name: "Zed", count: 2 }, { name: "Amy", count: 2 }, { name: "Bob", count: 5 }];
    expect(departmentBars(items).map((b) => b.name)).toEqual(["Bob", "Zed", "Amy"]);
    expect(departmentBars([...items].reverse()).map((b) => b.name)).toEqual(["Bob", "Amy", "Zed"]);
  });
  it("does not mutate its input and leaves counts untouched", () => {
    const items = [{ name: "A", count: 1 }, { name: "B", count: 3 }];
    const copy = JSON.stringify(items);
    expect(departmentBars(items).map((b) => b.count)).toEqual([3, 1]);
    expect(JSON.stringify(items)).toBe(copy);
  });
});

describe("topEmployees", () => {
  const people = [
    { name: "Zed", mentions: 2, total_cents: 99999 },
    { name: "Amy", mentions: 3, total_cents: 100 },
    { name: "Bob", mentions: 2, total_cents: 100 },
    { name: "Cat", mentions: 3, total_cents: 50 },
    { name: "Dan", mentions: 1, total_cents: 0 },
    { name: "Eve", mentions: 1, total_cents: 0 },
  ];
  it("ranks by review count, ties by name, ignoring dollars", () => {
    expect(topEmployees(people, 5).map((p) => p.name)).toEqual(["Amy", "Cat", "Bob", "Zed", "Dan"]);
  });
  it("does not mutate its input", () => {
    const copy = JSON.stringify(people);
    topEmployees(people);
    expect(JSON.stringify(people)).toBe(copy);
  });
});

describe("donutSlices", () => {
  it("is empty with no data", () => expect(donutSlices([])).toEqual({ slices: [], total: 0 }));
  it("top 5 plus one combined slice; percentages come from the real total", () => {
    const people = ["A", "B", "C", "D", "E", "F", "G"].map((name, i) => ({ name, mentions: 7 - i })); // 7,6,5,4,3,2,1 = 28
    const { slices, total } = donutSlices(people);
    expect(total).toBe(28);
    expect(slices.map((s) => s.label)).toEqual(["A", "B", "C", "D", "E", "Everyone else"]);
    expect(slices[5]).toMatchObject({ value: 3, rest: true, pct: 10.7 });
    expect(slices[0].pct).toBe(25);
  });
  it("no combined slice when five or fewer people", () => {
    const { slices } = donutSlices([{ name: "A", mentions: 2 }, { name: "B", mentions: 2 }]);
    expect(slices.map((s) => s.rest)).toEqual([false, false]);
    expect(slices.map((s) => s.pct)).toEqual([50, 50]);
  });
  it("skips people with zero reviews", () => {
    expect(donutSlices([{ name: "A", mentions: 0 }, { name: "B", mentions: 1 }]).slices).toHaveLength(1);
  });
});
