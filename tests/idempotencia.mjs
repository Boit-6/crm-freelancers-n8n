#!/usr/bin/env node
// Verificación EJECUTABLE de las dos garantías de idempotencia que la Tabla 11
// declara cerradas: S6 (deduplicación en la captación) y S5 (reconciliación de
// facturas). No las simula: levanta un PostgreSQL desechable, aplica el
// `db/schema.sql` del repositorio y **ejecuta las mismas consultas que llevan
// escritas los nodos del workflow**, leídas del propio `crm_postgres.json`.
//
// Que el SQL salga del artefacto y no de una copia pegada acá es lo que hace
// que la prueba siga diciendo algo si alguien toca un nodo: si el INSERT deja
// de ser condicional, este verificador se pone en rojo.
//
// Las consultas que representan una escritura real de n8n corren con
// `SET ROLE n8n_writer` (el rol acotado que cierra S4 de la Tabla 11, §4.6),
// no como el superusuario `postgres` que arma los datos de prueba. Antes de
// esto la única cobertura de una escritura bajo un rol sin BYPASSRLS era un
// único caso de tests/rls/casos.sql; si `n8n_writer` careciera de un
// privilegio que alguna de estas consultas necesita, esta verificación lo
// habría dejado en rojo en vez de pasarlo por alto.
//
// Los parámetros se enlazan con PREPARE/EXECUTE, que es la misma vía por la que
// el nodo Postgres de n8n los pasa ($1, $2, …): no hay interpolación de texto.
//
// Uso:  node tests/idempotencia.mjs   (o `npm run test:idempotencia`)
import {execFile, execFileSync, execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(aqui, '..');
const CONTENEDOR = 'crm-idem-test';
const IMAGEN = 'postgres:16-alpine';

const sh = (cmd) => execSync(cmd, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
const limpiar = () => {
  try { sh(`docker rm -f ${CONTENEDOR}`); } catch { /* no existía */ }
};

// ── El SQL sale del workflow, no de este archivo ────────────────────────────
const wf = JSON.parse(readFileSync(path.join(raiz, 'workflow', 'crm_postgres.json'), 'utf8'));

function consultaDe(nombreNodo) {
  const nodo = wf.nodes.find((n) => n.name === nombreNodo);

  if (!nodo?.parameters?.query) throw new Error(`El nodo «${nombreNodo}» ya no lleva una consulta SQL.`);

  // Las consultas de n8n son expresiones: `=` inicial y `{{ … }}` interpolados.
  // Acá se resuelven los `$env` con los MISMOS valores por defecto que declara
  // el propio nodo, que son los que rigen si nadie define la variable.
  return nodo.parameters.query
    .replace(/^=/, '')
    .replace(/\{\{\s*\$env\.\w+\s*\|\|\s*(\d+)\s*\}\}/g, '$1')
    .trim()
    .replace(/;$/, '');
}

const SQL_INSERT_LEAD = consultaDe('Postgres - Insert Lead');
const SQL_LEER_ACEPTADO = consultaDe('Postgres - Leer Aceptado Sin Factura');
const SQL_INSERT_FACTURA = consultaDe('Postgres - Insert Factura Reconciliada');
const SQL_LEAD_FACTURADO = consultaDe('Postgres - Lead a Facturado (Reconciliación)');
const SQL_COBRADO = consultaDe('Postgres - Marcar Cobrado Stripe');
const SQL_BUSCAR_NO_APLICADO = consultaDe('Postgres - Buscar Pago No Aplicado');
const SQL_LOG_NO_APLICADO = consultaDe('Postgres - Log Pago No Aplicado');
const SQL_FACTURA_COBRADA_CIERRE = consultaDe('Postgres - Factura Cobrada');
const SQL_MARCAR_ACEPTADO = consultaDe('Postgres - Marcar Aceptado');
const SQL_CREAR_TICKETS = consultaDe('Postgres - Crear Tickets Proyecto');
const wfTickets = JSON.parse(readFileSync(path.join(raiz, 'workflow', 'tickets.json'), 'utf8'));
const SQL_ESCALAR = wfTickets.nodes.find((n) => n.name === 'Postgres - Escalar Tickets Quietos')
  .parameters.query.trim().replace(/;$/, '');
const JS_CLASIFICAR_NO_APLICADO = wf.nodes
  .find((n) => n.name === 'Code - Clasificar Pago No Aplicado').parameters.jsCode;

// Si algún `{{ … }}` sobrevivió, la consulta no es ejecutable y el verificador
// estaría probando otra cosa. Mejor fallar acá y a la vista.
for (const [nombre, sql] of Object.entries({SQL_INSERT_LEAD, SQL_LEER_ACEPTADO, SQL_INSERT_FACTURA, SQL_LEAD_FACTURADO,
  SQL_COBRADO, SQL_BUSCAR_NO_APLICADO, SQL_LOG_NO_APLICADO, SQL_FACTURA_COBRADA_CIERRE,
  SQL_MARCAR_ACEPTADO, SQL_CREAR_TICKETS, SQL_ESCALAR})) {
  if (sql.includes('{{')) throw new Error(`${nombre} conserva una expresión sin resolver: ${sql}`);
}

let ok = 0;
let fallas = 0;

function comprobar(descripcion, condicion, detalle = '') {
  if (condicion) {
    ok++;
    console.log(`OK    ${descripcion}`);
  } else {
    fallas++;
    console.log(`FALLA ${descripcion}${detalle ? `\n      ${detalle}` : ''}`);
  }
}

let codigoSalida = 0;

// Espera a que PostgreSQL acepte conexiones. El bucle vive acá y no dentro de
// `sh -c "for i in $(seq 1 60); …"`, que es como estaba: en Windows execSync
// usa cmd.exe, que no expande `$(seq 1 60)` y se lo pasa intacto a la shell del
// contenedor —donde funciona—, pero en Linux lo expande la shell de afuera e
// inserta saltos de línea que rompen el `for`. El resultado era una verificación
// que pasaba en la máquina de desarrollo y fallaba en CI.
function esperarPostgres(intentos = 120) {
  for (let i = 0; i < intentos; i++) {
    try {
      // `-h 127.0.0.1` fuerza TCP a propósito. Durante initdb, la imagen de
      // postgres levanta un servidor temporal que escucha SÓLO por socket Unix
      // (listen_addresses=''), y un pg_isready sin -h lo da por bueno: la
      // verificación seguía y psql fallaba al conectarse un instante después.
      execFileSync('docker',
        ['exec', CONTENEDOR, 'pg_isready', '-q', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres'],
        {stdio: 'ignore'});
      return;
    } catch {
      // Espera sincrónica de 500 ms sin depender de la shell.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  throw new Error('PostgreSQL no aceptó conexiones dentro del tiempo previsto.');
}

try {
  console.log(`· Levantando ${IMAGEN} …`);
  limpiar();
  sh(`docker run -d --name ${CONTENEDOR} -e POSTGRES_PASSWORD=postgres ${IMAGEN}`);
  esperarPostgres();

  const psql = (entrada, args = []) =>
    execFileSync(
      'docker',
      ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args, '-f', '-'],
      {encoding: 'utf8', input: 'SET client_min_messages TO WARNING;\n' + entrada},
    );

  // -t (sin encabezados), -A (sin alineación) y -q (sin las etiquetas de estado
  // «SET», «PREPARE», …) para que la salida sean sólo las filas devueltas.
  const valor = (sql) => psql(sql, ['-t', '-A', '-q']).trim();
  const filas = (sql) => valor(sql).split('\n').filter((l) => l !== '');

  console.log('· Aplicando el esquema …');
  psql(readFileSync(path.join(aqui, 'rls', 'bootstrap.sql'), 'utf8'));
  psql(readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8'));
  // Un admin con la cuenta confirmada, y por lo tanto con su espacio: mientras
  // el formulario no diga de qué espacio viene el pedido, los leads van al del
  // admin (leads_espacio_por_defecto). Sin ninguno, la base los rechaza.
  psql(`
    INSERT INTO admin_emails (email) VALUES ('admin@test.com');
    INSERT INTO auth.users (email, email_confirmed_at) VALUES ('admin@test.com', now());
    -- Otra desarrolladora, con su formulario en /f/estudio-ana.
    INSERT INTO auth.users (email, email_confirmed_at) VALUES ('ana@estudio.com', now());
    UPDATE espacios SET slug = 'estudio-ana', nombre = 'Estudio Ana'
    WHERE dueno_id = (SELECT id FROM auth.users WHERE email = 'ana@estudio.com');
  `);

  const lit = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

  // Cada llamada a psql abre una sesión nueva, y las sentencias preparadas son
  // por sesión: la consulta del nodo se PREPARA y se EJECUTA en la misma vuelta.
  // El PREPARE también es la validación de tipos que hace `test:sql`.
  const ejecutar = (sql, valores = []) => {
    const args = valores.length ? `(${valores.map(lit).join(', ')})` : '';

    // SET ROLE: la sesión se abre como `postgres` (superusuario, para poder
    // sembrar los datos de prueba), pero la consulta del nodo se ejecuta
    // como `n8n_writer`, el rol sin BYPASSRLS que usa la conexión real de
    // n8n. Un superusuario puede tomar cualquier rol sin necesitar LOGIN ni
    // contraseña; esto no requiere credenciales del rol acotado.
    return filas(`SET ROLE n8n_writer;\nPREPARE consulta AS ${sql};\nEXECUTE consulta${args};`);
  };

  // Un lead tal como lo entrega `Code - Scoring`: los doce parámetros del nodo.
  // `espacio` vacío = el formulario de la raíz; con valor, el de /f/<slug>.
  const insertarLead = (over = {}) => {
    const l = {
      lead_id: 'LD-1000000000000-AAAA',
      nombre: 'Juan Pérez',
      email: 'juan@test.com',
      telefono: '+54 11 5555 5555',
      presupuesto: 6000,
      urgencia: 'alta',
      servicio: 'ecommerce',
      // Con coma a propósito: es el caso que rompía la lista de parámetros
      // separada por comas de n8n y obligó a pasarlos como arreglo.
      descripcion: 'Una tienda, con stock y pagos.',
      fuente: 'formulario_web',
      score: 100,
      tier: 'HOT',
      espacio: '',
      presupuesto_rango: '2000_5000',
      compartir_bolsa: true,
      ...over,
    };
    return ejecutar(SQL_INSERT_LEAD, [l.lead_id, l.nombre, l.email, l.telefono, l.presupuesto,
      l.urgencia, l.servicio, l.descripcion, l.fuente, l.score, l.tier, l.espacio,
      l.presupuesto_rango, l.compartir_bolsa]).length;
  };

  console.log('\n── S6 · Deduplicación por correo en la captación ──\n');

  comprobar('el primer envío del formulario crea el lead',
    insertarLead() === 1);

  comprobar('el segundo envío con el mismo correo NO crea un lead nuevo (doble clic)',
    insertarLead({lead_id: 'LD-1000000000001-BBBB'}) === 0);

  comprobar('y tampoco creó una segunda fila en la base',
    valor("SELECT count(*) FROM leads WHERE email = 'juan@test.com';") === '1');

  comprobar('el correo se compara sin distinguir mayúsculas',
    insertarLead({lead_id: 'LD-1000000000002-CCCC', email: 'JUAN@Test.com'}) === 0);

  comprobar('otro interesado, con otro correo, sí entra',
    insertarLead({lead_id: 'LD-1000000000003-DDDD', email: 'ana@test.com'}) === 1);

  // Cada desarrollador tiene su formulario: el mismo interesado puede escribirle
  // a otro dentro de la ventana y no es un doble clic.
  comprobar('el mismo correo, en el formulario de OTRO espacio, sí entra',
    insertarLead({lead_id: 'LD-1000000000005-FFFF', espacio: 'estudio-ana'}) === 1);

  comprobar('y queda en ese espacio, no en el del admin',
    valor(`SELECT e.slug FROM leads l JOIN espacios e ON e.id = l.espacio_id
           WHERE l.lead_id = 'LD-1000000000005-FFFF';`) === 'estudio-ana');

  comprobar('el doble clic dentro de ese mismo espacio sigue sin duplicar',
    insertarLead({lead_id: 'LD-1000000000006-GGGG', espacio: 'estudio-ana'}) === 0);

  comprobar('un formulario con una dirección que no existe no crea nada',
    insertarLead({lead_id: 'LD-1000000000007-HHHH', email: 'nadie@test.com', espacio: 'no-existe'}) === 0
      && valor("SELECT count(*) FROM leads WHERE email = 'nadie@test.com';") === '0');

  comprobar('la descripción con comas llegó entera (los parámetros no se partieron)',
    valor("SELECT descripcion FROM leads WHERE lead_id = 'LD-1000000000000-AAAA';")
      === 'Una tienda, con stock y pagos.');

  comprobar('el lead conserva su puntaje y su nivel',
    valor("SELECT score || '/' || tier FROM leads WHERE lead_id = 'LD-1000000000000-AAAA';") === '100/HOT');

  comprobar('guarda el rango de presupuesto y el consentimiento de compartirlo en la bolsa',
    valor("SELECT presupuesto_rango || '/' || compartir_bolsa FROM leads WHERE lead_id = 'LD-1000000000000-AAAA';")
      === '2000_5000/true');

  // Pasada la ventana, el mismo correo vuelve a ser un lead legítimo: es una
  // consulta nueva del mismo interesado, no un doble clic.
  psql("UPDATE leads SET creado_en = now() - interval '30 minutes' WHERE email = 'juan@test.com';");

  comprobar('vencida la ventana, el mismo correo vuelve a generar un lead',
    insertarLead({lead_id: 'LD-1000000000004-EEEE'}) === 1);

  // ── El caso que la prueba secuencial no ve ────────────────────────────────
  // Un doble clic no produce dos envíos ordenados: produce dos peticiones que
  // se solapan. Cada una abre su propia transacción y, bajo READ COMMITTED,
  // ninguna ve la fila que la otra todavía no commiteó, de modo que el
  // `WHERE NOT EXISTS` por sí solo las deja pasar a las dos. Se comprobó
  // contra el sistema vivo: dos POST a /webhook/lead-nuevo separados por 150 ms
  // insertaban dos leads. Lo que cierra la carrera es el cerrojo consultivo
  // `pg_try_advisory_xact_lock` sobre el correo, que sólo una de las dos
  // transacciones consigue.
  //
  // Acá se reproduce esa concurrencia de verdad: la sesión A inserta y retiene
  // la transacción dos segundos; la sesión B entra a la mitad.
  const psqlAsincrono = (entrada) =>
    new Promise((resolver) => {
      const hijo = execFile(
        'docker',
        ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-t', '-A', '-f', '-'],
        {encoding: 'utf8'},
        (error, stdout, stderr) => resolver({error, stdout, stderr}),
      );

      hijo.stdin.end(entrada);
    });

  const sentenciaLead = (leadId, correo) =>
    `SET ROLE n8n_writer;\n` +
    `PREPARE consulta AS ${SQL_INSERT_LEAD};\n` +
    `EXECUTE consulta(${[leadId, 'Doble Clic', correo, '', 1000, 'media', 'consultoria',
      'Dos peticiones solapadas.', 'formulario_web', 50, 'WARM', '', '', false].map(lit).join(', ')});\n`;

  const correoCarrera = 'concurrente@test.com';
  const sesionA = psqlAsincrono(`BEGIN;\n${sentenciaLead('LD-3000000000000-AAAA', correoCarrera)}SELECT pg_sleep(2);\nCOMMIT;\n`);

  await new Promise((r) => setTimeout(r, 500));
  await psqlAsincrono(sentenciaLead('LD-3000000000001-BBBB', correoCarrera));
  await sesionA;

  comprobar('dos envíos SIMULTÁNEOS del mismo correo dejan un solo lead',
    valor(`SELECT count(*) FROM leads WHERE email = '${correoCarrera}';`) === '1',
    `quedaron ${valor(`SELECT count(*) FROM leads WHERE email = '${correoCarrera}';`)}`);

  console.log('\n── S5 · Reconciliación de la factura perdida ──\n');

  // Escenario de la deuda: la aceptación se aplicó y la cadena se cortó antes
  // de persistir la factura (es lo que pasa si falla Gotenberg o el nodo de
  // correo).
  psql(`
    INSERT INTO leads (lead_id, nombre, email, presupuesto, servicio, estado, fecha_aceptacion, precio_propuesto)
    VALUES ('LD-2000000000000-PERD', 'Cliente Huérfano', 'huerfano@test.com', 3000, 'desarrollo_web',
            'ACEPTADO', now() - interval '60 minutes', 7200),
           ('LD-2000000000001-RECI', 'Aceptación En Vuelo', 'envuelo@test.com', 3000, 'consultoria',
            'ACEPTADO', now() - interval '1 minute', 4000),
           ('LD-2000000000002-CONF', 'Cliente Facturado', 'confactura@test.com', 3000, 'seo',
            'ACEPTADO', now() - interval '90 minutes', 5000);
    INSERT INTO facturas (factura_id, lead_id, cliente, email, servicio, monto, fecha_vencimiento)
    VALUES ('FAC-2026-9999', 'LD-2000000000002-CONF', 'Cliente Facturado', 'confactura@test.com',
            'seo', 5000, now() + interval '15 days');
  `);

  const pendientes = () => ejecutar(SQL_LEER_ACEPTADO);

  comprobar('la consulta encuentra el lead ACEPTADO sin factura',
    pendientes().length === 1 && pendientes()[0].startsWith('LD-2000000000000-PERD'),
    pendientes().join(' | '));

  comprobar('no toca la aceptación en vuelo (dentro del período de gracia)',
    !pendientes().join('|').includes('LD-2000000000001-RECI'));

  comprobar('no toca el lead que sí tiene factura',
    !pendientes().join('|').includes('LD-2000000000002-CONF'));

  // Los doce parámetros que arma `Code - Preparar Factura Reconciliada`.
  // `factura_id` es determinista: mismo lead, mismo identificador. `pago_token`
  // se sumó al cerrar S1 (Tabla 11): el enlace de pago_confirmado ya no
  // alcanza sólo con adivinar factura_id.
  const reconciliar = (over = {}) => {
    const f = {
      factura_id: 'FAC-R-0000PERD',
      lead_id: 'LD-2000000000000-PERD',
      cliente: 'Cliente Huérfano',
      email: 'huerfano@test.com',
      servicio: 'desarrollo_web',
      monto: 7200,
      moneda: 'USD',
      fecha_emision: new Date().toISOString(),
      fecha_vencimiento: new Date(Date.now() + 15 * 86400000).toISOString(),
      comision_plataforma: 72,
      pay_url: 'http://localhost:5678/webhook/pagar?f=FAC-R-0000PERD&t=11111111-2222-4333-8444-555555555555',
      pago_token: '11111111-2222-4333-8444-555555555555',
      ...over,
    };
    return ejecutar(SQL_INSERT_FACTURA, [f.factura_id, f.lead_id, f.cliente, f.email, f.servicio,
      f.monto, f.moneda, f.fecha_emision, f.fecha_vencimiento,
      f.comision_plataforma, f.pay_url, f.pago_token]).length;
  };

  comprobar('la primera corrida del cron emite la factura que faltaba',
    reconciliar() === 1);

  comprobar('la segunda corrida NO emite una segunda factura',
    reconciliar() === 0);

  comprobar('tampoco la emite si el identificador cambia: el candado es el lead',
    reconciliar({factura_id: 'FAC-R-OTRO'}) === 0);

  comprobar('la base tiene exactamente una factura para ese lead',
    valor("SELECT count(*) FROM facturas WHERE lead_id = 'LD-2000000000000-PERD';") === '1');

  comprobar('la factura reconciliada nace PENDIENTE, como cualquier otra',
    valor("SELECT estado_pago FROM facturas WHERE lead_id = 'LD-2000000000000-PERD';") === 'PENDIENTE');

  comprobar('conserva el precio que fijó el profesional, no el presupuesto declarado',
    valor("SELECT monto FROM facturas WHERE lead_id = 'LD-2000000000000-PERD';") === '7200.00');

  const facturar = () => ejecutar(SQL_LEAD_FACTURADO, ['LD-2000000000000-PERD']).length;

  comprobar('el lead pasa a FACTURADO', facturar() === 1);
  comprobar('y una segunda pasada no vuelve a aplicarlo', facturar() === 0);

  comprobar('reconciliado, el lead ya no aparece como pendiente',
    !pendientes().join('|').includes('LD-2000000000000-PERD'));

  comprobar('la factura recuperada entra al circuito de recordatorios de pago',
    valor("SELECT count(*) FROM facturas_pendientes WHERE lead_id = 'LD-2000000000000-PERD';") === '1');

  console.log('\n── Cobro por Stripe: ningún pago confirmado se pierde en silencio ──\n');

  // Una factura por caso, todas del lead que ya tiene factura más arriba.
  psql(`
    INSERT INTO facturas (factura_id, lead_id, cliente, email, servicio, monto, moneda, estado_pago, fecha_emision, fecha_vencimiento, stripe_pago_id)
    VALUES ('FAC-ST-PEND', 'LD-2000000000002-CONF', 'Cliente', 'c@test.com', 'seo', 1000, 'USD', 'PENDIENTE', now(), now() + interval '5 days', NULL),
           ('FAC-ST-VENC', 'LD-2000000000002-CONF', 'Cliente', 'c@test.com', 'seo', 1000, 'USD', 'VENCIDA',   now() - interval '35 days', now() - interval '20 days', NULL),
           ('FAC-ST-ANUL', 'LD-2000000000002-CONF', 'Cliente', 'c@test.com', 'seo', 1000, 'USD', 'ANULADA',   now(), now() + interval '5 days', NULL),
           ('FAC-ST-MONT', 'LD-2000000000002-CONF', 'Cliente', 'c@test.com', 'seo', 1000, 'USD', 'PENDIENTE', now(), now() + interval '5 days', NULL),
           ('FAC-ST-DOBL', 'LD-2000000000002-CONF', 'Cliente', 'c@test.com', 'seo', 1000, 'USD', 'COBRADO',   now(), now() + interval '5 days', 'pi_111');
  `);

  // Lo que entrega `Code - Verificar Evento Stripe` para un pago confirmado.
  const pago = (facturaId, over = {}) =>
    ({factura_id: facturaId, stripe_pago_id: 'pi_555', monto_pagado: 1000, moneda_pagada: 'USD', ...over});
  const cobrar = (p) => ejecutar(SQL_COBRADO, [p.factura_id, p.stripe_pago_id, p.monto_pagado, p.moneda_pagada]).length;
  const estado = (id) => valor(`SELECT estado_pago FROM facturas WHERE factura_id = '${id}';`);

  // La rama de «no aplicó»: la consulta real y el nodo Code real, encadenados
  // igual que en el workflow. Devuelve lo que llegaría a `logs` y a Telegram.
  const clasificar = (p) => {
    const [fila = ''] = ejecutar(SQL_BUSCAR_NO_APLICADO, [p.factura_id]);
    const [factura_id, estado_pago, stripe_pago_id, cliente, monto, moneda] = fila.split('|');
    const encontrada = fila ? {factura_id, estado_pago, stripe_pago_id, cliente, monto, moneda} : {};
    const item = {json: encontrada};
    const salida = new Function('$input', '$', JS_CLASIFICAR_NO_APLICADO)(
      {first: () => item},
      () => ({first: () => ({json: p})}),
    );
    return salida[0]?.json.motivo ?? null;
  };

  comprobar('un pago por el monto justo cobra la factura PENDIENTE',
    cobrar(pago('FAC-ST-PEND')) === 1 && estado('FAC-ST-PEND') === 'COBRADO');
  comprobar('y queda registrado que la cobró Stripe, con su PaymentIntent',
    valor("SELECT metodo_cobro || '/' || stripe_pago_id FROM facturas WHERE factura_id = 'FAC-ST-PEND';") === 'STRIPE/pi_555');

  comprobar('la notificación repetida del mismo pago no vuelve a aplicarse',
    cobrar(pago('FAC-ST-PEND')) === 0);
  comprobar('y no genera alerta (Stripe reintenta: es ruido esperable)',
    clasificar(pago('FAC-ST-PEND')) === null);

  comprobar('un pago tardío cobra la factura VENCIDA (antes se perdía)',
    cobrar(pago('FAC-ST-VENC')) === 1 && estado('FAC-ST-VENC') === 'COBRADO');

  comprobar('un pago sobre una factura ANULADA no la cobra',
    cobrar(pago('FAC-ST-ANUL')) === 0 && estado('FAC-ST-ANUL') === 'ANULADA');
  comprobar('pero deja alerta: la plata ya entró',
    /ANULADA/.test(clasificar(pago('FAC-ST-ANUL')) ?? ''), clasificar(pago('FAC-ST-ANUL')));

  comprobar('un pago por menos de lo facturado no cobra la factura',
    cobrar(pago('FAC-ST-MONT', {monto_pagado: 1})) === 0 && estado('FAC-ST-MONT') === 'PENDIENTE');
  comprobar('y la alerta dice cuánto se pagó y cuánto se facturó',
    /se pagaron 1 USD y la factura es por 1000/.test(clasificar(pago('FAC-ST-MONT', {monto_pagado: 1})) ?? ''),
    clasificar(pago('FAC-ST-MONT', {monto_pagado: 1})));
  comprobar('un pago en otra moneda tampoco la cobra',
    cobrar(pago('FAC-ST-MONT', {moneda_pagada: 'EUR'})) === 0 && estado('FAC-ST-MONT') === 'PENDIENTE');

  comprobar('un segundo pago sobre una factura ya cobrada se detecta como pago doble',
    cobrar(pago('FAC-ST-DOBL')) === 0 && /pago doble/.test(clasificar(pago('FAC-ST-DOBL')) ?? ''));

  comprobar('un pago que apunta a una factura inexistente deja alerta',
    /no existe/.test(clasificar(pago('FAC-NO-EXISTE')) ?? ''));

  comprobar('un evento sin factura (factura_id vacío) no toca nada ni alerta',
    cobrar(pago('')) === 0 && clasificar(pago('')) === null);

  const alerta = ['pi_556', 'FAC-ST-ANUL', 'la factura está ANULADA', 'factura=FAC-ST-ANUL pago_stripe=pi_556 motivo=la factura está ANULADA'];
  ejecutar(SQL_LOG_NO_APLICADO, alerta);
  comprobar('n8n_writer puede dejar la alerta en logs',
    valor("SELECT count(*) FROM logs WHERE evento = 'pago_no_aplicado' AND nivel = 'ERROR';") === '1');
  comprobar('y el pago queda en la cola de conciliación',
    valor("SELECT estado FROM pagos_no_aplicados WHERE stripe_pago_id = 'pi_556';") === 'pendiente');
  ejecutar(SQL_LOG_NO_APLICADO, alerta);
  comprobar('la misma alerta repetida no duplica el log',
    valor("SELECT count(*) FROM logs WHERE evento = 'pago_no_aplicado' AND nivel = 'ERROR';") === '1');

  console.log('\n── metrics_mensuales: una factura ANULADA no es facturación ──\n');

  // Mes propio, lejos de las facturas de los casos de arriba. La de 600 va en
  // un lead aparte porque el cierre cobra todas las pendientes de su lead.
  psql(`
    INSERT INTO leads (lead_id, nombre, email, presupuesto, servicio, estado)
    VALUES ('LD-2000000000009-CIER', 'Cliente Cierre', 'cierre@test.com', 600, 'seo', 'FACTURADO');
    INSERT INTO facturas (factura_id, lead_id, cliente, email, servicio, monto, estado_pago, fecha_emision, fecha_vencimiento)
    VALUES ('FAC-MET-COBR', 'LD-2000000000009-CIER', 'C', 'c@test.com', 'seo', 600, 'PENDIENTE', '2020-01-10', '2020-01-25'),
           ('FAC-MET-PEND', 'LD-2000000000002-CONF', 'C', 'c@test.com', 'seo', 300, 'PENDIENTE', '2020-01-10', '2020-01-25'),
           ('FAC-MET-VENC', 'LD-2000000000002-CONF', 'C', 'c@test.com', 'seo', 100, 'VENCIDA',   '2020-01-10', '2020-01-25'),
           ('FAC-MET-ANUL', 'LD-2000000000002-CONF', 'C', 'c@test.com', 'seo', 5000, 'ANULADA',  '2020-01-10', '2020-01-25');
  `);
  // La de 600 se da por cobrada al cerrar el proyecto: la consulta real del
  // nodo, que no tiene un pago detrás.
  ejecutar(SQL_FACTURA_COBRADA_CIERRE, ['LD-2000000000009-CIER']);
  comprobar('cerrar el proyecto marca la factura como cobrada por cierre, no por un pago',
    valor("SELECT estado_pago || '/' || metodo_cobro FROM facturas WHERE factura_id = 'FAC-MET-COBR';") === 'COBRADO/CIERRE_MANUAL');

  const metrica = valor(
    "SELECT facturacion || '|' || cobrado || '|' || pendiente || '|' || tasa_cobro_pct || '|' || facturas_vencidas || '|' || cobrado_cierre_manual FROM metrics_mensuales WHERE mes = '2020-01';");
  const [facturacion, cobrado, pendienteMes, tasa, vencidas, cierreManual] = metrica.split('|');

  comprobar('la facturación del mes no suma la anulada (600 + 300 + 100)', facturacion === '1000.00', metrica);
  comprobar('lo cobrado es sólo lo COBRADO', cobrado === '600.00', metrica);
  comprobar('lo pendiente suma PENDIENTE y VENCIDA, no la anulada', pendienteMes === '400.00', metrica);
  comprobar('la tasa de cobro se calcula sobre lo facturado sin anular (60 %)', tasa === '60.0', metrica);
  comprobar('las vencidas se siguen contando aparte', vencidas === '1', metrica);
  comprobar('el tablero puede separar lo cobrado sólo por cierre', cierreManual === '600.00', metrica);

  console.log('\n── Aceptación: el token se revalida en el mismo UPDATE ──\n');

  // El nodo Code previo ya clasifica el token, pero entre esa lectura y el
  // UPDATE la propuesta puede reenviarse (rota el token) o vencer. La guarda
  // tiene que estar en la escritura, no sólo antes.
  const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  psql(`
    INSERT INTO leads (lead_id, nombre, email, presupuesto, servicio, estado, accept_token, token_expira_en)
    VALUES ('LD-4000000000000-ACEP', 'Acepta', 'acepta@test.com', 1000, 'seo', 'PROPUESTA_ENVIADA', '${TOKEN}', now() + interval '5 days'),
           ('LD-4000000000001-VENC', 'Vencido', 'vencido@test.com', 1000, 'seo', 'PROPUESTA_ENVIADA', '${TOKEN}', now() - interval '1 minute');
  `);
  const aceptar = (leadId, token) => ejecutar(SQL_MARCAR_ACEPTADO, [leadId, token]).length;

  comprobar('con un token que no es el vigente no se acepta',
    aceptar('LD-4000000000000-ACEP', '00000000-0000-4000-8000-000000000000') === 0);
  comprobar('con el token vencido no se acepta', aceptar('LD-4000000000001-VENC', TOKEN) === 0);
  comprobar('con el token vigente se acepta', aceptar('LD-4000000000000-ACEP', TOKEN) === 1);
  comprobar('y una segunda aceptación con el mismo token no vuelve a aplicar',
    aceptar('LD-4000000000000-ACEP', TOKEN) === 0);

  console.log('\n── Tickets: siembra del CRM y envejecimiento ──\n');

  // Los parámetros que arma Code - Tickets del Proyecto, una fila por ticket.
  const sembrar = (titulo, prioridad = 'ALTA') => ejecutar(SQL_CREAR_TICKETS,
    [titulo, prioridad, 'LD-4000000000000-ACEP', 'proyecto,seo', 'Generado', '2026-12-01']);

  sembrar('Kickoff con Acepta');
  sembrar('Kickoff con Acepta');
  comprobar('sembrar dos veces el mismo ticket del proyecto no lo duplica',
    valor("SELECT count(*) FROM tickets WHERE lead_id = 'LD-4000000000000-ACEP';") === '1');
  comprobar('las etiquetas llegan como arreglo y la vista trae el cliente',
    valor("SELECT array_to_string(etiquetas, '|') || ' ' || cliente FROM tickets_tablero WHERE lead_id = 'LD-4000000000000-ACEP';") === 'proyecto|seo Acepta');

  // Tickets con el reloj corrido: uno BAJA quieto 11 días (tolera 10), uno
  // ALTA quieto 2 días (tolera 4), uno HECHO viejo y uno ya en CRITICA.
  psql(`
    INSERT INTO tickets (titulo, prioridad, estado, creado_en, ultimo_movimiento) VALUES
      ('Olvidado', 'BAJA', 'BACKLOG', now() - interval '11 days', now() - interval '11 days'),
      ('Reciente', 'ALTA', 'EN_CURSO', now() - interval '2 days', now() - interval '2 days'),
      ('Cerrado viejo', 'BAJA', 'HECHO', now() - interval '40 days', now() - interval '40 days'),
      ('Incendio', 'CRITICA', 'BACKLOG', now() - interval '9 days', now() - interval '9 days');
    -- Uno del tablero de otra desarrolladora: su resumen es aparte.
    INSERT INTO tickets (titulo, prioridad, estado, creado_en, ultimo_movimiento, espacio_id)
    SELECT 'De Ana', 'BAJA', 'BACKLOG', now() - interval '12 days', now() - interval '12 days', id
    FROM espacios WHERE slug = 'estudio-ana';
  `);
  const ticket = (titulo) => valor(`SELECT prioridad || '/' || escaladas || '/' || dias_quieto || '/' || score FROM tickets_tablero WHERE titulo = '${titulo}';`);

  comprobar('el score crece con los días abierto (BAJA 10 + 2×11 = 32)', ticket('Olvidado').endsWith('/32'), ticket('Olvidado'));
  comprobar('un ticket cerrado vale 0', ticket('Cerrado viejo').endsWith('/0'), ticket('Cerrado viejo'));

  // Una fila por espacio con tickets abiertos: espacio_id|abiertos|escaladas|criticos.
  const idAna = valor("SELECT id FROM espacios WHERE slug = 'estudio-ana';");
  const resumenes = ejecutar(SQL_ESCALAR).map((f) => f.split('|'));
  const [, abiertos, escaladas, criticos] = resumenes.find((f) => f[0] !== idAna);
  const deAna = resumenes.find((f) => f[0] === idAna);

  comprobar('el cron arma un resumen por espacio', resumenes.length === 2, JSON.stringify(resumenes));
  comprobar('el resumen de Ana tiene sólo su ticket, y lo escaló',
    deAna && deAna[1] === '1' && JSON.parse(deAna[2]).map((t) => t.titulo).join() === 'De Ana', JSON.stringify(deAna));

  comprobar('el cron escala sólo al que superó lo que tolera su prioridad',
    JSON.parse(escaladas).map((t) => t.titulo).join() === 'Olvidado', escaladas);
  comprobar('sube un escalón y el reloj se reinicia', ticket('Olvidado').startsWith('MEDIA/1/0/'), ticket('Olvidado'));
  comprobar('el cerrado y el reciente no se tocan',
    ticket('Cerrado viejo').startsWith('BAJA/0/') && ticket('Reciente').startsWith('ALTA/0/'));
  comprobar('CRITICA es el tope: no escala, pero aparece en el resumen',
    ticket('Incendio').startsWith('CRITICA/0/') && JSON.parse(criticos).some((t) => t.titulo === 'Incendio'), criticos);
  comprobar('el resumen cuenta los abiertos', Number(abiertos) >= 4, abiertos);
  comprobar('correrlo de nuevo el mismo día no vuelve a escalar',
    ejecutar(SQL_ESCALAR).every((f) => JSON.parse(f.split('|')[2]).length === 0));

  psql("UPDATE tickets SET estado = 'HECHO' WHERE titulo = 'Reciente';");
  comprobar('pasar a HECHO lo cierra (cerrado_en)',
    valor("SELECT cerrado_en IS NOT NULL FROM tickets WHERE titulo = 'Reciente';") === 't');
  psql("UPDATE tickets SET estado = 'EN_CURSO' WHERE titulo = 'Reciente';");
  comprobar('reabrirlo limpia cerrado_en',
    valor("SELECT cerrado_en IS NULL FROM tickets WHERE titulo = 'Reciente';") === 't');

  console.log(`\nResultado: ${ok} OK, ${fallas} FALLA`);
  if (fallas) codigoSalida = 1;
} catch (err) {
  codigoSalida = 1;
  console.error([err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message);
  console.error('\n✗ No se pudo completar la verificación.');
} finally {
  limpiar();
}

process.exit(codigoSalida);
