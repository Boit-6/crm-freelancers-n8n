import {describe, expect, it} from "vitest";

import {
  errorDeEmail,
  errorDeNombre,
  errorDeSlug,
  esSlugProvisorio,
  mensajeDeErrorDb,
  slugDesde,
} from "./espacios";

describe("slugDesde", () => {
  it("saca tildes, eñes y símbolos, y une con guiones", () => {
    expect(slugDesde("Estudio Ñandú & Cía.")).toBe("estudio-nandu-cia");
  });

  it("no deja guiones al principio ni al final, tampoco al recortar a 40", () => {
    const largo = slugDesde("  --" + "a".repeat(39) + " b");

    expect(largo.length).toBeLessThanOrEqual(40);
    expect(largo).not.toMatch(/^-|-$/);
  });

  it("lo que produce pasa la validación cuando alcanza el largo mínimo", () => {
    for (const nombre of ["Ana Gómez", "Soderos S.A.", "Dev 42"]) {
      expect(errorDeSlug(slugDesde(nombre))).toBeNull();
    }
  });
});

describe("errorDeSlug", () => {
  it("acepta el formato del CHECK de la base", () => {
    expect(errorDeSlug("estudio-ana")).toBeNull();
    expect(errorDeSlug("a1b")).toBeNull();
  });

  it("rechaza lo que la base rechazaría", () => {
    for (const malo of ["ab", "-ana", "ana-", "Ana", "ana gomez", "ana_gomez", "a".repeat(41)]) {
      expect(errorDeSlug(malo)).not.toBeNull();
    }
  });
});

describe("errorDeNombre", () => {
  it("exige algo que no sean espacios y respeta el tope", () => {
    expect(errorDeNombre("   ")).not.toBeNull();
    expect(errorDeNombre("x".repeat(81))).not.toBeNull();
    expect(errorDeNombre("  Estudio Ana ")).toBeNull();
  });
});

describe("errorDeEmail", () => {
  it("pide un correo con formato válido, como el CHECK de la base", () => {
    expect(errorDeEmail("ana@estudio.com")).toBeNull();
    expect(errorDeEmail("ana@estudio")).not.toBeNull();
    expect(errorDeEmail("ana estudio@x.com")).not.toBeNull();
  });
});

describe("esSlugProvisorio", () => {
  it("reconoce el que pone la base al crear el espacio", () => {
    expect(esSlugProvisorio("e-0123456789abcdef0123456789abcdef")).toBe(true);
    expect(esSlugProvisorio("estudio-ana")).toBe(false);
  });
});

describe("mensajeDeErrorDb", () => {
  it("explica la dirección repetida", () => {
    expect(mensajeDeErrorDb("23505")).toMatch(/ya la usa otro espacio/);
  });
});
