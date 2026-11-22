/* Constrói js/data-iscte.js a partir dos ficheiros enviados pelo professor:
   importa o horário de exemplo (2022/23) e a caracterização das salas, adapta as
   semanas ao calendário de 2022/23 (o do próprio ficheiro), valida o horário e gera a versão melhorada
   (reatribuição de salas, sem mudar dias nem horas).
   Uso: node tools/build-iscte.js <sql-asm.js> <HorarioDeExemplo.csv> <CaracterizaçãoDasSalas.csv> [segundos] [pasta de saída dos CSV] */
const path = require('path');
const fs = require('fs');
const initSqlJs = require(path.resolve(process.argv[2]));
const SCHEMA = require('../../frontend/js/schema.js');
globalThis.ODES_SCHEMA = SCHEMA;
const I = require('../../frontend/js/importer.js');
const M = require('../../frontend/js/model.js');
const E = require('../../frontend/js/engine.js')();
const DEMO = require('../../frontend/js/data.js');

const segundos = Number(process.argv[5]) || 90;
const outDir = process.argv[6] || null;

(async () => {
  const SQL = await initSqlJs();
  const r = I.iscte(fs.readFileSync(process.argv[3], 'utf8'), fs.readFileSync(process.argv[4], 'utf8'));
  const T = r.tables;

  /* Docente de demonstração (fictício): o ficheiro do professor não traz docentes.
     Fica com alguns turnos teóricos de um curso, sem sobreposições, para demonstrar
     o perfil de docente e a consulta do horário por professor. */
  T.docente = { cols: ['id', 'nome', 'departamento', 'categoria', 'horas_max'], rows: [[1, 'Docente Exemplo (fictício)', 'Ciências e Tecnologias da Informação', 'Professor Auxiliar', 540]] };
  const cursoLEI = T.curso.rows.find((c) => c[1] === 'LEI');
  const turmasLEI = new Set(T.turma.rows.filter((t) => t[1] === cursoLEI[0]).map((t) => t[0]));
  const turnoTurmas = new Map();
  for (const [tu, tm] of T.turno_turma.rows) { if (!turnoTurmas.has(tu)) turnoTurmas.set(tu, []); turnoTurmas.get(tu).push(tm); }
  const comp = new Map(T.componente.rows.map((c) => [c[0], c]));
  const aulasPorTurno = new Map();
  for (const a of r.aulas) { if (!aulasPorTurno.has(a[0])) aulasPorTurno.set(a[0], []); aulasPorTurno.get(a[0]).push(a); }
  const escolhidas = [];
  const choca = (a) => escolhidas.some((b) => b[2] === a[2] && (b[7] & a[7]) && Math.min(b[3] + b[4], a[3] + a[4]) > Math.max(b[3], a[3]));
  let minutos = 0;
  const ucsDoc = new Set();
  for (const t of T.turno.rows) {
    if (minutos >= 540 || ucsDoc.size >= 3) break;
    const tms = turnoTurmas.get(t[0]) || [];
    const c = comp.get(t[1]);
    if (!tms.some((x) => turmasLEI.has(x)) || !['T', 'TP'].includes(c[2])) continue;
    const as = aulasPorTurno.get(t[0]) || [];
    if (!as.length || as.some((a) => I.pop(a[7]) < 10 || choca(a))) continue;
    if (!ucsDoc.has(c[1]) && ucsDoc.size >= 3) continue;
    t[3] = 1; ucsDoc.add(c[1]);
    for (const a of as) { escolhidas.push(a); minutos += a[4]; }
  }
  T.disponibilidade = { cols: ['id', 'docente_id', 'dia', 'inicio', 'fim', 'tipo'], rows: [[1, 1, 4, 480, 1410, 'indisponivel']] };
  if (escolhidas.some((a) => a[2] === 4)) T.disponibilidade.rows = [[1, 1, 5, 480, 1410, 'indisponivel']];
  // O estudante de demonstração é um aluno da turma MIG-A1.
  const turmaEst = T.turma.rows.find((t) => t[3] === 'MIG-A1') || T.turma.rows.filter((t) => t[1] === cursoLEI[0]).sort((a, b) => b[4] - a[4])[0];

  const regras = SCHEMA.regras(r.regrasOpts);
  const fontes = DEMO.fontes.map((f) => {
    const x = f.slice();
    if (/Horários atuais/.test(x[0])) { x[0] = 'Proposta de Horário do ISCTE (1.º semestre 2022/23)'; x[4] = 'CSV (;)'; x[5] = 'Ficheiro recebido; importado com o calendário de 2022/23 (Fontes e recolha)'; x[8] = 'importado'; }
    if (/Cadastro de salas/.test(x[0])) { x[0] = 'Caracterização das salas do ISCTE'; x[4] = 'CSV (;)'; x[5] = 'Ficheiro recebido; 30 características por sala'; x[8] = 'importado'; }
    if (/^Docentes|Distribuição de serviço|Indisponibilidades/.test(x[0])) x[8] = 'por pedir';
    if (/Cursos/.test(x[0])) { x[5] = 'Só as siglas vêm no horário; nomes e regime por confirmar'; x[8] = 'recebido'; }
    if (/Estudantes inscritos/.test(x[0])) { x[5] = 'Inscritos por turno vêm no horário de exemplo'; x[8] = 'importado'; }
    return x;
  });
  fontes.push(['Calendário escolar 2022/23 (início do semestre, feriados, pausas)', 'calendario, feriado', 'Calendário escolar do ISCTE', 'Conselho Pedagógico / serviços académicos', 'PDF / HTML', 'Datas tiradas do próprio horário de exemplo (semana 1 a 12/09/2022)', 'Anual', 'Sem dados pessoais', 'pedido']);

  const ds = {
    id: 'iscte', nome: 'ISCTE 2022/23 · Proposta de Horário', tables: T, regras, fontes,
    parametros: [
      ['conjunto', 'iscte', 'Conjunto de dados'],
      ['aulas_em_falta', '0', 'O horário importado é a lista completa de aulas: não se acrescentam aulas previstas'],
      ['relatorio_importacao', JSON.stringify(r.relatorio), 'Resumo da importação da Proposta de Horário'],
    ],
    contas: { docente: { docente_id: 1 }, curso: { curso_id: cursoLEI[0] }, estudante: { turma_id: turmaEst[0] } },
    horarios: [{
      id: 1, nome: '2022/23 · 1.º sem. · Horário ISCTE (Manual)', ano_letivo: '2022/23', semestre: 1, origem: 'importado',
      criado_em: '2026-10-13T09:00:00', estado: 'publicado', criado_por: 'gestor', submetido_por: 'gestor', aprovado_por: 'curso', publicado_em: '2026-10-13T09:30:00',
      notas: 'Horário ISCTE (Manual): Proposta de Horário de 2022/23, com as datas originais do ficheiro do professor.',
      aulaCols: r.aulaCols, aulas: r.aulas,
    }],
  };

  // Base de dados com o horário do professor; valida e gera a versão melhorada.
  const D = M.wrap(new SQL.Database());
  M.seed(D, ds);
  const t0 = Date.now();
  const P0 = M.buildProblem(D, { horarioId: 1 });
  const v0 = E.validate(P0);
  console.log('Manual: aulas', P0.aulas.length, 'hard', v0.hard, 'soft', v0.soft, 'custo', v0.custo.toFixed(0), `(${Date.now() - t0} ms)`);
  console.log(' ', Object.entries(v0.porRegra).map(([k, x]) => `${k}:${x.n}`).join(' '));

  const P = M.buildProblem(D, { horarioId: 1 });
  const g = E.solve(P, { modo: 'salas', seed: 2026, tempoMs: segundos * 1000, T0: 3 }, (p) => { if (p.fase !== 'otimizacao' || Math.random() < 0.05) process.stdout.write(`\r  ${p.fase} ${(p.ms / 1000).toFixed(0)} s custo ${(p.melhor || p.custo).toFixed(0)}   `); });
  console.log('\nOtimizado: hard', g.hard, 'soft', g.soft, 'custo', g.custo.toFixed(0), 'it', g.it, 'salas melhoradas na fase 3', g.melhoriasSalas);
  console.log(' ', Object.entries(g.porRegra).map(([k, x]) => `${k}:${x.n}`).join(' '));
  const aulasMelhor = r.aulas.map((a, i) => {
    const x = g.aulas[i];
    const sala = x.sala >= 0 ? P.salas[x.sala].id : (a[5] != null && P.aulas[i].noRoom ? a[5] : null);
    return [a[0], a[1], x.dia, x.ini, a[4], sala, a[6], a[7], a[8]];
  });
  const mud = aulasMelhor.filter((a, i) => a[5] !== r.aulas[i][5]).length;
  ds.horarios.push({
    id: 2, nome: '2022/23 · 1.º sem. · Horário Otimizado', ano_letivo: '2022/23', semestre: 1, origem: 'gerado',
    criado_em: '2026-10-13T10:00:00', estado: 'em revisao', criado_por: 'gestor', submetido_por: 'gestor',
    notas: `Mesmos dias e horas do Horário ISCTE (Manual); ${mud} aulas mudaram de sala. Reatribuição de salas por arrefecimento simulado e troca de salas entre aulas, seguida da fase de melhoria de salas (Martins, 2014). Os dias e horas não mudaram porque o ficheiro não traz docentes: mover aulas poderia criar sobreposições de docentes que não se conseguem verificar.`,
    aulaCols: r.aulaCols, aulas: aulasMelhor,
  });
  // Aulas que calham em feriados: repostas numa semana posterior, nos dois horários (de preferência prolongando a aula).
  {
    const Df = M.wrap(new SQL.Database());
    M.seed(Df, ds);
    for (const h of ds.horarios) {
      const t1 = Date.now();
      const rf = M.reporFeriados(Df, E, h.id, 'gestor');
      console.log(`Feriados em ${h.nome}: ${rf.n} aulas em ${rf.feriados} feriados, ${rf.ok} repostas (${rf.prolongadas} prolongadas), ${rf.n - rf.ok} sem data (${Date.now() - t1} ms)`);
      h.feriados = rf;
      const cols = ['id', 'turno_id', 'seq', 'dia', 'inicio', 'duracao', 'sala_id', 'fixa', 'semanas', 'caracteristica_pedida', 'reposicao_de', 'evento_id'];
      h.aulaCols = cols;
      h.aulas = Df.q(`SELECT ${cols.join(', ')} FROM aula WHERE horario_id = ? ORDER BY id`, [h.id]).map((x) => cols.map((c) => x[c]));
    }
    const ec = ['id', 'nome', 'tipo', 'data', 'inicio', 'fim', 'descricao', 'criado_por', 'criado_em'];
    T.evento = { cols: ec, rows: Df.q('SELECT * FROM evento ORDER BY id').map((x) => ec.map((c) => x[c])) };
    const xc = ['evento_id', 'horario_id', 'aula_id', 'semana', 'nova_aula_id', 'nova_semana', 'estado', 'nota'];
    T.evento_aula = { cols: xc, rows: Df.q('SELECT * FROM evento_aula').map((x) => xc.map((c) => x[c])) };
  }
  ds.registo = [
    ['2026-10-13T09:00:00', 'Gestor de horários', 'Importação', `Proposta de Horário e caracterização das salas: ${r.relatorio.aulas} aulas semanais, ${r.relatorio.salas} salas`, 'gestor'],
    ['2026-10-13T09:30:00', 'Gestor de horários', 'Horário publicado', ds.horarios[0].nome, 'gestor'],
    ['2026-10-13T10:00:00', 'Gestor de horários', 'Horário gerado', ds.horarios[1].nome, 'gestor'],
    ['2026-10-13T10:05:00', 'Gestor de horários', 'Submetido para revisão', ds.horarios[1].nome, 'gestor'],
    ...ds.horarios.map((h) => ['2026-10-13T10:10:00', 'Gestor de horários', 'Aulas de feriados repostas', `${h.nome}: ${h.feriados.n} aulas em feriados, ${h.feriados.ok} repostas numa semana posterior`, 'gestor']),
  ];
  ds.resumo = { professor: { hard: v0.hard, soft: v0.soft, porRegra: v0.porRegra }, melhorado: { hard: g.hard, soft: g.soft, porRegra: g.porRegra }, mudancasSala: mud };

  const js = '/* Gerado por tools/build-iscte.js a partir da Proposta de Horário do ISCTE (sem dados pessoais). */\n'
    + '(function (root) { root.ODES_ISCTE = ' + JSON.stringify(ds) + '; })(typeof window !== \'undefined\' ? window : globalThis);\n';
  fs.writeFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'data-iscte.js'), js);
  console.log('js/data-iscte.js', (js.length / 1024).toFixed(0), 'KB');

  // Verificação e CSV no formato do ISCTE.
  const D2 = M.wrap(new SQL.Database());
  M.seed(D2, ds);
  const cal = M.calendario(D2);
  const linhas = (hid) => D2.q(`SELECT v.*, (SELECT group_concat(tm.codigo, ', ') FROM turno_turma tt JOIN turma tm ON tm.id = tt.turma_id WHERE tt.turno_id = v.turno_id) AS turmas,
      (SELECT group_concat(DISTINCT cu.sigla) FROM turno_turma tt JOIN turma tm ON tm.id = tt.turma_id JOIN curso cu ON cu.id = tm.curso_id WHERE tt.turno_id = v.turno_id) AS cursos,
      (SELECT group_concat(sc.caracteristica, ', ') FROM sala_caracteristica sc WHERE sc.sala_id = v.sala_id) AS caracteristicas_sala
    FROM v_aula v WHERE horario_id = ?`, [hid]);
  for (const hid of [1, 2]) { const v1 = E.validate(M.buildProblem(D2, { horarioId: hid })); console.log('Verificação do horário', hid, 'após repor feriados: hard', v1.hard, 'soft', v1.soft, Object.entries(v1.porRegra).map(([k, x]) => `${k}:${x.n}`).join(' ')); }
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const [hid, nome] of [[1, 'horario-2022-23-iscte-manual.csv'], [2, 'horario-2022-23-otimizado.csv']]) {
      const x = I.exportarIscte(linhas(hid), { inicio: cal.inicio, semanas: cal.semanas }, D2.q('SELECT data FROM feriado'));
      fs.writeFileSync(path.join(outDir, nome), x.csv);
      console.log(nome, x.linhas, 'linhas,', x.saltadas, 'ocorrências em feriados não exportadas');
    }
    fs.writeFileSync(path.join(outDir, 'resumo-importacao.json'), JSON.stringify({ relatorio: r.relatorio, resumo: ds.resumo }, null, 1));
  }
})();
