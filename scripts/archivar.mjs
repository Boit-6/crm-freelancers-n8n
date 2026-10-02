#!/usr/bin/env node
// Ejecuta un instrumento y archiva su salida con los metadatos que exige el
// protocolo de la Tabla 14: marca temporal, commit, estado del arbol de trabajo
// y codigo de salida. Instalado por parche-A.mjs (plan A, tarea B3).
//
//   node scripts/archivar.mjs <destino.md> <comando> [args...]

import { spawnSync, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [destino, ...cmd] = process.argv.slice(2);
if (!destino || !cmd.length) {
  console.error('uso: node scripts/archivar.mjs <destino.md> <comando> [args...]');
  process.exit(2);
}

const git = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(); } catch { return '(no disponible)'; } };
const inicio = new Date();
const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', shell: true });
const salida = ((r.stdout || '') + (r.stderr || '')).trimEnd();
const codigo = r.status ?? -1;
const sucio = git('git status --porcelain');

const cab = [
  '# ' + destino.split('/').pop().replace(/\.md$/, '').replace(/-/g, ' '),
  '',
  '| campo | valor |',
  '| --- | --- |',
  `| comando | \`${cmd.join(' ')}\` |`,
  `| marca temporal (UTC) | ${inicio.toISOString()} |`,
  `| commit | ${git('git rev-parse HEAD')} |`,
  `| commit (corto) | ${git('git rev-parse --short HEAD')} |`,
  `| arbol de trabajo | ${sucio === '' ? 'limpio' : 'CON CAMBIOS SIN CONFIRMAR'} |`,
  `| codigo de salida | ${codigo} |`,
  `| duracion | ${((Date.now() - inicio) / 1000).toFixed(1)} s |`,
  '',
  '## salida',
  '',
  '\`\`\`',
  salida,
  '\`\`\`',
  '',
].join('\n');

mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, cab, 'utf8');
console.log(salida);
console.log(`\n>>> evidencia archivada en ${destino} (codigo ${codigo})`);
process.exit(codigo);
