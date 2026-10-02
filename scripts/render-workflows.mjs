#!/usr/bin/env node
// Renderiza COPIAS importables de los workflows. n8n 2.34.6 no evalúa
// expresiones en webhook.options.allowedOrigins; el valor debe ser literal.
// No modifica workflow/, no importa a n8n ni conecta a servicios.
// Uso: CORS_ORIGINS='http://localhost:3000,https://app.example' npm run workflow:render -- --out ./rendered-workflow
// Node 24 también admite `node --env-file=.env scripts/render-workflows.mjs --out ...`.
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fuente = realpathSync(path.join(raiz, 'workflow'));
const hash = (data) => createHash('sha256').update(data).digest('hex');

function origenesValidos(valor) {
  if (!valor || !valor.trim()) throw new Error('CORS_ORIGINS es obligatorio');
  const entradas = valor.split(',');
  const origenes = entradas.map((entrada) => {
    const crudo = entrada.trim();
    if (!crudo || /[{}*$]/.test(crudo)) throw new Error('CORS_ORIGINS contiene un origen vacío, comodín o expresión');
    let url;
    try { url = new URL(crudo); } catch { throw new Error(`Origen CORS inválido: ${crudo}`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || crudo !== url.origin) {
      throw new Error(`Origen CORS inválido (usar sólo esquema, host y puerto): ${crudo}`);
    }
    return url.origin;
  });
  if (new Set(origenes).size !== origenes.length) throw new Error('CORS_ORIGINS contiene orígenes repetidos');
  return origenes;
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out' || !args[1]) throw new Error('Uso: workflow:render -- --out <directorio-nuevo>');
  const origenes = origenesValidos(process.env.CORS_ORIGINS);
  const salida = path.resolve(args[1]);
  // El directorio de salida debe ser nuevo; no pisar otra exportación ni fuente.
  const padre = realpathSync(path.dirname(salida));
  const destinoReal = path.join(padre, path.basename(salida));
  if (destinoReal === fuente || destinoReal.startsWith(fuente + path.sep)) {
    throw new Error('La salida no puede estar dentro de workflow/');
  }
  const nombres = readdirSync(fuente).filter((nombre) => nombre.endsWith('.json') && !nombre.includes('.backup-')).sort();
  if (!nombres.length) throw new Error('No hay workflows JSON que renderizar');
  const copias = nombres.map((nombre) => {
    const original = readFileSync(path.join(fuente, nombre));
    const workflow = JSON.parse(original.toString('utf8'));
    let campos = 0;
    for (const nodo of workflow.nodes ?? []) {
      if (Object.hasOwn(nodo.parameters?.options ?? {}, 'allowedOrigins')) {
        nodo.parameters.options.allowedOrigins = origenes.join(',');
        campos++;
      }
    }
    const renderizado = JSON.stringify(workflow, null, 2) + '\n';
    return {nombre, renderizado, campos, fuenteSha256: hash(original), renderizadoSha256: hash(renderizado)};
  });
  if (!copias.some((c) => c.campos)) throw new Error('No se encontró ningún allowedOrigins; revisar esquema de workflows');
  mkdirSync(destinoReal); // falla si existe: nunca sobrescribir un despliegue previo
  for (const copia of copias) writeFileSync(path.join(destinoReal, copia.nombre), copia.renderizado, {flag: 'wx'});
  const manifiesto = {
    formato: 1,
    tipo: 'workflows-renderizados',
    origenesCors: origenes,
    archivos: Object.fromEntries(copias.map((c) => [c.nombre, {fuenteSha256: c.fuenteSha256, renderizadoSha256: c.renderizadoSha256, camposCors: c.campos}])),
  };
  writeFileSync(path.join(destinoReal, 'render-manifest.json'), JSON.stringify(manifiesto, null, 2) + '\n', {flag: 'wx'});
  console.log(`Renderizados ${copias.length} workflows (${copias.reduce((n, c) => n + c.campos, 0)} campos CORS) en ${destinoReal}`);
  console.log('Importá estas COPIAS en n8n; cambiar CORS_ORIGINS después no modifica workflows ya importados.');
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
