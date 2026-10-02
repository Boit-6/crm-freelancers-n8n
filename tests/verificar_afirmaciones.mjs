// Verifica que las afirmaciones cuantitativas del documento de la tesis sigan
// siendo ciertas sobre el código del repositorio.
//
// El dictamen verificó a mano cosas como «128 nodos funcionales / 11 webhooks /
// 5 tablas». Cada vez que el artefacto cambia, esos números pueden quedar
// desactualizados sin que nadie lo note. Este script los recalcula desde el
// código y compara contra `docs/afirmaciones-tesis.json`.
//
// Los cambios posteriores al corte documental se declaran ahí como
// `delta_documentado` + `nota`: quedan explicados en vez de aparecer como falla.
//
// Uso: node tests/verificar_afirmaciones.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(aqui, '..');
const leer = (...p) => readFileSync(path.join(raiz, ...p), 'utf8');
const leerWorkflow = (nombre) => JSON.parse(leer('workflow', nombre));

// ── Mediciones sobre el artefacto ──────────────────────────────────────────
function medirWorkflow(nombre) {
  const wf = leerWorkflow(nombre);
  const de = (tipo) => wf.nodes.filter((n) => n.type === 'n8n-nodes-base.' + tipo).length;
  const notas = de('stickyNote');

  return {
    total: wf.nodes.length,
    notas,
    funcionales: wf.nodes.length - notas,
    webhooks: de('webhook'),
    crons: de('scheduleTrigger'),
  };
}

// Nodos que anuncian un importe leyéndolo de `presupuesto`.
//
// `presupuesto` es lo que el interesado declara en el formulario; el importe
// comprometido es `precio_propuesto` (y `monto` una vez emitida la factura).
// Confundirlos apareció cinco veces: en la propuesta, en el PDF, en el INSERT de
// la factura, en el correo que la acompaña —que llegó a anunciar un importe
// distinto del que decía el PDF adjunto en el mismo envío— y en tres avisos de
// Telegram. Este recuento tiene que quedarse en cero.
function medirImportes() {
  const wf = leerWorkflow('crm_postgres.json');
  const sospechoso = /(monto|cobrado|inversion|inversión|por <b>\$)[^"]{0,80}\.presupuesto/i;

  // Los nodos que ELIGEN entre un campo y otro son justamente los que resuelven
  // la ambigüedad: no cuentan como uso incorrecto. El segundo es la versión del
  // primero dentro del cron de reconciliación (S5): aplica el mismo criterio
  // —manda `precio_propuesto`, `presupuesto` es sólo el respaldo de las
  // propuestas emitidas antes de que existiera la columna—.
  const resuelvenLaAmbiguedad = ['Code - Generar ID Factura', 'Code - Preparar Factura Reconciliada'];

  return wf.nodes.filter((n) => {
    if (resuelvenLaAmbiguedad.includes(n.name)) return false;

    return sospechoso.test(JSON.stringify(n.parameters || {}));
  }).length;
}

function medirEsquema() {
  const sql = leer('db', 'schema.sql');
  // Sólo cuenta sentencias reales: si el patrón aparece dentro de un comentario
  // que explica el porqué de una decisión, no es un objeto más del esquema.
  const sqlSinComentarios = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const contar = (re) => (sqlSinComentarios.match(re) || []).length;
  const servicioEnum = sql.match(/CREATE TYPE servicio_tipo AS ENUM\s*\(([^)]*)\)/);
  const servicioBase = servicioEnum ? servicioEnum[1].split(',').length : 0;
  // Los ALTER TYPE ... ADD VALUE de la sección de migraciones también cuentan.
  const servicioExtra = contar(/ALTER TYPE servicio_tipo ADD VALUE IF NOT EXISTS/g);

  return {
    tablas: contar(/CREATE TABLE IF NOT EXISTS/g),
    vistas: contar(/CREATE OR REPLACE VIEW/g),
    enums: contar(/CREATE TYPE \w+ AS ENUM/g),
    // El enum se declara con 7 y las migraciones agregan marketing y seo, que
    // en una base nueva ya vienen en la declaración: no hay que sumarlos dos veces.
    servicios: new Set([
      ...(servicioEnum ? servicioEnum[1].match(/'[a-z_]+'/g) || [] : []),
      ...(sql.match(/ALTER TYPE servicio_tipo ADD VALUE IF NOT EXISTS ('[a-z_]+')/g) || [])
        .map((s) => s.replace(/.*(\'[a-z_]+\')/, '$1')),
    ]).size,
    politicas: contar(/CREATE POLICY/g),
    indices: contar(/CREATE INDEX IF NOT EXISTS/g),
    servicioBase,
    servicioExtra,
  };
}

// Los umbrales de scoring ahora son configurables; lo que la tesis documenta
// son los DEFAULTS, que es lo que se lee del nodo.
//
// Se miden además las ponderaciones de la Tabla 5, y no sólo los umbrales,
// porque la deriva del 23-ago-2026 pasó justo por ahí: se cambió a qué servicio
// mapea la opción «Otro» del formulario y el .docx siguió describiendo el valor
// viejo, sin que nada fallara. Las ponderaciones se expresan en puntos, que es
// como las declara la Tabla 5.
function medirScoring() {
  const wf = leerWorkflow('crm_postgres.json');
  const js = wf.nodes.find((n) => n.name === 'Code - Scoring').parameters.jsCode;
  const jsNorm = wf.nodes.find((n) => n.name === 'Code - Normalizar Lead').parameters.jsCode;

  // El nodo lee su configuración con tres ayudantes —`leerEnv` para los
  // escalares, `tabla` para los mapas clave:puntos y `tramos` para los cortes
  // de presupuesto—, todos con la misma firma (clave, valor por defecto).
  const leerDefaultCrudo = (clave) => {
    const m = js.match(new RegExp("(?:leerEnv|tabla|tramos)\\('" + clave + "',\\s*'([^']*)'\\)"));

    return m ? m[1] : null;
  };
  const leerDefault = (clave) => {
    const v = leerDefaultCrudo(clave);

    return v === null ? null : Number(v);
  };
  // "clave:puntos,clave:puntos" → {clave: puntos}
  const tablaDefault = (clave) => Object.fromEntries(
    (leerDefaultCrudo(clave) || '')
      .split(',')
      .map((p) => p.split(':'))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.trim(), Number(v)]),
  );
  const maximoDe = (tabla) => Math.max(...Object.values(tabla));

  const porServicio = tablaDefault('SCORING_SERVICIO');
  const porUrgencia = tablaDefault('SCORING_URGENCIA');
  const porPresupuesto = tablaDefault('SCORING_PRESUPUESTO');

  // A qué servicio traduce el normalizador cada caso, antes de que el scoring
  // lo pondere. Sin este paso las ponderaciones de la Tabla 5 se leen sobre un
  // espacio de entrada que el pipeline real nunca produce.
  const mapaSvc = jsNorm.match(/const svcMap = \{([^}]*)\}/);
  const traduce = (opcion) => {
    const m = mapaSvc && mapaSvc[1].match(new RegExp("'" + opcion + "'\\s*:\\s*'([a-z_]+)'"));

    return m ? m[1] : null;
  };
  const respaldo = (jsNorm.match(/svcMap\[[^\]]*\]\s*\|\|\s*'([a-z_]+)'/) || [])[1] || null;
  const puntosDe = (servicio) => (servicio && porServicio[servicio] !== undefined
    ? porServicio[servicio]
    : leerDefault('SCORING_SERVICIO_DEFAULT'));

  return {
    umbralHot: leerDefault('SCORING_UMBRAL_HOT'),
    umbralWarm: leerDefault('SCORING_UMBRAL_WARM'),
    serviciosPonderados: Object.keys(porServicio).length,
    // Puntos que termina recibiendo la opción «Otro» del formulario.
    puntosOtro: puntosDe(traduce('otro')),
    // Puntos que recibe un servicio que el normalizador no supo mapear.
    puntosRespaldo: puntosDe(respaldo),
    // Techo del modelo: el mejor tramo de cada criterio más los dos bonus.
    puntajeMaximo: maximoDe(porPresupuesto) + maximoDe(porUrgencia) + maximoDe(porServicio) +
      leerDefault('SCORING_BONUS_TELEFONO') + leerDefault('SCORING_BONUS_DESCRIPCION'),
  };
}

// ── Afirmaciones cualitativas ──────────────────────────────────────────────
// Las comprobaciones de arriba miden CANTIDADES. La deriva del 29-ago-2026
// mostró que eso no alcanza: tres afirmaciones del documento habían dejado de
// ser ciertas sin que nada fallara, porque ninguna es un número. El §4.3.1
// describía el orden de ejecución invertido; el §4.8 decía que la rama fría
// sólo avisaba al profesional, cuando ya acusa recibo al cliente; y declaraba
// como reglas vigentes dos transiciones de estado que ningún nodo ejecuta.
//
// Lo que sigue verifica esas afirmaciones —las de forma, no las de tamaño—
// contra el flujo exportado, que es lo que la tesis declara como fuente.
function cadenaDesde(wf, inicio) {
  const sig = (n) => ((wf.connections[n] || {}).main || []).flat().filter(Boolean).map((c) => c.node);
  const orden = [];
  const visto = new Set([inicio]);
  let frente = [inicio];

  while (frente.length) {
    orden.push(...frente);
    frente = [...new Set(frente.flatMap(sig))].filter((n) => !visto.has(n));
    frente.forEach((n) => visto.add(n));
  }

  return orden;
}

function medirCualitativas() {
  const wf = leerWorkflow('crm_postgres.json');
  const nodo = (nombre) => wf.nodes.find((n) => n.name === nombre);
  const params = (nombre) => JSON.stringify((nodo(nombre) || {}).parameters || {});
  const webhooks = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  const authDe = (ruta) => {
    const w = webhooks.find((n) => (n.parameters || {}).path === ruta);

    return w ? (w.parameters.authentication || null) : undefined;
  };
  const salidasDe = (n) => ((wf.connections[n] || {}).main || []).flat().filter(Boolean).map((c) => c.node);

  const captacion = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook' &&
    (n.parameters || {}).path === 'lead-nuevo');
  const cadena = captacion ? cadenaDesde(wf, captacion.name) : [];
  const pos = (nombre) => cadena.indexOf(nombre);

  // Rama fría: los nodos que cuelgan del condicional de nivel por la salida falsa.
  const condicionalNivel = wf.nodes.find((n) => /Es HOT o WARM/i.test(n.name));
  const ramaFria = condicionalNivel
    ? (((wf.connections[condicionalNivel.name] || {}).main || [])[1] || []).map((c) => c.node)
    : [];

  const escribenEstadoPago = wf.nodes.filter((n) => /estado_pago\s*=\s*'/.test(params(n.name)));
  const marcanCobrado = escribenEstadoPago.filter((n) => /estado_pago\s*=\s*'COBRADO'/.test(params(n.name)));
  // Guarda aceptada: PENDIENTE, o PENDIENTE/VENCIDA para registrar un pago
  // tardío. Nunca desde ANULADA (ni COBRADO: eso sería cobrar dos veces).
  const sinGuarda = marcanCobrado.filter((n) =>
    !/AND estado_pago\s*(=\s*'PENDIENTE'|IN \('PENDIENTE','VENCIDA'\))/.test(params(n.name)));
  const asignan = (valor) => wf.nodes
    .filter((n) => new RegExp("estado_pago\\s*=\\s*'" + valor + "'").test(params(n.name)))
    .map((n) => n.name);

  const conAuth = webhooks.filter((n) => (n.parameters || {}).authentication === 'headerAuth')
    .map((n) => n.parameters.path).sort();
  // stripe-conectar y stripe-estado desde el 24-sep-2026: el alta de cobros de
  // cada desarrollador, que también pasa por /api/crm con la credencial.
  // pedido-rechazar desde el 24-sep-2026 (bolsa de proyectos).
  const panelEsperado = ['cambio-aceptar', 'cambio-rechazar', 'factura-anular', 'lead-cancelar',
    'propuesta-enviar', 'proyecto-cerrado', 'trabajo-estado', 'stripe-conectar', 'stripe-estado',
    'pedido-rechazar'].sort();

  return [
    {
      id: 'orden-scoring-antes-de-insert',
      seccion: '§4.3.1 y §4.8',
      afirma: 'el cálculo del puntaje precede a la persistencia del lead',
      ok: pos('Code - Scoring') >= 0 && pos('Postgres - Insert Lead') >= 0 &&
        pos('Code - Scoring') < pos('Postgres - Insert Lead'),
      detalle: 'cadena real: ' + cadena.slice(0, 4).join(' → '),
    },
    {
      id: 'rama-fria-avisa-al-cliente',
      seccion: '§4.3.1 y §4.8',
      afirma: 'el lead COLD genera aviso interno y acuse de recibo al interesado',
      ok: ramaFria.some((n) => /telegram/i.test(n)) && ramaFria.some((n) => /gmail/i.test(n)),
      detalle: 'rama fría: ' + (ramaFria.join(' + ') || '(vacía)'),
    },
    {
      // Hasta el 23-sep-2026 era «sólo desde PENDIENTE», como dice §4.8. Pero el
      // cron pasa la factura a VENCIDA mientras su link de pago sigue vivo, y el
      // pago tardío quedaba acreditado en MercadoPago sin registrarse (ver
      // docs/modulo-pagos.md §1.1). §4.8 de la tesis tiene que actualizarse.
      id: 'cobrado-desde-pendiente-o-vencida',
      seccion: '§4.8 (desvío: 23-sep-2026, pago tardío)',
      afirma: 'una factura sólo pasa a COBRADO desde PENDIENTE o VENCIDA, nunca desde ANULADA',
      ok: marcanCobrado.length > 0 && sinGuarda.length === 0,
      detalle: marcanCobrado.length + ' nodos marcan COBRADO; sin guarda: ' +
        (sinGuarda.map((n) => n.name).join(', ') || 'ninguno'),
    },
    {
      // Hasta el 01-sep-2026 esta afirmación era la inversa: VENCIDA y ANULADA
      // estaban previstos en el enumerado y NINGÚN nodo los escribía (limitación
      // declarada en §4.8 y en el punto 7 del Capítulo 8). Se cierra acá: ahora
      // se verifica que ambas transiciones existan Y que sigan siendo
      // condicionales sobre el estado previo, con el mismo criterio de UPDATE
      // atómico que ya usaba 'cobrado-desde-pendiente-o-vencida'.
      id: 'vencida-solo-desde-pendiente',
      seccion: '§4.8 y Cap. 8 (punto 7, cerrado 01-sep-2026)',
      afirma: 'una factura sólo pasa a VENCIDA desde PENDIENTE, con un umbral de días de gracia',
      ok: asignan('VENCIDA').length === 1 &&
        /WHERE estado_pago = 'PENDIENTE' AND fecha_vencimiento < now\(\)/.test(
          params('Postgres - Marcar Facturas Vencidas'),
        ),
      detalle: 'la escribe: ' + (asignan('VENCIDA').join(', ') || 'ninguno'),
    },
    {
      id: 'anulada-desde-pendiente-o-vencida',
      seccion: '§4.8 y Cap. 8 (punto 7, cerrado 01-sep-2026)',
      afirma: 'una factura sólo pasa a ANULADA desde PENDIENTE o VENCIDA, nunca desde COBRADO',
      ok: asignan('ANULADA').length === 1 &&
        /estado_pago IN \('PENDIENTE','VENCIDA'\)/.test(params('Postgres - Marcar Factura Anulada')) &&
        !/estado_pago IN \([^)]*COBRADO/.test(params('Postgres - Marcar Factura Anulada')),
      detalle: 'la escribe: ' + (asignan('ANULADA').join(', ') || 'ninguno'),
    },
    {
      id: 'aceptacion-condicional-atomica',
      seccion: '§4.3.2 y RNF2',
      afirma: 'la transición a ACEPTADO es condicional sobre el estado previo y el token vigente',
      ok: /estado IN \('PROPUESTA_ENVIADA','EN_SEGUIMIENTO'\)/.test(params('Postgres - Marcar Aceptado')) &&
        /accept_token::text = \$2/.test(params('Postgres - Marcar Aceptado')) &&
        /token_expira_en > now\(\)/.test(params('Postgres - Marcar Aceptado')),
      detalle: 'nodo Postgres - Marcar Aceptado',
    },
    {
      id: 'webhooks-del-panel-autenticados',
      seccion: '§4.5, Tabla 10 y Tabla 11 (S1)',
      afirma: 'los webhooks invocados desde el tablero exigen Header Auth y ningún otro lo hace',
      ok: JSON.stringify(conAuth) === JSON.stringify(panelEsperado),
      detalle: 'con headerAuth: ' + conAuth.join(', '),
    },
    {
      id: 'captacion-sin-auth-de-origen',
      seccion: 'Tabla 11 (S1)',
      afirma: 'el webhook de captación sigue sin autenticación de origen (deuda declarada)',
      ok: authDe('lead-nuevo') === null,
      detalle: 'lead-nuevo → ' + (authDe('lead-nuevo') || 'sin autenticación'),
    },
    {
      id: 'pago-confirmado-exige-token',
      seccion: 'Tabla 11 (S1, cerrada)',
      afirma: 'el modo de desarrollo de pago exige pago_token, no sólo factura_id',
      ok: /pago_token/.test(params('Code - Validar Pago')) &&
        /AND pago_token = \$2::uuid/.test(params('Postgres - Marcar Cobrado')),
      detalle: 'Code - Validar Pago exige pago_token; Postgres - Marcar Cobrado lo verifica en el WHERE',
    },
    {
      id: 'accept-token-rota-en-reenvios',
      seccion: 'Tabla 11 (S3, cerrada)',
      afirma: 'accept_token rota en cada reenvío de la propuesta (cambios y seguimiento), no en el envío inicial',
      ok: /accept_token = gen_random_uuid\(\)/.test(params('Postgres - Reabrir Propuesta')) &&
        /accept_token = gen_random_uuid\(\)/.test(params('Postgres - Reabrir Original')) &&
        /UPDATE leads SET accept_token = gen_random_uuid\(\)/.test(params('Postgres - Leer Leads Follow-up')) &&
        !/accept_token\s*=\s*gen_random_uuid\(\)/.test(params('Postgres - Estado Propuesta Enviada')) &&
        /AND accept_token = \$3::uuid/.test(params('Postgres - Estado Propuesta Enviada')),
      detalle: 'rota en Reabrir Propuesta, Reabrir Original y Leer Leads Follow-up; no en el envío inicial',
    },
    {
      id: 'frontend-no-escribe-negocio',
      seccion: '§4.1 y RNF4',
      afirma: 'ninguna salida del condicional de duplicado reinserta el lead',
      ok: salidasDe('IF - Lead Nuevo?').some((n) => /No-op/i.test(n)),
      detalle: 'salidas: ' + salidasDe('IF - Lead Nuevo?').join(' | '),
    },
  ];
}

const medidas = {
  crm: medirWorkflow('crm_postgres.json'),
  tickets: medirWorkflow('tickets.json'),
  db: medirEsquema(),
  importesDesdePresupuesto: medirImportes(),
  scoring: medirScoring(),
};

const cualitativas = medirCualitativas();

// ── Comparación ────────────────────────────────────────────────────────────
const decl = JSON.parse(leer('docs', 'afirmaciones-tesis.json'));
const valorDe = (ruta) => ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), medidas);

let ok = 0, divergentes = 0, explicados = 0;
const filas = [];

for (const a of decl.afirmaciones) {
  const medido = valorDe(a.medida);
  const esperado = a.valor_tesis + (a.delta_documentado || 0);
  const coincide = medido === esperado;
  const tieneDelta = (a.delta_documentado || 0) !== 0;

  if (!coincide) divergentes++;
  else if (tieneDelta) explicados++;
  else ok++;

  filas.push({
    estado: !coincide ? 'DIVERGE' : tieneDelta ? 'EXPLICADO' : 'OK',
    id: a.id,
    tesis: a.valor_tesis,
    delta: a.delta_documentado || 0,
    esperado,
    medido: medido === undefined ? '(no medido)' : medido,
    descripcion: a.descripcion,
    nota: a.nota,
  });
}

// ── Reporte ────────────────────────────────────────────────────────────────
const anchoId = Math.max(...filas.map((f) => f.id.length));

console.log('Afirmaciones de la tesis vs. el repositorio');
console.log('Corte documental: ' + decl.corte_documental + '  (' + decl.referencia + ')\n');

for (const f of filas) {
  const delta = f.delta ? ` ${f.delta > 0 ? '+' : ''}${f.delta}` : '';

  console.log(
    f.estado.padEnd(10) + f.id.padEnd(anchoId + 2) +
    `tesis ${String(f.tesis).padStart(4)}${delta.padEnd(4)} → esperado ${String(f.esperado).padStart(4)}   medido ${String(f.medido).padStart(4)}`,
  );
  if (f.estado !== 'OK') console.log(' '.repeat(10) + '↳ ' + f.descripcion);
  if (f.estado === 'EXPLICADO' && f.nota) console.log(' '.repeat(10) + '↳ ' + f.nota);
}

console.log('\nMediciones actuales del artefacto:');
console.log('  CRM      : ' + medidas.crm.total + ' nodos (' + medidas.crm.funcionales + ' funcionales + ' + medidas.crm.notas + ' notas), ' + medidas.crm.webhooks + ' webhooks, ' + medidas.crm.crons + ' crons');
console.log('  Tickets  : ' + medidas.tickets.total + ' nodos (' + medidas.tickets.funcionales + ' funcionales + ' + medidas.tickets.notas + ' notas), ' + medidas.tickets.webhooks + ' webhooks, ' + medidas.tickets.crons + ' cron');
console.log('  Esquema  : ' + medidas.db.tablas + ' tablas, ' + medidas.db.vistas + ' vistas, ' + medidas.db.enums + ' enums, ' + medidas.db.politicas + ' políticas RLS, ' + medidas.db.indices + ' índices');
console.log('  Scoring  : HOT ≥ ' + medidas.scoring.umbralHot + ', WARM ≥ ' + medidas.scoring.umbralWarm +
  ', ' + medidas.scoring.serviciosPonderados + ' servicios ponderados, máximo ' + medidas.scoring.puntajeMaximo);
console.log('  Importes : ' + medidas.importesDesdePresupuesto + ' nodos anuncian un importe leyendo presupuesto (debe ser 0)');
console.log('  Servicio : «Otro» → ' + medidas.scoring.puntosOtro + ' pts · respaldo del normalizador → ' + medidas.scoring.puntosRespaldo + ' pts');

// ── Reporte de las afirmaciones cualitativas ───────────────────────────────
const anchoCual = Math.max(...cualitativas.map((c) => c.id.length));
const rotas = cualitativas.filter((c) => !c.ok);

console.log('\nAfirmaciones cualitativas (forma del flujo, no cantidades):');
for (const c of cualitativas) {
  console.log('  ' + (c.ok ? 'OK  ' : 'FALLA') + '  ' + c.id.padEnd(anchoCual + 2) + c.seccion);
  if (!c.ok) {
    console.log('        ↳ el documento afirma que ' + c.afirma);
    console.log('        ↳ ' + c.detalle);
  }
}

console.log('\nResultado: ' + ok + ' sin cambios, ' + explicados + ' con desvío documentado, ' + divergentes + ' divergentes');
console.log('           ' + (cualitativas.length - rotas.length) + '/' + cualitativas.length + ' afirmaciones cualitativas verificadas');

if (rotas.length) {
  console.log('\n✗ Hay afirmaciones cualitativas del documento que ya no describen el flujo.');
  console.log('  Corregí el texto de la sección indicada, o el nodo del flujo, según cuál');
  console.log('  de los dos quedó desactualizado.');
}

if (divergentes) {
  console.log('\n✗ Hay afirmaciones del documento que ya no son ciertas.');
  console.log('  Actualizá el .docx, o declará el cambio en docs/afirmaciones-tesis.json');
  console.log('  con `delta_documentado` + `nota` explicando de dónde sale la diferencia.');
}

process.exit(divergentes || rotas.length ? 1 : 0);
