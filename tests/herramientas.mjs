import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {crearRest, crearWebhook} from './helpers/servicios.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(raiz, 'scripts/verificar-manifiesto.mjs');
const temporal = mkdtempSync(path.join(os.tmpdir(), 'crm-manifest-'));
try {
  const manifest = execFileSync(process.execPath, [script, 'manifest'], {encoding: 'utf8'});
  const ruta = path.join(temporal, 'manifest.json');
  writeFileSync(ruta, manifest);
  assert.equal(spawnSync(process.execPath, [script, 'verify', ruta]).status, 0);
  const alterado = JSON.parse(manifest);
  alterado.archivos['db/schema.sql'] = '0'.repeat(64);
  writeFileSync(ruta, JSON.stringify(alterado));
  assert.equal(spawnSync(process.execPath, [script, 'verify', ruta]).status, 1);
  // Entrada histórica E7 valida argumentos antes de cualquier conexión.
  const realtime = path.join(raiz, 'scripts/medir-realtime.mjs');
  assert.equal(spawnSync(process.execPath, [realtime, '--n', '0']).status, 2);

  const render = path.join(raiz, 'scripts/render-workflows.mjs');
  const fuente = path.join(raiz, 'workflow');
  const nombres = readdirSync(fuente).filter((nombre) => nombre.endsWith('.json') && !nombre.includes('.backup-')).sort();
  const originales = Object.fromEntries(nombres.map((nombre) => [nombre, readFileSync(path.join(fuente, nombre))]));
  const destino = path.join(temporal, 'rendered');
  const env = {...process.env, CORS_ORIGINS: 'http://localhost:3000,https://app.example'};
  assert.equal(spawnSync(process.execPath, [render, '--out', destino], {env}).status, 0);
  const renderManifest = JSON.parse(readFileSync(path.join(destino, 'render-manifest.json'), 'utf8'));
  assert.deepEqual(renderManifest.origenesCors, ['http://localhost:3000', 'https://app.example']);
  let campos = 0;
  for (const nombre of nombres) {
    assert.deepEqual(readFileSync(path.join(fuente, nombre)), originales[nombre]);
    const original = JSON.parse(originales[nombre].toString('utf8'));
    const copiaTexto = readFileSync(path.join(destino, nombre), 'utf8');
    const copia = JSON.parse(copiaTexto);
    assert.deepEqual(copia.connections, original.connections);
    assert.equal(copia.nodes.length, original.nodes.length);
    for (let i = 0; i < copia.nodes.length; i++) {
      if (Object.hasOwn(copia.nodes[i].parameters?.options ?? {}, 'allowedOrigins')) {
        assert.equal(copia.nodes[i].parameters.options.allowedOrigins, env.CORS_ORIGINS);
        assert.doesNotMatch(copia.nodes[i].parameters.options.allowedOrigins, /\{\{|\$env/);
        copia.nodes[i].parameters.options.allowedOrigins = original.nodes[i].parameters.options.allowedOrigins;
        campos++;
      }
    }
    assert.deepEqual(copia, original);
    assert.equal(renderManifest.archivos[nombre].fuenteSha256, createHash('sha256').update(originales[nombre]).digest('hex'));
    assert.equal(renderManifest.archivos[nombre].renderizadoSha256, createHash('sha256').update(copiaTexto).digest('hex'));
  }
  assert.ok(campos > 0);
  assert.equal(spawnSync(process.execPath, [render, '--out', destino], {env}).status, 1);
  assert.equal(spawnSync(process.execPath, [render, '--out', fuente], {env}).status, 1);
  assert.equal(spawnSync(process.execPath, [render, '--out', path.join(fuente, 'generated')], {env}).status, 1);
  for (const [i, invalidos] of ['', '*', 'https://app.example/path', 'https://u:p@app.example',
    'https://app.example?x=1', 'https://app.example/#x', '={{ $env.CORS_ORIGINS }}',
    'ftp://app.example', 'https://app.example,https://app.example'].entries()) {
    const salidaInvalida = path.join(temporal, `invalid-${i}`);
    assert.equal(spawnSync(process.execPath, [render, '--out', salidaInvalida], {env: {...env, CORS_ORIGINS: invalidos}}).status, 1);
    assert.equal(existsSync(salidaInvalida), false);
  }
} finally {
  rmSync(temporal, {recursive: true, force: true});
}

const llamadas = [];
const fetchFalso = async (url, opciones) => {
  llamadas.push({url, opciones});
  return {ok: true, status: 200, text: async () => '{"bien":true}'};
};
const rest = crearRest('https://db.test', 'clave-ficticia', fetchFalso);
assert.deepEqual(await rest('leads?select=id', {headers: {Prefer: 'return=representation'}}), {bien: true});
assert.equal(llamadas[0].opciones.headers.Prefer, 'return=representation');
assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer clave-ficticia');
const webhook = crearWebhook('https://n8n.test', fetchFalso, {'ngrok-skip-browser-warning': 'true'});
assert.deepEqual(await webhook('lead-nuevo', {cuerpo: {nombre: 'Demo'}}), {status: 200, texto: '{"bien":true}', json: {bien: true}});
assert.equal(llamadas[1].opciones.headers['ngrok-skip-browser-warning'], 'true');
assert.equal(llamadas[1].opciones.body, '{"nombre":"Demo"}');
await assert.rejects(
  crearRest('https://db.test', 'clave-ficticia', async () => ({ok: false, status: 403, text: async () => 'denegado'}))('leads'),
  /Supabase 403: denegado/,
);
assert.deepEqual(
  await crearWebhook('https://n8n.test', async () => ({status: 502, text: async () => '<html>error</html>'}))('lead-nuevo'),
  {status: 502, texto: '<html>error</html>', json: null},
);
console.log('OK herramientas offline: manifiestos, render CORS y helpers REST/webhook');
