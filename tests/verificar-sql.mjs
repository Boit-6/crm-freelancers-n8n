#!/usr/bin/env node
// Verifica que TODAS las consultas SQL de los workflows compilen contra el
// esquema real de `db/schema.sql`.
//
// Los nodos Postgres de n8n llevan el SQL escrito a mano dentro del JSON: un
// nombre de columna mal escrito, un tipo que no castea o una tabla renombrada
// no se detectan hasta que la rama se ejecuta en producción. Este verificador
// levanta un PostgreSQL desechable, aplica el esquema y hace `PREPARE` de cada
// consulta: PostgreSQL la parsea y valida nombres y tipos, pero no la ejecuta,
// así que no toca ningún dato.
//
// Uso: node tests/verificar-sql.mjs
import {execFileSync, execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(aqui, '..');
const CONTENEDOR = 'crm-sql-test';
const IMAGEN = 'postgres:16-alpine';

const sh = (cmd) => execSync(cmd, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
const limpiar = () => {
  try { sh(`docker rm -f ${CONTENEDOR}`); } catch { /* no existía */ }
};

// Las consultas de n8n pueden ser expresiones (prefijo `=`) con interpolaciones
// `{{ ... }}`. Para validar la sintaxis se reemplazan por un literal.
const aSqlPlano = (query) => query.replace(/^=/, '').replace(/\{\{[^}]*\}\}/g, '14').trim().replace(/;$/, '');

// Los flujos del artefacto, nombrados uno por uno. Con un `readdirSync` de
// `*.json` esto barría también las copias de respaldo del directorio y compilaba
// el SQL de versiones viejas, inflando el recuento y dando por buenas consultas
// que ya no existen. Mismo criterio que en tests/smoke-code-nodes.mjs.
const FLUJOS = ['crm_postgres.json', 'tickets.json', 'avisos.json', 'telegram_vincular.json'];

function consultasDeWorkflows() {
  const dir = path.join(raiz, 'workflow');
  const salida = [];

  for (const archivo of FLUJOS) {
    const wf = JSON.parse(readFileSync(path.join(dir, archivo), 'utf8'));

    for (const nodo of wf.nodes) {
      if (nodo.type !== 'n8n-nodes-base.postgres') continue;
      if (!nodo.parameters?.query) continue;
      salida.push({archivo, nodo: nodo.nombre ?? nodo.name, sql: aSqlPlano(nodo.parameters.query)});
    }
  }

  return salida;
}

const consultas = consultasDeWorkflows();

if (!consultas.length) {
  console.log('No hay consultas SQL en los workflows.');
  process.exit(0);
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

  const psql = (entrada) =>
    execFileSync(
      'docker',
      ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      {encoding: 'utf8', input: 'SET client_min_messages TO WARNING;\n' + entrada},
    );

  console.log('· Aplicando el esquema …');
  psql(readFileSync(path.join(aqui, 'rls', 'bootstrap.sql'), 'utf8'));
  psql(readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8'));

  console.log(`· Compilando ${consultas.length} consultas …\n`);

  let fallas = 0;

  for (const [i, c] of consultas.entries()) {
    try {
      // PREPARE valida sintaxis, tablas, columnas y tipos sin ejecutar nada.
      psql(`PREPARE consulta_${i} AS ${c.sql};`);
      console.log(`OK    ${c.nodo}`);
    } catch (err) {
      fallas++;
      const detalle = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();

      console.log(`FALLA ${c.nodo}`);
      console.log(`      ${c.sql.slice(0, 160)}`);
      console.log(`      ${detalle.split('\n').filter((l) => l.includes('ERROR')).join(' ')}`);
    }
  }

  console.log(`\nResultado: ${consultas.length - fallas} OK, ${fallas} con error`);
  if (fallas) codigoSalida = 1;
} catch (err) {
  codigoSalida = 1;
  console.error([err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message);
  console.error('\n✗ No se pudo completar la verificación.');
} finally {
  limpiar();
}

process.exit(codigoSalida);
