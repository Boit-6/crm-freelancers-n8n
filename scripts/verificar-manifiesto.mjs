#!/usr/bin/env node
// Huellas locales de archivos FUENTE. Si se renderizan workflows para CORS,
// sus huellas son distintas y constan en render-manifest.json de esa salida.
// No conecta con n8n/Supabase ni despliega nada; no prueba el estado remoto.
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivos = ['db/schema.sql', ...readdirSync(path.join(raiz, 'workflow'))
  .filter((nombre) => nombre.endsWith('.json') && !nombre.includes('.backup-'))
  .sort().map((nombre) => `workflow/${nombre}`)];
const huellas = () => Object.fromEntries(archivos.map((nombre) => [
  nombre, createHash('sha256').update(readFileSync(path.join(raiz, nombre))).digest('hex'),
]));

const [accion, ruta] = process.argv.slice(2);
if (accion === 'manifest' && !ruta) {
  process.stdout.write(JSON.stringify({formato: 1, algoritmo: 'sha256', archivos: huellas()}, null, 2) + '\n');
} else if (accion === 'verify' && ruta) {
  try {
    const manifiesto = JSON.parse(readFileSync(ruta, 'utf8'));
    const nombres = Object.keys(manifiesto.archivos ?? {});
    if (manifiesto.formato !== 1 || manifiesto.algoritmo !== 'sha256' ||
        nombres.length !== archivos.length || nombres.some((nombre) => !archivos.includes(nombre))) {
      throw new Error('lista de artefactos o formato distinto');
    }
    const actuales = huellas();
    const distintos = archivos.filter((nombre) => actuales[nombre] !== manifiesto.archivos[nombre]);
    if (distintos.length) throw new Error(`huellas distintas: ${distintos.join(', ')}`);
    console.log(`OK: ${archivos.length} artefactos coinciden con el manifiesto local`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
} else {
  console.error('Uso: node scripts/verificar-manifiesto.mjs manifest > manifiesto.json | verify manifiesto.json');
  process.exitCode = 2;
}
