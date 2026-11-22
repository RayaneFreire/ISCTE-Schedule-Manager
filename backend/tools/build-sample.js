/* Gera js/sample-horarios.js: o horário "importado" de 2025/26 e um histórico de 2024/25,
   ambos fictícios, a partir dos dados de exemplo e do próprio motor.
   Uso: node tools/build-sample.js <caminho para sql-asm.js do pacote sql.js> */
const path = require('path');
const fs = require('fs');
const initSqlJs = require(process.argv[2]);
require('../../frontend/js/schema.js');
require('../../frontend/js/data.js');
const Model = require('../../frontend/js/model.js');
const Engine = require('../../frontend/js/engine.js')();

(async () => {
  const SQL = await initSqlJs();
  const D = Model.wrap(new SQL.Database());
  Model.seed(D, globalThis.ODES_DATA);

  function gerar(seed, ruido, tempoMs, dias) {
    const P = Model.buildProblem(D, { horarioId: null, incluirEmFalta: true });
    const r = Engine.solve(P, { seed, ruido, tempoMs, dias, grelha: 'blocos', modo: 'zero' });
    const salaId = (k) => (k >= 0 ? P.salas[k].id : null);
    return P.aulas.map((a, i) => ({ turno: a.turnoId, seq: a.seq, dia: r.aulas[i].dia, ini: r.aulas[i].ini, dur: a.dur, sala: salaId(r.aulas[i].sala), uc: a.ucCod, cod: P.turnos[a.turno].codigo }));
  }

  // Horário "atual": construção rápida com ruído (como um horário feito à mão, com problemas).
  const atual = gerar(11, 40, 300, [0, 1, 2, 3, 4, 5]);
  const find = (uc, cod, seq) => atual.find((a) => a.uc === uc && a.cod === cod && a.seq === (seq || 1));
  const set = (a, dia, ini, sala) => { if (a) { a.dia = dia; a.ini = ini; if (sala) a.sala = sala; } };
  // Problemas típicos introduzidos de propósito:
  set(find('PI', 'T1'), 2, 780, 1);          // PI T1 quarta 13:00 no AUD-A1
  set(find('PI', 'PL1', 1), 2, 870, 10);     // seguida de PL1 às 14:30 e 16:00: 4h30 seguidas de PI para LEI1-A
  set(find('PI', 'PL1', 2), 2, 960, 10);
  set(find('IG', 'TP1'), 3, 870, 12);        // aula TP num laboratório
  set(find('SAD', 'TP1'), 3, 900, 19);       // mestrado pós-laboral às 15:00
  set(find('CF', 'TP2'), 2, 1170, 16);       // licenciatura diurna às 19:30

  const historico = gerar(5, 25, 400, [0, 1, 2, 3, 4]);

  const toRows = (list, fixa) => list.map((a) => [a.turno, a.seq, a.dia, a.ini, a.dur, a.sala, fixa ? 1 : 0]);
  const aulaCols = ['turno_id', 'seq', 'dia', 'inicio', 'duracao', 'sala_id', 'fixa'];
  const horarios = [
    { id: 1, nome: '2026/27 · 1.º semestre (proposta inicial)', ano_letivo: '2026/27', semestre: 1, origem: 'importado', criado_em: '2026-07-10T10:00:00', estado: 'publicado', criado_por: 'gestor', submetido_por: 'gestor', aprovado_por: 'curso', publicado_em: '2026-07-20T10:00:00', notas: 'Horário em vigor, feito à mão com problemas típicos (dados fictícios).', aulaCols, aulas: toRows(atual) },
    { id: 2, nome: '2025/26 · 1.º semestre (histórico)', ano_letivo: '2025/26', semestre: 1, origem: 'historico', criado_em: '2025-09-12T10:00:00', estado: 'arquivado', notas: 'Horário do ano anterior, usado para comparação (dados fictícios).', aulaCols, aulas: toRows(historico) },
  ];

  const out = '/* Gerado por tools/build-sample.js. Horários de exemplo FICTÍCIOS. */\n' +
    '(function (root) { root.ODES_DATA.horarios = ' + JSON.stringify(horarios) + '; })(typeof window !== \'undefined\' ? window : globalThis);\n';
  fs.writeFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'sample-horarios.js'), out);

  // Resumo de validação para conferir.
  globalThis.ODES_DATA.horarios = horarios;
  const D2 = Model.wrap(new SQL.Database());
  Model.seed(D2, globalThis.ODES_DATA);
  for (const h of horarios) {
    const v = Engine.validate(Model.buildProblem(D2, { horarioId: h.id }));
    const sqlV = Model.sqlViolations(D2, h.id);
    console.log(h.nome, 'aulas', h.aulas.length, 'hard', v.hard, 'soft', v.soft, 'sql', sqlV.length);
    console.log(Object.entries(v.porRegra).map(([k, x]) => `${k}:${x.n}`).join(' '));
  }
  const tt = Date.now();
  const P = Model.buildProblem(D2, { horarioId: null, incluirEmFalta: true });
  const r = Engine.solve(P, { seed: 3, tempoMs: 6000, dias: [0, 1, 2, 3, 4], grelha: 'blocos', modo: 'zero' });
  console.log('gerado: hard', r.hard, 'soft', r.soft, 'custo', r.custo.toFixed(1), 'it', r.it, 'ms', Date.now() - tt);
  console.log(Object.entries(r.porRegra).map(([k, x]) => `${k}:${x.n}`).join(' '));
})();
