/* Dados de exemplo FICTÍCIOS para o protótipo de gestão de horários.
   Nomes de docentes, salas e números de alunos são inventados. Nenhum dado
   pessoal real é usado. A estrutura segue o modelo de dados do item 2. */
(function (root) {
  'use strict';

  /* ---------- Entidades base ---------- */
  const cursos = [
    [1, 'LEI', 'Licenciatura em Engenharia Informática', 'Licenciatura', 'diurno'],
    [2, 'LIGE', 'Licenciatura em Informática e Gestão de Empresas', 'Licenciatura', 'diurno'],
    [3, 'MIG', 'Mestrado em Informática e Gestão', 'Mestrado', 'pos-laboral'],
  ];

  const turmas = [
    [1, 1, 1, 'LEI1-A', 42], [2, 1, 1, 'LEI1-B', 40], [3, 1, 1, 'LEI1-C', 38], [4, 1, 1, 'LEI1-D', 36],
    [5, 1, 2, 'LEI2-A', 40], [6, 1, 2, 'LEI2-B', 36], [7, 1, 2, 'LEI2-C', 34],
    [8, 1, 3, 'LEI3-A', 44], [9, 1, 3, 'LEI3-B', 38],
    [10, 2, 1, 'LIGE1-A', 40], [11, 2, 1, 'LIGE1-B', 36], [12, 2, 1, 'LIGE1-C', 32],
    [13, 2, 2, 'LIGE2-A', 42], [14, 2, 2, 'LIGE2-B', 30],
    [15, 3, 1, 'MIG-A1', 30],
  ];

  const docentes = [
    [1, 'Ana Ribeiro', 'Ciências e Tecnologias da Informação', 'Professora Associada', 540],
    [2, 'Bruno Matos', 'Ciências e Tecnologias da Informação', 'Professor Auxiliar', 540],
    [3, 'Carla Nogueira', 'Matemática', 'Professora Auxiliar', 540],
    [4, 'Duarte Fonseca', 'Ciências e Tecnologias da Informação', 'Assistente Convidado', 360],
    [5, 'Eva Lacerda', 'Ciências e Tecnologias da Informação', 'Professora Auxiliar', 540],
    [6, 'Filipe Sarmento', 'Matemática', 'Professor Associado', 540],
    [7, 'Gonçalo Pires', 'Ciências e Tecnologias da Informação', 'Professor Auxiliar', 540],
    [8, 'Helena Vaz', 'Ciências e Tecnologias da Informação', 'Assistente Convidada', 360],
    [9, 'Inês Barata', 'Ciências e Tecnologias da Informação', 'Professora Auxiliar', 540],
    [10, 'João Teixeira', 'Ciências e Tecnologias da Informação', 'Assistente Convidado', 360],
    [11, 'Leonor Quintas', 'Finanças e Contabilidade', 'Professora Auxiliar', 540],
    [12, 'Miguel Antunes', 'Sistemas de Informação', 'Professor Associado', 540],
    [13, 'Nuno Correia', 'Marketing, Operações e Gestão Geral', 'Professor Auxiliar', 540],
    [14, 'Olga Simões', 'Matemática', 'Assistente Convidada', 360],
    [15, 'Pedro Lourenço', 'Ciências e Tecnologias da Informação', 'Professor Auxiliar', 540],
    [16, 'Rita Moura', 'Sistemas de Informação', 'Professora Auxiliar', 540],
    [17, 'Sérgio Valente', 'Ciências e Tecnologias da Informação', 'Assistente Convidado', 360],
    [18, 'Teresa Gaspar', 'Marketing, Operações e Gestão Geral', 'Professora Auxiliar', 540],
    [19, 'Vasco Henriques', 'Ciências e Tecnologias da Informação', 'Assistente Convidado', 360],
    [20, 'Xana Pestana', 'Sistemas de Informação', 'Professora Auxiliar', 540],
    [21, 'Alice Coutinho', 'Ciências e Tecnologias da Informação', 'Assistente Convidada', 360],
    [22, 'Rui Damásio', 'Matemática', 'Professor Auxiliar', 540],
    [23, 'Marta Feio', 'Finanças e Contabilidade', 'Assistente Convidada', 360],
    [24, 'Tiago Branco', 'Ciências e Tecnologias da Informação', 'Professor Auxiliar', 540],
    [25, 'Joana Lobo', 'Marketing, Operações e Gestão Geral', 'Assistente Convidada', 360],
  ];

  const tiposSala = [
    ['AUD', 'Auditório'], ['SALA', 'Sala de aula'], ['LAB', 'Laboratório de informática'], ['SEM', 'Sala de seminário'],
  ];
  const tiposAula = [['T', 'Teórica'], ['TP', 'Teórico-prática'], ['L', 'Laboratorial']];
  const edificios = [['A', 'Edifício A'], ['B', 'Edifício B'], ['C', 'Edifício C']];

  // id, codigo, edificio, piso, capacidade, tipo, equipamento
  const salas = [
    [1, 'AUD-A1', 'A', 0, 160, 'AUD', 'Projetor duplo, microfone'],
    [2, 'AUD-A2', 'A', 0, 110, 'AUD', 'Projetor, microfone'],
    [3, 'A1.01', 'A', 1, 50, 'SALA', 'Projetor'],
    [4, 'A1.02', 'A', 1, 50, 'SALA', 'Projetor'],
    [5, 'A1.03', 'A', 1, 40, 'SALA', 'Projetor'],
    [7, 'A2.01', 'A', 2, 60, 'SALA', 'Projetor, quadro interativo'],
    [9, 'B0.01', 'B', 0, 90, 'AUD', 'Projetor'],
    [10, 'B1.01', 'B', 1, 36, 'LAB', '36 PCs, Linux/Windows'],
    [11, 'B1.02', 'B', 1, 36, 'LAB', '36 PCs, Linux/Windows'],
    [12, 'B1.03', 'B', 1, 30, 'LAB', '30 PCs, Windows'],
    [14, 'B2.01', 'B', 2, 45, 'SALA', 'Projetor'],
    [16, 'B2.03', 'B', 2, 30, 'SALA', 'Projetor'],
    [17, 'C1.01', 'C', 1, 55, 'SALA', 'Projetor'],
    [19, 'C1.03', 'C', 1, 25, 'SEM', 'Ecrã, mesa em U'],
    [20, 'C2.01', 'C', 2, 40, 'LAB', '40 PCs, Linux'],
    [21, 'C2.02', 'C', 2, 70, 'SALA', 'Projetor duplo'],
    [23, 'C0.05', 'C', 0, 16, 'SEM', 'Ecrã'],
  ];

  /* ---------- Plano de estudos e componentes (1.º semestre) ----------
     uc: [codigo, nome, ects, departamento, [[curso, ano], ...],
          [[tipo, dur, aulas/semana, tipoSala, taxa, agrupamento, docentes[]], ...]]
     agrupamento: 'todas' = um turno para todas as turmas do(s) curso(s)/ano;
                  'turma' = um turno por turma. */
  const ucSpec = [
    ['PI', 'Programação I', 7.5, 'CTI', [[1, 1]], [
      ['T', 90, 1, 'AUD', 0.7, 'todas', [2]],
      ['L', 90, 2, 'LAB', 0.95, 'turma', [2, 4, 21, 24]]]],
    ['MD', 'Matemática Discreta', 6, 'Matemática', [[1, 1]], [
      ['T', 90, 1, 'AUD', 0.65, 'todas', [3]],
      ['TP', 90, 1, 'SALA', 0.85, 'turma', [3, 14, 22, 22]]]],
    ['CAL1', 'Cálculo I', 6, 'Matemática', [[1, 1]], [
      ['T', 90, 2, 'AUD', 0.65, 'todas', [6]],
      ['TP', 90, 1, 'SALA', 0.85, 'turma', [14, 6, 22, 3]]]],
    ['AC', 'Arquitetura de Computadores', 6, 'CTI', [[1, 1]], [
      ['T', 90, 1, 'AUD', 0.7, 'todas', [7]],
      ['L', 90, 1, 'LAB', 0.9, 'turma', [7, 19, 19, 24]]]],
    ['BD', 'Bases de Dados', 6, 'CTI', [[1, 2], [2, 2]], [
      ['T', 90, 1, 'AUD', 0.7, 'todas', [1]],
      ['L', 90, 1, 'LAB', 0.9, 'turma', [1, 8, 8, 10, 21]]]],
    ['SO', 'Sistemas Operativos', 6, 'CTI', [[1, 2]], [
      ['T', 90, 1, 'AUD', 0.7, 'todas', [5]],
      ['L', 90, 1, 'LAB', 0.9, 'turma', [5, 10, 17]]]],
    ['EDA', 'Estruturas de Dados e Algoritmos', 7.5, 'CTI', [[1, 2]], [
      ['T', 90, 1, 'AUD', 0.7, 'todas', [9]],
      ['L', 90, 2, 'LAB', 0.95, 'turma', [9, 4, 19]]]],
    ['PE', 'Probabilidades e Estatística', 6, 'Matemática', [[1, 2]], [
      ['T', 90, 1, 'AUD', 0.6, 'todas', [6]],
      ['TP', 90, 1, 'SALA', 0.8, 'turma', [14, 22, 6]]]],
    ['ES', 'Engenharia de Software', 6, 'CTI', [[1, 3]], [
      ['T', 90, 1, 'SALA', 0.75, 'todas', [15]],
      ['L', 180, 1, 'LAB', 0.9, 'turma', [15, 24]]]],
    ['RC', 'Redes de Computadores', 6, 'CTI', [[1, 3]], [
      ['T', 90, 1, 'SALA', 0.7, 'todas', [7]],
      ['L', 90, 1, 'LAB', 0.9, 'turma', [17, 7]]]],
    ['IA', 'Inteligência Artificial', 6, 'CTI', [[1, 3]], [
      ['T', 90, 1, 'SALA', 0.75, 'todas', [5]],
      ['TP', 90, 1, 'SALA', 0.85, 'turma', [9, 5]]]],
    ['FP', 'Fundamentos de Programação', 6, 'CTI', [[2, 1]], [
      ['T', 90, 1, 'SALA', 0.7, 'todas', [15]],
      ['L', 90, 2, 'LAB', 0.95, 'turma', [10, 4, 21]]]],
    ['CF', 'Contabilidade Financeira', 6, 'Finanças', [[2, 1]], [
      ['T', 90, 1, 'SALA', 0.65, 'todas', [11]],
      ['TP', 90, 1, 'SALA', 0.85, 'turma', [11, 23, 23]]]],
    ['MG', 'Matemática para a Gestão', 6, 'Matemática', [[2, 1]], [
      ['T', 90, 2, 'SALA', 0.65, 'todas', [3]],
      ['TP', 90, 1, 'SALA', 0.85, 'turma', [14, 22, 3]]]],
    ['IG', 'Introdução à Gestão', 6, 'MOGG', [[2, 1]], [
      ['T', 90, 1, 'SALA', 0.6, 'todas', [13]],
      ['TP', 90, 1, 'SALA', 0.8, 'turma', [18, 25, 25]]]],
    ['GO', 'Gestão de Operações', 6, 'MOGG', [[2, 2]], [
      ['T', 90, 1, 'SALA', 0.7, 'todas', [13]],
      ['TP', 90, 1, 'SALA', 0.85, 'turma', [18, 25]]]],
    ['SI', 'Sistemas de Informação', 6, 'SI', [[2, 2]], [
      ['T', 90, 1, 'SALA', 0.7, 'todas', [16]],
      ['TP', 90, 1, 'SALA', 0.85, 'turma', [16, 20]]]],
    ['GPI', 'Gestão de Projetos Informáticos', 6, 'SI', [[3, 1]], [
      ['TP', 180, 1, 'SALA', 0.85, 'turma', [12]]]],
    ['AD', 'Análise de Dados', 6, 'SI', [[3, 1]], [
      ['TP', 90, 1, 'SALA', 0.85, 'turma', [20]],
      ['L', 90, 1, 'LAB', 0.9, 'turma', [20]]]],
    ['AE', 'Arquiteturas Empresariais', 6, 'SI', [[3, 1]], [
      ['TP', 180, 1, 'SEM', 0.85, 'turma', [16]]]],
    ['SAD', 'Sistemas de Apoio à Decisão', 6, 'SI', [[3, 1]], [
      ['TP', 180, 1, 'SALA', 0.85, 'turma', [12]]]],
  ];

  // Expande a especificação para linhas das tabelas.
  const ucs = [], plano = [], componentes = [], turnos = [], turnoTurma = [];
  let ucId = 0, compId = 0, turnoId = 0;
  for (const [cod, nome, ects, dep, ofertas, comps] of ucSpec) {
    ucId++;
    ucs.push([ucId, cod, nome, ects, dep]);
    const turmasUC = [];
    for (const [cursoId, ano] of ofertas) {
      plano.push([cursoId, ucId, ano, 1, 1]);
      for (const t of turmas) if (t[1] === cursoId && t[2] === ano) turmasUC.push(t);
    }
    for (const [tipo, dur, n, tipoSala, taxa, agrup, docs] of comps) {
      compId++;
      componentes.push([compId, ucId, tipo, dur, n, tipoSala, taxa]);
      if (agrup === 'todas') {
        turnoId++;
        const insc = turmasUC.reduce((s, t) => s + t[4], 0);
        turnos.push([turnoId, compId, tipo + '1', docs[0], insc]);
        for (const t of turmasUC) turnoTurma.push([turnoId, t[0]]);
      } else {
        turmasUC.forEach((t, k) => {
          turnoId++;
          turnos.push([turnoId, compId, tipo + (k + 1), docs[k % docs.length], t[4]]);
          turnoTurma.push([turnoId, t[0]]);
        });
      }
    }
  }

  // Disponibilidades indicadas pelos docentes (dia 0 = segunda).
  const disponibilidades = [
    [1, 3, 2, 480, 1410, 'indisponivel'],   // Carla Nogueira: quarta-feira
    [2, 7, 4, 480, 780, 'indisponivel'],    // Gonçalo Pires: sexta de manhã
    [3, 12, 1, 1080, 1410, 'preferido'],    // Miguel Antunes prefere terça e quinta à noite
    [4, 12, 3, 1080, 1410, 'preferido'],
    [5, 11, 0, 480, 1410, 'indisponivel'],  // Leonor Quintas: segunda-feira
    [6, 17, 0, 480, 1080, 'indisponivel'],  // Sérgio Valente (convidado): só a partir das 18h às segundas e terças
    [7, 17, 1, 480, 1080, 'indisponivel'],
    [8, 20, 4, 1080, 1410, 'indisponivel'], // Xana Pestana: sexta à noite
    [9, 6, 0, 480, 660, 'indisponivel'],
  ];

  const reservas = [
    [1, 1, 2, 870, 1050, 'Conferência de abertura do ano letivo', 'Gestão de espaços'],
    [2, 21, 3, 1080, 1260, 'Sessão de júri de provas', 'Secretariado'],
  ];

  /* ---------- Catálogo de fontes (item 1) ---------- */
  const fontes = [
    ['Cursos (código, nome, grau, regime)', 'curso', 'Site institucional e sistema académico', 'Serviços académicos', 'HTML / exportação', 'Exportação CSV pedida; scraping das páginas públicas', 'Anual', 'Sem dados pessoais', 'importado'],
    ['UCs do plano de estudos (ano, semestre, ECTS)', 'uc, plano_estudos', 'Planos de estudo publicados, fichas de UC', 'Direções de curso', 'HTML / PDF', 'Transcrição e validação com a direção de curso', 'Anual', 'Sem dados pessoais', 'importado'],
    ['Docentes (departamento, categoria, carga)', 'docente', 'Sistema de RH / departamentos', 'Departamentos', 'Exportação', 'Exportação com dados mínimos', 'Semestral', 'Dados pessoais mínimos (nome, categoria)', 'recebido'],
    ['Distribuição de serviço docente', 'turno.docente_id', 'Folhas de distribuição de serviço', 'Diretores de departamento', 'Excel', 'Recolha dos ficheiros e normalização', 'Semestral', 'Dados pessoais mínimos', 'pedido'],
    ['Turnos por UC e tipo de aula', 'componente, turno, turno_turma', 'Sistema académico / ficha da UC', 'Coordenadores de UC', 'Sistema / PDF', 'Exportação; questionário ao coordenador', 'Semestral', 'Sem dados pessoais', 'importado'],
    ['Número e tipo de aulas por semestre', 'componente', 'Fichas de UC (horas de contacto)', 'Coordenadores de UC', 'PDF / HTML', 'Extração das fichas e validação', 'Anual', 'Sem dados pessoais', 'importado'],
    ['Cadastro de salas', 'sala, edificio, tipo_sala', 'Gestão de espaços / sistema de reservas', 'Gestão de espaços', 'Excel', 'Exportação e levantamento de equipamento', 'Anual', 'Sem dados pessoais', 'importado'],
    ['Horários atuais', 'horario, aula', 'Horários publicados', 'Gabinete de horários', 'HTML / iCal / Excel', 'Exportação ou scraping (baseline)', 'Semestral', 'Sem dados pessoais', 'importado'],
    ['Horários de anos anteriores', 'horario (histórico), aula', 'Arquivo do gabinete de horários', 'Gabinete de horários', 'Excel / CSV', 'Pedido formal', 'Pontual', 'Sem dados pessoais', 'recebido'],
    ['Estudantes inscritos por UC/turno', 'turma.n_alunos, turno.inscritos', 'Sistema académico (inscrições)', 'Serviços académicos', 'Exportação', 'Só contagens agregadas', 'Semestral', 'Só dados agregados (RGPD)', 'pedido'],
    ['Participação esperada nas aulas', 'componente.taxa_presenca', 'Fénix (presença prevista indicada pelo aluno na inscrição; ainda sem dados), registos de presença, histórico', 'Docentes / gabinete de qualidade', 'Variado', 'Inquérito; estimativa inscritos × taxa histórica', 'Semestral', 'Agregado', 'por pedir'],
    ['Indisponibilidades e preferências dos docentes', 'disponibilidade', 'Formulário aos docentes (nesta app)', 'Docentes', 'Formulário', 'Registo direto pelo docente na app', 'Semestral', 'Dados pessoais mínimos', 'recebido'],
    ['Reservas de salas para eventos', 'reserva', 'Sistema de reservas', 'Gestão de espaços', 'Sistema / Excel', 'Registo direto na app', 'Contínua', 'Sem dados pessoais', 'importado'],
    ['Regras de funcionamento dos horários', 'regra', 'Regulamentos, entrevistas ao gabinete de horários', 'Gabinete de horários / Conselho Pedagógico', 'Documento', 'Entrevista e análise documental', 'Quando mudam', 'Sem dados pessoais', 'importado'],
  ];

  /* Características de sala (no conjunto de demonstração coincidem com os tipos de sala). */
  const nomeTipo = Object.fromEntries(tiposSala);
  const caracteristicas = tiposSala.map(([, n]) => [n, null]);
  const salaCar = salas.map((s) => [s[0], nomeTipo[s[5]]]);
  const S = root.ODES_SCHEMA || require('./schema.js');
  const regras = S.regras({
    essenciais: ['Laboratório de informática'],
    equivalentes: { 'Sala de aula': ['Sala de seminário'], 'Sala de seminário': ['Sala de aula'] },
  });
  const T = (cols, rows) => ({ cols, rows });

  root.ODES_DATA = {
    id: 'demo', nome: 'Demonstração (dados fictícios)',
    tables: {
      curso: T(['id', 'sigla', 'nome', 'grau', 'regime'], cursos),
      turma: T(['id', 'curso_id', 'ano', 'codigo', 'n_alunos'], turmas),
      docente: T(['id', 'nome', 'departamento', 'categoria', 'horas_max'], docentes),
      tipo_sala: T(['id', 'nome'], tiposSala),
      tipo_aula: T(['id', 'nome'], tiposAula),
      edificio: T(['id', 'nome'], edificios),
      caracteristica: T(['nome', 'descricao'], caracteristicas),
      sala: T(['id', 'codigo', 'edificio_id', 'piso', 'capacidade', 'tipo_id', 'equipamento'], salas),
      sala_caracteristica: T(['sala_id', 'caracteristica'], salaCar),
      uc: T(['id', 'codigo', 'nome', 'ects', 'departamento'], ucs),
      plano_estudos: T(['curso_id', 'uc_id', 'ano', 'semestre', 'obrigatoria'], plano),
      componente: T(['id', 'uc_id', 'tipo_aula_id', 'duracao_min', 'aulas_semana', 'tipo_sala_id', 'taxa_presenca'], componentes),
      turno: T(['id', 'componente_id', 'codigo', 'docente_id', 'inscritos'], turnos),
      turno_turma: T(['turno_id', 'turma_id'], turnoTurma),
      calendario: T(['id', 'ano_letivo', 'semestre', 'inicio', 'semanas', 'notas'], [[1, '2026/27', 1, '2026-09-14', 14, 'Calendário de demonstração.']]),
      feriado: T(['data', 'nome', 'tipo'], [['2026-10-05', 'Implantação da República', 'feriado'], ['2026-12-01', 'Restauração da Independência', 'feriado'], ['2026-12-08', 'Imaculada Conceição', 'feriado']]),
      disponibilidade: T(['id', 'docente_id', 'dia', 'inicio', 'fim', 'tipo'], disponibilidades),
      reserva: T(['id', 'sala_id', 'dia', 'inicio', 'fim', 'motivo', 'pedido_por'], reservas),
    },
    regras, fontes,
    parametros: [['conjunto', 'demo', 'Conjunto de dados'], ['aulas_em_falta', '1', 'Acrescenta à validação as aulas previstas nas componentes que ainda não estão no horário']],
    contas: { docente: { docente_id: 2 }, curso: { curso_id: 1 }, estudante: { turma_id: 15 } },
    horarios: [],
  };
  if (typeof module !== 'undefined') module.exports = root.ODES_DATA;
})(typeof window !== 'undefined' ? window : globalThis);
