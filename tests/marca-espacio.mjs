// La plataforma es compartida: cada correo al cliente sale con la marca del
// espacio del desarrollador, no con una escrita a mano. Este test corre las
// plantillas tal cual están en el workflow con un lead de un espacio cuyo
// nombre trae HTML, y revisa los nodos de correo.
//
// Uso: node tests/marca-espacio.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(path.join(aqui, '..', 'workflow', 'crm_postgres.json'), 'utf8'));
const nodo = (nombre) => wf.nodes.find((n) => n.name === nombre);

let ok = 0, fail = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { console.log('OK    ' + nombre); ok++; }
  else { console.log('FAIL  ' + nombre + (detalle ? '  ->  ' + String(detalle).slice(0, 200) : '')); fail++; }
};

const lead = {
  lead_id: 'LD-1', nombre: 'Juan Pérez', email: 'juan@test.com', servicio: 'desarrollo_web',
  presupuesto: 2000, precio_propuesto: 2000, urgencia: 'media', accept_token: 'tok', seguimientos: 0,
  factura_id: 'FAC-2026-1234', monto: 2000, moneda: 'USD', fecha_emision_iso: new Date().toISOString(),
  fecha_vencimiento_iso: new Date().toISOString(), payUrl: 'https://pagar.test/x',
  espacio_nombre: 'Estudio <Ana>', espacio_email: 'ana@estudio.com',
};

// Corre un nodo Code con `$input`, `$env` y `$('Postgres - Lead Cerrado')`.
function correr(nombre, entrada, env = {}) {
  const js = nodo(nombre).parameters.jsCode;
  const item = {json: entrada};
  const $input = {first: () => item, all: () => [item], last: () => item};
  const $ = () => ({first: () => item, all: () => [item], item});
  const fn = new Function('$input', '$', '$env', 'require', js);
  const salida = fn($input, $, env, () => { throw new Error('sin require'); });

  return JSON.stringify(salida.map((s) => ({json: s.json, binary: s.binary})));
}

const PLANTILLAS = ['Code - Generar Propuesta', 'Code - Generar Factura HTML', 'Code - Preparar Follow-up',
  'Code - Email Testimonio', 'Code - Re-Propuesta', 'Code - Email No Cambios', 'Code - Filtrar Vencimientos',
  'Code - Email Rechazo Pedido', 'Code - Emails Asignación Bolsa'];

for (const nombre of PLANTILLAS) {
  const entrada = nombre === 'Code - Filtrar Vencimientos' ? {...lead, cliente: 'Juan', dias_al_vencimiento: 2} : lead;
  let salida;

  try { salida = correr(nombre, entrada); } catch (e) { check(nombre + ': corre', false, e.message); continue; }
  // Sólo el HTML que ve el cliente (la entrada viaja entera en el json). La
  // factura va como binario en base64.
  const primero = JSON.parse(salida)[0];
  const bin = primero?.binary?.factura_html_file?.data;
  const texto = Object.entries(primero?.json || {})
    .filter(([k]) => /html|cuerpo|body/.test(k)).map(([, v]) => String(v)).join('\n')
    + (bin ? Buffer.from(bin, 'base64').toString('utf8') : '');

  check(nombre + ': lleva la marca del espacio, escapada', /Estudio &lt;Ana&gt;|ESTUDIO &lt;ANA&gt;/.test(texto), texto.slice(0, 120));
  check(nombre + ': el nombre del espacio no se inyecta como HTML', !/Estudio <Ana>|ESTUDIO <ANA>/.test(texto));
}

const sinEspacio = correr('Code - Generar Propuesta', {...lead, espacio_nombre: null}, {PLATAFORMA_NOMBRE: 'MiPlataforma'});

check('sin espacio, la propuesta sale con el nombre de la plataforma', sinEspacio.includes('MIPLATAFORMA'));

check('ningún nodo tiene una marca, un correo o un alias de pago escritos a mano', !/soderos/i.test(JSON.stringify(wf)));

for (const g of wf.nodes.filter((n) => n.type.endsWith('gmail'))) {
  const o = g.parameters.options || {};

  check(`${g.name}: remitente con la marca del espacio`, /espacio_nombre/.test(o.senderName || ''));
  check(`${g.name}: las respuestas van al desarrollador (Reply-To)`, /espacio_email/.test(o.replyTo || ''));
}

check('el correo de la factura firma con la marca del espacio, escapada',
  /espacio_nombre[^}]*replaceAll\('<', '&lt;'\)/.test(nodo('Gmail - Enviar Factura PDF').parameters.message));
check('el acuse al lead frío firma con la marca del espacio, escapada',
  /espacio_nombre[^}]*replaceAll\('<', '&lt;'\)/.test(nodo('Gmail - Acuse Lead Frio').parameters.message));

// Toda consulta que alimenta un correo tiene que devolver la marca.
for (const q of ['Postgres - Guardar Terminos', 'Postgres - Leer Leads Follow-up', 'Postgres - Reabrir Propuesta',
  'Postgres - Reabrir Original', 'Postgres - Insert Lead', 'Postgres - Marcar Aceptado', 'Postgres - Lead Cerrado']) {
  const sql = nodo(q).parameters.query;

  check(`${q}: devuelve espacio_nombre y espacio_email`, /AS espacio_nombre/.test(sql) && /AS espacio_email/.test(sql));
}

console.log('\nResultado: ' + ok + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
