// Test del nodo `Code - Scoring`.
//
// El scoring pasó de tener los pesos y umbrales escritos a mano en el nodo a
// leerlos de variables de entorno (para poder recalibrar el criterio sin tocar
// el workflow). Este test cumple dos funciones:
//
//   1. REGRESIÓN: con la configuración por defecto, el resultado tiene que ser
//      idéntico al del algoritmo original —el que documenta la Tabla 4 de la
//      tesis— en una grilla exhaustiva de entradas.
//   2. CONFIGURABILIDAD: cambiar las variables de entorno tiene que cambiar la
//      clasificación de forma predecible.
//
// Uso: node tests/scoring.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

const wf = JSON.parse(
  readFileSync(path.join(aqui, '..', 'workflow', 'crm_postgres.json'), 'utf8'),
);
const jsCode = wf.nodes.find((n) => n.name === 'Code - Scoring').parameters.jsCode;

// El lead que nace al elegir en la bolsa se califica con una copia de este
// nodo (Code - Scoring Lead Bolsa): tienen que ser idénticos, o un proyecto
// publicado por un cliente se puntuaría con otro criterio.
const copiaBolsa = wf.nodes.find((n) => n.name === 'Code - Scoring Lead Bolsa')?.parameters.jsCode;

if (copiaBolsa !== jsCode) {
  console.log('FAIL  Code - Scoring Lead Bolsa es una copia exacta de Code - Scoring');
  process.exit(1);
}
console.log('OK    Code - Scoring Lead Bolsa es una copia exacta de Code - Scoring');

// Algoritmo ORIGINAL, tal como estaba antes de parametrizarlo. Es la referencia
// contra la que se compara: es lo que la Tabla 4 de la tesis documenta.
function scoringOriginal(l) {
  let score = 0;
  const b = parseInt(l.presupuesto) || 0;

  if (b >= 5000) score += 40;
  else if (b >= 2000) score += 30;
  else if (b >= 1000) score += 20;
  else if (b >= 300) score += 10;

  score += {alta: 30, media: 15, baja: 5}[l.urgencia] || 5;
  score += {
    desarrollo_web: 20, ecommerce: 20, app_movil: 18, automatizacion: 18,
    marketing: 15, seo: 15, diseno_ui: 15, consultoria: 12, soporte: 5,
  }[l.servicio] || 8;

  if (l.telefono && l.telefono.length > 6) score += 5;
  if (l.descripcion && l.descripcion.length > 50) score += 5;

  return {score, tier: score >= 70 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD'};
}

// Ejecuta el nodo tal cual está en el workflow.
function scoringDelNodo(lead, env = {}) {
  const item = {json: lead};
  const $input = {first: () => item, all: () => [item], last: () => item};
  const $ = () => ({first: () => item, all: () => [item], item});
  const fn = new Function('$input', '$', '$json', '$env', jsCode);

  return fn($input, $, lead, env)[0].json;
}

let ok = 0, fail = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { console.log('OK    ' + nombre); ok++; }
  else { console.log('FAIL  ' + nombre + (detalle ? '  ->  ' + detalle : '')); fail++; }
};

// ── 1. Regresión exhaustiva ────────────────────────────────────────────────
const presupuestos = [0, 1, 299, 300, 999, 1000, 1999, 2000, 4999, 5000, 12000, '3000', 'abc', null];
const urgencias = ['alta', 'media', 'baja', 'urgentisima', undefined];
const servicios = [
  'desarrollo_web', 'ecommerce', 'app_movil', 'automatizacion', 'marketing',
  'seo', 'diseno_ui', 'consultoria', 'soporte', 'inventado', undefined,
];
const telefonos = [null, '', '12345', '+54 11 5555 5555'];
const descripciones = [null, 'corta', 'x'.repeat(51)];

let casos = 0;
const divergencias = [];

for (const presupuesto of presupuestos) {
  for (const urgencia of urgencias) {
    for (const servicio of servicios) {
      for (const telefono of telefonos) {
        for (const descripcion of descripciones) {
          const lead = {presupuesto, urgencia, servicio, telefono, descripcion, nombre: 'Test'};
          const esperado = scoringOriginal(lead);
          const obtenido = scoringDelNodo(lead);

          casos++;

          if (obtenido.score !== esperado.score || obtenido.tier !== esperado.tier) {
            divergencias.push({lead, esperado, obtenido});
          }
        }
      }
    }
  }
}

check(
  `los defaults reproducen la Tabla 4 en ${casos} combinaciones`,
  divergencias.length === 0,
  divergencias.length ? JSON.stringify(divergencias.slice(0, 3)) : '',
);

// ── 2. Los campos que no tocan el score se preservan ───────────────────────
const conExtras = scoringDelNodo({presupuesto: 6000, urgencia: 'alta', servicio: 'ecommerce', email: 'a@b.com', lead_id: 'LD-1'});
check('el nodo preserva el resto del lead', conExtras.email === 'a@b.com' && conExtras.lead_id === 'LD-1');

// ── 3. Casos nombrados de la Tabla 4 ───────────────────────────────────────
const hot = scoringDelNodo({presupuesto: 6000, urgencia: 'alta', servicio: 'ecommerce', telefono: '+541155555555', descripcion: 'x'.repeat(60)});
check('lead premium ⇒ HOT (40+30+20+5+5 = 100)', hot.score === 100 && hot.tier === 'HOT', JSON.stringify(hot));

const cold = scoringDelNodo({presupuesto: 100, urgencia: 'baja', servicio: 'soporte'});
check('lead mínimo ⇒ COLD (0+5+5 = 10)', cold.score === 10 && cold.tier === 'COLD', JSON.stringify(cold));

// Presupuesto alto + urgencia baja: el caso que pregunta el dictamen (cuestión 3).
const raro = scoringDelNodo({presupuesto: 12000, urgencia: 'baja', servicio: 'consultoria'});
check('presupuesto alto + urgencia baja ⇒ WARM (40+5+12 = 57)', raro.score === 57 && raro.tier === 'WARM', JSON.stringify(raro));

// ── 4. Configurabilidad ────────────────────────────────────────────────────
const conUmbrales = scoringDelNodo(
  {presupuesto: 12000, urgencia: 'baja', servicio: 'consultoria'},
  {SCORING_UMBRAL_HOT: '50', SCORING_UMBRAL_WARM: '20'},
);
check('bajar SCORING_UMBRAL_HOT reclasifica el mismo lead como HOT', conUmbrales.score === 57 && conUmbrales.tier === 'HOT', JSON.stringify(conUmbrales));

const conPesos = scoringDelNodo(
  {presupuesto: 12000, urgencia: 'baja', servicio: 'consultoria'},
  {SCORING_URGENCIA: 'alta:30,media:15,baja:25'},
);
check('subir el peso de la urgencia baja sube el score (57 → 77)', conPesos.score === 77, JSON.stringify(conPesos));

const conTramos = scoringDelNodo(
  {presupuesto: 700, urgencia: 'media', servicio: 'soporte'},
  {SCORING_PRESUPUESTO: '500:35,100:10'},
);
check('se pueden redefinir los tramos de presupuesto (35+15+5 = 55)', conTramos.score === 55, JSON.stringify(conTramos));

const sinBonus = scoringDelNodo(
  {presupuesto: 6000, urgencia: 'alta', servicio: 'ecommerce', telefono: '+541155555555', descripcion: 'x'.repeat(60)},
  {SCORING_BONUS_TELEFONO: '0', SCORING_BONUS_DESCRIPCION: '0'},
);
check('los bonus se pueden anular (100 → 90)', sinBonus.score === 90, JSON.stringify(sinBonus));

// Una config rota no debe tumbar el nodo: cae a los defaults.
const configRota = scoringDelNodo(
  {presupuesto: 6000, urgencia: 'alta', servicio: 'ecommerce'},
  {SCORING_PRESUPUESTO: 'basura', SCORING_URGENCIA: '', SCORING_UMBRAL_HOT: 'x'},
);
check('una configuración inválida no rompe el nodo', typeof configRota.score === 'number' && ['HOT', 'WARM', 'COLD'].includes(configRota.tier), JSON.stringify(configRota));

console.log('\nResultado: ' + ok + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
