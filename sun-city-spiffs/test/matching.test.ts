import { beforeAll, describe, expect, it } from "vitest";
import { indexDirectory, reconcileMentions, serverCandidates, type DirEmployee } from "../worker/matching";
import { loadDirectory } from "../worker/directory";
import { freshDb } from "./d1-shim";

let dir: DirEmployee[];
let idx: ReturnType<typeof indexDirectory>;
const id = (name: string) => dir.find((e) => e.full_name === name)!.id;
const names = (ids: number[]) => ids.map((i) => dir.find((e) => e.id === i)!.full_name).sort();
const cands = (text: string) => names(serverCandidates(text, idx));

beforeAll(async () => {
  dir = await loadDirectory(freshDb());
  idx = indexDirectory(dir);
});

describe("serverCandidates", () => {
  it("'Ruben' alone returns both Rubens", () => expect(cands("Ruben")).toEqual(["Ruben Bustamante", "Ruben Urbano-Varela"]));
  it("'Rubin' (typo) maps to the Rubens", () => expect(cands("Rubin")).toEqual(["Ruben Bustamante", "Ruben Urbano-Varela"]));
  it("'Ruben Varela' is Urbano-Varela via alias", () => expect(cands("Ruben Varela")).toEqual(["Ruben Urbano-Varela"]));
  it("'Esteban' surfaces Esteban Manzo and Estevan Gutierrez (alias)", () => expect(cands("Esteban")).toEqual(["Esteban Manzo", "Estevan Gutierrez"]));
  it("'Estevan' is Estevan Gutierrez", () => expect(cands("Estevan")).toEqual(["Estevan Gutierrez"]));
  it("'Hernandez' lists every Hernandez", () =>
    expect(cands("Hernandez")).toEqual(["Alex Hernandez", "Isaac Hernandez", "Jessy Hernandez", "Jose Hernandez"]));
  it("'Jesse' maps to Jessy Hernandez", () => expect(cands("Jesse")).toEqual(["Jessy Hernandez"]));
  it("'Raymond Fonseca' is ambiguous with Jr.; 'Raymond Fonseca Jr.' is not", () => {
    expect(cands("Raymond Fonseca")).toEqual(["Raymond Fonseca", "Raymond Fonseca Jr."]);
    expect(cands("Raymond Fonseca Jr.")).toEqual(["Raymond Fonseca Jr."]);
  });
  it("'McCleery' finds both McCleerys; 'Malachi' only one", () => {
    expect(cands("McCleery")).toEqual(["Malachi McCleery", "William McCleery"]);
    expect(cands("Malachi")).toEqual(["Malachi McCleery"]);
  });
  it("'Olguin' finds Jason and Jayce", () => expect(cands("Olguin")).toEqual(["Jason Olguin", "Jayce Olguin"]));
  it("'Moreno' finds Raul and Luis", () => expect(cands("Mr. Moreno")).toEqual(["Luis Moreno", "Raul Moreno"]));
  it("'Varela' finds Brian and Ruben", () => expect(cands("Varela")).toEqual(["Brian Varela-Moraga", "Ruben Urbano-Varela"]));
  it("'Jose' finds both Joses but not Josh", () => expect(cands("Jose")).toEqual(["Jose A Mendez", "Jose Hernandez"]));
  it("'Josh' finds Josh Shaw and Joshua Abeyta", () => expect(cands("Josh")).toEqual(["Josh Shaw", "Joshua Abeyta"]));
  it("'Mike' finds Michael Estrada", () => expect(cands("Mike")).toEqual(["Michael Estrada"]));
  it("'Brian' is Brian Varela-Moraga", () => expect(cands("Brian")).toEqual(["Brian Varela-Moraga"]));
  it("'Justin' (not an employee) finds nobody", () => expect(cands("Justin")).toEqual([]));
});

describe("reconcileMentions (AI cross-check)", () => {
  it("downgrades an over-confident AI match to ambiguous with the union", () => {
    const r = reconcileMentions([{ mention_text: "Ruben", candidate_employee_ids: [id("Ruben Bustamante")], match_status: "matched" }], dir);
    expect(r[0].match_status).toBe("ambiguous");
    expect(r[0].candidates.map((c) => c.full_name).sort()).toEqual(["Ruben Bustamante", "Ruben Urbano-Varela"]);
    expect(r[0].candidates[0].full_name).toBe("Ruben Bustamante"); // AI's pick stays first
  });

  it("keeps a match the server agrees with", () => {
    const r = reconcileMentions([{ mention_text: "Brian", candidate_employee_ids: [id("Brian Varela-Moraga")], match_status: "matched" }], dir);
    expect(r[0].match_status).toBe("matched");
  });

  it("drops unknown ids and turns an empty result into not_found", () => {
    const r = reconcileMentions([{ mention_text: "Justin", candidate_employee_ids: [99999], match_status: "matched" }], dir);
    expect(r[0]).toMatchObject({ match_status: "not_found", candidates: [] });
  });

  it("an AI match the server can't confirm must be confirmed by the user", () => {
    const r = reconcileMentions([{ mention_text: "Chava", candidate_employee_ids: [id("Sal Santilian")], match_status: "matched" }], dir);
    expect(r[0].match_status).toBe("ambiguous");
    expect(r[0].candidates.map((c) => c.full_name)).toEqual(["Sal Santilian"]);
  });

  it("deduplicates the same person and the same text", () => {
    const b = id("Brian Varela-Moraga");
    const r = reconcileMentions(
      [
        { mention_text: "Brian", candidate_employee_ids: [b], match_status: "matched" },
        { mention_text: "brian", candidate_employee_ids: [b], match_status: "matched" },
        { mention_text: "Brian Varela", candidate_employee_ids: [b], match_status: "matched" },
      ],
      dir,
    );
    expect(r).toHaveLength(1);
  });

  it("ignores inactive employees", () => {
    const d2 = dir.map((e) => (e.full_name === "Ruben Bustamante" ? { ...e, active: false } : e));
    const r = reconcileMentions([{ mention_text: "Ruben", candidate_employee_ids: [], match_status: "ambiguous" }], d2);
    expect(r[0].candidates.map((c) => c.full_name)).toEqual(["Ruben Urbano-Varela"]);
  });
});
