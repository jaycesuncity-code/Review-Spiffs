// Generates migrations/0002_seed.sql from the data below, so alias normalization and
// SQL escaping always match the app's own code. Run: node scripts/gen-seed.ts
// (Only needed if you change the seed data BEFORE the first deploy. After that, edit in Settings.)
import { writeFileSync } from "node:fs";
import { normalizeName } from "../shared/names.ts";
import { wordCount } from "../shared/text.ts";
import { DEFAULT_SETTINGS } from "../shared/defaults.ts";

const departments: [number, string, "install" | "service" | "none"][] = [
  [1, "Managers", "none"],
  [2, "Shop", "install"],
  [3, "HVAC Service", "service"],
  [4, "HVAC Install", "install"],
  [5, "Plumbing Service", "service"],
  [6, "Plumbing Install", "install"],
  [7, "HVAC New Construction", "install"],
];

const employees: Record<number, string[]> = {
  1: ["Jason Olguin", "Jack Sanchez", "Alex Hernandez", "Victor Aguirre", "Ryan Escalera", "Malachi McCleery", "Jermaine Yancey"],
  2: ["Ben Mendoza", "Carl Greer", "Mundo Gonzalez", "Thomas Sanchez", "Todd Hensley", "Raymond Fonseca Jr.", "William McCleery"],
  3: ["Adrian Padilla", "Jaime Murillo", "Michael Estrada", "Nathan Barela", "Oscar Nunez", "Rudy Nunez", "Garrett Arnold", "Esteban Manzo", "Jordan Henly", "Joshua Abeyta", "Hector Martell", "Jose Hernandez"],
  4: ["Fabian Dominguez", "Jessy Hernandez", "Luis Moreno", "Socorro Chaparro", "Raymond Fonseca", "Antonio Barajas", "Josh Shaw", "Raul Moreno", "Jesus Montes"],
  5: ["Aaron Ordaz", "Brian Varela-Moraga", "Daniel Brawley", "Estevan Gutierrez", "Mario Castro", "Antonio Olivares", "Noah Trewern", "Ruben Urbano-Varela", "Sal Santilian"],
  6: ["Joel Marquez", "Jose A Mendez", "Isaac Hernandez", "Rodolfo Martinez", "Ruben Bustamante", "Caleb Solis", "Randy Ramos", "Martin Meza"],
  7: ["David Villa", "Isaiah Castanon", "Jayce Olguin", "Fredderik Rodriguez"],
};

const aliases: Record<string, string[]> = {
  "Jessy Hernandez": ["Jesse Hernandez", "Jessy"],
  "Michael Estrada": ["Mike Estrada", "Micheal Estrada"],
  "Daniel Brawley": ["Dainel Brawley"],
  "Estevan Gutierrez": ["Esteban Gutierrez"],
  "Brian Varela-Moraga": ["Brian Varela"],
  "Ruben Urbano-Varela": ["Ruben Varela"],
  "Malachi McCleery": ["Malachi Mcleery"],
  "Jaime Murillo": ["Jamie Murillo"],
  "Joshua Abeyta": ["Josh Abeyta"],
  "Sal Santilian": ["Sal Santillan", "Salvador Santillan"],
  "Fredderik Rodriguez": ["Frederick Rodriguez", "Fredderick Rodriguez"],
};

const examples: { customer: string; review: string; reply: string }[] = [
  {
    customer: "Steve Rogers",
    review: "Rubin and Brian did a terrific job. Very professional, skilled, courteous and efficient. Would recommend highly to everyone!",
    reply: "Thank you so much for your kind words! We’re thrilled to hear that Ruben and Brian provided such professional and efficient service. We truly appreciate your recommendation and your trust in Sun City Plumbing & Heating.",
  },
  {
    customer: "Trevor Weiss",
    review: "They arrived on time, were professional, and did a great job replacing the AC Unit! Fantastic work!",
    reply: "Thank you for the fantastic review! We truly appreciate your kind words and your trust in Sun City Plumbing & Heating.",
  },
  {
    customer: "Keith Risinger",
    review: "Justin replaced our outside faucets and provided explanation of options and what to be aware of. He was very friendly and professional. I will plan on using Sun City for any future work. Thank you Justin!",
    reply: "Thanks for sharing your experience Keith! We’re glad Justin provided excellent service and guidance on your outside faucets. We appreciate your trust in Sun City Plumbing & Heating for future projects!",
  },
  {
    customer: "John Tapia",
    review: "Malachi and Esteban were professional and very helpful!!  Sun City is a good run company.",
    reply: "Thank you, John so much for your kind review! Don’t hesitate to reach out if you need anything in the future!",
  },
  {
    customer: "Mary Spence",
    review:
      "I very rarely write reviews, but Sun City has earned these five stars for sure. We needed an air conditioner repair right in the middle of summer (everyone in Las Cruces dreads that). I got impatient and called another company that would come out the next day. They  told me to replace the whole system (only 3.5 years old) after less than 30 seconds looking at it.\n\nThen we got Sun City to come out. Yes, we had to wait a week during the busy season, but it was so so so worth it. Malachi came out, found out what was wrong, got the parts covered under warranty, and repaired everything. During the process it turned out another part needed replaced as well and he took care of that quickly and well too. I feel confident my system is working well and will keep going strong for years.  I will be sticking with Sun City every time from now on.",
    reply: "Thanks so much for sharing your experience, Mary! We’re glad Malachi was able to get your system properly diagnosed and repaired, especially during the middle of this summer heat. We know how stressful it can be when other companies rush to replace instead of repair, so it means a lot that you stuck with us. We’re grateful for your patience and truly appreciate you choosing Sun City!",
  },
];

const q = (s: string | null) => (s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`);
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const out: string[] = [
  "-- GENERATED by scripts/gen-seed.ts. Seed data: departments, rates, employees, aliases, settings, reply examples.",
  "-- Applied once, like any migration. Edit everything afterwards in the app's Settings screen.",
  "",
];

for (const [id, name, type] of departments) {
  out.push(`INSERT INTO departments (id, name, spiff_type, sort_order) VALUES (${id}, ${q(name)}, ${q(type)}, ${id * 10});`);
}
out.push("");
out.push(`INSERT INTO spiff_rules (spiff_type, solo_amount_cents, shared_amount_cents, effective_from, created_at, created_by) VALUES ('install', 3000, 3000, '2020-01-01', ${NOW}, 'seed');`);
out.push(`INSERT INTO spiff_rules (spiff_type, solo_amount_cents, shared_amount_cents, effective_from, created_at, created_by) VALUES ('service', 3000, 1500, '2020-01-01', ${NOW}, 'seed');`);
out.push("");
for (const [deptId, names] of Object.entries(employees)) {
  for (const n of names) {
    out.push(`INSERT INTO employees (full_name, department_id, active, created_at) VALUES (${q(n)}, ${deptId}, 1, ${NOW});`);
  }
}
out.push("");
const seenAlias = new Set<string>();
for (const [emp, list] of Object.entries(aliases)) {
  for (const a of list) {
    const norm = normalizeName(a);
    if (seenAlias.has(norm)) throw new Error(`duplicate alias ${a}`);
    seenAlias.add(norm);
    out.push(
      `INSERT INTO employee_aliases (employee_id, alias, alias_norm) SELECT id, ${q(a)}, ${q(norm)} FROM employees WHERE full_name = ${q(emp)};`,
    );
  }
}
out.push("");
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  out.push(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (${q(key)}, ${q(JSON.stringify(value))}, ${NOW}, 'seed');`);
}
out.push("");
for (const ex of examples) {
  out.push(
    `INSERT INTO reply_examples (customer_name, review_text, reply_text, word_count, active, created_at) VALUES (${q(ex.customer)}, ${q(ex.review)}, ${q(ex.reply)}, ${wordCount(ex.review)}, 1, ${NOW});`,
  );
}
out.push("");

writeFileSync(new URL("../migrations/0002_seed.sql", import.meta.url), out.join("\n"));
console.log("wrote migrations/0002_seed.sql");
