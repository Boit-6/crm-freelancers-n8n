// Redirige todos los Gmail de los workflows a DEMO_EMAIL_SINK cuando está definida,
// con el asunto «[DEMO → destinatario original] …». Sin la variable, el comportamiento
// queda idéntico al original. Idempotente: un nodo ya parcheado se saltea.
import { readFileSync, writeFileSync } from "node:fs";

const RUTAS = ["workflow/crm_postgres.json", "workflow/avisos.json"];

for (const ruta of RUTAS) {
  const wf = JSON.parse(readFileSync(ruta, "utf8"));
  let cambios = 0;

  for (const nodo of wf.nodes) {
    if (nodo.type !== "n8n-nodes-base.gmail") continue;
    const p = nodo.parameters;
    if (typeof p.sendTo !== "string" || p.sendTo.includes("DEMO_EMAIL_SINK")) continue;

    const m = p.sendTo.match(/^=\{\{\s*([\s\S]*?)\s*\}\}$/);
    if (!m) throw new Error(`sendTo inesperado en "${nodo.name}": ${p.sendTo}`);
    const original = m[1];

    p.sendTo = `={{ $env.DEMO_EMAIL_SINK || (${original}) }}`;
    const prefijo = `{{ $env.DEMO_EMAIL_SINK ? '[DEMO → ' + (${original}) + '] ' : '' }}`;
    const asunto = String(p.subject ?? "");
    p.subject = "=" + prefijo + (asunto.startsWith("=") ? asunto.slice(1) : asunto);
    cambios++;
  }

  writeFileSync(ruta, JSON.stringify(wf, null, 2) + "\n");
  console.log(`${ruta}: ${cambios} nodos Gmail parcheados`);
}
