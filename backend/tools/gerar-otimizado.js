/* Gera o Horário Otimizado (horário 2) em js/data-iscte.js com a Solução 1 completa (Greedy + Simulated Annealing):
   dias, horas e salas de todas as aulas, a partir do Horário ISCTE (Manual), com os docentes e as regras atuais.
   As aulas de reposição dos feriados do Manual são copiadas com as suas semanas e também são recolocadas.
   Uso: node tools/gerar-otimizado.js <caminho para sql.js dist/sql-wasm.js> [segundos=600] [semente=1001] */
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.resolve(process.argv[2]));
const M = require('../../frontend/js/model.js');
const E = require('../../frontend/js/engine.js')();
const ARQ = path.join(__dirname, '..', '..', 'frontend', 'js', 'data-iscte.js');
const segundos = Number(process.argv[3]) || 600;
const semente = Number(process.argv[4]) || 1001;
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

(async () => {
  const SQL = await initSqlJs();
  globalThis.window = globalThis;
  require(ARQ);
  const ds = globalThis.ODES_ISCTE;
  if (process.env.SO_FERIADOS) return feriados(SQL, ds);
  const h1 = ds.horarios.find((x) => x.id === 1);
  const h2 = ds.horarios.find((x) => x.id === 2);
  const C = h1.aulaCols;
  const ix = (c) => C.indexOf(c);

  // 1. O horário 2 passa a ser uma cópia do Manual (ids novos a seguir ao maior id existente).
  let prox = Math.max(...ds.horarios.flatMap((h) => h.aulas.map((a) => a[h.aulaCols.indexOf('id')]))) + 1;
  const novoId = new Map();
  for (const a of h1.aulas) novoId.set(a[ix('id')], prox++);
  h2.aulaCols = C.slice();
  h2.aulas = h1.aulas.map((a) => {
    const b = a.slice();
    b[ix('id')] = novoId.get(a[ix('id')]);
    if (b[ix('reposicao_de')] != null) b[ix('reposicao_de')] = novoId.get(b[ix('reposicao_de')]) || null;
    return b;
  });
  const XA = ds.tables.evento_aula;
  const xi = (c) => XA.cols.indexOf(c);
  XA.rows = XA.rows.filter((r) => r[xi('horario_id')] !== 2).concat(XA.rows.filter((r) => r[xi('horario_id')] === 1).map((r) => {
    const b = r.slice();
    b[xi('horario_id')] = 2;
    b[xi('aula_id')] = novoId.get(r[xi('aula_id')]) || r[xi('aula_id')];
    if (r[xi('nova_aula_id')] != null) b[xi('nova_aula_id')] = novoId.get(r[xi('nova_aula_id')]) || r[xi('nova_aula_id')];
    return b;
  }));

  // 2. Solução 1 sobre todas as aulas (como nas experiências: blocos de 90 min, segunda a sexta).
  const D = M.wrap(new SQL.Database());
  M.seed(D, ds);
  const P = M.buildProblem(D, { horarioId: 2 });
  const v0 = E.validate(P);
  console.log('Manual (cópia): hard', v0.hard, 'soft', v0.soft, 'custo', v0.custo.toFixed(0));
  const t0 = Date.now();
  const g = E.solve(P, { modo: 'zero', ruido: 1, seed: semente, tempoMs: segundos * 1000, dias: [0, 1, 2, 3, 4], grelha: 'blocos' },
    (p) => { if (p.fase !== 'otimizacao' || Math.random() < 0.02) process.stdout.write(`\r  ${p.fase} ${(p.ms / 1000).toFixed(0)} s custo ${(p.melhor || p.custo).toFixed(0)}   `); });
  console.log(`\nSolução 1: custo ${g.custo.toFixed(0)} (Greedy ${g.custoInicial.toFixed(0)}) em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  fs.writeFileSync(path.join(require('os').tmpdir(), 'otimizado-solucao.json'), JSON.stringify({ D: [...g.D], I: [...g.I], R: [...g.R] }));
  const pos = new Map(P.aulas.map((a, i) => [a.id, i]));
  let mudouTempo = 0, mudouSala = 0;
  for (const b of h2.aulas) {
    const i = pos.get(b[ix('id')]);
    if (i == null) continue;
    const sala = g.R[i] >= 0 ? P.salas[g.R[i]].id : (P.aulas[i].noRoom ? b[ix('sala_id')] : null);
    if (g.D[i] !== b[ix('dia')] || g.I[i] !== b[ix('inicio')]) mudouTempo++;
    if (sala !== b[ix('sala_id')]) mudouSala++;
    // Aulas que não cabem em nenhum bloco da grelha (mais longas do que 4h30) ficam como no Manual.
    if (g.D[i] < 0) continue;
    b[ix('dia')] = g.D[i];
    b[ix('inicio')] = g.I[i];
    b[ix('sala_id')] = sala;
  }
  // Notas das reposições passam a indicar o novo dia e hora.
  const porId = new Map(h2.aulas.map((b) => [b[ix('id')], b]));
  for (const r of XA.rows) {
    if (r[xi('horario_id')] !== 2 || r[xi('nova_aula_id')] == null || r[xi('estado')] !== 'reagendada') continue;
    const b = porId.get(r[xi('nova_aula_id')]);
    if (b && b[ix('dia')] != null) r[xi('nota')] = `semana ${r[xi('nova_semana')]}, ${DIAS[b[ix('dia')]]} ${hhmm(b[ix('inicio')])}`;
  }

  // 3. Validação final e metadados.
  const D2 = M.wrap(new SQL.Database());
  M.seed(D2, ds);
  const v1 = E.validate(M.buildProblem(D2, { horarioId: 2 }));
  const conf = ['CONF_TURMA', 'CONF_DOCENTE', 'CONF_SALA'].reduce((s, k) => s + ((v1.porRegra[k] || {}).n || 0), 0);
  console.log('Otimizado: hard', v1.hard, 'soft', v1.soft, 'custo', v1.custo.toFixed(0), 'conflitos', conf, '| dia/hora mudou', mudouTempo, 'sala mudou', mudouSala);
  console.log(' ', Object.entries(v1.porRegra).map(([k, x]) => `${k}:${x.n}`).join(' '));
  h2.criado_em = '2026-11-21T23:45:00';
  h2.notas = `Gerado pela Solução 1 (Greedy + Simulated Annealing, ${segundos} s, semente ${semente}) a partir do Horário ISCTE (Manual), com os docentes do Ciência-Iscte: dias, horas e salas de todas as aulas. ${mudouTempo} aulas mudaram de dia ou hora e ${mudouSala} de sala. Grelha de blocos de 90 min, segunda a sexta.`;
  h2.feriados = h1.feriados;
  ds.resumo = Object.assign(ds.resumo || {}, { melhorado: { hard: v1.hard, soft: v1.soft, porRegra: v1.porRegra }, mudancasSala: mudouSala, mudancasTempo: mudouTempo });
  ds.registo = ds.registo.filter((x) => !(x[0] === '2026-11-21T22:00:00' && x[2] === 'Horário gerado'));
  ds.registo.push(['2026-11-21T23:45:00', 'Gestor de horários', 'Horário gerado',
    `${h2.nome}: gerado de novo pela Solução 1 (dias, horas e salas); violações obrigatórias ${v0.hard} → ${v1.hard}`, 'gestor']);
  feriados(SQL, ds);
})();

/* 4. Aulas que a Solução 1 pôs em dias de feriado: suspensas nessa semana e repostas numa semana posterior
   (como no Manual: primeiro prolonga a aula, senão cria uma aula de reposição). */
function feriados(SQL, ds) {
  const h2 = ds.horarios.find((x) => x.id === 2);
  const D = M.wrap(new SQL.Database());
  M.seed(D, ds);
  const antes = E.validate(M.buildProblem(D, { horarioId: 2 }));
  const rf = M.reporFeriados(D, E, 2, 'gestor');
  const depois = E.validate(M.buildProblem(D, { horarioId: 2 }));
  console.log(`Feriados: ${rf.n} aulas em ${rf.feriados} feriados, ${rf.ok} repostas (${rf.prolongadas} prolongadas); FERIADOS ${(antes.porRegra.FERIADOS || {}).n || 0} → ${(depois.porRegra.FERIADOS || {}).n || 0}; hard ${antes.hard} → ${depois.hard}, soft ${antes.soft} → ${depois.soft}`);
  const cols = ['id', 'turno_id', 'seq', 'dia', 'inicio', 'duracao', 'sala_id', 'fixa', 'semanas', 'caracteristica_pedida', 'reposicao_de', 'evento_id'];
  h2.aulaCols = cols;
  h2.aulas = D.q(`SELECT ${cols.join(', ')} FROM aula WHERE horario_id = 2 ORDER BY id`).map((x) => cols.map((c) => x[c]));
  const xc = ['evento_id', 'horario_id', 'aula_id', 'semana', 'nova_aula_id', 'nova_semana', 'estado', 'nota'];
  ds.tables.evento_aula = { cols: xc, rows: D.q('SELECT * FROM evento_aula').map((x) => xc.map((c) => x[c])) };
  h2.feriados = { n: (h2.feriados ? h2.feriados.n : 0) + rf.n, ok: (h2.feriados ? h2.feriados.ok : 0) + rf.ok, prolongadas: (h2.feriados ? h2.feriados.prolongadas : 0) + rf.prolongadas, feriados: rf.feriados };
  ds.registo.push(['2026-11-21T23:50:00', 'Gestor de horários', 'Aulas de feriados repostas', `${h2.nome}: ${rf.n} aulas postas pelo gerador em feriados, ${rf.ok} repostas numa semana posterior`, 'gestor']);
  const js = fs.readFileSync(ARQ, 'utf8').split('\n')[0] + '\n'
    + '(function (root) { root.ODES_ISCTE = ' + JSON.stringify(ds) + '; })(typeof window !== \'undefined\' ? window : globalThis);\n';
  fs.writeFileSync(ARQ, js);
}
