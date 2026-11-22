/* Experiências do trabalho final: Solução 1 (Greedy + Simulated Annealing) vs Solução 2 (NSGA-II).
   Uso: node tools/experiencias.js <sql-asm.js> <pasta de saída> [T segundos=300] [curso=TODOS] [semente inicial=1001] [n.º de execuções=30]
   Instância: por omissão, o horário completo (todas as aulas e todos os cursos) do Horário ISCTE (Manual) de 2022/23,
   com os docentes do Ciência-Iscte. Com uma sigla de curso, só as aulas desse curso mudam: as aulas de outros cursos
   que partilham turmas ficam fixas e as restantes só ocupam as salas (reservas com as suas semanas).
   Grelha de blocos de 90 minutos, segunda a sexta. As execuções correm em sequência e os resultados vão sendo
   gravados em runs.json, para se poder retomar. No fim calcula as estatísticas (estatisticas.js). */
const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require(path.resolve(process.argv[2]));
globalThis.ODES_SCHEMA = require('../../frontend/js/schema.js');
const M = require('../../frontend/js/model.js');
const E = require('../../frontend/js/engine.js')();
require('../../frontend/js/data-iscte.js');
const ST = require('./estatisticas.js');

const outDir = process.argv[3] || 'experiencias';
const T = Number(process.argv[4]) || 300;
const siglaCurso = (process.argv[5] || 'TODOS').toUpperCase();
const semente0 = Number(process.argv[6]) || 1001;
const nRuns = Number(process.argv[7]) || 30;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const SQL = await initSqlJs();
  const D = M.wrap(new SQL.Database());
  M.seed(D, globalThis.ODES_ISCTE);
  const todos = siglaCurso === 'TODOS';
  const curso = todos ? null : D.one('SELECT id, sigla FROM curso WHERE sigla = ?', [siglaCurso]);
  const h = D.one("SELECT id, nome FROM horario WHERE origem = 'importado' ORDER BY id LIMIT 1");
  const P = todos ? M.buildProblem(D, { horarioId: h.id }) : M.instanciaCurso(D, h.id, curso.id);
  const livres = P.aulas.filter((a) => !a.fixa).length;
  const fixas = P.aulas.length - livres;
  const semBloco = P.aulas.filter((a) => !a.fixa && !E.startsFor(a.dur).length).length;
  const reg = D.q('SELECT codigo, severidade AS sev, peso, ativa FROM regra ORDER BY codigo');
  const meta = {
    instancia: todos ? 'Horário completo (todos os cursos)' : `I1 = ${curso.sigla}`, horarioBase: h.nome, aulasLivres: livres, aulasFixas: fixas, reservasDeOutrosCursos: todos ? 0 : P.bloqueios.length - M.buildProblem(D, { horarioId: h.id }).bloqueios.length, reservas: P.bloqueios.length,
    aulasSemBlocoPossivel: semBloco, sessoesPontuais: D.one('SELECT COUNT(*) n FROM aula WHERE horario_id = ? AND duracao > ?', [h.id, M.SESSAO_PONTUAL_MIN]).n, T, sementes: [semente0, semente0 + nRuns - 1], grelha: 'blocos de 90 min, segunda a sexta',
    solucao1: { salasCandidatas: 6, ruido: 1, T0: 6, T1: 0.02, fracaoSA: 0.9 },
    solucao2: { execucoes: nRuns, ruido: 1, populacao: 40, cruzamento: 'uniforme, 0,9', mutacao: '2/n_l por aula (recolocar 50%, sala 30%, troca 20%)', salasTop: 8, populacaoInicial: 'Greedy com ruído (mesma semente da Solução 1) + variantes com 3% a 28% das aulas recolocadas' },
    ambiente: { node: process.version, cpu: (os.cpus()[0] || {}).model, nucleos: os.cpus().length, so: `${os.type()} ${os.release()}`, data: new Date().toISOString() },
    dados: globalThis.ODES_ISCTE.nome, regras: reg,
  };
  console.log(meta.instancia, 'livres', livres, 'fixas', fixas, 'reservas', P.bloqueios.length, 'sem bloco possível', semBloco);

  const fRuns = path.join(outDir, 'runs.json');
  const dados = fs.existsSync(fRuns) ? JSON.parse(fs.readFileSync(fRuns, 'utf8')) : { meta, manual: null, s1: [], s2: [] };
  if (process.env.SO_ANALISE && dados.meta && dados.meta.ambiente) meta.ambiente = dados.meta.ambiente;
  dados.meta = meta;
  const grava = () => fs.writeFileSync(fRuns, JSON.stringify(dados));

  const D0 = Int16Array.from(P.aulas, (a) => (a.dia == null ? -1 : a.dia));
  const I0 = Int16Array.from(P.aulas, (a) => (a.ini == null ? -1 : a.ini));
  const R0 = Int16Array.from(P.aulas, (a) => (a.sala == null ? -1 : a.sala));
  const om = E.evaluateArrays(P, D0, I0, R0);
  if (!process.env.SO_ANALISE || !dados.manual) dados.manual = { f: om.f, F: om.F, m1: om.m1, hard: om.hard, nao: om.nao, ocupacao: om.ocupacao, furos: om.furos, salaUc: om.salaUc };
  console.log('Manual', JSON.stringify(dados.manual));
  if (!process.env.SO_ANALISE) grava();

  const opts = { dias: [0, 1, 2, 3, 4], grelha: 'blocos' };
  for (let k = 0; k < (process.env.SO_ANALISE ? 0 : nRuns); k++) {
    const seed = semente0 + k;
    if (!process.env.SO_S2 && !dados.s1.some((r) => r.seed === seed)) {
      const g = E.solve(P, Object.assign({ modo: 'zero', ruido: 1, seed, tempoMs: T * 1000 }, opts));
      const o = E.evaluateArrays(P, g.D, g.I, g.R);
      const run = { seed, f: o.f, F: o.F, m1: o.m1, hard: o.hard, nao: o.nao, ocupacao: o.ocupacao, furos: o.furos, salaUc: o.salaUc, custoInicial: g.custoInicial, msConstrucao: g.msConstrucao,
        tMelhor: g.tMelhor, ms: g.ms, it: g.it, hist: g.hist.filter((_, x) => x % 4 === 0 || x === g.hist.length - 1) };
      dados.s1.push(run); grava();
      console.log(`S1 ${seed}: F ${o.F.toFixed(0)} f ${o.f.map((v) => +v.toFixed(3)).join(' ')} salaUc ${o.salaUc} inicial ${g.custoInicial.toFixed(0)} melhor aos ${(g.tMelhor / 1000).toFixed(1)} s`);
    }
    // A Solução 2 corre com as mesmas sementes: a população inicial parte do Greedy com ruído dessa semente.
    if (!process.env.SEM_S2 && !dados.s2.some((r) => r.seed === seed)) {
      const g = E.nsga2(P, Object.assign({ seed, ruido: 1, tempoMs: T * 1000 }, opts));
      const e = g.escolhida;
      const run = { seed, f: e.f, F: e.F, m1: e.m1, hard: e.hard, nao: e.nao, ocupacao: e.ocupacao, furos: e.furos, salaUc: e.salaUc, frente: g.frente.map((x) => ({ f: x.f, F: x.F })),
        geracoes: g.geracoes, avaliacoes: g.avaliacoes, custoInicial: g.custoInicial, tMelhor: g.tMelhor, ms: g.ms, hist: g.hist.filter((_, x) => x % 4 === 0 || x === g.hist.length - 1) };
      dados.s2.push(run); grava();
      console.log(`S2 ${seed}: F ${e.F.toFixed(0)} f ${e.f.map((v) => +v.toFixed(3)).join(' ')} salaUc ${e.salaUc} frente ${g.frente.length} gerações ${g.geracoes} melhor aos ${(g.tMelhor / 1000).toFixed(1)} s`);
    }
  }
  const res = ST.analisar(dados);
  fs.writeFileSync(path.join(outDir, 'resultados.json'), JSON.stringify(res, null, 1));
  fs.writeFileSync(path.join(outDir, 'anexo-H.csv'), ST.anexoH(dados, res));
  fs.writeFileSync(path.join(outDir, 'resultados.md'), ST.relatorio(dados, res));
  // Dados para a página "Experiências" da app.
  const r3 = (v) => (typeof v === 'number' ? +v.toPrecision(6) : v);
  // Valores das tabelas (f, F, custo inicial): precisão completa, para baterem com o relatório e o runs.json.
  const rx = (v) => (typeof v === 'number' ? +v.toFixed(Math.abs(v) >= 1000 ? 3 : 6) : v);
  const app = {
    meta: dados.meta, res, manual: dados.manual,
    s1: dados.s1.map((r) => ({ seed: r.seed, f: r.f.map(rx), F: rx(r.F), hv: r3(r.hv), m1: r.m1, hard: r.hard, nao: r.nao, furos: r.furos, salaUc: r.salaUc, custoInicial: rx(r.custoInicial), tMelhor: r.tMelhor, ms: r.ms, it: r.it, hist: r.hist.map(([t, v]) => [t, r3(v)]) })),
    s2: dados.s2.map((r) => ({ seed: r.seed, f: r.f.map(rx), F: rx(r.F), hv: r3(r.hv), m1: r.m1, hard: r.hard, nao: r.nao, furos: r.furos, salaUc: r.salaUc, dimFrente: r.dimFrente, frente: r.frente.map((x) => x.f.map(r3)), geracoes: r.geracoes, avaliacoes: r.avaliacoes, tMelhor: r.tMelhor, ms: r.ms, hist: r.hist.map(([t, v]) => [t, r3(v)]) })),
  };
  fs.writeFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'data-experiencias.js'), '/* Gerado por tools/experiencias.js */\n(function (root) { root.ODES_EXPERIENCIAS = ' + JSON.stringify(app) + '; })(typeof window !== \'undefined\' ? window : globalThis);\n');
  console.log('Resultados em', outDir);
})();
