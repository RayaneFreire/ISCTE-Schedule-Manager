/* Esquema da base de dados (comum aos dois conjuntos de dados) e configuração
   base de governação: perfis, permissões e regras de funcionamento. */
(function (root) {
  'use strict';

  const DDL = `
PRAGMA foreign_keys = ON;
CREATE TABLE curso (
  id INTEGER PRIMARY KEY, sigla TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
  grau TEXT NOT NULL, regime TEXT NOT NULL CHECK (regime IN ('diurno','pos-laboral')));
CREATE TABLE uc (
  id INTEGER PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, sigla TEXT, nome TEXT NOT NULL,
  ects REAL, departamento TEXT);
CREATE TABLE plano_estudos (
  curso_id INTEGER NOT NULL REFERENCES curso(id) ON DELETE CASCADE,
  uc_id INTEGER NOT NULL REFERENCES uc(id) ON DELETE CASCADE,
  ano INTEGER, semestre INTEGER NOT NULL CHECK (semestre IN (1,2)),
  obrigatoria INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (curso_id, uc_id));
CREATE TABLE turma (
  id INTEGER PRIMARY KEY, curso_id INTEGER REFERENCES curso(id) ON DELETE SET NULL,
  ano INTEGER, codigo TEXT UNIQUE NOT NULL, n_alunos INTEGER NOT NULL DEFAULT 0,
  regime TEXT CHECK (regime IN ('diurno','pos-laboral')));
CREATE TABLE docente (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, departamento TEXT, categoria TEXT,
  horas_max INTEGER NOT NULL DEFAULT 540, escola TEXT, perfil_url TEXT);
CREATE TABLE tipo_sala (id TEXT PRIMARY KEY, nome TEXT NOT NULL);
CREATE TABLE edificio (id TEXT PRIMARY KEY, nome TEXT NOT NULL);
CREATE TABLE sala (
  id INTEGER PRIMARY KEY, codigo TEXT UNIQUE NOT NULL,
  edificio_id TEXT NOT NULL REFERENCES edificio(id), piso INTEGER,
  capacidade INTEGER NOT NULL CHECK (capacidade >= 0), capacidade_exame INTEGER,
  tipo_id TEXT NOT NULL REFERENCES tipo_sala(id), equipamento TEXT, ativa INTEGER NOT NULL DEFAULT 1);
CREATE TABLE caracteristica (nome TEXT PRIMARY KEY, descricao TEXT);
CREATE TABLE sala_caracteristica (
  sala_id INTEGER NOT NULL REFERENCES sala(id) ON DELETE CASCADE,
  caracteristica TEXT NOT NULL REFERENCES caracteristica(nome) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (sala_id, caracteristica));
CREATE TABLE tipo_aula (id TEXT PRIMARY KEY, nome TEXT NOT NULL);
CREATE TABLE componente (
  id INTEGER PRIMARY KEY, uc_id INTEGER NOT NULL REFERENCES uc(id) ON DELETE CASCADE,
  tipo_aula_id TEXT NOT NULL REFERENCES tipo_aula(id),
  duracao_min INTEGER NOT NULL, aulas_semana INTEGER NOT NULL DEFAULT 1,
  tipo_sala_id TEXT REFERENCES tipo_sala(id), taxa_presenca REAL NOT NULL DEFAULT 1);
CREATE TABLE turno (
  id INTEGER PRIMARY KEY, componente_id INTEGER NOT NULL REFERENCES componente(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL, docente_id INTEGER REFERENCES docente(id) ON DELETE SET NULL,
  inscritos INTEGER NOT NULL DEFAULT 0,
  caracteristica_pedida TEXT REFERENCES caracteristica(nome) ON UPDATE CASCADE,
  docente_estimado INTEGER NOT NULL DEFAULT 0);
CREATE TABLE docencia (
  uc_id INTEGER NOT NULL REFERENCES uc(id) ON DELETE CASCADE,
  docente_id INTEGER NOT NULL REFERENCES docente(id) ON DELETE CASCADE,
  ano_letivo TEXT NOT NULL, semestre INTEGER NOT NULL, coordenador INTEGER NOT NULL DEFAULT 0,
  cursos TEXT, fonte TEXT, PRIMARY KEY (uc_id, docente_id, ano_letivo, semestre));
CREATE TABLE turno_turma (
  turno_id INTEGER NOT NULL REFERENCES turno(id) ON DELETE CASCADE,
  turma_id INTEGER NOT NULL REFERENCES turma(id) ON DELETE CASCADE,
  PRIMARY KEY (turno_id, turma_id));
CREATE TABLE calendario (
  id INTEGER PRIMARY KEY, ano_letivo TEXT NOT NULL, semestre INTEGER NOT NULL,
  inicio TEXT NOT NULL, semanas INTEGER NOT NULL, notas TEXT);
CREATE TABLE feriado (data TEXT PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'feriado');
CREATE TABLE horario (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, ano_letivo TEXT NOT NULL, semestre INTEGER NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('importado','historico','gerado','manual')),
  criado_em TEXT NOT NULL, notas TEXT,
  estado TEXT NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','em revisao','aprovado','publicado','arquivado')),
  criado_por TEXT, submetido_por TEXT, aprovado_por TEXT, publicado_em TEXT);
CREATE TABLE aula (
  id INTEGER PRIMARY KEY, horario_id INTEGER NOT NULL REFERENCES horario(id) ON DELETE CASCADE,
  turno_id INTEGER NOT NULL REFERENCES turno(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 1, dia INTEGER NOT NULL CHECK (dia BETWEEN 0 AND 5),
  inicio INTEGER NOT NULL, duracao INTEGER NOT NULL,
  sala_id INTEGER REFERENCES sala(id) ON DELETE SET NULL, fixa INTEGER NOT NULL DEFAULT 0,
  semanas INTEGER NOT NULL DEFAULT 16383,
  caracteristica_pedida TEXT REFERENCES caracteristica(nome) ON UPDATE CASCADE,
  reposicao_de INTEGER, evento_id INTEGER);
CREATE TABLE evento (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'evento académico',
  data TEXT NOT NULL, inicio INTEGER, fim INTEGER, descricao TEXT,
  criado_por TEXT, criado_em TEXT NOT NULL);
CREATE TABLE evento_aula (
  evento_id INTEGER NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  horario_id INTEGER NOT NULL REFERENCES horario(id) ON DELETE CASCADE,
  aula_id INTEGER NOT NULL, semana INTEGER NOT NULL, nova_aula_id INTEGER, nova_semana INTEGER,
  estado TEXT NOT NULL CHECK (estado IN ('reagendada','sem solução')), nota TEXT,
  PRIMARY KEY (evento_id, aula_id, semana));
CREATE INDEX idx_aula_turno ON aula (horario_id, turno_id, seq);
CREATE INDEX idx_evento_aula_h ON evento_aula (horario_id);
CREATE TABLE disponibilidade (
  id INTEGER PRIMARY KEY, docente_id INTEGER NOT NULL REFERENCES docente(id) ON DELETE CASCADE,
  dia INTEGER NOT NULL, inicio INTEGER NOT NULL, fim INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('indisponivel','preferido')));
CREATE TABLE reserva (
  id INTEGER PRIMARY KEY, sala_id INTEGER NOT NULL REFERENCES sala(id) ON DELETE CASCADE,
  dia INTEGER NOT NULL, inicio INTEGER NOT NULL, fim INTEGER NOT NULL,
  motivo TEXT NOT NULL, pedido_por TEXT);
CREATE TABLE regra (
  id INTEGER PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, descricao TEXT,
  implementacao TEXT NOT NULL CHECK (implementacao IN ('motor','sql')),
  parametros TEXT NOT NULL DEFAULT '{}', severidade TEXT NOT NULL CHECK (severidade IN ('hard','soft')),
  peso REAL NOT NULL DEFAULT 1, ativa INTEGER NOT NULL DEFAULT 1, sql TEXT,
  origem TEXT, versao INTEGER NOT NULL DEFAULT 1, alterada_em TEXT);
CREATE TABLE fonte (
  id INTEGER PRIMARY KEY, informacao TEXT NOT NULL, tabelas TEXT, fonte TEXT, responsavel TEXT,
  formato TEXT, metodo TEXT, periodicidade TEXT, rgpd TEXT,
  estado TEXT NOT NULL DEFAULT 'por pedir' CHECK (estado IN ('por pedir','pedido','recebido','importado')));

CREATE TABLE parametro (chave TEXT PRIMARY KEY, valor TEXT, descricao TEXT);
CREATE TABLE perfil (id TEXT PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT);
CREATE TABLE permissao (id TEXT PRIMARY KEY, area TEXT NOT NULL, descricao TEXT NOT NULL);
CREATE TABLE perfil_permissao (
  perfil_id TEXT NOT NULL REFERENCES perfil(id) ON DELETE CASCADE,
  permissao_id TEXT NOT NULL REFERENCES permissao(id) ON DELETE CASCADE,
  PRIMARY KEY (perfil_id, permissao_id));
CREATE TABLE utilizador (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
  perfil_id TEXT NOT NULL REFERENCES perfil(id),
  docente_id INTEGER REFERENCES docente(id) ON DELETE SET NULL,
  curso_id INTEGER REFERENCES curso(id) ON DELETE SET NULL,
  turma_id INTEGER REFERENCES turma(id) ON DELETE SET NULL,
  sal TEXT NOT NULL, hash TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1,
  falhas INTEGER NOT NULL DEFAULT 0, bloqueado_ate TEXT, ultimo_login TEXT, mudar_senha INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pedido (
  id INTEGER PRIMARY KEY, criado_em TEXT NOT NULL, autor TEXT NOT NULL, perfil TEXT NOT NULL,
  horario_id INTEGER REFERENCES horario(id) ON DELETE CASCADE, aula_id INTEGER,
  resumo TEXT NOT NULL, motivo TEXT, proposta TEXT,
  estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','aprovado','rejeitado')),
  decidido_por TEXT, decidido_em TEXT, comentario TEXT,
  tipo TEXT NOT NULL DEFAULT 'horario' CHECK (tipo IN ('horario','sala')), aprovacoes TEXT, aplicado TEXT);
CREATE TABLE registo (
  id INTEGER PRIMARY KEY, quando TEXT NOT NULL, ator TEXT NOT NULL, acao TEXT NOT NULL, detalhe TEXT,
  utilizador TEXT);
CREATE TRIGGER registo_so_acrescenta_upd BEFORE UPDATE ON registo BEGIN SELECT RAISE(ABORT, 'O registo de alterações não pode ser alterado'); END;
CREATE TRIGGER registo_so_acrescenta_del BEFORE DELETE ON registo BEGIN SELECT RAISE(ABORT, 'O registo de alterações não pode ser apagado'); END;

CREATE VIEW v_aula AS
SELECT a.id AS aula_id, a.horario_id, a.dia, a.inicio, a.inicio + a.duracao AS fim, a.duracao, a.fixa, a.semanas, a.reposicao_de, a.evento_id,
       t.id AS turno_id, t.codigo AS turno, c.tipo_aula_id AS tipo_aula,
       COALESCE(a.caracteristica_pedida, t.caracteristica_pedida, ts.nome) AS caracteristica_pedida,
       u.id AS uc_id, COALESCE(NULLIF(u.sigla, ''), u.codigo) AS uc, u.codigo AS uc_codigo, u.nome AS uc_nome,
       d.id AS docente_id, d.nome AS docente,
       s.id AS sala_id, s.codigo AS sala, s.tipo_id AS tipo_sala, s.capacidade, s.edificio_id AS edificio,
       t.inscritos, CAST(ROUND(t.inscritos * c.taxa_presenca) AS INTEGER) AS esperados,
       (SELECT COUNT(*) FROM sala_caracteristica sc WHERE sc.sala_id = s.id AND sc.caracteristica = COALESCE(a.caracteristica_pedida, t.caracteristica_pedida, ts.nome)) AS tem_caracteristica
FROM aula a JOIN turno t ON t.id = a.turno_id JOIN componente c ON c.id = t.componente_id
JOIN uc u ON u.id = c.uc_id LEFT JOIN tipo_sala ts ON ts.id = c.tipo_sala_id
LEFT JOIN docente d ON d.id = t.docente_id LEFT JOIN sala s ON s.id = a.sala_id;

CREATE VIEW v_aula_turma AS
SELECT v.*, tm.id AS turma_id, tm.codigo AS turma, cu.sigla AS curso, COALESCE(tm.regime, cu.regime) AS regime
FROM v_aula v JOIN turno_turma tt ON tt.turno_id = v.turno_id
JOIN turma tm ON tm.id = tt.turma_id LEFT JOIN curso cu ON cu.id = tm.curso_id;
`;

  /* ---------- Governação ---------- */
  const perfis = [
    ['admin', 'Administrador', 'Gere contas, perfis e permissões. Vê todos os pedidos e reservas e pode decidir em substituição de um aprovador ausente (com justificação registada). Não edita aulas.'],
    ['gestor', 'Gestor de horários', 'Mantém os dados e as regras, constrói e gera horários, decide pedidos de alteração.'],
    ['curso', 'Direção de curso', 'Revê e aprova os horários antes da publicação, pede alterações e regista eventos do seu curso. Só vê a informação do seu curso.'],
    ['docente', 'Docente', 'Consulta só o seu horário, indica disponibilidade e pede alterações.'],
    ['estudante', 'Estudante', 'Consulta os horários publicados e procura salas livres.'],
    ['espacos', 'Gestão de espaços', 'Mantém o cadastro de salas e as reservas. Não pode ser a mesma pessoa que gere os horários.'],
  ];
  const permissoes = [
    ['dados.ver', 'Dados', 'Consultar tabelas, modelo, dicionário e consola SQL (só leitura)'],
    ['dados.editar', 'Dados', 'Alterar dados, importar CSV e executar SQL de escrita'],
    ['regras.editar', 'Regras', 'Alterar parâmetros, tipo e peso das regras e criar regras SQL'],
    ['horario.ver_rascunhos', 'Horários', 'Ver horários ainda não publicados'],
    ['horario.editar', 'Horários', 'Alterar aulas de horários em rascunho'],
    ['horario.gerar', 'Horários', 'Gerar horários automaticamente'],
    ['horario.submeter', 'Horários', 'Submeter um rascunho para revisão'],
    ['horario.aprovar', 'Horários', 'Aprovar ou devolver um horário em revisão'],
    ['horario.publicar', 'Horários', 'Publicar um horário aprovado (substitui o publicado)'],
    ['pedidos.criar', 'Pedidos', 'Pedir alterações a aulas'],
    ['pedidos.decidir', 'Pedidos', 'Aprovar ou rejeitar pedidos de alteração'],
    ['disponibilidade.propria', 'Docentes', 'Registar a própria disponibilidade'],
    ['salas.editar', 'Espaços', 'Alterar o cadastro e as características das salas'],
    ['reservas.gerir', 'Espaços', 'Criar e apagar reservas de salas'],
    ['utilizadores.gerir', 'Administração', 'Criar contas, mudar perfis, bloquear e repor senhas'],
    ['permissoes.gerir', 'Administração', 'Alterar a matriz de permissões'],
    ['registo.ver', 'Administração', 'Consultar o registo de alterações'],
    ['horarios.consultar', 'Consultas', 'Consultar horários de qualquer turma, professor ou sala'],
    ['salas.pesquisar', 'Espaços', 'Pesquisar salas livres'],
    ['planeamento.ver', 'Horários', 'Ver informação de planeamento: pedidos de sala, características, violações e alertas'],
    ['eventos.gerir', 'Calendário', 'Registar eventos académicos e repor as aulas afetadas'],
  ];
  const matriz = {
    admin: ['dados.ver', 'horario.ver_rascunhos', 'horario.aprovar', 'pedidos.decidir', 'reservas.gerir', 'utilizadores.gerir', 'permissoes.gerir', 'registo.ver', 'horarios.consultar', 'salas.pesquisar', 'planeamento.ver'],
    gestor: ['dados.ver', 'dados.editar', 'regras.editar', 'horario.ver_rascunhos', 'horario.editar', 'horario.gerar', 'horario.submeter', 'horario.publicar', 'pedidos.decidir', 'registo.ver', 'horarios.consultar', 'salas.pesquisar', 'planeamento.ver', 'eventos.gerir'],
    curso: ['horario.ver_rascunhos', 'horario.aprovar', 'pedidos.criar', 'pedidos.decidir', 'horarios.consultar', 'salas.pesquisar', 'planeamento.ver', 'eventos.gerir'],
    docente: ['pedidos.criar', 'disponibilidade.propria', 'salas.pesquisar', 'planeamento.ver'],
    estudante: [],
    espacos: ['salas.editar', 'reservas.gerir', 'pedidos.decidir', 'horario.ver_rascunhos', 'horarios.consultar', 'salas.pesquisar', 'planeamento.ver'],
  };
  const perfilPermissao = [];
  for (const p in matriz) for (const x of matriz[p]) perfilPermissao.push([p, x]);

  /* ---------- Regras (comuns; os parâmetros podem ser ajustados por conjunto de dados) ---------- */
  const P = (o) => JSON.stringify(o);
  function regras(opts) {
    opts = opts || {};
    return [
      ['CONF_SALA', 'Sala com duas aulas ao mesmo tempo', 'Uma sala não pode ter aulas sobrepostas (na mesma semana) nem aulas sobrepostas a reservas.', 'motor', P({}), 'hard', 1, 1, null, 'Funcionamento atual'],
      ['CONF_DOCENTE', 'Docente com aulas sobrepostas', 'Um docente não pode dar duas aulas ao mesmo tempo.', 'motor', P({}), 'hard', 1, 1, null, 'Funcionamento atual'],
      ['CONF_TURMA', 'Turma com aulas sobrepostas', 'Os estudantes de uma turma não podem ter duas aulas ao mesmo tempo.', 'motor', P({}), 'hard', 1, 1, null, 'Funcionamento atual'],
      ['MAX_SEGUIDAS_UC', 'Aulas seguidas da mesma UC acima do limite', 'Não devem existir aulas seguidas da mesma UC, para a mesma turma, com duração total superior ao máximo.', 'motor', P({ max_min: 180, intervalo_max_min: 15 }), 'hard', 1, 1, null, 'Enunciado do projeto'],
      ['CAPACIDADE', 'Sala sem capacidade suficiente', 'A capacidade da sala deve cobrir os estudantes esperados (inscritos × participação esperada).', 'motor', P({ usar_participacao: true, tolerancia_pct: 5 }), 'hard', 1, 1, null, 'Funcionamento atual'],
      ['INDISP_DOCENTE', 'Aula em período indisponível do docente', 'Respeita as indisponibilidades registadas pelos docentes.', 'motor', P({}), 'hard', 1, 1, null, 'Recolha junto dos docentes'],
      ['NAO_AGENDADA', 'Aula sem dia, hora ou sala', 'Todas as aulas previstas devem ter dia e hora, e sala quando precisam de sala.', 'motor', P({}), 'hard', 1, 1, null, 'Funcionamento atual'],
      ['CARACT_ESSENCIAL', 'Sala sem a característica essencial pedida', 'Quando o docente pede um laboratório ou uma sala especializada, a sala tem de a ter.', 'motor', P({ caracteristicas: opts.essenciais || [] }), 'hard', 1.5, 1, null, 'Pedido dos docentes'],
      ['CARACTERISTICA', 'Sala sem a característica pedida', 'Conta as aulas em salas que não têm a característica pedida pelo docente (ou uma equivalente).', 'motor', P({ equivalentes: opts.equivalentes || {}, alternativas: opts.alternativas || {}, custo_equivalente: opts.custoEquivalente != null ? opts.custoEquivalente : 0.3 }), 'soft', 8, 1, null, 'Pedido dos docentes'],
      ['FORA_MANCHA', 'Aula fora da mancha horária padrão', 'Conta as aulas fora da mancha horária do regime do curso.', 'motor', P({ diurno: { dias: [0, 1, 2, 3, 4], inicio: 480, fim: 1080 }, 'pos-laboral': { dias: [0, 1, 2, 3, 4, 5], inicio: 1080, fim: 1410 } }), 'soft', 10, 1, null, 'Enunciado do projeto'],
      ['DESPERDICIO', 'Sala demasiado grande', 'Penaliza lugares vazios acima do limite (adequação da sala, Martins 2014).', 'motor', P({ limite_lugares: 25 }), 'soft', 2, 1, null, 'Martins (2014)'],
      ['MUDANCA_EDIFICIO', 'Mudança de edifício entre aulas seguidas', 'Evita deslocações entre edifícios em aulas seguidas de turmas e docentes (Martins 2014). Desativada por decisão do grupo: não entra na avaliação nem na otimização.', 'motor', P({ intervalo_max_min: 30, incluir_docentes: true }), 'soft', 3, 0, null, 'Martins (2014)'],
      ['BLOCO_SEPARADO', 'Aulas do mesmo bloco separadas', 'Aulas seguidas da mesma UC para a mesma turma no Horário ISCTE (Manual) (por exemplo T e logo a seguir TP) formam um bloco: têm de ficar no mesmo dia, seguidas, como no Manual. Os algoritmos movem o bloco inteiro.', 'motor', P({ intervalo_max_min: 30 }), 'hard', 1, 1, null, 'Pedido do grupo'],
      ['MESMA_SALA_UC', 'Aulas seguidas da mesma UC em salas diferentes', 'Quando uma turma tem aulas seguidas da mesma UC no mesmo dia (por exemplo T e logo a seguir TP), devem ficar na mesma sala. Regra de qualidade com peso alto.', 'motor', P({ intervalo_max_min: 30 }), 'soft', 10, 1, null, 'Pedido do grupo'],
      ['FUROS_TURMA', 'Furos no horário da turma', 'Penaliza intervalos sem aulas entre aulas do mesmo dia.', 'motor', P({ minimo_min: 60 }), 'soft', 3, 1, null, 'Qualidade'],
      ['MESMO_DIA_TURNO', 'Duas aulas do mesmo turno no mesmo dia', 'As aulas de um turno com mais de uma aula por semana devem ficar em dias diferentes (aulas seguidas contam como um bloco).', 'motor', P({}), 'soft', 4, 1, null, 'Qualidade'],
      ['MAX_DIA_TURMA', 'Demasiadas horas num dia', 'Limita as horas de aulas de uma turma num só dia (na semana mais carregada).', 'motor', P({ max_min: 360 }), 'soft', 3, 1, null, 'Qualidade'],
      ['FERIADOS', 'Aulas perdidas por feriados', 'Conta as aulas que calham em feriados do calendário do ano letivo.', 'motor', P({}), 'soft', 1, 1, null, 'Calendário'],
      ['PREF_DOCENTE', 'Aula fora das preferências do docente', 'Quando um docente indica períodos preferidos, penaliza aulas fora deles.', 'motor', P({}), 'soft', 2, 1, null, 'Recolha junto dos docentes'],
      ['CARGA_DOCENTE', 'Carga semanal acima do máximo', 'Horas letivas semanais do docente acima do máximo da categoria.', 'motor', P({}), 'soft', 1, 1, null, 'Distribuição de serviço'],
      ['ALTERACOES', 'Alterações face ao horário de partida', 'Só no gerador: penaliza aulas mudadas de dia/hora (1) ou de sala (0,3) face ao horário base.', 'motor', P({ custo_sala: 0.3 }), 'soft', 2, 0, null, 'Estabilidade'],
      ['SQL_SABADO', 'Aulas ao sábado (regra SQL)', 'Exemplo de regra nova escrita em SQL, sem alterar o código da aplicação.', 'sql', P({}), 'soft', 1, 1,
        "SELECT aula_id, 'Aula de ' || uc || ' ao sábado' AS mensagem\nFROM v_aula WHERE horario_id = :horario AND dia = 5", 'Exemplo de evolução'],
      ['SQL_DOC_4_DIA', 'Docente com mais de 3 aulas num dia (regra SQL)', 'Exemplo de regra nova: limita a 3 o número de aulas de um docente por dia.', 'sql', P({}), 'soft', 1, 1,
        "WITH RECURSIVE w(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM w WHERE n < (SELECT semanas FROM calendario ORDER BY id LIMIT 1)),\nx AS (SELECT v.docente_id, v.docente, v.dia, w.n AS semana, v.aula_id, v.inicio, v.uc, v.turno\n  FROM v_aula v JOIN w ON (v.semanas >> (w.n - 1)) & 1 WHERE v.horario_id = :horario AND v.docente_id IS NOT NULL ORDER BY v.inicio),\ng AS (SELECT docente_id, docente, dia, semana, COUNT(*) AS n, MIN(aula_id) AS aula_id, group_concat(aula_id) AS aulas,\n  group_concat(printf('%02d:%02d', inicio / 60, inicio % 60) || ' ' || turno, ', ') AS lista\n  FROM x GROUP BY docente_id, dia, semana HAVING COUNT(*) > 3)\nSELECT MIN(g.aula_id) AS aula_id, g.aulas,\n  g.docente || ' tem ' || g.n || ' aulas ' || CASE g.dia WHEN 0 THEN 'na segunda-feira' WHEN 1 THEN 'na terça-feira' WHEN 2 THEN 'na quarta-feira' WHEN 3 THEN 'na quinta-feira' WHEN 4 THEN 'na sexta-feira' ELSE 'no sábado' END || ' ' ||\n  CASE WHEN COUNT(*) > 3 THEN 'de ' || strftime('%d/%m', date(c.inicio, '+' || ((MIN(g.semana) - 1) * 7 + g.dia) || ' days')) || ' a ' || strftime('%d/%m', date(c.inicio, '+' || ((MAX(g.semana) - 1) * 7 + g.dia) || ' days')) || ' (' || COUNT(*) || ' semanas)'\n    ELSE group_concat(strftime('%d/%m', date(c.inicio, '+' || ((g.semana - 1) * 7 + g.dia) || ' days')), ', ') END || ': ' || g.lista AS mensagem\nFROM g, (SELECT inicio FROM calendario ORDER BY id LIMIT 1) c\nGROUP BY g.docente_id, g.dia, g.aulas", 'Exemplo de evolução'],
    ];
  }

  const PBKDF2_ITER = 100000;
  // username, nome, perfil, sal, hash (PBKDF2-SHA256), senha de demonstração mostrada no ecrã de entrada
  const contasDemo = [
    ["admin", "Administração de sistemas (demo)", "admin", '2fd1cf2ec27551302ce80ab3f60cb10c', '10c9e9a21d47e927856b4731386d7883f806fe66b42c81f2ef641e652e26d3b0', "admin2026!"],
    ["gestor", "Gabinete de horários (demo)", "gestor", '7a1cae8e28a19827decd55fb65c0c349', '3dd3541b72489fa9c479ee5d437021aa26272764b496f277745a631f833b176e', "gestor2026!"],
    ["curso", "Direção de curso (demo)", "curso", '91cbd3df665b9a8dfaf97652fefe8e3f', 'd58c67b32a63bf09a24c2264f9d2838b8484dd9a44b7378633db187d3b54148f', "curso2026!"],
    ["docente", "Docente (demo)", "docente", '40dfa96cea677d47c60fea4abc5024ea', '0d084917b30f1abd986171e4a6e8a01f500025f2ec0a34799c35ecfb1623f079', "docente2026!"],
    ["estudante", "Estudante (demo)", "estudante", '24d253abd90d9f8dac8c216fc3eaf374', '201eef434e3d81f90aaca3c591510973ecd47756399035d71d8a56462e683080', "estudante2026!"],
    ["espacos", "Gestão de espaços (demo)", "espacos", '1e55adf39da1d35d85ff86e03f3a68a5', 'f61ac267f3b7af622dd5f75ecec223f91552224824df3d651503b6851d4e3941', "espacos2026!"],
  ];

  /* Segregação de funções: grupos de permissões que nunca podem estar no mesmo perfil
     nem com a mesma pessoa (contas com o mesmo nome). */
  const incompatibilidades = [
    { nome: 'Gestão de horários × gestão de espaços', a: ['horario.editar', 'horario.gerar', 'horario.publicar'], b: ['salas.editar', 'reservas.gerir'],
      motivo: 'Quem constrói o horário não pode também gerir as salas e as reservas: as duas funções controlam-se mutuamente.' },
    { nome: 'Submeter × aprovar horários', a: ['horario.submeter'], b: ['horario.aprovar'], motivo: 'Quem propõe um horário não o pode aprovar.' },
    { nome: 'Administração × alteração de horários', a: ['utilizadores.gerir', 'permissoes.gerir'], b: ['horario.editar', 'horario.publicar'], motivo: 'Quem gere contas e permissões não altera nem publica horários.' },
  ];

  const api = { DDL, perfis, permissoes, perfilPermissao, regras, contasDemo, PBKDF2_ITER, incompatibilidades };
  if (typeof module !== 'undefined') module.exports = api;
  root.ODES_SCHEMA = api;
})(typeof window !== 'undefined' ? window : globalThis);
