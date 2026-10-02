// Que cada nodo que consume un binario lo reciba de verdad. En n8n un nodo
// sólo ve el binario del item que le llega: si en el medio se intercala un
// nodo que no lo reenvía (un Postgres devuelve filas, no archivos), el
// consumidor falla con «expects the node's input data to contain a binary
// file». Pasó el 18-sep-2026 con la factura: Postgres - Insert Factura quedó
// entre el HTML y Gotenberg y ninguna factura volvió a salir por correo. Los
// tests que ejecutan cada nodo Code por separado no lo podían ver.
//
// Recorre, para cada consumidor, la cadena hacia atrás hasta el nodo que
// produce ese binario, y exige que ningún nodo intermedio lo descarte.
//
// Uso: node tests/binarios.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(path.join(aqui, '..', 'workflow', 'crm_postgres.json'), 'utf8'));
const porNombre = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

let ok = 0, fail = 0;
const check = (nombre, condicion, detalle) => {
  if (condicion) { console.log('OK    ' + nombre); ok++; }
  else { console.log('FAIL  ' + nombre + (detalle ? '  ->  ' + detalle : '')); fail++; }
};

const previos = {};

for (const [origen, c] of Object.entries(wf.connections)) {
  for (const destino of (c.main || []).flat()) (previos[destino.node] ??= []).push(origen);
}

// ¿Este nodo deja en su salida el binario `campo`?
function produce(nodo, campo) {
  if (nodo.type === 'n8n-nodes-base.code') {
    return new RegExp(`binary\\s*:\\s*\\{[^}]*${campo}|binary\\s*:\\s*\\w+\\.binary`).test(nodo.parameters.jsCode || '');
  }
  if (nodo.type === 'n8n-nodes-base.httpRequest') {
    const r = nodo.parameters.options?.response?.response;

    return r?.responseFormat === 'file' && r.outputPropertyName === campo;
  }

  return false;
}

const consumidores = [];

for (const n of wf.nodes) {
  for (const p of n.parameters.bodyParameters?.parameters ?? []) {
    if (p.parameterType === 'formBinaryData') consumidores.push([n, p.inputDataFieldName]);
  }
  for (const a of n.parameters.options?.attachmentsUi?.attachmentsBinary ?? []) consumidores.push([n, a.property]);
}

check('hay consumidores de binarios que revisar', consumidores.length > 0);

for (const [nodo, campo] of consumidores) {
  const anteriores = previos[nodo.name] ?? [];

  check(`${nodo.name}: recibe «${campo}» de ${anteriores.join(', ') || '(nadie)'}`,
    anteriores.length > 0 && anteriores.every((a) => produce(porNombre[a], campo)),
    anteriores.map((a) => `${a} (${porNombre[a].type.split('.').pop()}) no lo produce`).join('; '));
}

console.log('\nResultado: ' + ok + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
