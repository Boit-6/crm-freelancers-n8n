// Verifica cómo cada nodo Postgres de los workflows le pasa los valores a su
// consulta. No mira SQL (de eso se ocupa tests/verificar-sql.mjs): mira el
// puente entre n8n y PostgreSQL, que es donde se perdían los valores.
//
// El nodo Postgres de n8n acepta los parámetros de dos formas y NO son
// equivalentes. Con la forma de texto ("valor1,valor2") los resuelve con
// `stringToArray`, que es literalmente:
//
//     String(str).split(',').filter((entry) => entry).map((entry) => entry.trim())
//
// (n8n-nodes-base/dist/nodes/Postgres/v2/helpers/utils.js). Eso tiene dos
// consecuencias que no se ven leyendo el workflow:
//
//   1. `.filter(entry => entry)` DESCARTA los valores vacíos. Un parámetro que
//      llega como '' no se envía, los siguientes se corren un lugar y la
//      consulta falla con «there is no parameter $N».
//   2. `.split(',')` parte los valores que traen comas internas. Un texto libre
//      con una coma se convierte en dos parámetros.
//
// Las dos se comprobaron en el n8n vivo el 27-ago-2026: un GET a
// /webhook/lead-propuesta sin `token` dejaba `String(q.token || '')` en '',
// «Postgres - Buscar Propuesta» recibía un solo valor para $1 y $2, y el
// visitante veía una página en blanco en vez del cartel «Enlace no válido o
// vencido». En el log: `error: there is no parameter $2`.
//
// Con la forma de arreglo (`={{ [a, b, c] }}`) n8n usa los valores tal cual, sin
// partirlos ni filtrarlos. Por eso el artefacto la exige en todos los nodos.
//
// Uso: node tests/parametros-sql.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const wfDir = path.join(aqui, '..', 'workflow');
// Mismo criterio que en smoke-code-nodes.mjs y verificar-sql.mjs: los dos flujos
// del artefacto nombrados uno por uno, para no barrer las copias de respaldo.
const wfFiles = ['crm_postgres.json', 'tickets.json', 'avisos.json', 'telegram_vincular.json'];

// Parte por las comas de primer nivel, respetando corchetes, paréntesis, llaves
// y comillas: `[a, f(x, y), 'p,q']` son tres elementos, no cinco.
function partirTopLevel(texto) {
  const partes = [];
  let buf = '';
  let prof = 0;
  let comilla = null;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (comilla) {
      buf += c;
      if (c === '\\') { buf += texto[++i] ?? ''; continue; }
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { comilla = c; buf += c; continue; }
    if (c === '[' || c === '(' || c === '{') prof++;
    if (c === ']' || c === ')' || c === '}') prof--;
    if (c === ',' && prof === 0) { partes.push(buf); buf = ''; continue; }
    buf += c;
  }
  partes.push(buf);
  return partes.map((p) => p.trim()).filter((p) => p.length);
}

// `={{ [a, b, c] }}` → ['a', 'b', 'c']. Devuelve null si no es forma de arreglo.
function elementosDelArreglo(repl) {
  if (typeof repl !== 'string') return null;
  const m = /^=?\{\{\s*\[([\s\S]*)\]\s*\}\}$/.exec(repl.trim());
  if (!m) return null;
  return partirTopLevel(m[1]);
}

const problemas = [];
let revisados = 0;

for (const file of wfFiles) {
  const wf = JSON.parse(readFileSync(path.join(wfDir, file), 'utf8'));
  const nodos = wf.nodes.filter(
    (n) => n.type === 'n8n-nodes-base.postgres' && n.parameters?.operation === 'executeQuery',
  );

  console.log(`\n── ${file}  (${nodos.length} nodos Postgres)`);

  for (const n of nodos) {
    revisados++;
    const query = n.parameters.query ?? '';
    const repl = n.parameters.options?.queryReplacement;
    const fallas = [];

    // Cuántos parámetros pide el SQL, y que estén numerados 1..N sin huecos.
    const usados = [...new Set([...query.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort(
      (a, b) => a - b,
    );
    const pide = usados.length ? Math.max(...usados) : 0;
    if (usados.length && usados.some((v, i) => v !== i + 1)) {
      fallas.push(`los placeholders no son 1..${pide} sin huecos: $${usados.join(', $')}`);
    }

    // Ningún dato del flujo puede viajar concatenado dentro del texto del SQL:
    // para eso están los parámetros. Las interpolaciones de $env sí se aceptan
    // (son constantes de operación, no entrada de usuario).
    for (const expr of query.match(/\{\{[\s\S]*?\}\}/g) ?? []) {
      if (!/\$env\b/.test(expr)) {
        fallas.push(`interpola un dato dentro del SQL en vez de parametrizarlo: ${expr}`);
      }
    }

    if (pide === 0) {
      if (repl) fallas.push('pasa parámetros pero la consulta no usa ninguno');
    } else {
      const elementos = elementosDelArreglo(repl);
      if (repl === undefined) {
        fallas.push(`la consulta usa $1..$${pide} y el nodo no pasa ningún valor`);
      } else if (elementos === null) {
        fallas.push(
          'usa la forma de texto ("a,b"): n8n descarta los valores vacíos y parte los que ' +
            `tengan comas. Tiene que ser un arreglo: ={{ [ ... ] }} — actual: ${repl}`,
        );
      } else if (elementos.length !== pide) {
        fallas.push(`la consulta usa $1..$${pide} y el arreglo trae ${elementos.length} valor(es)`);
      }
    }

    if (fallas.length) {
      problemas.push({nodo: n.name, fallas});
      console.log(`FALLA ${n.name}`);
      for (const f of fallas) console.log(`      ${f}`);
    } else {
      console.log(`OK    ${n.name}  ->  ${pide} parámetro(s)`);
    }
  }
}

console.log(`\nResultado: ${revisados - problemas.length} OK, ${problemas.length} con error`);
process.exit(problemas.length ? 1 : 0);
