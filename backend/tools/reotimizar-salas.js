/* Volta a gerar as salas do Horário Otimizado (horário 2) em js/data-iscte.js, com as regras atuais
   (por exemplo, depois de criar a regra MESMA_SALA_UC). Só muda salas: dias, horas, semanas, reposições
   de feriados e docentes ficam iguais. Parte das salas atuais do Otimizado.
   Uso: node tools/reotimizar-salas.js <caminho para sql.js dist/sql-wasm.js> [segundos=240] */
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.resolve(process.argv[2]));
const M = require('../../frontend/js/model.js');
const E = require('../../frontend/js/engine.js')();
const ARQ = path.join(__dirname, '..', '..', 'frontend', 'js', 'data-iscte.js');
const segundos = Number(process.argv[3]) || 240;

(async () => {
  const SQL = await initSqlJs();
  globalThis.window = globalThis;
  require(ARQ);
  const ds = globalThis.ODES_ISCTE;
  const D = M.wrap(new SQL.Database());
  M.seed(D, ds);
  const h = ds.horarios.find((x) => x.id === 2);
  const P = M.buildProblem(D, { horarioId: 2 });
  const v0 = E.validate(P);
  console.log('Antes: hard', v0.hard, 'soft', v0.soft, 'custo', v0.custo.toFixed(0), 'MESMA_SALA_UC', (v0.porRegra.MESMA_SALA_UC || {}).n);
  const g = E.solve(P, { modo: 'salas', seed: 2026, tempoMs: segundos * 1000, T0: 3 });
  const salaDe = new Map(P.aulas.map((a, i) => [a.id, g.R[i] >= 0 ? P.salas[g.R[i]].id : null]));
  const ci = h.aulaCols.indexOf('id'), cs = h.aulaCols.indexOf('sala_id');
  let mud = 0;
  for (const a of h.aulas) {
    if (!salaDe.has(a[ci])) continue;
    const s = salaDe.get(a[ci]);
    if (s == null && a[cs] != null) continue; // aulas sem sala no problema (não precisam de sala) mantêm a sala original
    if (s !== a[cs]) { a[cs] = s; mud++; }
  }
  const D2 = M.wrap(new SQL.Database());
  M.seed(D2, ds);
  const v1 = E.validate(M.buildProblem(D2, { horarioId: 2 }));
  console.log('Depois: hard', v1.hard, 'soft', v1.soft, 'custo', v1.custo.toFixed(0), 'MESMA_SALA_UC', (v1.porRegra.MESMA_SALA_UC || {}).n, 'aulas com sala nova', mud);
  console.log(' ', Object.entries(v1.porRegra).map(([k, x]) => `${k}:${x.n}`).join(' '));
  ds.registo.push(['2026-11-21T22:00:00', 'Gestor de horários', 'Horário gerado',
    `${h.nome}: salas geradas de novo com a regra "Aulas seguidas da mesma UC em salas diferentes" (${mud} aulas mudaram de sala)`, 'gestor']);
  const js = fs.readFileSync(ARQ, 'utf8').split('\n')[0] + '\n'
    + '(function (root) { root.ODES_ISCTE = ' + JSON.stringify(ds) + '; })(typeof window !== \'undefined\' ? window : globalThis);\n';
  fs.writeFileSync(ARQ, js);
})();
