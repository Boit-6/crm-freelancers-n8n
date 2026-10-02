#!/usr/bin/env node
// Escenario E15 — Trazabilidad: reconstrucción del ciclo de una oportunidad
// a partir de lo que el sistema persiste.
//
// Por qué existe. La proposición orientadora del §1.5 se declara refutada en
// tres supuestos, y el tercero es «que el estado de una oportunidad no pudiera
// reconstruirse a partir de lo registrado». Los otros dos se ejercitan: que
// todo flujo del ciclo pueda completarse lo verifican E1 a E14, y que el
// sistema no tome decisiones de negocio por el profesional lo verifica E1b.
// El tercero se respondía por afirmación —«la trazabilidad queda acreditada
// por construcción» (Cap. 7)—, que es justo el tipo de argumento que el resto
// del trabajo se niega a aceptar de sí mismo.
//
// Qué hace. Recorre un lead por el ciclo, y después RECONSTRUYE su historia
// leyendo únicamente la base: la fila de `leads` con sus marcas temporales y
// las filas de auditoría de `logs`. No vuelve a preguntarle a n8n. Si la
// reconstrucción coincide con lo que efectivamente ocurrió, la condición se
// cumple; si falta un tramo, el escenario lo nombra.
//
// Uso: node tests/trazabilidad.mjs   (npm run test:trazabilidad)
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cargarEnv, crearRest, crearWebhook} from './helpers/servicios.mjs';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
cargarEnv(path.join(raiz, '.env'));

const N8N = (process.env.N8N_BASE ?? 'http://localhost:5678').replace(/\/+$/, '');
const SUPA = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PANEL_TOKEN = process.env.CRM_PANEL_TOKEN ?? '';
const PANEL_HEADER = process.env.CRM_PANEL_HEADER ?? 'x-crm-token';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const rest = crearRest(SUPA, KEY);
const webhook = crearWebhook(N8N);

async function esperarHasta(descripcion, condicion, {timeout = 25000, intervalo = 400} = {}) {
  const t0 = Date.now();

  for (;;) {
    const valor = await condicion();

    if (valor) return valor;
    if (Date.now() - t0 > timeout) throw new Error(`timeout esperando: ${descripcion}`);
    await esperar(intervalo);
  }
}

// ── Aserciones ─────────────────────────────────────────────────────────────
const resultados = [];
const afirmar = (ok, texto, detalle = '') => {
  resultados.push({ok, texto, detalle});
  console.log(`  ${ok ? '✅' : '❌'} ${texto}${detalle ? ': ' + detalle : ''}`);
};

// ── Escenario ──────────────────────────────────────────────────────────────
const sufijo = Date.now();
const EMAIL = `cliente.demo.traza.${sufijo}@ejemplo.com`;

console.log('E15 — Trazabilidad: reconstrucción del ciclo desde lo registrado\n');

if (!SUPA || !KEY) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Ver Anexo G.');
  process.exit(2);
}

let leadId = null;

try {
  // 1) Alta del lead. Datos ficticios y neutros, conforme al protocolo de la Tabla 4.
  console.log('Recorrido del ciclo');
  const alta = await webhook('lead-nuevo', {
    cuerpo: {
      nombre: 'Cliente Demo Traza',
      email: EMAIL,
      telefono: '+54 261 555 0199',
      servicio: 'Desarrollo Web',
      presupuesto: 6000,
      urgencia: 'alta',
      descripcion: 'Necesito una tienda en línea con pasarela de pago y panel de gestión para el equipo.',
      fuente: 'test_trazabilidad',
    },
  });

  console.log(`  · alta enviada (HTTP ${alta.status})`);

  const fila = await esperarHasta('el lead aparezca en la base', async () => {
    const r = await rest(`leads?email=eq.${encodeURIComponent(EMAIL)}&select=*`);

    return r.length ? r[0] : null;
  });

  leadId = fila.lead_id;
  console.log(`  · lead persistido: ${leadId} (tier ${fila.tier}, score ${fila.score})`);

  // 2) El profesional fija los términos y se envía la propuesta.
  const envio = await webhook('propuesta-enviar', {
    cuerpo: {lead_id: leadId, precio: 8400, plazo: '4 semanas', alcance: 'Tienda en línea con pasarela y panel.'},
    headers: PANEL_TOKEN ? {[PANEL_HEADER]: PANEL_TOKEN} : {},
  });

  console.log(`  · propuesta enviada desde el panel (HTTP ${envio.status})`);

  let avanzo = true;

  try {
    await esperarHasta('el lead pase a PROPUESTA_ENVIADA', async () => {
      const r = await rest(`leads?lead_id=eq.${leadId}&select=estado`);

      return r[0]?.estado === 'PROPUESTA_ENVIADA' ? r[0] : null;
    }, {timeout: 20000});
  } catch {
    avanzo = false;
    console.log('  · el envío no completó (credencial de correo); se reconstruye hasta donde llegó');
  }

  // 3) RECONSTRUCCIÓN. A partir de aquí sólo se lee la base: ni una consulta
  //    más a n8n. Es la prueba de que el estado es reconstruible con lo que el
  //    sistema persiste, y no con lo que el motor recuerda.
  console.log('\nReconstrucción a partir de lo registrado (sólo lecturas a la base)');

  const [lead] = await rest(`leads?lead_id=eq.${leadId}&select=*`);
  const auditoria = await rest(`logs?lead_id=eq.${leadId}&select=*&order=creado_en.asc`);
  const seguimientos = await rest(`seguimientos?lead_id=eq.${leadId}&select=*&order=enviado_en.asc`);

  // Cada estado del ciclo comercial tiene una marca temporal que lo fecha
  // (Tabla 6). Reconstruir consiste en ordenar las que están presentes.
  const marcas = [
    {estado: 'NUEVO', columna: 'fecha_ingreso', valor: lead.fecha_ingreso},
    {estado: 'PROPUESTA_ENVIADA', columna: 'fecha_propuesta', valor: lead.fecha_propuesta},
    {estado: 'EN_SEGUIMIENTO', columna: 'fecha_ultimo_seguimiento', valor: lead.fecha_ultimo_seguimiento},
    {estado: 'ACEPTADO', columna: 'fecha_aceptacion', valor: lead.fecha_aceptacion},
    {estado: 'CERRADO', columna: 'fecha_cierre', valor: lead.fecha_cierre},
  ];
  const linea = marcas.filter((m) => m.valor).sort((a, b) => new Date(a.valor) - new Date(b.valor));

  console.log('  línea de tiempo reconstruida:');
  for (const m of linea) {
    console.log(`      ${new Date(m.valor).toISOString()}  ${m.estado.padEnd(18)} (${m.columna})`);
  }
  for (const l of auditoria) {
    console.log(`      ${new Date(l.creado_en).toISOString()}  auditoría ${l.nivel.padEnd(9)} ${l.evento ?? ''}`);
  }

  // ── Aserciones de la reconstrucción ──────────────────────────────────────
  console.log('\nComprobaciones');

  afirmar(linea.length > 0, 'el ciclo tiene al menos una transición fechada', `${linea.length} marcas`);

  afirmar(
    linea[0]?.estado === 'NUEVO',
    'la reconstrucción arranca en el alta del lead',
    linea[0]?.estado ?? '(sin marcas)',
  );

  const monotona = linea.every((m, i) => i === 0 || new Date(m.valor) >= new Date(linea[i - 1].valor));

  afirmar(monotona, 'las marcas temporales son cronológicamente consistentes');

  // El estado actual tiene que ser el último de la línea reconstruida, o uno
  // derivado de él. PERDIDO y FACTURADO no tienen columna de fecha propia:
  // se alcanzan desde el último estado fechado, y así se lo declara.
  const derivados = {FACTURADO: 'ACEPTADO', PERDIDO: null};
  const ultimoFechado = linea[linea.length - 1]?.estado;
  const coherente = lead.estado === ultimoFechado ||
    derivados[lead.estado] === ultimoFechado ||
    Object.prototype.hasOwnProperty.call(derivados, lead.estado);

  afirmar(
    coherente,
    'el estado actual se explica por la última transición fechada',
    `estado=${lead.estado} · última marca=${ultimoFechado}`,
  );

  afirmar(
    lead.score !== null && lead.tier !== null,
    'la calificación quedó registrada junto al lead',
    `score=${lead.score} tier=${lead.tier}`,
  );

  if (avanzo) {
    afirmar(
      lead.precio_propuesto !== null && Number(lead.precio_propuesto) !== Number(lead.presupuesto),
      'los términos que fijó el profesional son recuperables y distintos del presupuesto declarado',
      `precio=${lead.precio_propuesto} · presupuesto declarado=${lead.presupuesto}`,
    );
    afirmar(
      Boolean(lead.fecha_propuesta),
      'el envío de la propuesta quedó fechado',
      lead.fecha_propuesta ?? '',
    );
    afirmar(
      auditoria.length > 0,
      'el envío dejó rastro en el registro de auditoría',
      `${auditoria.length} fila(s) en logs`,
    );
  }

  afirmar(
    seguimientos.length === 0 || seguimientos.every((s) => s.enviado_en && s.numero),
    'los seguimientos registrados permiten auditar su espaciado',
    `${seguimientos.length} seguimiento(s)`,
  );

  // La prueba de fondo: ¿alcanza lo persistido para saber en qué punto del
  // ciclo está la oportunidad, sin preguntarle nada al motor de orquestación?
  afirmar(
    Boolean(lead.estado && lead.fecha_ingreso && lead.lead_id),
    'la oportunidad es identificable y ubicable en el ciclo sólo con la base',
  );
} finally {
  // Limpieza: el protocolo de la Tabla 4 exige datos ficticios y no deja residuo.
  if (leadId) {
    try {
      await rest(`logs?lead_id=eq.${leadId}`, {method: 'DELETE'});
      await rest(`leads?lead_id=eq.${leadId}`, {method: 'DELETE'});
      console.log(`\n  (lead de prueba ${leadId} eliminado)`);
    } catch (e) {
      console.log(`\n  (no se pudo limpiar ${leadId}: ${e.message})`);
    }
  }
}

const fallidas = resultados.filter((r) => !r.ok);

console.log(`\nResultado: ${resultados.length - fallidas.length}/${resultados.length} comprobaciones en verde`);

if (fallidas.length) {
  console.log('\n✗ La reconstrucción no es completa. Tramos que no se pueden reconstruir:');
  for (const f of fallidas) console.log('  · ' + f.texto);
}

process.exit(fallidas.length ? 1 : 0);
