import {describe, expect, it} from "vitest";

import {textoDeAviso} from "./avisos-panel";

describe("textoDeAviso", () => {
  it("saca el HTML de Telegram y deja el texto", () => {
    expect(textoDeAviso("💳 <b>Pago recibido</b>\nCliente: Ana")).toBe(
      "💳 Pago recibido\nCliente: Ana",
    );
  });

  it("decodifica lo que el llamador escapó, para que React lo escape una sola vez", () => {
    expect(textoDeAviso("Cliente: A &amp; B &lt;script&gt;")).toBe("Cliente: A & B <script>");
  });

  it("no convierte &amp;lt; en <: decodifica &amp; al final", () => {
    expect(textoDeAviso("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  });
});
