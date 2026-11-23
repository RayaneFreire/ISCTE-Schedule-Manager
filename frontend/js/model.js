/* Camada de dados: base de dados SQLite (sql.js) e tradução do modelo
   relacional para o problema que o motor de regras/gerador usa. */
(function (root) {
  'use strict';
  const SCHEMA = root.ODES_SCHEMA || (typeof require !== 'undefined' ? require('./schema.js') : null);
  const SEM_SALA = 'Não necessita de sala';

  function wrap(db) {
    const api = {
      raw: db,
      q(sql, params) {
        const st = db.prepare(sql);
        try {
          if (params) st.bind(params);
          const rows = [];
          while (st.step()) rows.push(st.getAsObject());
          return rows;
        } finally { st.free(); }
      },
      one(sql, params) { return api.q(sql, params)[0] || null; },
      run(sql, params) { db.run(sql, params || []); return db.getRowsModified(); },
      lastId() { return db.exec('SELECT last_insert_rowid()')[0].values[0][0]; },
      exec(sql) { return db.exec(sql); },
      tx(fn) {
        db.run('BEGIN');
        try { const r = fn(); db.run('COMMIT'); return r; } catch (e) { db.run('ROLLBACK'); throw e; }
      },
    };
    return api;
  }

  function insertMany(D, table, cols, rows) {
    if (!rows || !rows.length) return;
    const st = D.raw.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    for (const r of rows) st.run(r.map((x) => (x === undefined ? null : x)));
    st.free();
  }

  const ORDEM = ['curso', 'uc', 'plano_estudos', 'turma', 'docente', 'tipo_sala', 'edificio', 'caracteristica', 'sala', 'sala_caracteristica',
    'tipo_aula', 'componente', 'turno', 'turno_turma', 'docencia', 'calendario', 'feriado', 'disponibilidade', 'reserva', 'evento'];

  /* Cria o esquema e carrega um conjunto de dados.
     ds = { tables: {tabela: {cols, rows}}, regras, fontes, parametros, horarios: [{..., aulaCols, aulas}], contas: {perfil: {docente_id, ...}} } */
  function seed(D, ds) {
    D.raw.exec(SCHEMA.DDL);
    D.tx(() => {
      insertMany(D, 'perfil', ['id', 'nome', 'descricao'], SCHEMA.perfis);
      insertMany(D, 'permissao', ['id', 'area', 'descricao'], SCHEMA.permissoes);
      insertMany(D, 'perfil_permissao', ['perfil_id', 'permissao_id'], SCHEMA.perfilPermissao);
      for (const t of ORDEM) if (ds.tables[t]) insertMany(D, t, ds.tables[t].cols, ds.tables[t].rows);
      const now = ds.criadoEm || '2026-09-01T09:00:00';
      insertMany(D, 'regra', ['codigo', 'nome', 'descricao', 'implementacao', 'parametros', 'severidade', 'peso', 'ativa', 'sql', 'origem', 'alterada_em'],
        ds.regras.map((r) => [...r, now]));
      insertMany(D, 'fonte', ['informacao', 'tabelas', 'fonte', 'responsavel', 'formato', 'metodo', 'periodicidade', 'rgpd', 'estado'], ds.fontes || []);
      insertMany(D, 'parametro', ['chave', 'valor', 'descricao'], ds.parametros || []);
      for (const h of ds.horarios || []) {
        D.run(`INSERT INTO horario (id, nome, ano_letivo, semestre, origem, criado_em, notas, estado, criado_por, submetido_por, aprovado_por, publicado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [h.id, h.nome, h.ano_letivo, h.semestre, h.origem, h.criado_em, h.notas, h.estado || 'rascunho',
          h.criado_por || null, h.submetido_por || null, h.aprovado_por || null, h.publicado_em || null]);
        insertMany(D, 'aula', ['horario_id', ...h.aulaCols], h.aulas.map((a) => [h.id, ...a]));
      }
      if (ds.tables.evento_aula) insertMany(D, 'evento_aula', ds.tables.evento_aula.cols, ds.tables.evento_aula.rows);
      const contas = ds.contas || {};
      for (const [u, nome, perfil, sal, hash] of SCHEMA.contasDemo) {
        const l = contas[perfil] || {};
        D.run('INSERT INTO utilizador (username, nome, perfil_id, docente_id, curso_id, turma_id, sal, hash) VALUES (?,?,?,?,?,?,?,?)',
          [u, nome, perfil, l.docente_id || null, l.curso_id || null, l.turma_id || null, sal, hash]);
      }
      for (const r of ds.registo || []) D.run('INSERT INTO registo (quando, ator, acao, detalhe, utilizador) VALUES (?,?,?,?,?)', r);
    });
  }

  function param(D, chave, def) {
    try { const r = D.one('SELECT valor FROM parametro WHERE chave = ?', [chave]); return r ? r.valor : def; } catch (e) { return def; }
  }

  function rulesFromDb(D) {
    const rules = {};
    for (const r of D.q("SELECT * FROM regra WHERE implementacao = 'motor'")) {
      let params = {};
      try { params = JSON.parse(r.parametros || '{}'); } catch (e) { params = {}; }
      rules[r.codigo] = { ativa: !!r.ativa, sev: r.severidade, peso: r.peso, params, nome: r.nome };
    }
    return rules;
  }

  /* Calendário do semestre: n.º de semanas, datas e feriados por dia da semana (máscaras). */
  const DAY = 86400000;
  const fromIso = (s) => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  function calendario(D) {
    const c = D.one('SELECT * FROM calendario ORDER BY id LIMIT 1') || { id: null, ano_letivo: '2022/23', semestre: 1, inicio: '2022-09-12', semanas: 14 };
    const n = Math.max(1, Math.min(30, Number(c.semanas) || 14));
    const feriados = D.q('SELECT * FROM feriado ORDER BY data');
    const masks = [0, 0, 0, 0, 0, 0, 0];
    const lista = [];
    for (const f of feriados) {
      const d = Math.floor((fromIso(f.data) - fromIso(c.inicio)) / DAY);
      const w = Math.floor(d / 7) + 1, dia = ((d % 7) + 7) % 7;
      if (w >= 1 && w <= n) { masks[dia] |= 1 << (w - 1); lista.push({ ...f, semana: w, dia }); }
    }
    // Eventos académicos de dia inteiro (ex.: Festa do Caloiro) também suspendem as aulas desse dia.
    let eventos = [];
    try { eventos = D.q("SELECT data, nome, 'evento' AS tipo FROM evento WHERE inicio IS NULL ORDER BY data"); } catch (e) { eventos = []; }
    for (const f of eventos) {
      const d = Math.floor((fromIso(f.data) - fromIso(c.inicio)) / DAY);
      const w = Math.floor(d / 7) + 1, dia = ((d % 7) + 7) % 7;
      if (w >= 1 && w <= n && dia < 6) { masks[dia] |= 1 << (w - 1); lista.push({ ...f, semana: w, dia, evento: true }); }
    }
    const data = (w, dia) => new Date(fromIso(c.inicio) + ((w - 1) * 7 + (dia || 0)) * DAY);
    return { ...c, semanas: n, full: (1 << n) - 1, feriados: masks, feriadosLista: lista, todos: feriados, data };
  }

  /* Monta o problema para o motor.
     opts.horarioId: horário com as posições atuais (ou null para vazio)
     opts.incluirEmFalta: acrescenta as aulas previstas (componente.aulas_semana) que faltam
     opts.rules: sobrepõe as regras guardadas (para o gerador)
     opts.escopo: {cursoId} limita o que o gerador pode mover às aulas de um curso */
  function buildProblem(D, opts) {
    opts = opts || {};
    const cal = calendario(D);
    const carPorSala = new Map();
    for (const r of D.q('SELECT sala_id, caracteristica FROM sala_caracteristica')) {
      if (!carPorSala.has(r.sala_id)) carPorSala.set(r.sala_id, []);
      carPorSala.get(r.sala_id).push(r.caracteristica);
    }
    const salas = D.q('SELECT id, codigo, edificio_id AS edificio, capacidade AS cap, tipo_id AS tipo FROM sala WHERE ativa = 1 ORDER BY id')
      .map((s) => ({ ...s, car: carPorSala.get(s.id) || [] }));
    const salaIdx = new Map(salas.map((s, i) => [s.id, i]));
    const turmasRows = D.q("SELECT t.id, t.codigo, t.curso_id, COALESCE(t.regime, c.regime, 'diurno') AS regime FROM turma t LEFT JOIN curso c ON c.id = t.curso_id ORDER BY t.id");
    const turmaIdx = new Map(turmasRows.map((t, i) => [t.id, i]));
    const docRows = D.q('SELECT id, nome, horas_max AS horasMax FROM docente ORDER BY id');
    const docIdx = new Map(docRows.map((d, i) => [d.id, i]));
    const docentes = docRows.map((d) => ({ ...d, indisp: [], pref: [] }));
    for (const x of D.q('SELECT * FROM disponibilidade')) {
      const k = docIdx.get(x.docente_id);
      if (k == null) continue;
      (x.tipo === 'indisponivel' ? docentes[k].indisp : docentes[k].pref).push({ dia: x.dia, ini: x.inicio, fim: x.fim });
    }
    const turnoRows = D.q(`SELECT t.id, t.codigo, t.docente_id, t.inscritos, t.caracteristica_pedida AS car, c.id AS comp_id, c.tipo_aula_id AS tipo, c.duracao_min AS dur,
        c.aulas_semana AS n, ts.nome AS tipo_sala_nome, c.taxa_presenca AS taxa, u.id AS uc_id, COALESCE(NULLIF(u.sigla, ''), u.codigo) AS uc_cod
      FROM turno t JOIN componente c ON c.id = t.componente_id JOIN uc u ON u.id = c.uc_id LEFT JOIN tipo_sala ts ON ts.id = c.tipo_sala_id ORDER BY t.id`);
    const turnoIdx = new Map(turnoRows.map((t, i) => [t.id, i]));
    const tt = new Map();
    for (const r of D.q('SELECT turno_id, turma_id FROM turno_turma')) {
      if (!tt.has(r.turno_id)) tt.set(r.turno_id, []);
      if (turmaIdx.has(r.turma_id)) tt.get(r.turno_id).push(turmaIdx.get(r.turma_id));
    }
    const escopo = opts.escopo && opts.escopo.cursoId != null ? Number(opts.escopo.cursoId) : null;
    const mk = (t, seq, row) => {
      const turmas = tt.get(t.id) || [];
      const regimes = [...new Set(turmas.map((k) => turmasRows[k].regime))];
      const req = (row && row.caracteristica_pedida) || t.car || t.tipo_sala_nome || null;
      const fora = escopo != null && !turmas.some((k) => turmasRows[k].curso_id === escopo);
      return {
        id: row ? row.id : null, key: `${t.id}:${seq}`, turnoId: t.id, seq,
        turno: turnoIdx.get(t.id), uc: t.uc_id, ucCod: t.uc_cod, tipoAula: t.tipo,
        docente: t.docente_id != null && docIdx.has(t.docente_id) ? docIdx.get(t.docente_id) : -1,
        turmas, regimes, dur: row ? row.duracao : t.dur, req, noRoom: req === SEM_SALA,
        sem: row && row.semanas != null ? (row.semanas & cal.full) : cal.full,
        inscritos: t.inscritos, esperado: Math.round(t.inscritos * (t.taxa == null ? 1 : t.taxa)),
        fixa: (row ? !!row.fixa : false) || fora, foraEscopo: fora,
        dia: row ? row.dia : null, ini: row ? row.inicio : null,
        sala: row && row.sala_id != null && salaIdx.has(row.sala_id) ? salaIdx.get(row.sala_id) : (row ? -1 : null),
        ref: null, label: `${t.uc_cod} ${t.codigo}`, repos: !!(row && row.reposicao_de != null), bloco: -1,
      };
    };
    const aulas = [];
    const have = new Set();
    const pontuais = [];
    if (opts.horarioId != null) {
      for (const row of D.q('SELECT * FROM aula WHERE horario_id = ? ORDER BY id', [opts.horarioId])) {
        const t = turnoRows[turnoIdx.get(row.turno_id)];
        if (!t) continue;
        // Sessões pontuais (seminários mais longos do que o maior bloco da grelha) não são aulas: ficam como estão.
        if (sessaoPontual(row.duracao)) {
          have.add(`${t.id}:${row.seq}`);
          // Continuam a ocupar a sala nas suas semanas.
          if (row.sala_id != null && salaIdx.has(row.sala_id) && row.dia != null) pontuais.push({ sala: salaIdx.get(row.sala_id), dia: row.dia, ini: row.inicio, fim: row.inicio + row.duracao, sem: row.semanas == null ? null : row.semanas & cal.full, motivo: `sessão pontual ${t.uc_cod} ${t.codigo}` });
          continue;
        }
        const a = mk(t, row.seq, row);
        have.add(a.key);
        aulas.push(a);
      }
    }
    const emFalta = opts.incluirEmFalta && param(D, 'aulas_em_falta', '1') !== '0';
    if (emFalta) {
      for (const t of turnoRows) for (let s = 1; s <= t.n; s++) {
        if (!have.has(`${t.id}:${s}`) && !sessaoPontual(t.dur)) aulas.push(mk(t, s, null));
      }
    }
    const bloqueios = D.q('SELECT * FROM reserva').filter((b) => salaIdx.has(b.sala_id))
      .map((b) => ({ sala: salaIdx.get(b.sala_id), dia: b.dia, ini: b.inicio, fim: b.fim, motivo: b.motivo })).concat(pontuais);
    const P = {
      aulas, salas, turmas: turmasRows, docentes, turnos: turnoRows.map((t) => ({ id: t.id, codigo: t.codigo })),
      bloqueios, rules: opts.rules || rulesFromDb(D), nSemanas: cal.semanas, feriados: cal.feriados,
    };
    if (opts.blocos !== false) atribuirBlocos(D, P);
    return P;
  }

  /* Blocos: aulas seguidas da mesma UC para a mesma turma no Horário ISCTE (Manual) (mesmo dia, intervalo até
     30 min, semanas em comum), por exemplo T e logo a seguir TP. Ficam sempre juntas: os algoritmos movem o bloco
     inteiro, mantendo as distâncias do Manual (aulas em paralelo continuam em paralelo), e a regra BLOCO_SEPARADO
     assinala blocos separados. P.blocos = [{m: [índices], off: [minutos desde o início do bloco], span}]. */
  const BLOCO_GAP = 30;
  function atribuirBlocos(D, P) {
    P.blocos = [];
    for (const a of P.aulas) a.bloco = -1;
    const ref = D.one("SELECT id FROM horario WHERE origem = 'importado' ORDER BY id LIMIT 1");
    if (!ref) return;
    const rows = D.q('SELECT a.id, a.turno_id, a.seq, a.dia, a.inicio, a.duracao, a.semanas, t.componente_id FROM aula a JOIN turno t ON t.id = a.turno_id WHERE a.horario_id = ? AND a.reposicao_de IS NULL AND a.dia IS NOT NULL AND a.inicio IS NOT NULL AND a.duracao <= ?', [ref.id, SESSAO_PONTUAL_MIN]);
    const ucDe = new Map(D.q('SELECT id, uc_id FROM componente').map((c) => [c.id, c.uc_id]));
    // Chaves turno:seq únicas no Manual e no problema.
    const conta = (l, k) => l.reduce((m, x) => m.set(k(x), (m.get(k(x)) || 0) + 1), new Map());
    const nRef = conta(rows, (r) => `${r.turno_id}:${r.seq}`);
    const nP = conta(P.aulas.filter((a) => !a.repos), (a) => a.key);
    const idxDe = new Map();
    P.aulas.forEach((a, i) => { if (!a.repos && nP.get(a.key) === 1) idxDe.set(a.key, i); });
    const ok = rows.filter((r) => nRef.get(`${r.turno_id}:${r.seq}`) === 1 && idxDe.has(`${r.turno_id}:${r.seq}`));
    const turmasDe = new Map();
    for (const x of D.q('SELECT turno_id, turma_id FROM turno_turma')) { if (!turmasDe.has(x.turno_id)) turmasDe.set(x.turno_id, []); turmasDe.get(x.turno_id).push(x.turma_id); }
    const grupos = new Map();
    for (const r of ok) for (const t of turmasDe.get(r.turno_id) || []) {
      const k = `${t}|${ucDe.get(r.componente_id)}|${r.dia}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(r);
    }
    const pai = new Map(ok.map((r) => [r.id, r.id]));
    const raiz = (x) => { while (pai.get(x) !== x) { pai.set(x, pai.get(pai.get(x))); x = pai.get(x); } return x; };
    for (const l of grupos.values()) {
      // Seguidas (intervalo até 30 min) ou à mesma hora, em quaisquer semanas: o Manual às vezes parte o mesmo
      // horário semanal (por exemplo terça 18:00–21:00) em vários registos com semanas diferentes.
      for (const x of l) for (const y of l) {
        if (x === y || y.inicio < x.inicio) continue;
        if (y.inicio - (x.inicio + x.duracao) <= BLOCO_GAP) pai.set(raiz(x.id), raiz(y.id));
      }
    }
    const comp = new Map();
    for (const r of ok) { const k = raiz(r.id); if (!comp.has(k)) comp.set(k, []); comp.get(k).push(r); }
    // Nenhum bloco passa o máximo de aulas seguidas da mesma UC (MAX_SEGUIDAS_UC, 3 h): um grupo maior no Manual
    // (por exemplo T + TP02 + TP03 em paralelo) é partido, por ordem de início, em blocos até esse máximo.
    const regraMax = D.one("SELECT parametros FROM regra WHERE codigo = 'MAX_SEGUIDAS_UC'");
    let maxMin = 180;
    try { maxMin = (JSON.parse(regraMax && regraMax.parametros) || {}).max_min || 180; } catch (e) { /* omissão */ }
    const juntar = (l) => {
      if (l.length < 2) return;
      const ini = l[0].inicio, span = Math.max(...l.map((r) => r.inicio + r.duracao)) - ini;
      const m = l.map((r) => idxDe.get(`${r.turno_id}:${r.seq}`));
      // Blocos com aulas fixas e livres (instância de um curso) não se formam.
      if (new Set(m.map((i) => !!P.aulas[i].fixa)).size > 1) return;
      const b = P.blocos.length;
      P.blocos.push({ m, off: l.map((r) => r.inicio - ini), span });
      for (const i of m) P.aulas[i].bloco = b;
    };
    for (const l of comp.values()) {
      if (l.length < 2) continue;
      l.sort((x, y) => x.inicio - y.inicio || x.id - y.id);
      // O máximo conta-se semana a semana (só as aulas que acontecem nessa semana).
      const NW = 30;
      let atual = [], soma = new Array(NW).fill(0);
      const bits = (r) => { const m = r.semanas == null ? -1 : r.semanas; const o = []; for (let w = 0; w < NW; w++) if (m & (1 << w)) o.push(w); return o; };
      for (const r of l) {
        const bs = bits(r);
        // Também não pode passar um período da grelha (4h30), senão não cabe em lado nenhum.
        const longo = atual.length && Math.max(r.inicio + r.duracao, ...atual.map((x) => x.inicio + x.duracao)) - atual[0].inicio > SESSAO_PONTUAL_MIN;
        if (atual.length && (longo || bs.some((w) => soma[w] + r.duracao > maxMin))) { juntar(atual); atual = []; soma = new Array(NW).fill(0); }
        atual.push(r); for (const w of bs) soma[w] += r.duracao;
      }
      juntar(atual);
    }
  }

  /* Sessões pontuais: seminários com mais de 4h30 (o maior bloco da grelha), por exemplo 5 h ao sábado em 1 a 3 semanas.
     Não contam como aulas: não são validadas nem mudadas pelos algoritmos e mantêm o dia, a hora e a sala do horário. */
  const SESSAO_PONTUAL_MIN = 270;
  function sessaoPontual(dur) { return dur > SESSAO_PONTUAL_MIN; }

  /* Instância de um curso (por exemplo I1 = LETI): as aulas com turmas do curso ficam livres; as aulas de outros
     cursos que partilham turmas com elas ficam fixas (contam para sobreposições de turma); as restantes aulas do
     horário só ocupam salas, como reservas com as respetivas semanas. full[i] é o índice da aula no horário completo. */
  function instanciaCurso(D, hid, cursoId, opts) {
    const P = buildProblem(D, Object.assign({ horarioId: hid }, opts || {}));
    cursoId = Number(cursoId);
    const doCurso = (a) => a.turmas.some((k) => P.turmas[k].curso_id === cursoId);
    const turmasIn = new Set();
    P.aulas.forEach((a) => { if (doCurso(a)) for (const k of a.turmas) turmasIn.add(k); });
    const aulas = [], full = [];
    const bloqueios = P.bloqueios.slice();
    P.aulas.forEach((a, i) => {
      if (doCurso(a)) { aulas.push(Object.assign({}, a, { foraEscopo: false })); full.push(i); }
      else if (a.turmas.some((k) => turmasIn.has(k))) { aulas.push(Object.assign({}, a, { fixa: true, foraEscopo: true })); full.push(i); }
      else if (a.sala != null && a.sala >= 0 && a.dia != null && a.dia >= 0) {
        bloqueios.push({ sala: a.sala, dia: a.dia, ini: a.ini, fim: a.ini + a.dur, sem: a.sem, motivo: `aula de outro curso (${a.label})` });
      }
    });
    const Q = Object.assign({}, P, { aulas, bloqueios, full, cursoId });
    atribuirBlocos(D, Q);
    return Q;
  }

  /* Importa os docentes recolhidos do ciencia.iscte-iul.pt (tools/docentes-ciencia.js).
     dados: {ano, semestre, fonte, docentes: [{nome, url, categoria, departamento, escola, ucs: [{codigo, nome, coordenador, cursos}]}]}
     Só usa as UCs que já existem na base de dados (as do CSV do professor): nunca cria UCs.
     Uma UC com um só docente: todos os turnos ficam com esse docente. Com vários: os turnos são distribuídos
     pelos docentes da UC sem sobreposições no horário de referência, e ficam marcados como estimativa
     (turno.docente_estimado = 1), porque o site não diz que turno cada docente dá. */
  function importarDocentes(D, dados, opts) {
    opts = opts || {};
    const ano = dados.ano || '2022/2023', semestre = Number(dados.semestre || 1);
    const ucPorCod = new Map(D.q('SELECT id, codigo FROM uc').map((u) => [String(u.codigo).toUpperCase(), u.id]));
    const rel = { docentes: 0, docentesComUcs: 0, ucsComDocente: 0, ucsDoSiteSemCorrespondencia: 0, turnosAtribuidos: 0, turnosEstimados: 0, turnosComSobreposicao: 0 };
    return D.tx(() => {
      if (opts.substituir !== false) {
        D.run('UPDATE turno SET docente_id = NULL, docente_estimado = 0');
        D.run('DELETE FROM docencia');
        D.run('DELETE FROM disponibilidade');
        D.run('DELETE FROM docente');
      }
      const semCorr = new Set();
      for (const d of dados.docentes || []) {
        const ucs = (d.ucs || []).filter((u) => ucPorCod.has(String(u.codigo).toUpperCase()));
        for (const u of d.ucs || []) if (!ucPorCod.has(String(u.codigo).toUpperCase())) semCorr.add(String(u.codigo).toUpperCase());
        if (!ucs.length && opts.soComUcs !== false) continue;
        D.run('INSERT INTO docente (nome, departamento, categoria, horas_max, escola, perfil_url) VALUES (?, ?, ?, ?, ?, ?)',
          [d.nome, d.departamento || null, d.categoria || null, d.horasMax || 540, d.escola || null, d.url || null]);
        const id = D.lastId();
        rel.docentes++;
        if (ucs.length) rel.docentesComUcs++;
        for (const u of ucs) {
          D.run('INSERT OR IGNORE INTO docencia (uc_id, docente_id, ano_letivo, semestre, coordenador, cursos, fonte) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [ucPorCod.get(String(u.codigo).toUpperCase()), id, ano, semestre, u.coordenador ? 1 : 0, u.cursos || null, d.url || dados.fonte || null]);
        }
      }
      rel.ucsDoSiteSemCorrespondencia = semCorr.size;
      // Distribuição dos turnos, com base no horário de referência (o importado).
      const h = opts.horarioId || (D.one("SELECT id FROM horario WHERE origem = 'importado' ORDER BY id LIMIT 1") || {}).id;
      const aulasTurno = new Map();
      for (const a of D.q('SELECT turno_id, dia, inicio, duracao, semanas FROM aula WHERE horario_id = ?', [h])) {
        if (!aulasTurno.has(a.turno_id)) aulasTurno.set(a.turno_id, []);
        aulasTurno.get(a.turno_id).push(a);
      }
      const ocupado = new Map();
      const choca = (doc, t) => (ocupado.get(doc) || []).some((x) => (aulasTurno.get(t) || []).some((a) => a.dia === x.dia && (a.semanas & x.semanas) && Math.min(a.inicio + a.duracao, x.inicio + x.duracao) > Math.max(a.inicio, x.inicio)));
      const carga = new Map();
      const porUc = new Map();
      for (const r of D.q('SELECT uc_id, docente_id, coordenador FROM docencia WHERE ano_letivo = ? AND semestre = ?', [ano, semestre])) {
        if (!porUc.has(r.uc_id)) porUc.set(r.uc_id, []);
        porUc.get(r.uc_id).push(r);
      }
      rel.ucsComDocente = porUc.size;
      // Primeiro as UCs com um só docente (atribuição exata, sem escolha); depois as estimadas, que assim
      // já veem todas as aulas fixas de cada docente e evitam sobreposições com elas.
      const ordemUcs = [...porUc].sort((a, b) => (a[1].length > 1) - (b[1].length > 1));
      for (const [uc, docs] of ordemUcs) {
        const turnos = D.q(`SELECT t.id, c.tipo_aula_id AS tipo FROM turno t JOIN componente c ON c.id = t.componente_id WHERE c.uc_id = ?
          ORDER BY CASE c.tipo_aula_id WHEN 'T' THEN 0 ELSE 1 END, t.codigo`, [uc]);
        for (const t of turnos) {
          let escolhido;
          if (docs.length === 1) escolhido = docs[0].docente_id;
          else {
            const cand = docs.slice().sort((a, b) => (t.tipo === 'T' ? b.coordenador - a.coordenador : 0) || (carga.get(a.docente_id) || 0) - (carga.get(b.docente_id) || 0));
            const livre = cand.find((c) => !choca(c.docente_id, t.id));
            // Se todos os docentes da UC têm aulas a essa hora, o turno fica sem docente: uma estimativa
            // não deve criar sobreposições. Fica contado para ser atribuído à mão.
            if (!livre) { rel.turnosComSobreposicao++; continue; }
            escolhido = livre.docente_id;
            rel.turnosEstimados++;
          }
          D.run('UPDATE turno SET docente_id = ?, docente_estimado = ? WHERE id = ?', [escolhido, docs.length > 1 ? 1 : 0, t.id]);
          rel.turnosAtribuidos++;
          const l = aulasTurno.get(t.id) || [];
          if (!ocupado.has(escolhido)) ocupado.set(escolhido, []);
          ocupado.get(escolhido).push(...l);
          carga.set(escolhido, (carga.get(escolhido) || 0) + l.reduce((s, a) => s + a.duracao, 0));
        }
      }
      return rel;
    });
  }

  /* Corre as regras SQL ativas para um horário. */
  function sqlViolations(D, horarioId) {
    const out = [];
    // As sessões pontuais não são aulas: avisos que só envolvem sessões pontuais não contam.
    const pontuais = new Set(D.q('SELECT id FROM aula WHERE horario_id = ? AND duracao > ?', [horarioId, SESSAO_PONTUAL_MIN]).map((x) => x.id));
    for (const r of D.q("SELECT * FROM regra WHERE implementacao = 'sql' AND ativa = 1")) {
      try {
        for (const row of D.q(r.sql, { ':horario': horarioId })) {
          if (pontuais.size && row.aula_id != null && pontuais.has(row.aula_id) && row.aulas == null) continue;
          out.push({ codigo: r.codigo, nome: r.nome, sev: r.severidade, aulas: row.aulas != null ? String(row.aulas).split(',').map(Number).filter((x) => x > 0) : row.aula_id != null ? [row.aula_id] : [],
            msg: String(row.mensagem != null ? row.mensagem : r.nome), custo: 1, sql: true });
        }
      } catch (e) {
        out.push({ codigo: r.codigo, nome: r.nome, sev: 'soft', aulas: [], msg: 'Erro na regra SQL: ' + e.message, custo: 0, erro: true, sql: true });
      }
    }
    return out;
  }

  /* Suspende as aulas de um horário numa data (evento ou feriado) e repõe cada uma (engine.repor).
     o: {evId, hid, semana, dia, ini, fim, semanas(row) → semanas candidatas}
     Quando a reposição fica no mesmo dia, hora e sala, a aula é prolongada (ganha a semana nova);
     senão é criada uma aula de reposição ligada à original. */
  const DCURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  function aplicarSuspensao(D, E, o) {
    const c = calendario(D);
    const bit = 1 << (o.semana - 1);
    // o.cursoId (opcional): só as aulas de turnos com turmas desse curso (eventos registados pela direção de curso).
    const afetadas = D.q(`SELECT * FROM aula WHERE horario_id = ? AND dia = ? AND (semanas & ?) <> 0 AND (? IS NULL OR (inicio < ? AND inicio + duracao > ?))
      AND (? IS NULL OR turno_id IN (SELECT tt.turno_id FROM turno_turma tt JOIN turma tm ON tm.id = tt.turma_id WHERE tm.curso_id = ?)) ORDER BY inicio`,
      [o.hid, o.dia, bit, o.ini == null ? null : o.ini, o.fim, o.ini, o.cursoId || null, o.cursoId || null]);
    if (!afetadas.length) return { n: 0, ok: 0, prolongadas: 0 };
    return D.tx(() => {
      for (const a of afetadas) D.run('UPDATE aula SET semanas = semanas & ? WHERE id = ?', [~bit & c.full, a.id]);
      const P = buildProblem(D, { horarioId: o.hid });
      const pos = new Map(P.aulas.map((a, i) => [a.id, i]));
      const pedidos = [];
      afetadas.forEach((row, k) => {
        const x = P.aulas[pos.get(row.id)];
        if (!x) return;
        P.aulas.push(Object.assign({}, x, { id: -(k + 1), key: 'rep' + k, sem: 0, dia: null, ini: null, sala: null, fixa: false, ref: null, _rooms: undefined,
          iniOriginal: row.inicio, diaOriginal: row.dia, salaOriginal: x.sala, label: x.label + ' (reposição)', _row: row }));
        pedidos.push({ idx: P.aulas.length - 1, semanas: o.semanas(row, c), evitar: [{ semana: o.semana, dia: o.dia, ini: o.ini == null ? 0 : o.ini, fim: o.fim == null ? 1440 : o.fim }] });
      });
      const dias = P.aulas.some((a) => a.dia === 5) ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
      const res = E.repor(P, pedidos, { dias });
      let ok = 0, prolongadas = 0;
      for (const r of res) {
        const a = P.aulas[r.idx], row = a._row;
        if (r.ok) {
          const salaId = r.sala >= 0 ? P.salas[r.sala].id : null;
          let nid;
          if (r.dia === row.dia && r.ini === row.inicio && (salaId === row.sala_id || (salaId == null && row.sala_id == null))) {
            D.run('UPDATE aula SET semanas = semanas | ? WHERE id = ?', [1 << (r.semana - 1), row.id]);
            nid = row.id; prolongadas++;
          } else {
            const seq = D.one('SELECT COALESCE(MAX(seq), 0) + 1 s FROM aula WHERE horario_id = ? AND turno_id = ?', [o.hid, row.turno_id]).s;
            D.run('INSERT INTO aula (horario_id, turno_id, seq, dia, inicio, duracao, sala_id, fixa, semanas, caracteristica_pedida, reposicao_de, evento_id) VALUES (?,?,?,?,?,?,?,0,?,?,?,?)',
              [o.hid, row.turno_id, seq, r.dia, r.ini, row.duracao, salaId, 1 << (r.semana - 1), row.caracteristica_pedida, row.id, o.evId]);
            nid = D.lastId();
          }
          const nota = nid === row.id ? `prolongada para a semana ${r.semana} (${DCURTO[r.dia]} ${hm(r.ini)})` : `semana ${r.semana}, ${DCURTO[r.dia]} ${hm(r.ini)}`;
          D.run("INSERT OR REPLACE INTO evento_aula (evento_id, horario_id, aula_id, semana, nova_aula_id, nova_semana, estado, nota) VALUES (?,?,?,?,?,?,'reagendada',?)", [o.evId, o.hid, row.id, o.semana, nid, r.semana, nota]);
          ok++;
        } else D.run("INSERT OR REPLACE INTO evento_aula (evento_id, horario_id, aula_id, semana, estado, nota) VALUES (?,?,?,?,'sem solução',?)", [o.evId, o.hid, row.id, o.semana, `${r.candidatos} posições avaliadas, todas com conflitos`]);
      }
      return { n: afetadas.length, ok, prolongadas };
    });
  }

  /* Repõe as aulas que calham em feriados: cada feriado do semestre fica registado como evento
     (tipo "Feriado") e as aulas desse dia passam para uma semana posterior, de preferência
     prolongando a aula (mesmo dia, hora e sala) para depois da sua última semana. */
  function reporFeriados(D, E, hid, quem) {
    const c = calendario(D);
    const tot = { n: 0, ok: 0, prolongadas: 0, feriados: 0 };
    for (const f of c.feriadosLista.filter((x) => !x.evento && x.dia < 6)) {
      let ev = D.one("SELECT id FROM evento WHERE tipo = 'Feriado' AND data = ?", [f.data]);
      if (!ev) {
        D.run("INSERT INTO evento (nome, tipo, data, inicio, fim, descricao, criado_por, criado_em) VALUES (?, 'Feriado', ?, NULL, NULL, ?, ?, ?)",
          [f.nome || 'Feriado', f.data, 'Aulas repostas numa semana posterior', quem || 'sistema', new Date().toISOString().slice(0, 19).replace('T', ' ')]);
        ev = { id: D.lastId() };
      }
      const r = aplicarSuspensao(D, E, {
        evId: ev.id, hid, semana: f.semana, dia: f.dia, ini: null, fim: null,
        semanas: (row) => {
          let ult = 0; for (let w = 1; w <= c.semanas; w++) if (row.semanas & (1 << (w - 1))) ult = w;
          const l = []; for (let w = Math.max(ult, f.semana) + 1; w <= c.semanas; w++) l.push(w);
          for (let w = f.semana + 1; w <= c.semanas; w++) if (!l.includes(w)) l.push(w);
          return l;
        },
      });
      tot.n += r.n; tot.ok += r.ok; tot.prolongadas += r.prolongadas; tot.feriados++;
    }
    return tot;
  }

  const api = { wrap, seed, buildProblem, instanciaCurso, importarDocentes, rulesFromDb, sqlViolations, calendario, param, aplicarSuspensao, reporFeriados, SEM_SALA, sessaoPontual, SESSAO_PONTUAL_MIN };
  if (typeof module !== 'undefined') module.exports = api;
  root.ODES_MODEL = api;
})(typeof window !== 'undefined' ? window : globalThis);
