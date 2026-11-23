-- ISCTE Schedule Manager: SQLite schema
-- Generated from frontend/js/schema.js (the source of truth). Do not edit by hand.
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
