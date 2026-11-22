/* Integra os docentes recolhidos do Ciência-Iscte (tools/docentes-ciencia.js) nos dados por omissão da app
   (js/data-iscte.js), sem voltar a gerar os horários: as aulas, salas e horas dos dois horários ficam iguais.
   Substitui o docente fictício pelos docentes reais, preenche a tabela docencia e atribui os turnos
   (M.importarDocentes, a mesma função do botão "Importar docentes" da app). Imprime os valores da Tabela 15.
   Uso: node tools/integrar-docentes.js <caminho para sql.js dist/sql-wasm.js> <docentes.json> */
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.resolve(process.argv[2]));
const M = require('../../frontend/js/model.js');
const E = require('../../frontend/js/engine.js')();
const ARQ = path.join(__dirname, '..', '..', 'frontend', 'js', 'data-iscte.js');

(async () => {
  const SQL = await initSqlJs();
  const dados = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  globalThis.window = globalThis;
  require(ARQ);
  const ds = globalThis.ODES_ISCTE;
  const T = ds.tables;

  const D = M.wrap(new SQL.Database());
  M.seed(D, ds);
  const antes = {};
  for (const h of [1, 2]) antes[h] = E.validate(M.buildProblem(D, { horarioId: h }));

  const r = M.importarDocentes(D, dados);

  // Tabelas afetadas, de volta ao conjunto de dados.
  const tab = (nome, cols) => ({ cols, rows: D.q(`SELECT ${cols.join(', ')} FROM ${nome} ORDER BY 1`).map((x) => cols.map((c) => x[c])) });
  T.docente = tab('docente', ['id', 'nome', 'departamento', 'categoria', 'horas_max', 'escola', 'perfil_url']);
  T.docencia = tab('docencia', ['uc_id', 'docente_id', 'ano_letivo', 'semestre', 'coordenador', 'cursos', 'fonte']);
  T.turno = tab('turno', ['id', 'componente_id', 'codigo', 'docente_id', 'inscritos', 'caracteristica_pedida', 'docente_estimado']);
  T.disponibilidade = { cols: ['id', 'docente_id', 'dia', 'inicio', 'fim', 'tipo'], rows: [] };

  // Contas de demonstração: direção de curso do MIG e um docente que dá aulas à turma MIG-A1, com todos os turnos
  // atribuídos sem estimativa e sem violações no Horário Otimizado (escolhido a 21/11/2026: Rúben Filipe de Sousa Pereira).
  const doc = D.one("SELECT id FROM docente WHERE nome = 'Rúben Filipe de Sousa Pereira'")
    || D.one('SELECT docente_id AS id FROM turno WHERE docente_id IS NOT NULL GROUP BY docente_id ORDER BY SUM(docente_estimado = 0) DESC, COUNT(*) DESC LIMIT 1');
  ds.contas.docente = { docente_id: doc.id };
  const mig = D.one("SELECT id FROM curso WHERE sigla = 'MIG'");
  if (mig) ds.contas.curso = { curso_id: mig.id };

  // Catálogo de fontes: docentes e distribuição de serviço passam a importados.
  for (const f of ds.fontes) {
    if (/^Docentes|Distribuição de serviço/.test(f[0])) { f[2] = 'Ciência-Iscte (ciencia.iscte-iul.pt), atividades letivas de 2022/2023, 1.º semestre'; f[4] = 'HTML → JSON'; f[5] = 'tools/docentes-ciencia.js; importado em 21/11/2026'; f[8] = 'importado'; }
  }
  ds.registo = ds.registo.filter((x) => x[2] !== 'Docentes importados');
  ds.registo.push(['2026-11-21T16:40:00', 'Gestor de horários', 'Docentes importados',
    `Ciência-Iscte: ${r.docentes} docentes, ${r.ucsComDocente} UCs com docente, ${r.turnosAtribuidos} turnos (${r.turnosEstimados} por estimativa)`, 'gestor']);

  const js = '/* Gerado por tools/build-iscte.js a partir da Proposta de Horário do ISCTE; docentes do Ciência-Iscte integrados por tools/integrar-docentes.js. */\n'
    + '(function (root) { root.ODES_ISCTE = ' + JSON.stringify(ds) + '; })(typeof window !== \'undefined\' ? window : globalThis);\n';
  fs.writeFileSync(ARQ, js);

  // Valores da Tabela 15.
  const comUcsSem = dados.docentes.filter((d) => d.ucs && d.ucs.length).length;
  const nUc = D.one('SELECT COUNT(*) n FROM uc').n;
  const nTurnos = D.one('SELECT COUNT(*) n FROM turno').n;
  const t15 = {
    perfisLidos: dados.perfisLidos,
    docentesComUcs: comUcsSem,
    docentesImportados: r.docentes,
    ucsComDocente: r.ucsComDocente, ucsTotal: nUc,
    ucsSemCorrespondencia: r.ucsDoSiteSemCorrespondencia,
    turnosComDocente: r.turnosAtribuidos, turnosTotal: nTurnos,
    turnosEstimados: r.turnosEstimados,
    turnosComSobreposicao: r.turnosComSobreposicao,
    comCategoria: D.one('SELECT COUNT(*) n FROM docente WHERE categoria IS NOT NULL').n,
    comDepartamento: D.one('SELECT COUNT(*) n FROM docente WHERE departamento IS NOT NULL').n,
    ucsComVariosDocentes: D.one('SELECT COUNT(*) n FROM (SELECT uc_id FROM docencia GROUP BY uc_id HAVING COUNT(*) > 1)').n,
  };
  const depois = {};
  for (const h of [1, 2]) depois[h] = E.validate(M.buildProblem(D, { horarioId: h }));
  const regras = (v) => Object.fromEntries(Object.entries(v.porRegra).map(([k, x]) => [k, x.n]));
  const out = { tabela15: t15, validacao: { manual: { antes: { hard: antes[1].hard, soft: antes[1].soft, porRegra: regras(antes[1]) }, depois: { hard: depois[1].hard, soft: depois[1].soft, porRegra: regras(depois[1]) } },
    otimizado: { antes: { hard: antes[2].hard, soft: antes[2].soft, porRegra: regras(antes[2]) }, depois: { hard: depois[2].hard, soft: depois[2].soft, porRegra: regras(depois[2]) } } } };
  console.log(JSON.stringify(out, null, 1));
})();
