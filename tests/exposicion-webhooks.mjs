#!/usr/bin/env node
// Escenario E16 — Exposición: medición de la deuda S1 declarada en la Tabla 11.
//
// Por qué existe. La Tabla 11 declara que seis de los trece webhooks no
// verifican la identidad de quien los invoca, y la nota de la Tabla 10 precisa
// que la lista blanca de orígenes es un control del navegador (CORS) y no una
// autenticación. Ambas cosas se afirmaban sin medirse: el capítulo de
// resultados no tenía escenario que las ejercitara. Este script las convierte
// de riesgo enunciado en riesgo observado.
//
// Qué hace. Invoca los catorce webhooks desde un cliente que NO es un navegador
// —Node, sin cabecera Origin— y registra cuáles responden 403 por falta de
// credencial y cuáles atienden la petición igual. El resultado es la tabla que
// el Capítulo 5 puede citar.
//
// Alcance. Se ejecuta contra la instancia local declarada en el Anexo G, sobre
// el propio artefacto de los autores, con datos ficticios conforme al protocolo
// de la Tabla 4, y limpia lo que crea. Las invocaciones que podrían alterar
// estado real se hacen con identificadores inexistentes, de modo que el flujo
// las rechace por su propia lógica y no por efecto de esta prueba: lo que se
// mide es si el endpoint ATIENDE a un desconocido, no si se le puede hacer daño.
//
// Uso: node tests/exposicion-webhooks.mjs   (npm run test:exposicion)
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rutaEnv = path.join(raiz, '.env');

if (existsSync(rutaEnv)) {
  for (const linea of readFileSync(rutaEnv, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);

    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const N8N = (process.env.N8N_BASE ?? 'http://localhost:5678').replace(/\/+$/, '');
const SUPA = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const INEXISTENTE = 'LD-0000000000000-NOEX';
const TOKEN_FALSO = '00000000-0000-4000-8000-000000000000';

// Los webhooks del flujo, con el control que se espera de cada uno.
const WEBHOOKS = [
  {ruta: 'lead-nuevo', metodo: 'POST', esperado: 'sin auth', grupo: 'público',
    cuerpo: null /* se completa abajo: es el único que crea algo */},
  {ruta: 'lead-propuesta', metodo: 'GET', esperado: 'sin auth', grupo: 'público',
    query: `?lead_id=${INEXISTENTE}&token=${TOKEN_FALSO}`},
  {ruta: 'lead-acepta', metodo: 'POST', esperado: 'sin auth', grupo: 'público',
    cuerpo: {lead_id: INEXISTENTE, token: TOKEN_FALSO}},
  {ruta: 'lead-rechaza', metodo: 'POST', esperado: 'sin auth', grupo: 'público',
    cuerpo: {lead_id: INEXISTENTE, token: TOKEN_FALSO}},
  {ruta: 'lead-modifica', metodo: 'POST', esperado: 'sin auth', grupo: 'público',
    cuerpo: {lead_id: INEXISTENTE, token: TOKEN_FALSO, mensaje: 'prueba de exposición'}},
  {ruta: 'pago-confirmado', metodo: 'GET', esperado: 'sin auth', grupo: 'público',
    query: '?factura_id=FAC-0000-0000'},
  {ruta: 'pagar', metodo: 'GET', esperado: 'sin auth (token en el enlace)', grupo: 'público',
    query: `?f=FAC-0000-0000&t=${TOKEN_FALSO}`},
  {ruta: 'bolsa-postulaciones', metodo: 'GET', esperado: 'sin auth (token en el enlace)', grupo: 'público',
    query: `?t=${TOKEN_FALSO}`},
  {ruta: 'bolsa-elegir', metodo: 'POST', esperado: 'sin auth (token en el enlace)', grupo: 'público',
    cuerpo: {t: TOKEN_FALSO, postulacion_id: TOKEN_FALSO}},
  {ruta: 'stripe', metodo: 'POST', esperado: 'firma obligatoria', grupo: 'pasarela',
    cuerpo: {type: 'checkout.session.completed', data: {object: {payment_status: 'paid', metadata: {factura_id: 'FAC-0000-0000'}}}}},
  {ruta: 'propuesta-enviar', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {lead_id: INEXISTENTE, precio: 1, plazo: 'x', alcance: 'x'}},
  {ruta: 'proyecto-cerrado', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {lead_id: INEXISTENTE}},
  {ruta: 'trabajo-estado', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {lead_id: INEXISTENTE, estado: 'EN_PROGRESO'}},
  {ruta: 'lead-cancelar', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {lead_id: INEXISTENTE}},
  {ruta: 'pedido-rechazar', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {lead_id: INEXISTENTE, destino: 'descartar'}},
  {ruta: 'cambio-aceptar', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {lead_id: INEXISTENTE}},
  {ruta: 'cambio-rechazar', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {lead_id: INEXISTENTE}},
  {ruta: 'stripe-conectar', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {espacio_id: TOKEN_FALSO}},
  {ruta: 'stripe-estado', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {espacio_id: TOKEN_FALSO}},
  {ruta: 'factura-anular', metodo: 'POST', esperado: 'Header Auth', grupo: 'panel',
    cuerpo: {factura_id: 'FAC-0000-0000'}},
];

const sufijo = Date.now();
const EMAIL = `cliente.demo.exposicion.${sufijo}@ejemplo.com`;

WEBHOOKS[0].cuerpo = {
  nombre: 'Cliente Demo Exposicion',
  email: EMAIL,
  telefono: '+54 261 555 0177',
  servicio: 'Consultoría',
  presupuesto: 1200,
  urgencia: 'media',
  descripcion: 'Alta emitida por un cliente que no es un navegador, para medir la deuda S1.',
  fuente: 'test_exposicion',
};

async function rest(ruta, opciones = {}) {
  const res = await fetch(`${SUPA}/rest/v1/${ruta}`, {
    ...opciones,
    headers: {apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opciones.headers ?? {})},
  });

  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

  const texto = await res.text();

  return texto ? JSON.parse(texto) : [];
}

console.log('E16 — Exposición de los webhooks a un cliente que no es un navegador\n');
console.log(`Instancia: ${N8N}`);
console.log('Cliente:   Node ' + process.version + ', sin cabecera Origin ni Referer\n');

const filas = [];

for (const w of WEBHOOKS) {
  const url = `${N8N}/webhook/${w.ruta}${w.query ?? ''}`;

  let status = 0, cuerpo = '', crudo = '';

  try {
    const res = await fetch(url, {
      method: w.metodo,
      headers: {'Content-Type': 'application/json'},
      body: w.cuerpo ? JSON.stringify(w.cuerpo) : undefined,
    });

    status = res.status;
    crudo = await res.text();
    cuerpo = crudo.slice(0, 60).replace(/\s+/g, ' ');
  } catch (e) {
    status = -1;
    cuerpo = e.message.slice(0, 60);
  }

  // 403 = el webhook exigió una credencial que no se le dio.
  const rechazado = status === 403;

  // El webhook de la pasarela (stripe) responde 400 a un evento sin firma
  // válida y 200 a los que ignora. Lo que dice si se aplicó (S8) es el cuerpo:
  // { ok: false } cuando se rechazó.
  let aplicado = null;
  if (w.grupo === 'pasarela') {
    try { aplicado = JSON.parse(crudo).ok === true; } catch { /* cuerpo no-JSON */ }
  }

  filas.push({...w, status, cuerpo, rechazado, aplicado});
}

// ── Reporte ────────────────────────────────────────────────────────────────
const anchoRuta = Math.max(...filas.map((f) => f.ruta.length));

console.log('Respuesta a una invocación sin credencial:\n');
console.log('  ' + 'webhook'.padEnd(anchoRuta + 2) + 'mét.  HTTP  ¿exige credencial?  declarado en Tabla 10');
console.log('  ' + '─'.repeat(anchoRuta + 58));

for (const f of filas) {
  console.log(
    '  ' + f.ruta.padEnd(anchoRuta + 2) +
    f.metodo.padEnd(6) +
    String(f.status).padEnd(6) +
    (f.rechazado ? 'sí (403)' : 'NO').padEnd(20) +
    f.esperado,
  );
}

const sinAuth = filas.filter((f) => !f.rechazado && f.grupo === 'público');
const panel = filas.filter((f) => f.grupo === 'panel');
const panelRechazado = panel.filter((f) => f.rechazado);
const pasarela = filas.filter((f) => f.grupo === 'pasarela');

console.log('\nMedición');
console.log(`  · ${sinAuth.length} de ${WEBHOOKS.length} webhooks atendieron a un cliente sin credencial y sin navegador.`);
console.log(`  · ${panelRechazado.length} de ${panel.length} webhooks del panel interno respondieron 403.`);
for (const f of pasarela) {
  console.log(`  · ${f.ruta}: notificación SIN firma → ${
    f.aplicado ? 'se APLICÓ (S8 seguiría abierta)' : 'se ignoró sin persistir cambios (S8 cerrada)'
  }.`);
}

// La prueba de fondo: ¿la lista blanca de orígenes impidió algo?
let leadCreado = null;

if (SUPA && KEY) {
  try {
    const r = await rest(`leads?email=eq.${encodeURIComponent(EMAIL)}&select=lead_id,estado,tier,fuente`);

    leadCreado = r[0] ?? null;
  } catch { /* la base puede no estar disponible; la medición HTTP igual vale */ }
}

console.log('\nConsecuencia observada sobre el sistema de registro');
if (leadCreado) {
  console.log(`  ❗ El alta prosperó: se persistió ${leadCreado.lead_id} (tier ${leadCreado.tier}, fuente «${leadCreado.fuente}»)`);
  console.log('     desde un cliente que no es un navegador y sin credencial alguna. Es la');
  console.log('     demostración de lo que la nota de la Tabla 10 afirma: CORS es un control');
  console.log('     del navegador, no una autenticación de origen.');
} else if (SUPA && KEY) {
  console.log('  · el alta no llegó a persistirse; revisar que el flujo esté activo en n8n.');
} else {
  console.log('  · sin credenciales de base: se reporta sólo la medición HTTP.');
}

// Limpieza.
if (leadCreado) {
  try {
    await rest(`logs?lead_id=eq.${leadCreado.lead_id}`, {method: 'DELETE'});
    await rest(`leads?lead_id=eq.${leadCreado.lead_id}`, {method: 'DELETE'});
    console.log(`\n  (lead de prueba ${leadCreado.lead_id} eliminado)`);
  } catch (e) {
    console.log(`\n  (no se pudo limpiar: ${e.message})`);
  }
}

// El escenario NO falla por encontrar la exposición: la deuda está declarada.
// Falla si el reparto deja de ser el que la Tabla 11 dice, en cualquier
// dirección —si se cierra una deuda y el documento no se entera, o si se abre
// una nueva—.
const esperadoSinAuth = 6;
// 01-sep-2026: se sumó el webhook del panel factura-anular (cierra la
// transición ANULADA, §4.8 / Cap. 8 punto 7), de 6 a 7 con Header Auth.
const esperadoPanel = 7;
const s1Coincide = sinAuth.length === esperadoSinAuth && panelRechazado.length === esperadoPanel;

console.log(`\nResultado S1: ${s1Coincide ? 'el reparto coincide con la Tabla 11' : 'EL REPARTO CAMBIÓ respecto de la Tabla 11'}`);
if (!s1Coincide) {
  console.log(`  Tabla 11 declara ${esperadoSinAuth} sin autenticación de origen y ${esperadoPanel} con Header Auth;`);
  console.log(`  se midieron ${sinAuth.length} y ${panelRechazado.length}. Actualizá la Tabla 11 y el §4.6.`);
}

// S8 (cerrada): una notificación sin firma válida debe ignorarse (ok:false),
// no aplicarse. Si esto vuelve a dar true, la Tabla 11 y el §4.6 hay que
// volver a abrirlos para esa fila.
const pasarelaRow = pasarela[0] ?? null;
const s8Coincide = pasarelaRow ? pasarelaRow.aplicado === false : false;

console.log(`Resultado S8: ${s8Coincide ? 'la firma es obligatoria: una notificación sin firmar se ignora' : 'LA FIRMA SIGUE SIENDO OPCIONAL o el webhook no devolvió el cuerpo esperado'}`);
if (!s8Coincide) {
  console.log('  Se esperaba {"ok":false} para una notificación sin x-signature válida. Revisá el');
  console.log('  nodo «Code - Leer Notificacion MP» y la Tabla 11 (S8).');
}

const coincide = s1Coincide && s8Coincide;
process.exit(coincide ? 0 : 1);
