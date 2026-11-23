/* Interface da aplicação: entrada com conta, um menu por perfil e permissões,
   todos sobre a mesma base de dados SQLite no browser. */
(async function () {
  'use strict';
  const E = EngineFactory();
  const M = window.ODES_MODEL;
  const SC = window.ODES_SCHEMA;
  const IMP = window.ODES_IMPORT;
  const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const DC = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const STORE = 'odes-horarios-v16';
  const SESSAO = 'odes-sessao-v16';
  const TITULO = 'ISCTE Schedule Manager · Proposta de Horário · 2022/23';
  const INATIVIDADE_MIN = 30, MAX_FALHAS = 5, BLOQUEIO_MIN = 15;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hhmm = E.hhmm;
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const horas = (min) => (min / 60).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + ' h';
  const num = (x, d) => Number(x).toLocaleString('pt-PT', { maximumFractionDigits: d == null ? 1 : d });
  const hue = (id) => (Number(id) * 47 + 200) % 360;
  const agora = () => new Date().toISOString().slice(0, 19);
  const dmy = (d) => String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
  const TIMES = []; for (let m = 480; m <= 1380; m += 30) TIMES.push(m);
  const DATASETS = {
    iscte: { nome: 'ISCTE 2022/23 · Proposta de Horário', curto: 'Proposta de Horário · 2022/23', data: () => window.ODES_ISCTE },
  };

  /* ---------- Armazenamento (IndexedDB, com recurso a memória) ---------- */
  const IDB = {
    db: null,
    async open() {
      if (this.db) return this.db;
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open(STORE, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return this.db;
    },
    async get(k) {
      try { const db = await this.open(); return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return null; }
    },
    async set(k, v) {
      try { const db = await this.open(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; } catch (e) { return false; }
    },
    async del(k) {
      try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch (e) { /* ignora */ }
    },
  };
  const ui = { get(k, d) { try { const v = localStorage.getItem(STORE + '-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(STORE + '-' + k, JSON.stringify(v)); } catch (e) { /* ignora */ } } };
  const ss = { get() { try { return JSON.parse(sessionStorage.getItem(SESSAO) || 'null'); } catch (e) { return memSess; } }, set(v) { memSess = v; try { if (v) sessionStorage.setItem(SESSAO, JSON.stringify(v)); else sessionStorage.removeItem(SESSAO); } catch (e) { /* só em memória */ } } };
  let memSess = null;

  /* ---------- Base de dados ---------- */
  let SQL, D;
  try { SQL = await initSqlJs(); } catch (e) {
    $('#main').innerHTML = '<div class="loading">Não foi possível carregar o motor de base de dados (sql.js). Verifique a ligação à internet e recarregue a página.</div>';
    return;
  }
  function freshDb(ds) {
    const w = M.wrap(new SQL.Database());
    M.seed(w, DATASETS[ds].data());
    // Aulas em feriados são repostas numa semana posterior em todos os horários (o conjunto ISCTE já vem tratado).
    if (!w.one("SELECT 1 x FROM evento WHERE tipo = 'Feriado' LIMIT 1")) for (const h of w.q('SELECT id FROM horario')) M.reporFeriados(w, E, h.id, 'sistema');
    return w;
  }
  async function loadDb(ds) {
    const u8 = await IDB.get('db-' + ds);
    if (u8) {
      try {
        const w = M.wrap(new SQL.Database(u8));
        w.exec('PRAGMA foreign_keys = ON');
        w.q('SELECT COUNT(*) AS n FROM utilizador');
        return w;
      } catch (e) { /* base de dados antiga ou estragada: começa de novo */ }
    }
    return freshDb(ds);
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    const ds = st.ds, db = D;
    saveTimer = setTimeout(() => {
      try { const u8 = db.raw.export(); db.exec('PRAGMA foreign_keys = ON'); IDB.set('db-' + ds, u8); } catch (e) { /* continua só em memória */ }
    }, 500);
  }

  /* ---------- Estado da interface ---------- */
  const st = {
    ds: DATASETS[ui.get('ds', 'iscte')] ? ui.get('ds', 'iscte') : 'iscte', view: null, horarioId: null,
    filtro: { tipo: 'turma', id: null }, sel: null, vfiltro: 'todas', undo: [], semana: 0,
    consulta: { tipo: 'turma', id: null }, dadosTab: 'tabelas', tabela: 'sala', tabelaBusca: '', acadTab: 'docente',
    sql: "SELECT turma, uc, tipo_aula, dia, inicio, sala, semanas\nFROM v_aula_turma\nWHERE horario_id = 1\nORDER BY turma, dia, inicio\nLIMIT 50;",
    sqlRes: null, paint: 'indisponivel', pesquisa: { dia: 0, ini: 600, dur: 90, alunos: 30, car: '', edificio: '', semana: 0 },
    gen: null, cmp: { a: null, b: null }, sugestoes: null, importRes: null, csvOut: null, novaRegra: null,
    cursoTurmaId: null, criar: null, criarRes: null, pedido: null, novaConta: null, senhaTemp: null, regFiltro: '', loginErr: '',
    salaSel: null,
  };
  let U = null;
  let rev = 0;

  function registar(acao, detalhe, quem) {
    try {
      D.run('INSERT INTO registo (quando, ator, acao, detalhe, utilizador) VALUES (?,?,?,?,?)',
        [agora(), quem ? quem.perfil : (U ? U.perfilNome : 'Sistema'), acao, detalhe || '', quem ? quem.username : (U ? U.username : null)]);
    } catch (e) { /* ignora */ }
  }
  function changed(acao, detalhe) {
    rev++;
    if (acao) registar(acao, detalhe);
    save();
  }
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  /* ---------- Autenticação e permissões ---------- */
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  async function pbkdf2(senha, sal) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(sal), iterations: SC.PBKDF2_ITER }, key, 256);
    return hex(bits);
  }
  const iguais = (a, b) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
  function novoSal() { const a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a.buffer); }
  function senhaTemporaria() {
    const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    return [...a].map((x) => abc[x % abc.length]).join('').replace(/^(.{4})(.{4})/, '$1-$2-');
  }
  function politicaSenha(s, u) {
    if (s.length < 10) return 'A senha tem de ter pelo menos 10 caracteres.';
    if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'A senha tem de ter letras e números.';
    if (u && s.toLowerCase().includes(u.toLowerCase())) return 'A senha não pode conter o nome de utilizador.';
    return null;
  }
  function carregarUtilizador(username) {
    const u = D.one('SELECT u.*, p.nome AS perfilNome FROM utilizador u JOIN perfil p ON p.id = u.perfil_id WHERE u.username = ?', [username]);
    if (!u || !u.ativo) return null;
    u.perms = new Set(D.q('SELECT permissao_id FROM perfil_permissao WHERE perfil_id = ?', [u.perfil_id]).map((r) => r.permissao_id));
    u.perfil = u.perfilNome;
    return u;
  }
  const can = (p) => !!(U && U.perms.has(p));

  async function entrar(username, senha) {
    username = String(username || '').trim().toLowerCase();
    const u = D.one('SELECT * FROM utilizador WHERE username = ?', [username]);
    const falha = 'Utilizador ou senha incorretos.';
    if (!u) { registar('Entrada recusada', `utilizador desconhecido: ${username.slice(0, 40)}`, { perfil: 'Sistema', username: null }); changed(); return falha; }
    const quem = { perfil: 'Sistema', username: u.username };
    if (!u.ativo) { registar('Entrada recusada', 'conta desativada', quem); changed(); return 'Esta conta está desativada. Contacte o administrador.'; }
    if (u.bloqueado_ate && u.bloqueado_ate > agora()) {
      registar('Entrada recusada', 'conta bloqueada', quem); changed();
      return `Conta bloqueada por excesso de tentativas até às ${u.bloqueado_ate.slice(11, 16)} (hora UTC). Um administrador pode desbloqueá-la.`;
    }
    let h;
    try { h = await pbkdf2(senha, u.sal); } catch (e) { return 'Este browser não permite verificar senhas (é preciso uma ligação https).'; }
    if (!iguais(h, u.hash)) {
      const f = u.falhas + 1;
      if (f >= MAX_FALHAS) {
        const ate = new Date(Date.now() + BLOQUEIO_MIN * 60000).toISOString().slice(0, 19);
        D.run('UPDATE utilizador SET falhas = 0, bloqueado_ate = ? WHERE id = ?', [ate, u.id]);
        registar('Conta bloqueada', `${MAX_FALHAS} tentativas falhadas seguidas`, quem); changed();
        return `Conta bloqueada durante ${BLOQUEIO_MIN} minutos após ${MAX_FALHAS} tentativas falhadas.`;
      }
      D.run('UPDATE utilizador SET falhas = ? WHERE id = ?', [f, u.id]);
      registar('Entrada recusada', `senha errada (${f} de ${MAX_FALHAS})`, quem); changed();
      return falha + (f >= 3 ? ` Restam ${MAX_FALHAS - f} tentativas antes do bloqueio.` : '');
    }
    D.run('UPDATE utilizador SET falhas = 0, bloqueado_ate = NULL, ultimo_login = ? WHERE id = ?', [agora(), u.id]);
    U = carregarUtilizador(u.username);
    registar('Sessão iniciada', `${st.ds}`);
    ss.set({ u: U.username, ds: st.ds, t: Date.now() });
    changed();
    iniciarSessao();
    return null;
  }
  function sair(msg) {
    if (U) { registar('Sessão terminada', msg || 'pelo utilizador'); changed(); }
    U = null; ss.set(null);
    st.view = null; st.sel = null; st.gen = null; st.criar = null; st.criarRes = null; st.pedido = null; st.senhaTemp = null;
    st.loginErr = msg && msg !== 'pelo utilizador' ? msg : '';
    render();
  }
  let ultimaAtividade = Date.now();
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
    if (!U) return;
    const t = Date.now();
    if (t - ultimaAtividade > 20000) { ultimaAtividade = t; const s = ss.get(); if (s) { s.t = t; ss.set(s); } }
  }, true));
  setInterval(() => {
    const s = ss.get();
    if (U && s && Date.now() - Math.max(s.t, ultimaAtividade) > INATIVIDADE_MIN * 60000) sair(`Sessão terminada por inatividade (${INATIVIDADE_MIN} minutos).`);
  }, 30000);

  /* ---------- Consultas comuns ---------- */
  const AULAS_SQL = `SELECT v.*, (SELECT group_concat(tm.codigo, ', ') FROM turno_turma tt JOIN turma tm ON tm.id = tt.turma_id WHERE tt.turno_id = v.turno_id) AS turmas
    FROM v_aula v WHERE v.horario_id = ?`;
  function aulasDe(hid, filtro, todasSemanas) {
    if (hid == null) return [];
    // Sem permissão de consulta geral, só o próprio horário (turma do estudante ou aulas do docente).
    if (U && !can('horarios.consultar')) filtro = U.turma_id ? { tipo: 'turma', id: U.turma_id } : U.docente_id ? { tipo: 'docente', id: U.docente_id } : { tipo: 'turma', id: -1 };
    let sql = AULAS_SQL; const p = [hid];
    if (filtro) {
      if (filtro.tipo === 'turma') { sql += ' AND v.turno_id IN (SELECT turno_id FROM turno_turma WHERE turma_id = ?)'; p.push(filtro.id); }
      if (filtro.tipo === 'docente') { sql += ' AND v.docente_id = ?'; p.push(filtro.id); }
      if (filtro.tipo === 'sala') { sql += ' AND v.sala_id = ?'; p.push(filtro.id); }
      if (filtro.tipo === 'uc') { sql += ' AND v.uc_id = ?'; p.push(filtro.id); }
      if (filtro.tipo === 'curso') { sql += ' AND v.turno_id IN (SELECT tt.turno_id FROM turno_turma tt JOIN turma t ON t.id = tt.turma_id WHERE t.curso_id = ?)'; p.push(filtro.id); }
    }
    let rows = D.q(sql + ' ORDER BY v.dia, v.inicio', p);
    if (st.semana && !todasSemanas) { const b = 1 << (st.semana - 1); rows = rows.filter((a) => a.semanas & b); }
    return rows;
  }
  const vcache = new Map();
  function validar(hid) {
    if (hid == null) return { violacoes: [], hard: 0, soft: 0, porAula: new Map(), porRegra: {}, custo: 0 };
    const k = st.ds + ':' + hid + ':' + rev;
    if (vcache.has(k)) return vcache.get(k);
    const P = M.buildProblem(D, { horarioId: hid, incluirEmFalta: true });
    const r = E.validate(P);
    const sv = M.sqlViolations(D, hid);
    const violacoes = r.violacoes.concat(sv);
    const porAula = new Map();
    const porRegra = {};
    let hard = 0, soft = 0;
    for (const v of violacoes) {
      if (v.erro) continue;
      if (v.sev === 'hard') hard++; else soft++;
      (porRegra[v.codigo] = porRegra[v.codigo] || { n: 0, nome: v.nome, sev: v.sev }).n++;
      for (const id of v.aulas) if (id != null) { if (!porAula.has(id)) porAula.set(id, []); porAula.get(id).push(v); }
    }
    const res = { violacoes, hard, soft, porAula, porRegra, custo: r.custo };
    for (const key of [...vcache.keys()]) if (!key.endsWith(':' + rev) || !key.startsWith(st.ds + ':')) vcache.delete(key);
    vcache.set(k, res);
    return res;
  }
  const todosHorarios = () => D.q('SELECT * FROM horario ORDER BY id');
  const horarios = () => {
    const all = todosHorarios();
    if (can('horario.ver_rascunhos')) return all;
    // Todos os perfis podem comparar os dois cenários: Horário ISCTE (Manual) e Horário Otimizado.
    const { base, alt } = horariosChave();
    return all.filter((h) => h.estado === 'publicado' || (base && h.id === base.id) || (alt && h.id === alt.id));
  };
  const horario = (id) => D.one('SELECT * FROM horario WHERE id = ?', [id]);
  const turmasAll = () => D.q("SELECT t.*, COALESCE(c.sigla, '—') AS sigla, COALESCE(t.regime, c.regime, 'diurno') AS regime FROM turma t LEFT JOIN curso c ON c.id = t.curso_id ORDER BY t.codigo");
  const docentesAll = () => D.q('SELECT * FROM docente ORDER BY nome');
  const salasAll = () => D.q('SELECT * FROM sala ORDER BY codigo');
  const regrasMotor = () => M.rulesFromDb(D);
  const cal = () => M.calendario(D);
  const conjunto = () => M.param(D, 'conjunto', st.ds);
  function mancha(regime) {
    const r = regrasMotor().FORA_MANCHA;
    return r && r.params && r.params[regime] ? r.params[regime] : null;
  }
  function optList(rows, val, label, sel) {
    return rows.map((r) => `<option value="${esc(r[val])}"${String(r[val]) === String(sel) ? ' selected' : ''}>${esc(typeof label === 'function' ? label(r) : r[label])}</option>`).join('');
  }
  const tipoTxt = (t) => (t === 'ND' ? 'tipo não indicado' : t);
  const regimeTxt = (r) => (r === 'pos-laboral' ? 'Pós-Laboral (PL)' : 'Diurno');
  const editavel = (h) => !!(h && h.estado === 'rascunho' && can('horario.editar'));
  const ESTADOS = { rascunho: 'rascunho', 'em revisao': 'em revisão', aprovado: 'aprovado', publicado: 'publicado', arquivado: 'arquivado' };
  const estadoPill = (e) => `<span class="estado ${String(e).replace(' ', '-')}">${esc(ESTADOS[e] || e)}</span>`;
  function semanaTxt(w) {
    const c = cal();
    return `${w} · ${dmy(c.data(w, 0))}–${dmy(c.data(w, 5))}`;
  }
  function semanaSel(id) {
    const c = cal();
    const opts = ['<option value="0">Todas as semanas</option>'];
    for (let w = 1; w <= c.semanas; w++) opts.push(`<option value="${w}"${w === st.semana ? ' selected' : ''}>Semana ${semanaTxt(w)}</option>`);
    return `<label class="f">Semana do semestre<select data-change="semana" ${id ? `id="${id}"` : ''}>${opts.join('')}</select></label>`;
  }
  const semTxt = (m) => E.semTxt(m, cal().semanas);

  const CONF_MOTIVO = { CONF_TURMA: 'mesma turma', CONF_DOCENTE: 'mesmo docente', CONF_SALA: 'mesma sala' };
  /* ---------- Grelha de horário ---------- */
  function lanes(list) {
    const byDay = {};
    for (const a of list) (byDay[a.dia] = byDay[a.dia] || []).push(a);
    for (const d in byDay) {
      const l = byDay[d].sort((x, y) => x.inicio - y.inicio || y.duracao - x.duracao);
      const ends = [];
      const groups = []; let g = null, gEnd = -1;
      for (const a of l) {
        let k = ends.findIndex((e) => e <= a.inicio);
        if (k < 0) { k = ends.length; ends.push(0); }
        ends[k] = a.inicio + a.duracao; a._lane = k;
        if (!g || a.inicio >= gEnd) { g = []; groups.push(g); gEnd = -1; }
        g.push(a); gEnd = Math.max(gEnd, a.inicio + a.duracao);
      }
      for (const gg of groups) { const n = Math.max(...gg.map((a) => a._lane)) + 1; for (const a of gg) a._lanes = n; }
    }
  }
  function grid(o) {
    const aulas = o.aulas || [];
    const dias = o.dias || (aulas.some((a) => a.dia === 5) ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4]);
    const slot = 21, top0 = 480, endM = 1410;
    const y = (m) => ((m - top0) / 30) * slot;
    const H = y(endM);
    const c = cal();
    const full = c.full;
    lanes(aulas);
    let html = `<div class="tt-wrap"><div class="tt${o.paint ? ' paint' : ''}" id="${o.id || 'tt'}" style="--ndias:${dias.length}" data-dias="${dias.join(',')}">`;
    const fer = st.semana ? c.feriadosLista.filter((f) => f.semana === st.semana) : [];
    html += '<div class="hd"></div>' + dias.map((d) => {
      const f = fer.find((x) => x.dia === d);
      return `<div class="hd">${DIAS[d]}${st.semana ? ` <span class="muted small">${dmy(c.data(st.semana, d))}</span>` : ''}${f ? `<br><span class="pill hard" title="${esc(f.nome)}">feriado</span>` : ''}</div>`;
    }).join('');
    html += `<div class="times" style="height:${H}px">` + TIMES.filter((m) => m % 60 === 0).map((m) => `<span style="top:${y(m)}px">${hhmm(m)}</span>`).join('') + '</div>';
    for (const d of dias) {
      html += `<div class="day" data-dia="${d}" style="height:${H}px">`;
      if (o.mancha && o.mancha.dias.includes(d)) html += `<div class="band mancha" style="top:${y(o.mancha.inicio)}px;height:${y(Math.min(o.mancha.fim, endM)) - y(o.mancha.inicio)}px"></div>`;
      for (const x of o.disp || []) if (x.dia === d) html += `<div class="band ${x.tipo === 'indisponivel' ? 'indisp' : 'pref'}" style="top:${y(x.inicio)}px;height:${y(x.fim) - y(x.inicio)}px"></div>`;
      if (o.paint) for (let m = 480; m < endM; m += 30) html += `<div class="cell" data-dia="${d}" data-m="${m}" style="top:${y(m)}px"></div>`;
      for (const a of aulas.filter((a) => a.dia === d)) {
        const vs = (o.viol && o.viol.get(a.aula_id)) || [];
        const nh = vs.filter((v) => v.sev === 'hard').length;
        // Aulas sobrepostas (turma, docente ou sala): cada aula diz com qual coincide.
        const porId = o._porId || (o._porId = new Map(aulas.map((x) => [x.aula_id, x])));
        const sobre = [];
        for (const v of vs) {
          if (!CONF_MOTIVO[v.codigo]) continue;
          for (const id of v.aulas || []) {
            if (id === a.aula_id) continue;
            const x = porId.get(id);
            const y = x || D.one('SELECT t.codigo AS turno FROM aula a JOIN turno t ON t.id = a.turno_id WHERE a.id = ?', [id]);
            const t = `${y ? y.turno : 'aula ' + id} (${CONF_MOTIVO[v.codigo]})`;
            if (!sobre.includes(t)) sobre.push(t);
          }
        }
        const w = 100 / a._lanes;
        const parcial = (a.semanas & full) !== full;
        const plan = can('planeamento.ver');
        const cls = ['blk', o.editable ? 'editable' : '', o.clickable ? 'click' : '', !plan ? '' : nh ? 'v-hard' : vs.length ? 'v-soft' : '', st.sel === a.aula_id && o.selectable ? 'selected' : '', a.fixa ? 'fixa' : '', parcial ? 'parcial' : '', sobre.length ? 'sobreposta' : ''].join(' ');
        const linha3 = o.mostrar === 'turmas' ? a.turmas : o.mostrar === 'sala' ? a.sala : a.docente || a.turmas;
        const tip = `${a.uc_nome} (${tipoTxt(a.tipo_aula)} · ${a.turno})\n${DIAS[a.dia]} ${hhmm(a.inicio)}–${hhmm(a.fim)} · ${semTxt(a.semanas)}\nSala: ${a.sala || (a.caracteristica_pedida === M.SEM_SALA ? 'não precisa' : 'por atribuir')}${plan && a.caracteristica_pedida ? `\nPedido: ${a.caracteristica_pedida}` : ''}\nDocente: ${a.docente || '—'}\nTurmas: ${a.turmas || ''}` + (sobre.length ? `\n\nAo mesmo tempo que: ${sobre.join(', ')}` : '') + (plan && vs.length ? '\n\n' + vs.slice(0, 8).map((v) => '• ' + v.msg).join('\n') : '');
        html += `<div class="${cls}" data-aula="${a.aula_id}" title="${esc(tip)}" style="--h:${hue(a.uc_id)};top:${y(a.inicio) + 1}px;height:${y(a.fim) - y(a.inicio) - 2}px;left:calc(${a._lane * w}% + 2px);width:calc(${w}% - 4px)">`
          + (vs.length && plan ? `<span class="badge${nh ? '' : ' soft'}">${vs.length}</span>` : '')
          + (sobre.length ? `<span class="m sobre">⚠ com ${esc([...new Set(sobre.map((x) => x.replace(/ \(.*\)$/, '')))].join(', '))}</span>` : '')
          + `<span class="m"><b>${esc(a.uc_nome || a.uc)}</b></span><span class="m">${a.tipo_aula === 'ND' ? '' : esc(a.tipo_aula) + ' · '}${esc(a.turno)}</span>`
          + `<span class="m">${esc(o.mostrar === 'sala' ? hhmm(a.inicio) + '–' + hhmm(a.fim) : (a.sala || (a.caracteristica_pedida === M.SEM_SALA ? 'sem sala (não precisa)' : 'sem sala')))}</span>`
          + `<span class="m">${esc(linha3 || '')}</span></div>`;
      }
      html += '</div>';
    }
    return html + '</div></div>';
  }
  const legendaGrid = (extra) => `<div class="legend"><span><i style="background:var(--mancha)"></i>Mancha horária padrão</span>${can('planeamento.ver') ? `<span><i style="box-shadow:inset 0 0 0 2px var(--hard)"></i>Viola regra obrigatória</span><span><i style="box-shadow:inset 0 0 0 2px var(--soft)"></i>Viola critério de qualidade</span>` : ''}<span><i style="border:1px dashed var(--ink-3)"></i>Só em algumas semanas</span>${can('planeamento.ver') ? '<span><i class="lg-sobre"></i>Aulas ao mesmo tempo (lado a lado)</span>' : ''}${extra || ''}</div>`;

  /* Arrastar aulas na grelha. */
  function bindDrag(gridId, onDrop, onClick) {
    const tt = document.getElementById(gridId);
    if (!tt) return;
    const dias = tt.dataset.dias.split(',').map(Number);
    tt.addEventListener('pointerdown', (ev) => {
      const blk = ev.target.closest('.blk.editable, .blk.click');
      if (!blk || ev.button > 0) return;
      const id = Number(blk.dataset.aula);
      if (!blk.classList.contains('editable')) { if (onClick) onClick(id); return; }
      ev.preventDefault();
      const startX = ev.clientX, startY = ev.clientY;
      const r0 = blk.getBoundingClientRect();
      let moved = false, ghost = null, target = null;
      blk.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true;
        blk.classList.add('dragging');
        blk.style.transform = `translate(${dx}px, ${dy}px)`;
        const cols = $$('.day', tt);
        const cx = r0.left + r0.width / 2 + dx;
        const col = cols.find((c) => { const b = c.getBoundingClientRect(); return cx >= b.left && cx < b.right; });
        if (!col) return;
        const b = col.getBoundingClientRect();
        const dur = Math.round((r0.height + 2) / 21) * 30;
        let m = 480 + Math.round((r0.top + dy - b.top) / 21) * 30;
        m = Math.max(480, Math.min(1410 - dur, m));
        target = { dia: Number(col.dataset.dia), ini: m };
        if (!ghost) { ghost = document.createElement('div'); ghost.className = 'ghost'; }
        if (ghost.parentNode !== col) col.appendChild(ghost);
        ghost.style.cssText = `top:${((m - 480) / 30) * 21}px;height:${(dur / 30) * 21}px;left:2px;right:2px`;
      };
      const up = () => {
        blk.removeEventListener('pointermove', move);
        blk.removeEventListener('pointerup', up);
        blk.removeEventListener('pointercancel', up);
        if (ghost) ghost.remove();
        blk.classList.remove('dragging'); blk.style.transform = '';
        if (moved && target && dias.includes(target.dia)) onDrop(id, target.dia, target.ini);
        else if (!moved && onClick) onClick(id);
      };
      blk.addEventListener('pointermove', move);
      blk.addEventListener('pointerup', up);
      blk.addEventListener('pointercancel', up);
    });
  }

  /* ---------- Alterações validadas antes de gravar (bloqueia regras obrigatórias) ---------- */
  function violacoesDaAula(hid, aulaId) {
    const P = M.buildProblem(D, { horarioId: hid });
    const i = P.aulas.findIndex((a) => a.id === aulaId);
    return i < 0 ? [] : E.violationsOf(P, i);
  }
  /* Aplica mutate() numa transação, compara as violações da aula antes e depois e
     desfaz se aparecerem violações novas de regras obrigatórias (salvo se forçado). */
  function comValidacao(hid, aulaId, mutate, forcar) {
    const antes = aulaId != null ? violacoesDaAula(hid, aulaId) : [];
    D.run('SAVEPOINT alteracao');
    let id = aulaId;
    try { const r = mutate(); if (id == null) id = r; } catch (e) { D.run('ROLLBACK TO alteracao'); D.run('RELEASE alteracao'); return { ok: false, erro: e.message, novas: [] }; }
    const depois = violacoesDaAula(hid, id);
    const k = (v) => v.codigo + '|' + v.msg;
    const ant = new Set(antes.map(k));
    const novas = depois.filter((v) => !ant.has(k(v)));
    const novasHard = novas.filter((v) => v.sev === 'hard');
    if (novasHard.length && !forcar) { D.run('ROLLBACK TO alteracao'); D.run('RELEASE alteracao'); return { ok: false, novas, depois, id }; }
    D.run('RELEASE alteracao');
    return { ok: true, novas, depois, id };
  }
  function moverAula(id, dia, ini, salaId, opts) {
    opts = opts || {};
    const a = D.one('SELECT * FROM aula WHERE id = ?', [id]);
    if (!a) return null;
    const h = horario(a.horario_id);
    // A gestão de espaços pode mudar a sala (pedido só de sala aprovado) num rascunho.
    const podeSala = opts.soSala && h && h.estado === 'rascunho' && can('salas.editar') && dia === a.dia && ini === a.inicio;
    if (!editavel(h) && !podeSala) { toast(`O horário está ${ESTADOS[h.estado]}: só se alteram horários em rascunho.`); return null; }
    const novaSala = salaId === undefined ? a.sala_id : salaId;
    // Aulas do mesmo bloco (seguidas da mesma UC e turma no Manual) mudam de dia e hora juntas.
    let outras = [];
    if (dia !== a.dia || ini !== a.inicio) {
      const P = M.buildProblem(D, { horarioId: a.horario_id });
      const k = P.aulas.findIndex((x) => x.id === id);
      const B = k >= 0 && P.aulas[k].bloco >= 0 ? P.blocos[P.aulas[k].bloco] : null;
      if (B) outras = B.m.filter((j) => j !== k).map((j) => D.one('SELECT id, dia, inicio, sala_id FROM aula WHERE id = ?', [P.aulas[j].id])).filter(Boolean);
    }
    const dIni = ini - a.inicio;
    const r = comValidacao(a.horario_id, id, () => {
      D.run('UPDATE aula SET dia = ?, inicio = ?, sala_id = ? WHERE id = ?', [dia, ini, novaSala, id]);
      for (const o of outras) D.run('UPDATE aula SET dia = ?, inicio = ? WHERE id = ?', [dia, o.inicio + dIni, o.id]);
    }, opts.forcar);
    const v = D.one('SELECT uc, turno, sala FROM v_aula WHERE aula_id = ?', [id]);
    if (!r.ok) {
      st.bloqueio = { id, dia, ini, sala: novaSala, novas: r.novas };
      st.sel = id;
      toast(`Alteração bloqueada: ${r.novas.filter((x) => x.sev === 'hard').length} regra(s) obrigatória(s) violada(s). Veja o detalhe da aula.`);
      return r;
    }
    st.bloqueio = null;
    st.undo.push({ id, dia: a.dia, ini: a.inicio, sala: a.sala_id, outras: outras.map((o) => ({ id: o.id, dia: o.dia, ini: o.inicio, sala: o.sala_id })) });
    if (st.undo.length > 30) st.undo.shift();
    changed(opts.forcar ? 'Aula alterada (forçado)' : 'Aula alterada', `${v.uc} ${v.turno}: ${DC[a.dia]} ${hhmm(a.inicio)} → ${DC[dia]} ${hhmm(ini)} (${v.sala || 'sem sala'})${opts.justificacao ? ' · justificação: ' + opts.justificacao : ''}`);
    const soft = r.novas.filter((x) => x.sev !== 'hard').length;
    toast(`Aula gravada em ${DC[dia]} ${hhmm(ini)}${v.sala ? ', ' + v.sala : ''}.` + (outras.length ? ` As ${outras.length} aula(s) seguidas do mesmo bloco foram juntas.` : '') + (soft ? ` Atenção: ${soft} critério(s) de qualidade novo(s).` : '') + (opts.forcar && r.novas.length ? ' Gravada com violações (registado).' : ''));
    return r;
  }

  /* ---------- Navegação por perfil e permissões ---------- */
  const VIEWDEFS = [
    ['geral', 'Visão geral', 'Gabinete', '', () => can('horario.editar') || can('horario.gerar')],
    ['meu', 'O meu horário', 'Pessoal', '', () => !!(U.docente_id || U.turma_id)],
    ['disp', 'Disponibilidade', 'Pessoal', '', () => !!U.docente_id && can('disponibilidade.propria')],
    ['avisos', 'Avisos', 'Pessoal', '', () => !!U.docente_id],
    ['ucs', 'As minhas UCs', 'Pessoal', '', () => !!U.turma_id],
    ['plano', 'Plano e cobertura', 'Curso', '', () => !!U.curso_id],
    ['turmas', 'Horários das turmas', 'Curso', '', () => !!U.curso_id],
    ['problemas', 'Problemas do curso', 'Curso', '', () => !!U.curso_id],
    ['consultas', 'Consultar horários', 'Horários', '', () => can('horarios.consultar')],
    ['horario', 'Horário e violações', 'Horários', '2', () => can('horario.editar') || can('horario.ver_rascunhos')],
    ['criar', 'Criar aula', 'Horários', '', () => can('horario.editar')],
    ['gerar', 'Gerar horário', 'Horários', '3', () => can('horario.gerar')],
    ['comparar', 'Comparar horários', 'Horários', '3', () => can('horario.ver_rascunhos')],
    ['experiencias', 'Experiências (Solução 1 vs 2)', 'Horários', '', () => (can('horario.gerar') || can('horario.ver_rascunhos')) && U.perfil_id !== 'espacos'],
    ['revisao', 'Aprovação e publicação', 'Governação', '', () => can('horario.aprovar') || can('horario.publicar') || can('horario.submeter')],
    ['pedidos', 'Pedidos de alteração', 'Governação', '', () => can('pedidos.criar') || can('pedidos.decidir')],
    ['fontes', 'Fontes e recolha', 'Dados', '1', () => can('dados.ver')],
    ['academica', 'Gestão académica', 'Dados', '', () => can('dados.ver') || !!U.curso_id],
    ['dados', 'Dados e modelo', 'Dados', '2', () => can('dados.ver')],
    ['regras', 'Regras', 'Dados', '2', () => can('dados.ver') || can('regras.editar')],
    ['calendario', 'Calendário', 'Dados', '', () => can('dados.ver') || !!U.curso_id],
    ['eventos', 'Eventos e datas especiais', 'Dados', '', () => can('eventos.gerir') || can('dados.ver')],
    ['ocupacao', 'Ocupação de salas', 'Espaços', '', () => can('salas.editar') || can('reservas.gerir')],
    ['pesquisa', 'Pesquisa de salas', 'Espaços', '', () => can('salas.pesquisar')],
    ['salas', 'Salas e características', 'Espaços', '', () => can('salas.editar') || can('dados.ver') || !!U.curso_id],
    ['reservas', 'Reservas', 'Espaços', '', () => can('reservas.gerir')],
    ['utilizadores', 'Utilizadores', 'Administração', '', () => can('utilizadores.gerir')],
    ['permissoes', 'Perfis e permissões', 'Administração', '', () => can('permissoes.gerir') || can('utilizadores.gerir')],
    ['registo', 'Registo de auditoria', 'Administração', '', () => can('registo.ver')],
    ['conta', 'A minha conta', 'Conta', '', () => true],
  ];
  const INICIO = { gestor: 'geral', admin: 'utilizadores', curso: 'plano', docente: 'meu', estudante: 'meu', espacos: 'ocupacao' };
  const visiveis = () => VIEWDEFS.filter((v) => { try { return v[4](); } catch (e) { return false; } });

  function iniciarSessao() {
    const vs = visiveis().map((v) => v[0]);
    st.view = U.mudar_senha ? 'conta' : (vs.includes(INICIO[U.perfil_id]) ? INICIO[U.perfil_id] : vs[0]);
    const hs = horarios();
    const pub = hs.find((h) => h.estado === 'publicado');
    st.horarioId = (pub || hs[0] || {}).id || null;
    st.semana = conjunto() === 'iscte' ? 3 : 0;
    const t1 = U.turma_id || (U.curso_id && (D.one('SELECT id FROM turma WHERE curso_id = ? ORDER BY n_alunos DESC LIMIT 1', [U.curso_id]) || {}).id)
      || (D.one("SELECT t.id FROM turma t JOIN curso c ON c.id = t.curso_id WHERE c.sigla IN ('LEI','MIG') ORDER BY t.n_alunos DESC LIMIT 1") || D.one('SELECT id FROM turma ORDER BY id LIMIT 1') || {}).id;
    st.filtro = { tipo: 'turma', id: t1 };
    st.consulta = { tipo: 'turma', id: t1 };
    st.cursoTurmaId = null; st.undo = []; st.sel = null; st.bloqueio = null; st.gen = null;
    const hids = hs.map((h) => h.id);
    st.cmp = { a: hids[0], b: hids[1] || hids[0] };
    st.pesquisa.car = '';
    render();
  }

  /* ---------- Ecrã de entrada ---------- */
  function renderLogin() {
    const box = $('#login');
    box.hidden = false;
    document.title = 'Entrar · ' + TITULO;
    const contas = SC.contasDemo.map(([u, n, p, , , s]) => ({ u, n, p, s, perfil: (SC.perfis.find((x) => x[0] === p) || [])[1] }));
    box.innerHTML = `<div class="login">
      <div class="panel"><div><div class="eyebrow">${esc(TITULO)}</div><h2>Entrar</h2></div>
        <form id="login-form" autocomplete="on">
          <label class="f">Utilizador<input type="text" id="lg-u" autocomplete="username" required autocapitalize="none" spellcheck="false"></label>
          <label class="f">Senha<input type="password" id="lg-p" autocomplete="current-password" required></label>
          ${st.loginErr ? `<p class="err" role="alert">${esc(st.loginErr)}</p>` : ''}
          <button class="btn primary" type="submit" id="lg-go">Entrar</button>
          <p class="small muted">Depois de ${MAX_FALHAS} tentativas falhadas a conta fica bloqueada ${BLOQUEIO_MIN} minutos. A sessão termina após ${INATIVIDADE_MIN} minutos sem atividade.</p>
        </form></div>
      <div class="stack">
        <div class="panel"><h3>Contas de demonstração</h3>
          ${table(contas, [{ h: 'Perfil', f: (r) => `<b>${esc(r.perfil)}</b>` }, { h: 'Utilizador', f: (r) => `<span class="mono">${esc(r.u)}</span>` }, { h: 'Senha', f: (r) => `<span class="mono">${esc(r.s)}</span>` }, { h: '', f: (r) => `<button class="btn small" type="button" data-act="lg-fill" data-u="${esc(r.u)}" data-s="${esc(r.s)}">Usar</button>` }])}</div>
      </div></div>`;
    setTimeout(() => { const i = $('#lg-u'); if (i) i.focus(); }, 0);
  }
  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'login-form') {
      e.preventDefault();
      const b = $('#lg-go'); b.disabled = true; b.textContent = 'A verificar…';
      const err = await entrar($('#lg-u').value, $('#lg-p').value);
      if (err) { const un = $('#lg-u').value; st.loginErr = err; renderLogin(); const u = $('#lg-u'); if (u) { u.value = un; $('#lg-p').focus(); } }
      return;
    }
    const f = e.target.dataset && e.target.dataset.submit;
    if (f && SUBMIT[f]) { e.preventDefault(); SUBMIT[f](e.target); }
  });

  /* ---------- Renderização ---------- */
  function renderTop() {
    const d = DATASETS[st.ds];
    const hs = horarios();
    if (!hs.some((h) => h.id === st.horarioId)) st.horarioId = hs.length ? (hs.find((h) => h.estado === 'publicado') || hs[0]).id : null;
    $('#hsel').innerHTML = hs.map((h) => `<option value="${h.id}"${h.id === st.horarioId ? ' selected' : ''}>${esc(h.nome)}${h.estado !== 'publicado' ? ' (' + ESTADOS[h.estado] + ')' : ''}</option>`).join('') || '<option>Sem horários</option>';
    const h = horario(st.horarioId);
    $('#hestado').innerHTML = h ? estadoPill(h.estado) : '';
    $('#user').innerHTML = `<div class="who"><b>${esc(U.nome)}</b><span>${esc(U.perfil)} · ${esc(U.username)}</span></div><button class="btn small" data-act="sair">Sair</button>`;
    const vs = visiveis();
    let sec = null, html = '';
    for (const [k, n, s, item] of vs) {
      if (s !== sec) { html += `<div class="sec">${esc(s)}</div>`; sec = s; }
      html += `<button data-act="view" data-k="${k}" aria-current="${st.view === k}"><span>${n}</span>${item ? `<span class="item-tag">item ${item}</span>` : ''}</button>`;
    }
    if (can('dados.editar')) html += '<div class="note"><button class="btn small" data-act="reset" data-confirm="1">Repor dados iniciais</button></div>';
    $('#nav').innerHTML = html;
  }
  function render() {
    if (!U) { $('#nav').innerHTML = ''; $('#main').innerHTML = ''; $('#user').innerHTML = ''; $('#hsel').innerHTML = ''; $('#hestado').innerHTML = ''; renderLogin(); return; }
    $('#login').hidden = true;
    $('#login').innerHTML = '';
    if (!visiveis().some((v) => v[0] === st.view)) st.view = visiveis()[0][0];
    if (U.mudar_senha) st.view = 'conta';
    renderTop();
    const def = VIEWDEFS.find((v) => v[0] === st.view);
    document.title = (def ? def[1] + ' · ' : '') + TITULO;
    const fn = VIEWS[st.view];
    const main = $('#main');
    const scroll = window.scrollY;
    try {
      main.innerHTML = fn ? (CENARIO_VIEWS.includes(st.view) ? cenarioBar() : '') + fn() : '';
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="panel"><h3>Erro ao mostrar esta secção</h3><p class="mono">${esc(e.message)}</p></div>`;
    }
    const after = AFTER[st.view];
    if (after) after();
    window.scrollTo(0, scroll);
  }

  /* Escolha rápida entre os dois cenários (Horário ISCTE (Manual) e Horário Otimizado), em todos os perfis. */
  const CENARIO_VIEWS = ['meu', 'ucs', 'consultas', 'turmas', 'geral', 'horario', 'ocupacao'];
  function cenarioBar() {
    const { base, alt } = horariosChave();
    const hs = horarios();
    if (!base || !alt || !hs.some((h) => h.id === base.id) || !hs.some((h) => h.id === alt.id)) return '';
    const b = (h, nome) => `<button class="btn small${h.id === st.horarioId ? ' primary' : ''}" data-act="cenario" data-id="${h.id}" aria-pressed="${h.id === st.horarioId}">${nome}</button>`;
    const outro = st.horarioId !== base.id && st.horarioId !== alt.id ? `<span class="small muted">A ver: ${esc(hNome(st.horarioId))}</span>` : '';
    const nota = st.horarioId === alt.id && alt.estado !== 'publicado' ? `<span class="small muted">Cenário ainda não publicado (${esc(ESTADOS[alt.estado])}).</span>` : '';
    return `<div class="row cenario" role="group" aria-label="Cenário"><span class="small"><b>Cenário</b></span>${b(base, 'Horário ISCTE (Manual)')}${b(alt, 'Horário Otimizado')}${outro}${nota}</div>`;
  }
  const head = (eyebrow, title, sub, right) => `<div class="head"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${right ? `<div class="row">${right}</div>` : ''}</div>`;
  const kpi = (v, l, cls) => `<div class="kpi ${cls || ''}"><b>${v}</b><span>${l}</span></div>`;
  const hNome = (id) => { const h = horario(id); return h ? h.nome : '—'; };
  const hLabel = (id) => { const h = horario(id); return h ? `<b>${esc(h.nome)}</b> ${estadoPill(h.estado)}` : '—'; };
  const sevPill = (sev) => sev === 'hard' ? '<span class="pill hard">obrigatória</span>' : '<span class="pill soft">qualidade</span>';
  const somenteLeitura = (msg) => `<div class="callout">${msg}</div>`;

  function table(rows, cols, opts) {
    opts = opts || {};
    if (!rows.length) return `<p class="muted">${opts.vazio || 'Sem registos.'}</p>`;
    const rs = opts.max ? rows.slice(0, opts.max) : rows;
    return `<div class="tablewrap"${opts.maxH ? ` style="max-height:${opts.maxH}px"` : ''}><table${opts.cls ? ` class="${opts.cls}"` : ''}><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>`
      + rs.map((r) => `<tr${opts.rowAttr ? ' ' + opts.rowAttr(r) : ''}>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')
      + '</tbody></table></div>' + (rs.length < rows.length ? `<p class="small muted">Mostradas ${rs.length} de ${rows.length}.</p>` : '');
  }

  function violList(vs, opts) {
    opts = opts || {};
    if (!vs.length) return `<p class="muted">${opts.vazio || 'Nenhuma violação.'}</p>`;
    const rs = vs.slice(0, opts.max || 300);
    // No detalhe de uma aula (opts.atual): clicar num aviso mostra as aulas envolvidas, com ligação para cada uma.
    if (opts.atual != null) {
      return `<div class="vlist">${rs.map((v, k) => {
        const chave = `${v.codigo}|${v.msg}`;
        const aberto = st.violSel === chave;
        const ids = [...new Set(v.aulas)];
        const info = aberto && ids.length ? D.q(`SELECT aula_id, uc, uc_nome, turno, dia, inicio, fim, semanas, sala, docente FROM v_aula WHERE aula_id IN (${ids.map(Number).join(',')}) ORDER BY dia, inicio`) : [];
        return `<div class="v ${v.sev}" data-act="viol-ver" data-k="${esc(chave)}" aria-expanded="${aberto}"><div class="rn">${esc(v.nome || v.codigo)}${v.sql ? ' · SQL' : ''}</div>${esc(v.msg)}
          ${aberto ? `<div class="stack" style="margin-top:6px">${info.length ? `<span class="small muted">${info.length > 1 ? 'Aulas envolvidas:' : 'Aula envolvida:'}</span>${info.map((x) => `<button class="btn small" style="text-align:left;white-space:normal" data-act="goto-aula" data-id="${x.aula_id}"${x.aula_id === opts.atual ? ' disabled' : ''}><b>${esc(x.uc)} ${esc(x.turno)}</b> · ${DC[x.dia]} ${hhmm(x.inicio)}–${hhmm(x.fim)} · ${esc(semTxt(x.semanas))}${x.sala ? ' · ' + esc(x.sala) : ''}${x.aula_id === opts.atual ? ' (esta aula)' : ''}</button>`).join('')}` : '<span class="small muted">Este aviso não está ligado a aulas concretas.</span>'}</div>` : '<span class="small muted" style="display:block;margin-top:4px">Clique para ver as aulas envolvidas.</span>'}</div>`;
      }).join('')}</div>` + (vs.length > rs.length ? `<p class="muted small">E mais ${vs.length - rs.length}.</p>` : '');
    }
    return `<div class="vlist">${rs.map((v) => `<div class="v ${v.sev}" ${v.aulas[0] != null && !opts.semLink ? `data-act="goto-aula" data-id="${v.aulas[0]}"` : ''}><div class="rn">${esc(v.nome || v.codigo)}${v.sql ? ' · SQL' : ''}</div>${esc(v.msg)}</div>`).join('')}</div>`
      + (vs.length > rs.length ? `<p class="muted small">E mais ${vs.length - rs.length}.</p>` : '');
  }

  const VIEWS = {}, AFTER = {}, SUBMIT = {};

  /* ===== Gabinete: visão geral ===== */
  function horariosChave() {
    const hs = todosHorarios();
    const base = hs.find((h) => h.origem === 'importado') || hs.find((h) => h.estado === 'publicado') || hs[0];
    const alt = hs.filter((h) => h !== base && h.origem === 'gerado').pop();
    return { base, alt };
  }
  VIEWS.geral = () => {
    const hid = st.horarioId;
    const v = validar(hid);
    const h = horario(hid);
    const n = D.one('SELECT (SELECT COUNT(*) FROM aula WHERE horario_id = ?) a, (SELECT COUNT(*) FROM turma) t, (SELECT COUNT(*) FROM docente) d, (SELECT COUNT(*) FROM sala WHERE ativa = 1) s, (SELECT COUNT(*) FROM uc) u, (SELECT COUNT(*) FROM regra WHERE ativa = 1) r', [hid]);
    const top = Object.entries(v.porRegra).sort((a, b) => (a[1].sev === b[1].sev ? b[1].n - a[1].n : a[1].sev === 'hard' ? -1 : 1));
    const pend = D.one("SELECT COUNT(*) n FROM pedido WHERE estado = 'pendente'").n;
    const rev_ = D.one("SELECT COUNT(*) n FROM horario WHERE estado IN ('em revisao','aprovado')").n;
    const { base, alt } = horariosChave();
    let cmp = '';
    if (base && alt) {
      const ma = metricas(base.id), mb = metricas(alt.id);
      cmp = `<div class="panel"><div class="row"><h3>Horário ISCTE (Manual) e Horário Otimizado</h3><div style="flex:1"></div><button class="btn small" data-act="cmp-chave">Comparar em detalhe</button></div>
        <p class="small muted">${esc(base.nome)} ${estadoPill(base.estado)} face a ${esc(alt.nome)} ${estadoPill(alt.estado)}.</p>
        ${tabelaIndicadores(ma, mb, 'Manual', 'Otimizado')}</div>`;
    }
    return head('Gabinete de horários', 'Visão geral', `Horário ativo: ${hLabel(hid)}`)
      + `<div class="kpis">${kpi(num(n.a, 0), 'aulas semanais no horário')}${kpi(num(v.hard, 0), 'violações de regras obrigatórias', v.hard ? 'hard' : 'ok')}${kpi(num(v.soft, 0), 'violações de critérios de qualidade', v.soft ? 'soft' : 'ok')}${kpi(n.r, 'regras ativas')}${kpi(num(n.t, 0) + ' / ' + n.d, 'turmas / docentes')}${kpi(n.s, 'salas ativas')}</div>`
      + ((pend || rev_) ? `<div class="callout">${pend ? `<b>${pend}</b> pedido(s) de alteração por decidir. ` : ''}${rev_ ? `<b>${rev_}</b> horário(s) em revisão ou aprovados à espera do passo seguinte.` : ''} <button class="btn small" data-act="view" data-k="${pend ? 'pedidos' : 'revisao'}">Abrir</button></div>` : '')
      + cmp
      + `<div class="cols even">
        <div class="panel"><h3>O que o horário ativo viola</h3>${top.length ? table(top.map(([k, x]) => ({ k, ...x })), [{ h: 'Regra', f: (r) => esc(r.nome || r.k) }, { h: 'Tipo', f: (r) => sevPill(r.sev) }, { h: 'Ocorrências', f: (r) => num(r.n, 0), num: true }], { rowAttr: (r) => `class="click" data-act="ver-regra" data-k="${r.k}"` }) : '<p class="muted">Este horário cumpre todas as regras ativas.</p>'}
          <div class="row"><button class="btn primary" data-act="view" data-k="horario">Ver no horário</button><button class="btn" data-act="view" data-k="gerar">Gerar uma alternativa</button></div></div>
        <div class="panel"><h3>Como se chega a um horário publicado</h3>
          <ol class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">
            <li><b>Rascunho</b>: o gabinete importa, cria aulas, gera ou melhora. Cada alteração é validada antes de gravar.</li>
            <li><b>Em revisão</b>: o gabinete submete; a direção de curso vê as violações e aprova ou devolve com comentário.</li>
            <li><b>Aprovado</b>: quem aprova não pode ser quem submeteu (separação de funções).</li>
            <li><b>Publicado</b>: o gabinete publica; o horário anterior do mesmo semestre é arquivado. Docentes e estudantes veem o horário publicado e podem compará-lo com o Horário Otimizado (cenário).</li>
            <li><b>Pedidos de alteração</b>: docentes e direções de curso pedem mudanças; o gabinete decide e aplica numa nova versão.</li>
          </ol>
          <div class="row"><button class="btn" data-act="view" data-k="revisao">Aprovação e publicação</button><button class="btn" data-act="view" data-k="pedidos">Pedidos</button></div></div>
      </div>
      <div class="grid3">
        <div class="panel"><div class="eyebrow">Item 1</div><h3>Fontes de informação</h3><p class="small">Catálogo de fontes, importação dos ficheiros do ISCTE com o calendário de 2022/23 e verificações de qualidade.</p><button class="btn" data-act="view" data-k="fontes">Abrir</button></div>
        <div class="panel"><div class="eyebrow">Item 2</div><h3>Modelo de dados e regras</h3><p class="small">SQLite no browser com ${D.one("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").n} tabelas, características de sala, semanas e feriados, regras parametrizáveis ou escritas em SQL.</p><div class="row"><button class="btn" data-act="view" data-k="dados">Dados</button><button class="btn" data-act="view" data-k="regras">Regras</button></div></div>
        <div class="panel"><div class="eyebrow">Item 3</div><h3>Geração de horários</h3><p class="small">Construção gulosa, arrefecimento simulado, troca de salas e melhoria de salas (Martins, 2014), por curso ou para toda a escola.</p><button class="btn" data-act="view" data-k="gerar">Abrir</button></div>
      </div>`;
  };
  function diffPill(x, y, lowerBetter) {
    const d = y - x;
    if (Math.abs(d) < 1e-9) return '<span class="muted">=</span>';
    const good = lowerBetter ? d < 0 : d > 0;
    return `<span class="pill ${good ? 'ok' : 'hard'}">${d > 0 ? '+' : ''}${num(d, 1)}</span>`;
  }

  /* ===== Fontes e recolha (item 1) ===== */
  const IMPORT_TABLES = ['curso', 'uc', 'plano_estudos', 'turma', 'docente', 'sala', 'sala_caracteristica', 'caracteristica', 'componente', 'turno', 'turno_turma', 'disponibilidade', 'aula', 'reserva', 'feriado'];
  function qualidade() {
    const hid = Number(st.horarioId);
    const checks = [
      ['Turnos sem docente atribuído (distribuição de serviço)', "SELECT u.codigo || ' ' || t.codigo AS x FROM turno t JOIN componente c ON c.id = t.componente_id JOIN uc u ON u.id = c.uc_id WHERE t.docente_id IS NULL"],
      ['Aulas do horário ativo sem sala que precisam de sala', `SELECT uc || ' ' || turno || ' (' || CASE dia WHEN 0 THEN 'Seg' WHEN 1 THEN 'Ter' WHEN 2 THEN 'Qua' WHEN 3 THEN 'Qui' WHEN 4 THEN 'Sex' ELSE 'Sáb' END || ')' AS x FROM v_aula WHERE horario_id = ${hid} AND sala_id IS NULL AND COALESCE(caracteristica_pedida, '') <> '${M.SEM_SALA}'`],
      ['Características pedidas que nenhuma sala ativa tem', `SELECT DISTINCT caracteristica_pedida AS x FROM v_aula v WHERE horario_id = ${hid} AND caracteristica_pedida IS NOT NULL AND caracteristica_pedida NOT IN ('${M.SEM_SALA}', 'Sala/anfiteatro aulas') AND NOT EXISTS (SELECT 1 FROM sala_caracteristica sc JOIN sala s ON s.id = sc.sala_id WHERE s.ativa = 1 AND sc.caracteristica = v.caracteristica_pedida)`],
      ['Salas usadas no horário que não constam da caracterização das salas', "SELECT codigo AS x FROM sala WHERE equipamento LIKE 'Não consta%'"],
      ['Salas sem nenhuma característica registada', 'SELECT codigo AS x FROM sala s WHERE ativa = 1 AND NOT EXISTS (SELECT 1 FROM sala_caracteristica sc WHERE sc.sala_id = s.id)'],
      ['Turmas sem curso associado', 'SELECT codigo AS x FROM turma WHERE curso_id IS NULL'],
      ['Cursos só com sigla (sem nome completo)', 'SELECT sigla AS x FROM curso WHERE nome = sigla'],
      ['Turnos sem inscritos registados', "SELECT u.codigo || ' ' || t.codigo AS x FROM turno t JOIN componente c ON c.id = t.componente_id JOIN uc u ON u.id = c.uc_id WHERE t.inscritos = 0"],
      ['Turnos sem turma associada', "SELECT u.codigo || ' ' || t.codigo AS x FROM turno t JOIN componente c ON c.id = t.componente_id JOIN uc u ON u.id = c.uc_id WHERE NOT EXISTS (SELECT 1 FROM turno_turma x WHERE x.turno_id = t.id)"],
      ['UCs sem ECTS', 'SELECT codigo AS x FROM uc WHERE ects IS NULL'],
    ];
    return checks.map(([nome, sql]) => { try { const rows = D.q(sql); return { nome, n: rows.length, ex: rows.slice(0, 6).map((r) => r.x).join(', ') }; } catch (e) { return { nome, n: 0, ex: 'erro: ' + e.message }; } });
  }
  function relatorioImportacao() {
    let r = null;
    try { r = JSON.parse(M.param(D, 'relatorio_importacao', 'null')); } catch (e) { r = null; }
    if (!r) return '';
    const linhas = [
      ['Linhas do ficheiro do horário (uma por data de aula)', r.linhas],
      ['Linhas sem data ou sem hora (ignoradas)', r.semData],
      ['Linhas fora das 14 semanas do 1.º semestre (ignoradas)', r.foraSemestre],
      ['Aulas semanais criadas (turno, dia, hora, sala e característica pedida)', r.aulas],
      ['Ocorrências de aulas no semestre', r.ocorrencias],
      ['Aulas que só acontecem em algumas semanas', Object.entries(r.semanasPorAula || {}).filter(([k]) => Number(k) < (r.alvo || {}).semanas).reduce((s, [, n]) => s + n, 0)],
      ['Semanas repostas (aula que em 2022/23 caiu num feriado)', r.semanasRecuperadas],
      ['Ocorrências que calham em feriados (aulas perdidas, a repor)', r.emFeriadoAlvo],
      ['Linhas sem sala', r.semSala],
      ['… das quais o docente pediu "Não necessita de sala"', r.semSalaPedidoSemSala],
      ['UCs / turnos / turmas / cursos', `${r.ucs} / ${r.turnos} / ${r.turmas} / ${r.cursos}`],
      ['Salas', r.salas],
    ];
    return `<div class="panel"><h3>Proposta de Horário: o que foi importado</h3>
      <p class="small">Horário de ${esc((r.origem || {}).ano || '2022/23')} no calendário de ${esc((r.alvo || {}).ano || '2022/23')}: cada aula fica na mesma semana do semestre e no mesmo dia da semana (semana 1 começa a ${esc(String((r.alvo || {}).inicio || '').split('-').reverse().join('/'))}). Cada aula guarda as semanas em que acontece.</p>
      ${table(linhas.map(([a, b]) => ({ a, b })), [{ h: 'Item', k: 'a' }, { h: 'N.º', f: (x) => typeof x.b === 'number' ? num(x.b, 0) : esc(x.b), num: true }])}
      ${r.salasForaCadastro && r.salasForaCadastro.length ? `<p class="small"><b>Salas usadas no horário que não estão na caracterização:</b> ${esc(r.salasForaCadastro.join(', '))} (criadas no cadastro e assinaladas).</p>` : ''}
      ${r.pedidasSemSala && r.pedidasSemSala.length ? `<p class="small"><b>Características pedidas que nenhuma sala tem:</b> ${esc(r.pedidasSemSala.join(', '))}.</p>` : ''}</div>`;
  }
  VIEWS.fontes = () => {
    const fontes = D.q('SELECT * FROM fonte ORDER BY id');
    const cnt = (e) => fontes.filter((f) => f.estado === e).length;
    const q = qualidade();
    const estados = ['por pedir', 'pedido', 'recebido', 'importado'];
    const ed = can('dados.editar');
    const metodos = [
      ['Exportação CSV/Excel', 'Completa e fiável', 'Depende de pedido aos serviços; os códigos têm de ser verificados na importação', 'Horário, salas, inscrições, histórico'],
      ['API do sistema académico', 'Atualizada e automatizável', 'Pode não existir ou ser restrita', 'A confirmar com os serviços informáticos'],
      ['Scraping de páginas públicas', 'Não depende de terceiros', 'Frágil a mudanças de página', 'Planos de estudo, horários publicados'],
      ['Entrevistas', 'Captam regras não escritas', 'Subjetivas e demoradas', 'Gabinete de horários, direções de curso'],
      ['Formulário na aplicação', 'Escala para todos os docentes', 'Taxa de resposta', 'Indisponibilidades, pedidos de alteração'],
      ['Análise documental', 'Fonte oficial', 'PDF difícil de processar', 'Calendário escolar, regulamentos'],
    ];
    const imp = st.importRes;
    return head('Item 1', 'Fontes de informação e recolha', 'Onde está cada dado, quem o fornece, como é recolhido, em que tabela do modelo entra e como está a qualidade.')
      + `<div class="kpis">${estados.map((e) => kpi(cnt(e), { 'por pedir': 'fontes por pedir', pedido: 'fontes pedidas', recebido: 'fontes recebidas', importado: 'fontes importadas' }[e], e === 'importado' ? 'ok' : e === 'por pedir' ? 'soft' : '')).join('')}</div>`
      + relatorioImportacao()
      + (ed ? `<div class="panel"><h3>Importar os ficheiros do ISCTE</h3><p class="small muted">Os dois CSV da Proposta de Horário: horário e caracterização das salas (separador ponto e vírgula). A importação substitui a base de dados atual por uma nova, com o horário adaptado ao calendário indicado.</p>
        <div class="formgrid"><label class="f">Horário de exemplo (CSV)<input type="file" id="isc-h" accept=".csv,text/csv"></label><label class="f">Caracterização das salas (CSV)<input type="file" id="isc-s" accept=".csv,text/csv"></label>
        <label class="f">Início do 1.º semestre de destino<input type="date" id="isc-ini" value="${esc(cal().inicio || '2022-09-12')}"></label><label class="f">Ano letivo<input type="text" id="isc-ano" value="${esc(cal().ano_letivo || '2022/23')}"></label></div>
        <div class="row"><button class="btn primary" data-act="isc-import" data-confirm="1">Importar e adaptar</button><span class="small muted">Os feriados de destino são os do calendário atual.</span></div></div>
        <div class="panel"><h3>Docentes do Ciência-Iscte</h3><p class="small muted">Ficheiro JSON criado por <code>tools/docentes-ciencia.js</code> a partir de ciencia.iscte-iul.pt (atividades letivas de 2022/2023, 1.º semestre). Só se usam as UCs que já existem (as do CSV do professor). Quando uma UC tem vários docentes, a divisão dos turnos é uma estimativa sem sobreposições e fica assinalada. Substitui os docentes atuais.</p>
        <div class="formgrid"><label class="f">Ficheiro de docentes (JSON)<input type="file" id="doc-json" accept=".json,application/json"></label></div>
        <div class="row"><button class="btn primary" data-act="doc-import" data-confirm="1">Importar docentes</button></div></div>` : '')
      + `<div class="panel"><h3>Catálogo de fontes</h3><p class="small muted">A coluna "Tabelas" liga cada fonte ao modelo de dados.${ed ? ' Altere o estado à medida que o grupo pede e recebe os dados.' : ''}</p>
        ${table(fontes, [
          { h: 'Informação', f: (r) => `<b>${esc(r.informacao)}</b>` }, { h: 'Tabelas', f: (r) => `<span class="mono">${esc(r.tabelas)}</span>` },
          { h: 'Fonte', k: 'fonte' }, { h: 'Responsável', k: 'responsavel' }, { h: 'Formato', k: 'formato' }, { h: 'Método de recolha', k: 'metodo' },
          { h: 'Periodicidade', k: 'periodicidade' }, { h: 'RGPD', k: 'rgpd' },
          { h: 'Estado', f: (r) => ed ? `<select data-change="fonte-estado" data-id="${r.id}" aria-label="Estado" style="min-width:112px">${estados.map((e) => `<option${e === r.estado ? ' selected' : ''}>${e}</option>`).join('')}</select>` : esc(r.estado) },
        ])}</div>`
      + `<div class="cols even">
        <div class="panel"><h3>Verificações de qualidade</h3><p class="small muted">Lacunas que impedem ou enfraquecem a construção do horário.</p>
          ${table(q, [{ h: 'Verificação', k: 'nome' }, { h: 'Casos', f: (r) => r.n ? `<span class="pill soft">${num(r.n, 0)}</span>` : '<span class="pill ok">0</span>', num: true }, { h: 'Exemplos', f: (r) => `<span class="small">${esc(r.ex)}</span>` }])}
        </div>
        ${ed ? `<div class="panel"><h3>Importar uma tabela (CSV)</h3><p class="small muted">A primeira linha tem os nomes das colunas da tabela. Separador vírgula ou ponto e vírgula.</p>
          <div class="row"><label class="f">Tabela de destino<select id="imp-tab">${IMPORT_TABLES.map((t) => `<option${t === (st.importTab || 'sala') ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="f">Modo<select id="imp-modo"><option value="add">Acrescentar</option><option value="replace">Substituir tudo</option></select></label>
          <label class="f">Ficheiro<input type="file" id="imp-file" accept=".csv,text/csv,text/plain"></label></div>
          <textarea id="imp-csv" rows="7" spellcheck="false">${esc(st.importCsv != null ? st.importCsv : modeloCsv(st.importTab || 'sala'))}</textarea>
          <div class="row"><button class="btn" data-act="imp-modelo">Mostrar modelo da tabela</button><button class="btn primary" data-act="imp-run">Importar</button></div>
          ${imp ? `<div class="callout ${imp.erros.length ? 'warn' : ''}">${imp.ok} linhas importadas para <b>${esc(imp.tab)}</b>.${imp.erros.length ? ' ' + imp.erros.length + ' com erro:<br>' + imp.erros.slice(0, 6).map((e) => esc(e)).join('<br>') : ''}</div>` : ''}
        </div>` : ''}
      </div>
      <div class="panel"><h3>Métodos de recolha</h3>${table(metodos.map((m) => ({ a: m[0], b: m[1], c: m[2], d: m[3] })), [{ h: 'Método', f: (r) => `<b>${esc(r.a)}</b>` }, { h: 'Vantagens', k: 'b' }, { h: 'Desvantagens', k: 'c' }, { h: 'Usar para', k: 'd' }])}</div>`;
  };
  function cols(t) { return D.q(`PRAGMA table_info(${t})`); }
  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function modeloCsv(t) {
    const c = cols(t).filter((x) => !(x.pk && x.type === 'INTEGER' && cols(t).filter((y) => y.pk).length === 1));
    const ex = D.q(`SELECT ${c.map((x) => x.name).join(',')} FROM ${t} LIMIT 2`);
    return [c.map((x) => x.name).join(','), ...ex.map((r) => c.map((x) => csvCell(r[x.name])).join(','))].join('\n');
  }
  function importar() {
    if (!can('dados.editar')) return;
    const tab = $('#imp-tab').value, modo = $('#imp-modo').value, txt = $('#imp-csv').value;
    st.importTab = tab; st.importCsv = txt;
    const rows = IMP.parseCSV(txt.trim()).filter((r) => r.some((x) => x !== ''));
    if (rows.length < 2) { toast('O CSV precisa de uma linha de cabeçalho e pelo menos uma linha de dados.'); return; }
    const valid = new Set(cols(tab).map((c) => c.name));
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const bad = header.filter((h) => !valid.has(h));
    if (bad.length) { toast(`Colunas desconhecidas em ${tab}: ${bad.join(', ')}`); return; }
    let ok = 0; const erros = [];
    D.raw.run('BEGIN');
    try {
      if (modo === 'replace') D.run(`DELETE FROM ${tab}`);
      rows.slice(1).forEach((r, k) => {
        try {
          D.run(`INSERT INTO ${tab} (${header.join(',')}) VALUES (${header.map(() => '?').join(',')})`, header.map((_, i) => { const v = (r[i] || '').trim(); return v === '' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v; }));
          ok++;
        } catch (e) { erros.push(`linha ${k + 2}: ${e.message}`); }
      });
      D.raw.run('COMMIT');
    } catch (e) { D.raw.run('ROLLBACK'); toast('Importação cancelada: ' + e.message); return; }
    st.importRes = { tab, ok, erros };
    changed('Importação CSV', `${ok} linhas em ${tab}${erros.length ? `, ${erros.length} erros` : ''}`);
    render();
  }
  const lerFicheiro = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsText(f, 'utf-8'); });
  async function importarIscte() {
    const fh = $('#isc-h').files[0], fs_ = $('#isc-s').files[0];
    if (!fh || !fs_) { toast('Escolha os dois ficheiros: horário de exemplo e caracterização das salas.'); return; }
    const ini = $('#isc-ini').value || '2022-09-12';
    const ano = ($('#isc-ano').value || '2022/23').trim();
    toast('A importar…');
    try {
      const [th, ts] = await Promise.all([lerFicheiro(fh), lerFicheiro(fs_)]);
      const fer = D.q('SELECT data, nome, tipo FROM feriado').map((f) => [f.data, f.nome, f.tipo]);
      const alvo = Object.assign({}, IMP.CAL_2022, { ano, inicio: ini, feriados: fer.length ? fer : IMP.CAL_2022.feriados, notas: `Início do semestre indicado na importação: ${ini.split('-').reverse().join('/')}.` });
      const r = IMP.iscte(th, ts, { alvo });
      const fontes = D.q('SELECT informacao, tabelas, fonte, responsavel, formato, metodo, periodicidade, rgpd, estado FROM fonte ORDER BY id').map((f) => Object.values(f));
      const lei = r.tables.curso.rows.find((c) => c[1] === 'LEI') || r.tables.curso.rows[0];
      const ds = {
        tables: r.tables, regras: SC.regras(r.regrasOpts), fontes,
        parametros: [['conjunto', 'iscte', 'Conjunto de dados'], ['aulas_em_falta', '0', 'O horário importado é a lista completa de aulas'], ['relatorio_importacao', JSON.stringify(r.relatorio), 'Resumo da importação']],
        contas: { curso: { curso_id: lei && lei[0] } },
        horarios: [{ id: 1, nome: `${ano} · 1.º sem. · importado`, ano_letivo: ano, semestre: 1, origem: 'importado', criado_em: agora(), estado: 'rascunho', criado_por: U.username, notas: `Importado de ${fh.name} e ${fs_.name}.`, aulaCols: r.aulaCols, aulas: r.aulas }],
        registo: [[agora(), U.perfil, 'Importação ISCTE', `${fh.name} + ${fs_.name}: ${r.relatorio.aulas} aulas semanais, ${r.relatorio.salas} salas`, U.username]],
      };
      const novo = M.wrap(new SQL.Database());
      M.seed(novo, ds);
      D = novo; st.ds = 'iscte'; ui.set('ds', 'iscte'); rev++; vcache.clear();
      U = carregarUtilizador(U.username) || null;
      save();
      if (!U) { sair('A importação criou contas novas: entre de novo.'); return; }
      iniciarSessao(); st.view = 'fontes';
      toast(`Importado: ${num(r.relatorio.aulas, 0)} aulas semanais em ${r.relatorio.salas} salas.`); render();
    } catch (e) { console.error(e); toast('Não foi possível importar: ' + e.message); }
  }

  async function importarDocentesCiencia() {
    const f = $('#doc-json').files[0];
    if (!f) { toast('Escolha o ficheiro JSON dos docentes.'); return; }
    try {
      const dados = JSON.parse(await lerFicheiro(f));
      if (!Array.isArray(dados.docentes)) throw new Error('o ficheiro não tem a lista "docentes"');
      const r = M.importarDocentes(D, dados);
      // A conta de demonstração do perfil Docente passa para o docente com mais turnos.
      const top = D.one('SELECT docente_id AS id FROM turno WHERE docente_id IS NOT NULL GROUP BY docente_id ORDER BY COUNT(*) DESC LIMIT 1');
      if (top) D.run("UPDATE utilizador SET docente_id = ? WHERE username = 'docente'", [top.id]);
      changed('Docentes importados', `${f.name}: ${r.docentes} docentes, ${r.ucsComDocente} UCs com docente, ${r.turnosAtribuidos} turnos (${r.turnosEstimados} por estimativa)`);
      toast(`Importados ${r.docentes} docentes: ${r.ucsComDocente} UCs e ${r.turnosAtribuidos} turnos com docente (${r.turnosEstimados} por estimativa). ${r.ucsDoSiteSemCorrespondencia} UCs do site não estão no CSV e foram ignoradas.`);
      render();
    } catch (e) { console.error(e); toast('Não foi possível importar os docentes: ' + e.message); }
  }

  /* ===== Dados e modelo (item 2) ===== */
  const TAB_DESC = {
    curso: 'Cursos e regime (diurno ou pós-laboral)', uc: 'Unidades curriculares', plano_estudos: 'UC em cada curso, ano e semestre',
    turma: 'Grupos de estudantes de um curso; regime diurno ou pós-laboral (PL)', docente: 'Docentes: categoria, departamento, escola, perfil no Ciência-Iscte e carga máxima (minutos/semana)', tipo_sala: 'Tipos de sala (agregados)',
    edificio: 'Edifícios', sala: 'Cadastro de salas', caracteristica: 'Características de sala (equipamento e tipo de espaço) que os docentes podem pedir',
    sala_caracteristica: 'Características de cada sala', tipo_aula: 'Tipos de aula (T, TP, L, ...). PL não é tipo de aula: significa Pós-Laboral (regime da turma)', componente: 'Tipo de aula de uma UC: duração, aulas por semana, participação esperada',
    turno: 'Turno de uma componente, com docente, inscritos e característica de sala pedida', turno_turma: 'Turmas que frequentam cada turno', docencia: 'Docentes de cada UC num ano e semestre (Ciência-Iscte), com indicação de coordenador', horario: 'Versões de horário e estado no fluxo de aprovação',
    aula: 'Uma aula semanal de um turno: dia, hora, sala, semanas em que acontece (máscara) e característica pedida', disponibilidade: 'Indisponibilidades e preferências dos docentes', reserva: 'Reservas de salas fora das aulas',
    calendario: 'Início e número de semanas do semestre', feriado: 'Feriados e dias sem aulas', parametro: 'Parâmetros do conjunto de dados',
    regra: 'Regras de funcionamento e critérios de qualidade', fonte: 'Catálogo de fontes de informação (item 1)', registo: 'Registo de auditoria (só acréscimo)',
    perfil: 'Perfis de utilizador', permissao: 'Permissões', perfil_permissao: 'Matriz de permissões por perfil', utilizador: 'Contas (só hash da senha)', pedido: 'Pedidos de alteração e decisões',
  };
  const PROTEGIDAS = new Set(['utilizador', 'perfil_permissao', 'permissao', 'perfil', 'registo']);
  const userTables = () => D.q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
  const LABEL_COL = { curso: 'sigla', uc: 'codigo', turma: 'codigo', docente: 'nome', sala: 'codigo', tipo_sala: 'nome', edificio: 'nome', tipo_aula: 'nome', horario: 'nome', perfil: 'nome', componente: null, turno: null, caracteristica: 'nome' };
  function fkOptions(t) {
    if (t === 'componente') return D.q("SELECT c.id, u.codigo || ' ' || c.tipo_aula_id AS l FROM componente c JOIN uc u ON u.id = c.uc_id ORDER BY u.codigo");
    if (t === 'turno') return D.q("SELECT t.id, u.codigo || ' ' || t.codigo AS l FROM turno t JOIN componente c ON c.id = t.componente_id JOIN uc u ON u.id = c.uc_id ORDER BY u.codigo, t.codigo");
    if (t === 'caracteristica') return D.q('SELECT nome AS id, nome AS l FROM caracteristica ORDER BY nome');
    const lc = LABEL_COL[t];
    if (lc === undefined) return null;
    const pk = t === 'tipo_sala' || t === 'edificio' || t === 'tipo_aula' || t === 'perfil' ? 'id' : 'id';
    return D.q(`SELECT ${pk} AS id, ${lc} AS l FROM ${t} ORDER BY ${lc}`);
  }
  VIEWS.dados = () => {
    const tabs = [['tabelas', 'Tabelas'], ['modelo', 'Diagrama ER'], ['dicionario', 'Dicionário de dados'], ['sql', 'Consola SQL']];
    let body = '';
    if (st.dadosTab === 'tabelas') body = tabelaEditor(st.tabela, true, can('dados.editar') && !PROTEGIDAS.has(st.tabela));
    if (st.dadosTab === 'modelo') body = `<div class="panel"><p class="small muted">Gerado a partir do esquema real da base de dados.</p><div class="tablewrap er">${erSvg()}</div></div>`;
    if (st.dadosTab === 'dicionario') body = dicionario();
    if (st.dadosTab === 'sql') body = consola();
    return head('Item 2', 'Dados e modelo', 'Base de dados SQLite a correr no browser. ' + (can('dados.editar') ? 'Consulte e altere os dados diretamente ou por SQL.' : 'O seu perfil só pode consultar.'))
      + `<div class="tabs" role="tablist">${tabs.map(([k, n]) => `<button role="tab" aria-selected="${st.dadosTab === k}" data-act="dados-tab" data-k="${k}">${n}</button>`).join('')}</div>` + body;
  };
  function tabelaEditor(t, escolher, podeEditar, filtroSql) {
    const cs = cols(t);
    const fks = {};
    for (const f of D.q(`PRAGMA foreign_key_list(${t})`)) fks[f.from] = f.table;
    const fkOpt = {};
    for (const c in fks) { const o = fkOptions(fks[c]); fkOpt[c] = o && o.length <= 200 ? o : null; }
    const busca = (st.tabelaBusca || '').toLowerCase();
    let rows = D.q(`SELECT rowid AS __rowid, * FROM ${t}${filtroSql ? ' WHERE ' + filtroSql : ''} LIMIT ${busca ? 20000 : 300}`);
    if (busca) rows = rows.filter((r) => cs.some((c) => String(r[c.name] == null ? '' : r[c.name]).toLowerCase().includes(busca))).slice(0, 300);
    const total = D.one(`SELECT COUNT(*) n FROM ${t}${filtroSql ? ' WHERE ' + filtroSql : ''}`).n;
    const hidden = t === 'utilizador' ? new Set(['sal', 'hash']) : new Set();
    const vcs = cs.filter((c) => !hidden.has(c.name));
    const editCell = (r, c) => {
      const v = r[c.name];
      if (!podeEditar || c.pk) return `<span class="${c.pk ? 'mono' : ''}">${esc(fkOpt[c.name] ? ((fkOpt[c.name].find((o) => String(o.id) === String(v)) || {}).l || v) : v)}</span>`;
      const a = `data-change="cell" data-t="${t}" data-c="${c.name}" data-rid="${r.__rowid}" aria-label="${c.name}"`;
      if (fkOpt[c.name]) return `<select ${a}><option value="">—</option>${fkOpt[c.name].map((o) => `<option value="${esc(o.id)}"${String(o.id) === String(v) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
      return `<input type="text" ${a} value="${esc(v)}">`;
    };
    const novos = vcs.filter((c) => !(c.pk && c.type === 'INTEGER' && cs.filter((x) => x.pk).length === 1));
    return `<div class="panel">
      <div class="row">${escolher ? `<label class="f">Tabela<select data-change="tabela">${userTables().map((x) => `<option${x === t ? ' selected' : ''}>${x}</option>`).join('')}</select></label>` : ''}
      <label class="f">Procurar<input type="search" id="tab-busca" value="${esc(st.tabelaBusca)}" placeholder="texto em qualquer coluna"></label>
      <div class="spacer" style="flex:1"></div><span class="muted small">${rows.length} de ${num(total, 0)} registos${rows.length < total && !busca ? ' (use a pesquisa)' : ''}</span>
      <button class="btn" data-act="csv-out" data-t="${t}">Exportar CSV</button></div>
      ${TAB_DESC[t] ? `<p class="small muted">${esc(TAB_DESC[t])}${!podeEditar ? ' · só consulta' : ''}</p>` : ''}
      ${st.csvOut && st.csvOut.t === t ? `<div class="stack"><textarea rows="6" readonly id="csv-out">${esc(st.csvOut.txt)}</textarea><div class="row"><button class="btn small" data-act="copy" data-src="csv-out">Copiar</button><button class="btn small" data-act="csv-close">Fechar</button></div></div>` : ''}
      <div class="tablewrap" style="max-height:520px"><table><thead><tr>${vcs.map((c) => `<th>${esc(c.name)}${fks[c.name] ? ` <span class="muted">→ ${fks[c.name]}</span>` : ''}</th>`).join('')}${podeEditar ? '<th></th>' : ''}</tr></thead><tbody>
      ${podeEditar ? `<tr>${vcs.map((c) => `<td>${novos.includes(c) ? (fkOpt[c.name] ? `<select data-new="${c.name}" aria-label="novo ${c.name}"><option value="">—</option>${fkOpt[c.name].map((o) => `<option value="${esc(o.id)}">${esc(o.l)}</option>`).join('')}</select>` : `<input type="text" data-new="${c.name}" placeholder="${esc(c.name)}" aria-label="novo ${c.name}">`) : '<span class="muted small">auto</span>'}</td>`).join('')}<td><button class="btn small primary" data-act="row-add" data-t="${t}">Acrescentar</button></td></tr>` : ''}
      ${rows.map((r) => `<tr>${vcs.map((c) => `<td>${editCell(r, c)}</td>`).join('')}${podeEditar ? `<td><button class="btn small danger" data-act="row-del" data-t="${t}" data-rid="${r.__rowid}" data-confirm="1">Apagar</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function dicionario() {
    const fonteDe = {};
    for (const f of D.q('SELECT informacao, tabelas FROM fonte')) for (const t of String(f.tabelas || '').split(/[,\s]+/)) { const k = t.split('.')[0].replace(/\(.*$/, ''); if (k) (fonteDe[k] = fonteDe[k] || []).push(f.informacao); }
    return userTables().map((t) => {
      const fks = {}; for (const f of D.q(`PRAGMA foreign_key_list(${t})`)) fks[f.from] = f.table + '.' + f.to;
      return `<div class="panel"><div class="row"><h3 class="mono">${t}</h3><span class="muted small">${esc(TAB_DESC[t] || '')}</span></div>
        ${fonteDe[t] ? `<p class="small">Fonte: ${esc(fonteDe[t].join('; '))}</p>` : ''}
        ${table(cols(t), [{ h: 'Coluna', f: (c) => `<span class="mono">${esc(c.name)}</span>` }, { h: 'Tipo', f: (c) => esc(c.type) }, { h: 'Obrigatória', f: (c) => (c.notnull || c.pk ? 'sim' : '') }, { h: 'Chave', f: (c) => (c.pk ? '<span class="pill acc">PK</span> ' : '') + (fks[c.name] ? `<span class="pill">FK → ${esc(fks[c.name])}</span>` : '') }, { h: 'Predefinição', f: (c) => `<span class="mono small">${esc(c.dflt_value)}</span>` }])}</div>`;
    }).join('');
  }
  function erSvg() {
    const layout = [['curso', 'plano_estudos', 'uc', 'componente', 'tipo_aula'], ['turma', 'turno_turma', 'turno', 'docente', 'docencia', 'disponibilidade'], ['horario', 'aula', 'sala', 'sala_caracteristica', 'caracteristica', 'tipo_sala', 'edificio', 'reserva'],
      ['calendario', 'feriado', 'regra', 'fonte', 'parametro'], ['utilizador', 'perfil', 'perfil_permissao', 'permissao', 'pedido', 'registo']];
    const all = userTables();
    const extra = all.filter((t) => !layout.flat().includes(t));
    if (extra.length) layout.push(extra);
    const W = 210, gapX = 70, rowH = 15, headH = 22, gapY = 22;
    const box = {};
    let maxH = 0;
    layout.forEach((col, ci) => {
      let yy = 10;
      for (const t of col) {
        if (!all.includes(t)) continue;
        const cs = cols(t);
        const hgt = headH + cs.length * rowH + 6;
        box[t] = { x: 10 + ci * (W + gapX), y: yy, h: hgt, cs };
        yy += hgt + gapY;
      }
      maxH = Math.max(maxH, yy);
    });
    let s = '', lines = '';
    for (const t in box) {
      const b = box[t];
      s += `<g><rect x="${b.x}" y="${b.y}" width="${W}" height="${b.h}" rx="6" fill="var(--surface)" stroke="var(--line)"/><rect x="${b.x}" y="${b.y}" width="${W}" height="${headH}" rx="6" fill="var(--accent-soft)"/><text x="${b.x + 8}" y="${b.y + 15}" font-size="12" font-weight="600" fill="var(--ink)">${t}</text>`;
      b.cs.forEach((c, i) => { s += `<text x="${b.x + 8}" y="${b.y + headH + 12 + i * rowH}" font-size="10.5" fill="${c.pk ? 'var(--accent)' : 'var(--ink-2)'}">${c.pk ? '◆ ' : ''}${esc(c.name)}<tspan fill="var(--ink-3)"> ${esc((c.type || '').toLowerCase())}</tspan></text>`; });
      s += '</g>';
      for (const f of D.q(`PRAGMA foreign_key_list(${t})`)) {
        const tb = box[f.table]; if (!tb) continue;
        const i = b.cs.findIndex((c) => c.name === f.from);
        const y1 = b.y + headH + 8 + i * rowH, y2 = tb.y + headH / 2;
        let x1, x2;
        if (tb.x > b.x) { x1 = b.x + W; x2 = tb.x; } else if (tb.x < b.x) { x1 = b.x; x2 = tb.x + W; } else { x1 = b.x + W; x2 = tb.x + W; }
        const cx = tb.x === b.x ? x1 + 40 : (x1 + x2) / 2;
        lines += `<path d="M${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}" fill="none" stroke="var(--ink-3)" stroke-width="1.2" opacity="0.7"/><circle cx="${x2}" cy="${y2}" r="3" fill="var(--ink-3)"/>`;
      }
    }
    const width = 10 + layout.length * (W + gapX);
    return `<svg viewBox="0 0 ${width} ${maxH}" width="${width}" height="${maxH}" role="img" aria-label="Diagrama entidade-relação">${lines}${s}</svg>`;
  }
  const EXEMPLOS_SQL = [
    ['Horário de uma turma', "SELECT turma, uc, tipo_aula, dia, inicio, sala, semanas\nFROM v_aula_turma\nWHERE horario_id = 1 AND turma = (SELECT codigo FROM turma LIMIT 1)\nORDER BY dia, inicio;"],
    ['Ocupação por sala (horas semanais)', 'SELECT sala, COUNT(*) AS aulas, SUM(duracao) / 60.0 AS horas\nFROM v_aula WHERE horario_id = 1 AND sala IS NOT NULL\nGROUP BY sala ORDER BY horas DESC;'],
    ['Pedidos de sala não cumpridos', "SELECT uc, turno, caracteristica_pedida, sala\nFROM v_aula\nWHERE horario_id = 1 AND sala_id IS NOT NULL AND tem_caracteristica = 0\n  AND caracteristica_pedida NOT IN ('Não necessita de sala', 'Sala/anfiteatro aulas');"],
    ['Salas com cada característica', 'SELECT caracteristica, COUNT(*) AS salas, group_concat(s.codigo, \', \') AS lista\nFROM sala_caracteristica sc JOIN sala s ON s.id = sc.sala_id\nGROUP BY caracteristica ORDER BY salas;'],
    ['Aulas que só acontecem em algumas semanas', 'SELECT uc, turno, dia, inicio, semanas\nFROM v_aula WHERE horario_id = 1 AND semanas <> 16383\nLIMIT 100;'],
    ['Nova coluna: sala acessível', "ALTER TABLE sala ADD COLUMN acessivel INTEGER DEFAULT 1;\nSELECT codigo, acessivel FROM sala;"],
  ];
  function consola() {
    const r = st.sqlRes;
    let out = '';
    if (r) {
      if (r.erro) out = `<div class="callout warn mono">${esc(r.erro)}</div>`;
      else out = r.sets.map((set) => `<div class="tablewrap" style="max-height:420px"><table><thead><tr>${set.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${set.values.slice(0, 500).map((v) => `<tr>${v.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">${set.values.length} linhas</p>`).join('') || `<p class="muted">Comando executado. ${r.mod} linhas alteradas.</p>`;
    }
    return `<div class="panel"><div class="row"><label class="f">Exemplos<select data-change="sql-ex"><option value="">Escolher…</option>${EXEMPLOS_SQL.map((e, i) => `<option value="${i}">${esc(e[0])}</option>`).join('')}</select></label>
      <p class="small muted">Vistas úteis: <code>v_aula</code> e <code>v_aula_turma</code>. Ctrl+Enter executa.${can('dados.editar') ? '' : ' O seu perfil só pode executar consultas (SELECT).'} As tabelas de contas e permissões só se alteram pela administração.</p></div>
      <textarea id="sql" rows="8" spellcheck="false">${esc(st.sql)}</textarea>
      <div class="row"><button class="btn primary" data-act="sql-run">Executar</button></div>${out}</div>`;
  }
  function runSql() {
    st.sql = $('#sql').value;
    const leitura = /^\s*(select|with|pragma|explain)\b/i.test(st.sql) && !/;\s*\S/.test(st.sql.trim().replace(/;\s*$/, ''));
    if (!leitura && !can('dados.editar')) { st.sqlRes = { erro: 'Sem permissão: o seu perfil só pode executar uma consulta SELECT.' }; render(); return; }
    if (!leitura && /\b(utilizador|perfil_permissao|permissao|perfil)\b/i.test(st.sql) && /\b(insert|update|delete|drop|alter|replace)\b/i.test(st.sql)) { st.sqlRes = { erro: 'As contas e permissões só se alteram na área de Administração.' }; render(); return; }
    try {
      const sets = D.exec(st.sql);
      const mod = D.raw.getRowsModified();
      st.sqlRes = { sets, mod };
      if (!leitura) changed('SQL executado', st.sql.slice(0, 200));
    } catch (e) { st.sqlRes = { erro: e.message }; }
    render();
  }

  /* ===== Gestão académica (escopo: professores, UCs, turmas) ===== */
  VIEWS.academica = () => {
    const tabs = [['docente', 'Professores'], ['uc', 'Unidades curriculares'], ['turma', 'Turmas'], ['curso', 'Cursos'], ['turno', 'Turnos'], ['componente', 'Tipos de aula das UCs']];
    // Direção de curso: só a informação do seu curso (turmas, turnos dessas turmas, UCs e docentes desses turnos).
    const cid = !can('dados.ver') && U.curso_id ? Number(U.curso_id) : null;
    const tc = cid ? `SELECT tt.turno_id FROM turno_turma tt JOIN turma tm ON tm.id = tt.turma_id WHERE tm.curso_id = ${cid}` : null;
    const uc = cid ? `SELECT c.uc_id FROM componente c JOIN turno tu ON tu.componente_id = c.id WHERE tu.id IN (${tc})` : null;
    const filtros = cid ? { docente: `id IN (SELECT docente_id FROM turno WHERE id IN (${tc}))`, uc: `id IN (${uc})`, turma: `curso_id = ${cid}`, curso: `id = ${cid}`, turno: `id IN (${tc})`, componente: `uc_id IN (${uc})` } : {};
    const w = (k, extra) => (filtros[k] ? ` WHERE ${filtros[k]}${extra ? ' AND ' + extra : ''}` : (extra ? ' WHERE ' + extra : ''));
    const n = D.one(`SELECT (SELECT COUNT(*) FROM docente${w('docente')}) d, (SELECT COUNT(*) FROM uc${w('uc')}) u, (SELECT COUNT(*) FROM turma${w('turma')}) t, (SELECT COUNT(*) FROM curso${w('curso')}) c, (SELECT COUNT(*) FROM turno${w('turno')}) tu, (SELECT COUNT(*) FROM turno${w('turno', 'docente_id IS NULL')}) sd`);
    const ed = can('dados.editar');
    const t = tabs.some((x) => x[0] === st.acadTab) ? st.acadTab : 'docente';
    const cs = cid ? (D.one('SELECT sigla FROM curso WHERE id = ?', [cid]) || {}).sigla : null;
    return head('Gestão académica', 'Professores, UCs e turmas', (cs ? `Informação do curso ${esc(cs)}: ` : '') + 'O registo de que o horário precisa: quem ensina, o que se ensina e a quem.' + (ed ? '' : ' O seu perfil só pode consultar.'))
      + `<div class="kpis">${kpi(n.d, 'professores')}${kpi(num(n.u, 0), 'unidades curriculares')}${kpi(num(n.t, 0), 'turmas')}${kpi(n.c, 'cursos')}${kpi(num(n.tu, 0), 'turnos')}${kpi(num(n.sd, 0), 'turnos sem professor', n.sd ? 'soft' : 'ok')}</div>`
      + (conjunto() === 'iscte' && n.sd ? '<div class="callout warn">Os docentes vêm do Ciência-Iscte (atividades letivas de 2022/23, 1.º semestre). Os turnos sem professor são de UCs sem docente nesse site; pode associá-los aqui (Turnos, coluna docente_id) ou ao criar uma aula. Nas UCs com vários docentes, a divisão dos turnos é uma estimativa.</div>' : '')
      + `<div class="tabs" role="tablist">${tabs.map(([k, nn]) => `<button role="tab" aria-selected="${t === k}" data-act="acad-tab" data-k="${k}">${nn}</button>`).join('')}</div>`
      + tabelaEditor(t, false, ed, filtros[t]);
  };

  /* ===== Regras ===== */
  VIEWS.regras = () => {
    const regras = D.q('SELECT * FROM regra ORDER BY implementacao, severidade, id');
    const v = validar(st.horarioId);
    const ed = can('regras.editar');
    const dis = ed ? '' : ' disabled';
    const nr = st.novaRegra || { codigo: 'SQL_', nome: '', descricao: '', severidade: 'soft', peso: 1, sql: "SELECT aula_id, uc || ' ' || turno || ': ...' AS mensagem\nFROM v_aula\nWHERE horario_id = :horario AND inicio < 540" };
    const card = (r) => `<div class="panel" id="regra-${r.codigo}">
      <div class="row"><span class="mono small muted">${esc(r.codigo)}</span>${sevPill(r.severidade)}<span class="pill">${r.implementacao === 'sql' ? 'SQL' : 'motor'}</span>${r.origem ? `<span class="pill">${esc(r.origem)}</span>` : ''}<span class="muted small">v${r.versao}</span>
        <div style="flex:1"></div>${v.porRegra[r.codigo] ? `<span class="pill ${r.severidade}">${num(v.porRegra[r.codigo].n, 0)} no horário ativo</span>` : r.ativa ? '<span class="pill ok">cumprida</span>' : ''}</div>
      <h3>${esc(r.nome)}</h3><p class="small">${esc(r.descricao)}</p>
      <div class="row" style="align-items:end">
        <label class="chk" style="padding-bottom:6px"><input type="checkbox" data-change="regra" data-id="${r.id}" data-c="ativa"${r.ativa ? ' checked' : ''}${dis}> Ativa</label>
        <label class="f">Tipo<select data-change="regra" data-id="${r.id}" data-c="severidade"${dis}><option value="hard"${r.severidade === 'hard' ? ' selected' : ''}>Obrigatória</option><option value="soft"${r.severidade === 'soft' ? ' selected' : ''}>Qualidade</option></select></label>
        <label class="f">Peso<input type="number" min="0" step="0.5" style="width:80px" data-change="regra" data-id="${r.id}" data-c="peso" value="${r.peso}"${dis}></label>
      </div>
      ${r.implementacao === 'motor' ? (r.parametros && r.parametros !== '{}' ? `<label class="f">Parâmetros (JSON)<textarea rows="${Math.min(8, JSON.stringify(JSON.parse(r.parametros), null, 1).split('\n').length)}" data-change="regra" data-id="${r.id}" data-c="parametros" spellcheck="false"${ed ? '' : ' readonly'}>${esc(JSON.stringify(JSON.parse(r.parametros), null, 1))}</textarea></label>` : '')
        : `<label class="f">Consulta SQL<textarea rows="4" data-change="regra" data-id="${r.id}" data-c="sql" spellcheck="false"${ed ? '' : ' readonly'}>${esc(r.sql)}</textarea></label>${ed ? `<div class="row"><button class="btn small danger" data-act="regra-del" data-id="${r.id}" data-confirm="1">Apagar regra</button></div>` : ''}`}
    </div>`;
    return head('Item 2', 'Regras de funcionamento', 'As regras são dados, não código: cada uma tem parâmetros, tipo e peso que podem mudar sem reprogramar a aplicação.' + (ed ? '' : ' O seu perfil só pode consultar.'))
      + `<div class="callout">Três formas de evoluir as regras: <b>mudar parâmetros</b> (por exemplo, o máximo de horas seguidas da mesma UC, ou as características de sala que são obrigatórias), <b>mudar o tipo ou o peso</b> e <b>criar regras novas em SQL</b> sobre as vistas <code>v_aula</code> e <code>v_aula_turma</code>. As características pedidas pelos docentes entram em duas regras: <b>CARACT_ESSENCIAL</b> (laboratórios e salas especializadas, obrigatória) e <b>CARACTERISTICA</b> (as restantes, com salas equivalentes a custo reduzido).</div>`
      + `<div class="grid3">${regras.map(card).join('')}</div>`
      + (ed ? `<div class="panel"><h3>Nova regra em SQL</h3><p class="small muted">A consulta recebe <code>:horario</code> e devolve uma linha por violação, com as colunas <code>aula_id</code> e <code>mensagem</code>.</p>
        <div class="row"><label class="f">Código<input type="text" id="nr-codigo" value="${esc(nr.codigo)}"></label><label class="f" style="flex:1;min-width:200px">Nome<input type="text" id="nr-nome" value="${esc(nr.nome)}" placeholder="Ex.: Aulas antes das 9h"></label>
        <label class="f">Tipo<select id="nr-sev"><option value="soft">Qualidade</option><option value="hard"${nr.severidade === 'hard' ? ' selected' : ''}>Obrigatória</option></select></label><label class="f">Peso<input type="number" id="nr-peso" value="${esc(nr.peso)}" style="width:80px"></label></div>
        <label class="f">Descrição<input type="text" id="nr-desc" value="${esc(nr.descricao)}"></label>
        <textarea id="nr-sql" rows="5" spellcheck="false">${esc(nr.sql)}</textarea>
        <div class="row"><button class="btn" data-act="nr-test">Testar no horário ativo</button><button class="btn primary" data-act="nr-save">Guardar regra</button></div>
        ${nr.teste ? `<div class="callout ${nr.teste.erro ? 'warn' : ''}">${nr.teste.erro ? esc(nr.teste.erro) : `${nr.teste.rows.length} violações encontradas.${nr.teste.rows.slice(0, 5).map((r) => '<br>• ' + esc(r.mensagem)).join('')}`}</div>` : ''}</div>` : '');
  };
  function lerNovaRegra() {
    st.novaRegra = { codigo: $('#nr-codigo').value.trim().toUpperCase(), nome: $('#nr-nome').value.trim(), descricao: $('#nr-desc').value.trim(), severidade: $('#nr-sev').value, peso: Number($('#nr-peso').value) || 1, sql: $('#nr-sql').value };
    return st.novaRegra;
  }

  /* ===== Calendário ===== */
  VIEWS.calendario = () => {
    const c = cal();
    const ed = can('dados.editar');
    const hid = st.horarioId;
    const aulas = hid != null ? D.q('SELECT dia, semanas FROM aula WHERE horario_id = ?', [hid]) : [];
    const impacto = c.feriadosLista.map((f) => ({ ...f, n: aulas.filter((a) => a.dia === f.dia && (a.semanas & (1 << (f.semana - 1)))).length }));
    let rel = null; try { rel = JSON.parse(M.param(D, 'relatorio_importacao', 'null')); } catch (e) { rel = null; }
    const semanas = [];
    for (let w = 1; w <= c.semanas; w++) {
      const fs = c.feriadosLista.filter((f) => f.semana === w);
      semanas.push({ w, de: dmy(c.data(w, 0)), ate: dmy(c.data(w, 5)), n: aulas.filter((a) => a.semanas & (1 << (w - 1))).length, fer: fs.map((f) => `${DC[f.dia]} ${f.nome}`).join('; ') });
    }
    return head('Dados', 'Calendário do semestre', `${esc(c.ano_letivo)}, ${c.semestre}.º semestre: ${c.semanas} semanas a partir de ${esc(String(c.inicio).split('-').reverse().join('/'))}.`)
      + (c.notas ? `<div class="callout warn">${esc(c.notas)}</div>` : '')
      + (rel ? `<div class="panel"><h3>Adaptação da Proposta de Horário (${esc(rel.origem.ano)} → ${esc(rel.alvo.ano)})</h3><p class="small">A semana 1 de ${esc(rel.origem.ano)} começou a ${esc(rel.origem.inicio.split('-').reverse().join('/'))}; a de ${esc(rel.alvo.ano)} começa a ${esc(String(c.inicio).split('-').reverse().join('/'))}. Cada aula fica na mesma semana do semestre e no mesmo dia da semana. Em ${esc(rel.origem.ano)} houve feriados à quarta (5/10) e à terça e quinta (1/11, 1/12, 8/12): ${num(rel.semanasRecuperadas, 0)} aulas que tinham sido saltadas nesses dias voltam a acontecer em ${esc(rel.alvo.ano)}. Em ${esc(rel.alvo.ano)} os feriados caem noutros dias (ver abaixo) e ${num(rel.emFeriadoAlvo, 0)} ocorrências passam a calhar em feriado: a regra FERIADOS assinala-as para reposição.</p></div>` : '')
      + `<div class="cols even"><div class="panel"><h3>Semestre</h3>
          ${ed ? `<div class="formgrid"><label class="f">Ano letivo<input type="text" id="cal-ano" value="${esc(c.ano_letivo)}"></label><label class="f">Início (segunda-feira)<input type="date" id="cal-ini" value="${esc(c.inicio)}"></label><label class="f">Semanas<input type="number" id="cal-sem" min="1" max="30" value="${c.semanas}"></label></div>
          <label class="f">Notas<input type="text" id="cal-notas" value="${esc(c.notas || '')}"></label><div class="row"><button class="btn primary" data-act="cal-save">Guardar calendário</button><span class="small muted">As aulas mantêm as semanas do semestre; mudam as datas.</span></div>` : `<p class="small">Início: ${esc(c.inicio)} · ${c.semanas} semanas</p>`}
        </div>
        <div class="panel"><h3>Feriados e dias sem aulas</h3>
          ${table(c.todos.map((f) => ({ ...f, imp: impacto.find((x) => x.data === f.data) })), [{ h: 'Data', f: (r) => `<span class="mono">${esc(r.data.split('-').reverse().join('/'))}</span>` }, { h: 'Nome', k: 'nome' }, { h: 'Tipo', k: 'tipo' }, { h: 'Aulas afetadas', f: (r) => r.imp ? `${DC[r.imp.dia]}, semana ${r.imp.semana}: <b>${num(r.imp.n, 0)}</b>` : '<span class="muted">fora do semestre ou ao domingo</span>' }, ...(ed ? [{ h: '', f: (r) => `<button class="btn small danger" data-act="fer-del" data-id="${esc(r.data)}" data-confirm="1">Apagar</button>` }] : [])])}
          ${ed ? '<div class="row"><input type="date" id="fer-data" aria-label="Data"><input type="text" id="fer-nome" placeholder="Nome" aria-label="Nome"><select id="fer-tipo" aria-label="Tipo"><option>feriado</option><option>pausa letiva</option><option>evento</option></select><button class="btn" data-act="fer-add">Acrescentar</button></div>' : ''}
        </div></div>`
      + `<div class="panel"><h3>Semanas</h3><p class="small muted">Aulas semanais do horário ativo que acontecem em cada semana.</p>${table(semanas, [{ h: 'Semana', k: 'w', num: true }, { h: 'Segunda a sábado', f: (r) => `${r.de} – ${r.ate}` }, { h: 'Aulas', f: (r) => num(r.n, 0), num: true }, { h: 'Feriados', k: 'fer' }])}</div>`;
  };

  /* ===== Horário e violações ===== */
  function filtroOpts(f, prefixo) {
    const lists = {
      turma: () => optList(turmasAll(), 'id', (r) => `${r.codigo} (${r.sigla})`, f.id), docente: () => optList(docentesAll(), 'id', 'nome', f.id),
      sala: () => optList(salasAll(), 'id', (r) => `${r.codigo} · ${r.capacidade} lugares`, f.id), uc: () => optList(D.q("SELECT id, codigo, nome FROM uc ORDER BY nome"), 'id', (r) => `${r.nome} (${r.codigo})`, f.id),
      curso: () => optList(D.q('SELECT * FROM curso ORDER BY sigla'), 'id', (r) => r.nome !== r.sigla ? `${r.sigla} · ${r.nome}` : r.sigla, f.id),
    };
    return `<label class="f">Ver por<select data-change="${prefixo}-tipo">${[['turma', 'Turma'], ['docente', 'Professor'], ['sala', 'Sala'], ['uc', 'UC'], ['curso', 'Curso']].map(([k, n]) => `<option value="${k}"${k === f.tipo ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f">&nbsp;<select data-change="${prefixo}-id" style="max-width:280px">${lists[f.tipo]()}</select></label>`;
  }
  function manchaPara(filtro) {
    if (filtro.tipo === 'turma') { const t = D.one("SELECT COALESCE(t.regime, c.regime, 'diurno') regime FROM turma t LEFT JOIN curso c ON c.id = t.curso_id WHERE t.id = ?", [filtro.id]); return t ? mancha(t.regime) : null; }
    if (filtro.tipo === 'curso') { const c = D.one('SELECT regime FROM curso WHERE id = ?', [filtro.id]); return c ? mancha(c.regime) : null; }
    return null;
  }
  const primeiroDe = { turma: 'SELECT id FROM turma ORDER BY codigo', docente: 'SELECT id FROM docente ORDER BY nome', sala: 'SELECT id FROM sala ORDER BY codigo', uc: 'SELECT id FROM uc ORDER BY nome', curso: 'SELECT id FROM curso ORDER BY sigla' };
  VIEWS.horario = () => {
    const hid = st.horarioId;
    if (hid == null) return head('Item 2', 'Horário e violações', 'Não há horários. Gere um em "Gerar horário".');
    const v = validar(hid);
    const h = horario(hid);
    const ed = editavel(h);
    const aulas = aulasDe(hid, st.filtro);
    const ids = new Set(aulas.map((a) => a.aula_id));
    let vs = v.violacoes.filter((x) => !x.erro);
    if (st.vfiltro === 'vista') vs = vs.filter((x) => x.aulas.some((id) => ids.has(id)));
    else if (st.vfiltro === 'hard' || st.vfiltro === 'soft') vs = vs.filter((x) => x.sev === st.vfiltro);
    else if (st.vfiltro && st.vfiltro.startsWith('r:')) vs = vs.filter((x) => x.codigo === st.vfiltro.slice(2));
    vs.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'hard' ? -1 : 1));
    const sel = st.sel != null ? D.one(AULAS_SQL + ' AND v.aula_id = ?', [hid, st.sel]) : null;
    const regrasV = Object.entries(v.porRegra).sort((a, b) => b[1].n - a[1].n);
    return head('Item 2', 'Horário e violações', `${hLabel(hid)} · <span class="muted">${esc(h.origem)}</span>`,
      (ed ? `<button class="btn" data-act="undo"${st.undo.length ? '' : ' disabled'}>Desfazer</button><button class="btn" data-act="view" data-k="criar">Criar aula</button>` : '')
      + (h.estado === 'rascunho' && can('horario.submeter') ? '<button class="btn primary" data-act="wf" data-a="submeter">Submeter para revisão</button>' : '')
      + (can('horario.editar') && h.estado !== 'rascunho' ? '<button class="btn" data-act="wf" data-a="nova">Nova versão em rascunho</button>' : '')
      + '<button class="btn" data-act="csv-aulas">Exportar CSV (ISCTE)</button>'
      + (ed ? '<button class="btn danger" data-act="h-del" data-confirm="1">Apagar</button>' : ''))
      + (!ed ? `<div class="callout">${h.estado === 'rascunho' ? 'O seu perfil pode consultar este horário, mas não alterá-lo.' : `Este horário está <b>${ESTADOS[h.estado]}</b>: só se alteram horários em rascunho.${can('horario.editar') ? ' Crie uma nova versão em rascunho para fazer alterações; a publicada fica intacta até a nova ser aprovada e publicada.' : ''}`}</div>` : '')
      + `<div class="kpis">${kpi(num(D.one('SELECT COUNT(*) n FROM aula WHERE horario_id = ?', [hid]).n, 0), 'aulas semanais')}${kpi(num(v.hard, 0), 'violações obrigatórias', v.hard ? 'hard' : 'ok')}${kpi(num(v.soft, 0), 'violações de qualidade', v.soft ? 'soft' : 'ok')}${kpi(num(v.custo, 0), 'custo ponderado')}</div>`
      + (st.csvOut && st.csvOut.t === 'aulas' ? `<div class="panel"><p class="small">${esc(st.csvOut.info)}</p><div class="row"><a class="btn primary" href="${st.csvOut.url}" download="${esc(st.csvOut.nome)}">Descarregar ${esc(st.csvOut.nome)}</a><button class="btn small" data-act="csv-close">Fechar</button></div></div>` : '')
      + `<div class="cols"><div class="stack">
          <div class="row">${filtroOpts(st.filtro, 'filtro')}${semanaSel()}</div>
          <p class="small muted">${ed ? 'Arraste uma aula para a mudar de dia ou hora: a alteração só é gravada se não violar regras obrigatórias. ' : ''}Clique numa aula para ver detalhes${ed ? ', sugestões e mudar de sala' : ''}.</p>
          ${grid({ id: 'tt-g', aulas, viol: v.porAula, editable: ed, clickable: !ed, selectable: true, mancha: manchaPara(st.filtro), mostrar: st.filtro.tipo === 'turma' ? 'docente' : 'turmas' })}
          ${legendaGrid()}
        </div>
        <div class="stack">
          ${sel ? detalheAula(sel, v, ed) : ''}
          <div class="panel"><div class="row"><h3>Violações</h3><select data-change="vfiltro" aria-label="Filtrar violações" style="max-width:100%">${[['todas', 'Todas'], ['vista', 'Só desta vista'], ['hard', 'Obrigatórias'], ['soft', 'Qualidade'], ...regrasV.map(([k, x]) => ['r:' + k, `${x.nome || k} (${x.n})`])].map(([k, n]) => `<option value="${esc(k)}"${k === st.vfiltro ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
          ${violList(vs)}</div>
        </div></div>`;
  };
  /* Detalhe para quem não vê informação de planeamento (estudante): só a informação académica. */
  function detalheSimples(a) {
    const uc = D.one('SELECT ects FROM uc WHERE id = ?', [a.uc_id]) || {};
    const ta = D.one('SELECT nome FROM tipo_aula WHERE id = ?', [a.tipo_aula]);
    return `<div class="panel" id="detalhe">
      <div class="row"><span class="pill" style="--h:${hue(a.uc_id)};background:hsl(var(--h) var(--blk-s) var(--blk-l));color:hsl(var(--h) 45% var(--blk-ink-l))">${esc(a.uc)}</span><div style="flex:1"></div><button class="btn small" data-act="sel-close">Fechar</button></div>
      <h3>${esc(a.uc_nome)}</h3>
      ${table([
        ['Docente', esc(a.docente || 'a designar')],
        ['Horário', `${DIAS[a.dia]}, ${hhmm(a.inicio)}–${hhmm(a.fim)}`],
        ['Semanas', esc(semTxt(a.semanas))],
        ['Sala', esc(a.sala || (a.caracteristica_pedida === M.SEM_SALA ? 'sem sala (aula fora de sala)' : 'a designar'))],
        ['Tipo de aula', esc(a.tipo_aula === 'ND' ? 'não indicado' : (ta ? ta.nome : a.tipo_aula))],
        ['Turno', esc(a.turno)],
        ['Turmas', esc(a.turmas || '')],
        ...(uc.ects ? [['ECTS', num(uc.ects)]] : []),
      ].map(([k, x]) => ({ k, x })), [{ h: '', k: 'k' }, { h: '', f: (r) => r.x }])}
    </div>`;
  }
  function detalheAula(a, v, ed) {
    if (!can('planeamento.ver')) return detalheSimples(a);
    const vs = v.porAula.get(a.aula_id) || [];
    const full = M.buildProblem(D, { horarioId: st.horarioId });
    const idx = full.aulas.findIndex((x) => x.id === a.aula_id);
    const semSala = a.caracteristica_pedida === M.SEM_SALA;
    const rooms = semSala ? [] : E.searchRooms(full, { dia: a.dia, ini: a.inicio, dur: a.duracao, alunos: a.esperados, car: a.caracteristica_pedida, semanas: a.semanas, ignorar: idx }).slice(0, 15);
    if (a.sala_id && !rooms.some((r) => r.sala.id === a.sala_id)) { const cur = E.searchRooms(full, { dia: a.dia, ini: a.inicio, dur: a.duracao, alunos: a.esperados, car: a.caracteristica_pedida, semanas: a.semanas, ignorar: idx }).find((r) => r.sala.id === a.sala_id); if (cur) rooms.unshift(cur); }
    const sug = st.sugestoes && st.sugestoes.id === a.aula_id ? st.sugestoes.list : null;
    const bl = st.bloqueio && st.bloqueio.id === a.aula_id ? st.bloqueio : null;
    const carSala = a.sala_id ? D.q('SELECT caracteristica FROM sala_caracteristica WHERE sala_id = ? ORDER BY caracteristica', [a.sala_id]).map((r) => r.caracteristica).filter((c) => c !== 'Horário sala visível portal público') : [];
    return `<div class="panel" id="detalhe">
      <div class="row"><span class="pill" style="--h:${hue(a.uc_id)};background:hsl(var(--h) var(--blk-s) var(--blk-l));color:hsl(var(--h) 45% var(--blk-ink-l))">${esc(a.uc)} ${esc(a.tipo_aula)} · ${esc(a.turno)}</span><div style="flex:1"></div><button class="btn small" data-act="sel-close">Fechar</button></div>
      <h3>${esc(a.uc_nome)}</h3>
      <p class="small">${DIAS[a.dia]}, ${hhmm(a.inicio)}–${hhmm(a.fim)} · ${esc(semTxt(a.semanas))}<br>Sala ${esc(a.sala || (semSala ? 'não necessária' : 'por atribuir'))}${a.capacidade ? ` (${a.capacidade} lugares)` : ''} · ${esc(a.docente || 'sem professor')}<br>Turmas ${esc(a.turmas)} · ${a.inscritos} inscritos</p>
      ${presencaTxt(a)}
      ${a.caracteristica_pedida ? `<p class="small">Pedido do docente: <b>${esc(a.caracteristica_pedida)}</b>${a.sala_id && !semSala ? (a.tem_caracteristica ? ' <span class="pill ok">a sala tem</span>' : ' <span class="pill soft">a sala não tem</span>') : ''}</p>` : ''}
      ${carSala.length ? `<div class="chips">${carSala.map((c) => `<span class="chip${c === a.caracteristica_pedida ? ' ok' : ''}">${esc(c)}</span>`).join('')}</div>` : ''}
      ${vs.length ? violList(vs, { atual: a.aula_id }) : '<p class="pill ok">Cumpre todas as regras</p>'}
      ${bl ? `<div class="callout warn"><b>Alteração bloqueada.</b> Mudar para ${DC[bl.dia]} ${hhmm(bl.ini)} criaria:${bl.novas.map((x) => `<br>• ${sevPill(x.sev)} ${esc(x.msg)}`).join('')}
        ${ed ? `<div class="row" style="margin-top:8px"><input type="text" id="forcar-just" placeholder="Justificação (obrigatória)" style="flex:1;min-width:160px"><button class="btn danger" data-act="forcar" data-id="${a.aula_id}">Gravar mesmo assim</button></div>` : ''}</div>` : ''}
      ${ed ? `<div class="row">
        <label class="f">Dia<select id="ed-dia">${DIAS.map((d, i) => `<option value="${i}"${i === a.dia ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="f">Início<select id="ed-ini">${TIMES.filter((m) => m + a.duracao <= 1410).map((m) => `<option value="${m}"${m === a.inicio ? ' selected' : ''}>${hhmm(m)}</option>`).join('')}</select></label>
        <label class="f">Sala<select id="ed-sala"><option value="">${semSala ? 'Sem sala (não precisa)' : 'Sem sala'}</option>${rooms.map((r) => `<option value="${r.sala.id}"${r.sala.id === a.sala_id ? ' selected' : ''}>${esc(r.sala.codigo)} · ${r.sala.cap}${r.carOk ? ' ✓' : r.carEq ? ' ≈' : ''}${r.livre ? '' : ' (ocupada)'}</option>`).join('')}</select></label>
      </div>
      <p class="small muted">Salas ordenadas pela adequação ao pedido: ✓ tem a característica pedida, ≈ tem uma equivalente.</p>
      <div class="row"><label class="chk"><input type="checkbox" id="ed-fixa"${a.fixa ? ' checked' : ''}> Fixar (o gerador não a move)</label></div>
      <div class="row"><button class="btn primary" data-act="ed-save" data-id="${a.aula_id}">Guardar</button><button class="btn" data-act="sugerir" data-id="${a.aula_id}">Sugerir melhores posições</button></div>
      ${sug ? (sug.length ? `<div class="stack"><p class="small muted">Posições livres com menor custo (diferença face à atual):</p>${sug.map((s) => `<button class="btn" style="text-align:left" data-act="aplicar-sug" data-id="${a.aula_id}" data-dia="${s.dia}" data-ini="${s.ini}" data-sala="${s.salaId == null ? '' : s.salaId}">${DC[s.dia]} ${hhmm(s.ini)} · ${esc(s.sala)} <span class="${s.delta < 0 ? 'pill ok' : 'pill'}">${s.delta <= 0 ? '' : '+'}${num(s.delta, 1)}</span></button>`).join('')}</div>` : '<p class="muted small">Sem posições livres.</p>') : ''}` : ''}
      ${!ed && can('pedidos.criar') ? `<div class="row"><button class="btn" data-act="pedir" data-id="${a.aula_id}">Pedir alteração</button></div>` : ''}
    </div>`;
  }
  AFTER.horario = () => bindDrag('tt-g', (id, dia, ini) => { moverAula(id, dia, ini); st.sel = id; st.sugestoes = null; render(); }, (id) => { st.sel = id; st.sugestoes = null; st.bloqueio = null; render(); });

  /* ===== Criar aula (escopo: UC, professor, turma, sala, data, início, fim) ===== */
  function criarEstado() {
    if (st.criar) return st.criar;
    const c = cal();
    const uc = (D.one("SELECT u.id FROM uc u JOIN componente c ON c.uc_id = u.id JOIN turno t ON t.componente_id = c.id JOIN turno_turma tt ON tt.turno_id = t.id WHERE tt.turma_id = ? LIMIT 1", [st.filtro.id]) || D.one('SELECT id FROM uc ORDER BY nome LIMIT 1') || {}).id;
    st.criar = { uc, turno: '', tipo: 'TP', docente: '', turma: st.filtro.tipo === 'turma' ? st.filtro.id : '', sala: '', data: new Date(c.data(Math.min(3, c.semanas), 1)).toISOString().slice(0, 10), ini: '09:30', fim: '11:00', rep: 'todas', car: '', insc: '' };
    return st.criar;
  }
  function lerCriar() {
    const f = st.criar;
    for (const k of ['uc', 'turno', 'tipo', 'docente', 'turma', 'sala', 'data', 'ini', 'fim', 'rep', 'car', 'insc']) { const el = $('#cr-' + k); if (el) f[k] = el.value; }
    return f;
  }
  VIEWS.criar = () => {
    const h = horario(st.horarioId);
    const f = criarEstado();
    const c = cal();
    if (!editavel(h)) {
      return head('Horários', 'Criar aula', 'Registe uma aula indicando UC, professor, turma, sala, data e horas. A aplicação valida as regras antes de gravar.')
        + `<div class="callout">O horário ativo (${h ? esc(h.nome) + ', ' + ESTADOS[h.estado] : 'nenhum'}) não está em rascunho. As aulas criam-se numa versão em rascunho.${h && can('horario.editar') ? ' <button class="btn small" data-act="wf" data-a="nova">Criar nova versão em rascunho</button>' : ''}</div>`;
    }
    const turnos = f.uc ? D.q("SELECT t.id, t.codigo, t.inscritos, t.docente_id, t.caracteristica_pedida, c.tipo_aula_id, (SELECT group_concat(tm.codigo, ', ') FROM turno_turma x JOIN turma tm ON tm.id = x.turma_id WHERE x.turno_id = t.id) AS turmas FROM turno t JOIN componente c ON c.id = t.componente_id WHERE c.uc_id = ? ORDER BY t.codigo", [Number(f.uc)]) : [];
    const tsel = turnos.find((t) => String(t.id) === String(f.turno));
    const r = st.criarRes;
    const resHtml = r ? (r.ok
      ? `<div class="callout"><b>Aula gravada.</b> ${esc(r.resumo)}${r.novas.length ? `<br>Avisos de qualidade:${r.novas.map((x) => '<br>• ' + esc(x.msg)).join('')}` : ' Cumpre todas as regras.'}<div class="row" style="margin-top:6px"><button class="btn small" data-act="goto-aula" data-id="${r.id}">Ver no horário</button></div></div>`
      : `<div class="callout warn"><b>Não gravada.</b> ${r.erro ? esc(r.erro) : 'A aula violaria regras obrigatórias:'}${(r.novas || []).filter((x) => x.sev === 'hard').map((x) => '<br>• ' + esc(x.msg)).join('')}
        ${r.alternativas && r.alternativas.length ? `<p class="small" style="margin-top:6px">Salas livres e adequadas nesse período:</p><div class="row">${r.alternativas.map((x) => `<button class="btn small" data-act="cr-sala" data-id="${x.sala.id}">${esc(x.sala.codigo)} · ${x.sala.cap}${x.carOk ? ' ✓' : ''}</button>`).join('')}</div>` : ''}
        ${r.novas && r.novas.length && !r.erro ? `<div class="row" style="margin-top:8px"><input type="text" id="cr-just" placeholder="Justificação para gravar com violações" style="flex:1;min-width:180px"><button class="btn danger" data-act="cr-forcar">Gravar mesmo assim</button></div>` : ''}</div>`) : '';
    return head('Horários', 'Criar aula', `Em ${hLabel(st.horarioId)}. A aplicação verifica sala ocupada, conflito de professor, conflito de turma e capacidade antes de gravar.`)
      + resHtml
      + `<form class="panel" data-submit="criar"><div class="formgrid">
        <label class="f">Unidade curricular<select id="cr-uc" data-change="cr-uc" required>${optList(D.q('SELECT id, codigo, nome FROM uc ORDER BY nome'), 'id', (x) => `${x.nome} (${x.codigo})`, f.uc)}</select></label>
        <label class="f">Turno<select id="cr-turno" data-change="cr-turno"><option value="">Novo turno…</option>${turnos.map((t) => `<option value="${t.id}"${String(t.id) === String(f.turno) ? ' selected' : ''}>${esc(t.codigo)} · ${esc(t.turmas || 'sem turma')}</option>`).join('')}</select></label>
        ${tsel ? '' : `<label class="f">Tipo de aula (turno novo)<select id="cr-tipo">${optList(D.q('SELECT * FROM tipo_aula ORDER BY id'), 'id', (x) => `${x.id} · ${x.nome}`, f.tipo)}</select></label>`}
        <label class="f">Professor<select id="cr-docente"><option value="">Sem professor</option>${optList(docentesAll(), 'id', 'nome', f.docente || (tsel && tsel.docente_id) || '')}</select></label>
        <label class="f">Turma<select id="cr-turma" required><option value="">Escolher…</option>${optList(turmasAll(), 'id', (x) => `${x.codigo} (${x.sigla})`, f.turma)}</select></label>
        <label class="f">Inscritos<input type="number" id="cr-insc" min="0" value="${esc(f.insc || (tsel ? tsel.inscritos : ''))}" placeholder="n.º de estudantes"></label>
        <label class="f">Característica de sala pedida<select id="cr-car"><option value="">Nenhuma em particular</option>${optList(D.q('SELECT nome FROM caracteristica ORDER BY nome'), 'nome', 'nome', f.car || (tsel && tsel.caracteristica_pedida) || '')}</select></label>
        <label class="f">Sala<select id="cr-sala"><option value="">Sem sala</option>${optList(D.q('SELECT id, codigo, capacidade FROM sala WHERE ativa = 1 ORDER BY codigo'), 'id', (x) => `${x.codigo} · ${x.capacidade} lugares`, f.sala)}</select></label>
        <label class="f">Data<input type="date" id="cr-data" value="${esc(f.data)}" min="${esc(c.inicio)}" required></label>
        <label class="f">Hora de início<input type="time" id="cr-ini" value="${esc(f.ini)}" min="08:00" max="23:00" step="1800" required></label>
        <label class="f">Hora de fim<input type="time" id="cr-fim" value="${esc(f.fim)}" min="08:30" max="23:30" step="1800" required></label>
        <label class="f">Repetição<select id="cr-rep"><option value="unica"${f.rep === 'unica' ? ' selected' : ''}>Só nesta data</option><option value="seguintes"${f.rep === 'seguintes' ? ' selected' : ''}>Todas as semanas a partir desta data</option><option value="todas"${f.rep === 'todas' ? ' selected' : ''}>Todas as semanas do semestre (mesmo dia)</option></select></label>
      </div>
      <div class="row"><button class="btn primary" type="submit">Validar e gravar</button><button class="btn" type="button" data-act="cr-sugerir">Sugerir sala</button><span class="small muted">Semestre: ${c.semanas} semanas a partir de ${esc(String(c.inicio).split('-').reverse().join('/'))}.</span></div>
      </form>`;
  };
  function dadosData(iso) {
    const c = cal();
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y) return null;
    const t = Date.UTC(y, m - 1, d);
    const [y0, m0, d0] = String(c.inicio).split('-').map(Number);
    const dd = Math.floor((t - Date.UTC(y0, m0 - 1, d0)) / 86400000);
    return { semana: Math.floor(dd / 7) + 1, dia: ((dd % 7) + 7) % 7, n: c.semanas, fer: c.todos.find((f) => f.data === iso) };
  }
  /* Estudantes esperados de uma aula nova: inscritos indicados, os do turno ou os da turma. */
  function alunosCriar(f) {
    if (Number(f.insc)) return Number(f.insc);
    const t = f.turno ? D.one('SELECT inscritos FROM turno WHERE id = ?', [Number(f.turno)]) : null;
    if (t && t.inscritos) return t.inscritos;
    const tm = f.turma ? D.one('SELECT n_alunos FROM turma WHERE id = ?', [Number(f.turma)]) : null;
    return (tm && tm.n_alunos) || 30;
  }
  function criarAula(forcar, just) {
    const f = lerCriar();
    const hid = st.horarioId;
    const h = horario(hid);
    if (!editavel(h)) return;
    const dd = dadosData(f.data);
    const ini = toMin(f.ini), fim = toMin(f.fim);
    const erro = !f.uc ? 'Escolha a UC.' : !f.turma && !f.turno ? 'Escolha a turma.' : !dd ? 'Indique a data.' : dd.semana < 1 || dd.semana > dd.n ? `A data fica fora do semestre (${dd.n} semanas).` : dd.dia > 5 ? 'Não há aulas ao domingo.'
      : !(fim > ini) ? 'A hora de fim tem de ser depois da hora de início.' : ini < 480 || fim > 1410 ? 'As aulas decorrem entre as 08:00 e as 23:30.' : f.rep === 'unica' && dd.fer ? `${f.data.split('-').reverse().join('/')} é ${dd.fer.nome}.` : null;
    if (erro) { st.criarRes = { ok: false, erro, novas: [] }; render(); return; }
    let mask = 0;
    if (f.rep === 'unica') mask = 1 << (dd.semana - 1);
    else for (let w = f.rep === 'todas' ? 1 : dd.semana; w <= dd.n; w++) mask |= 1 << (w - 1);
    const uc = D.one('SELECT * FROM uc WHERE id = ?', [Number(f.uc)]);
    let notas = [];
    const res = comValidacao(hid, null, () => {
      let turnoId = f.turno ? Number(f.turno) : null;
      if (!turnoId) {
        let comp = D.one('SELECT id FROM componente WHERE uc_id = ? AND tipo_aula_id = ?', [uc.id, f.tipo]);
        if (!comp) { D.run('INSERT INTO componente (uc_id, tipo_aula_id, duracao_min, aulas_semana, taxa_presenca) VALUES (?,?,?,1,1)', [uc.id, f.tipo, fim - ini]); comp = { id: D.lastId() }; }
        const n = D.one('SELECT COUNT(*) n FROM turno WHERE componente_id = ?', [comp.id]).n + 1;
        const codigo = `${uc.codigo}${f.tipo}${String(n).padStart(2, '0')}`;
        D.run('INSERT INTO turno (componente_id, codigo, docente_id, inscritos, caracteristica_pedida) VALUES (?,?,?,?,?)', [comp.id, codigo, f.docente ? Number(f.docente) : null, Number(f.insc) || 0, f.car || null]);
        turnoId = D.lastId();
        D.run('INSERT INTO turno_turma (turno_id, turma_id) VALUES (?,?)', [turnoId, Number(f.turma)]);
        notas.push(`turno novo ${codigo}`);
      } else {
        const t = D.one('SELECT * FROM turno WHERE id = ?', [turnoId]);
        if (f.turma && !D.one('SELECT 1 x FROM turno_turma WHERE turno_id = ? AND turma_id = ?', [turnoId, Number(f.turma)])) { D.run('INSERT INTO turno_turma (turno_id, turma_id) VALUES (?,?)', [turnoId, Number(f.turma)]); notas.push('turma acrescentada ao turno'); }
        if (f.docente && Number(f.docente) !== t.docente_id) { D.run('UPDATE turno SET docente_id = ? WHERE id = ?', [Number(f.docente), turnoId]); notas.push('professor atribuído a todo o turno'); }
        if (f.insc !== '' && Number(f.insc) !== t.inscritos) D.run('UPDATE turno SET inscritos = ? WHERE id = ?', [Number(f.insc) || 0, turnoId]);
      }
      const seq = D.one('SELECT COALESCE(MAX(seq), 0) + 1 s FROM aula WHERE horario_id = ? AND turno_id = ?', [hid, turnoId]).s;
      D.run('INSERT INTO aula (horario_id, turno_id, seq, dia, inicio, duracao, sala_id, fixa, semanas, caracteristica_pedida) VALUES (?,?,?,?,?,?,?,0,?,?)',
        [hid, turnoId, seq, dd.dia, ini, fim - ini, f.sala ? Number(f.sala) : null, mask, f.car || null]);
      return D.lastId();
    }, forcar);
    const resumo = `${uc.nome}, ${DIAS[dd.dia]} ${f.ini}–${f.fim}, ${E.semTxt(mask, dd.n)}${f.sala ? ', sala ' + D.one('SELECT codigo FROM sala WHERE id = ?', [Number(f.sala)]).codigo : ''}`;
    if (res.ok) {
      changed(forcar ? 'Aula criada (forçado)' : 'Aula criada', resumo + (notas.length ? ` (${notas.join('; ')})` : '') + (just ? ' · justificação: ' + just : ''));
      st.criarRes = { ok: true, id: res.id, novas: res.novas, resumo: resumo + (notas.length ? ` (${notas.join('; ')})` : '') };
      st.sel = res.id;
    } else {
      let alternativas = [];
      if (!res.erro && res.novas.some((x) => x.codigo === 'CONF_SALA' || x.codigo === 'CAPACIDADE' || x.codigo === 'CARACT_ESSENCIAL' || x.codigo === 'NAO_AGENDADA')) {
        const P = M.buildProblem(D, { horarioId: hid });
        alternativas = E.searchRooms(P, { dia: dd.dia, ini, dur: fim - ini, alunos: alunosCriar(f), car: f.car || null, semanas: mask }).filter((x) => x.livre && x.capOk).slice(0, 6);
      }
      st.criarRes = { ok: false, erro: res.erro, novas: res.novas, alternativas };
    }
    render();
  }
  SUBMIT.criar = () => criarAula(false);

  /* ===== Gerar (item 3) ===== */
  let worker = null;
  VIEWS.gerar = () => {
    const iscte = conjunto() === 'iscte';
    const g = st.gen || (st.gen = { base: st.horarioId, modo: iscte ? 'salas' : 'zero', escopo: '', dias: '5', grelha: 'blocos', tempo: iscte ? 20 : 8, seed: 7, regras: null, prog: null, res: null });
    if (!g.regras) g.regras = JSON.parse(JSON.stringify(regrasMotor()));
    const hs = horarios();
    const regras = Object.entries(g.regras).filter(([k]) => k !== 'NAO_AGENDADA' && (k !== 'ALTERACOES' || g.modo === 'melhorar'));
    const running = !!worker;
    const p = g.prog;
    return head('Item 3', 'Gerar horário', 'Sugere o dia, a hora e a sala de cada aula segundo as restrições e os critérios de qualidade que escolher. O resultado é guardado como rascunho.')
      + `<div class="cols"><div class="stack">
        ${p ? `<div class="panel"><div class="row"><h3>${running ? 'A gerar…' : 'Resultado'}</h3><span class="pill acc">${{ construcao: 'Construção', otimizacao: 'Arrefecimento simulado', populacao: 'População inicial', nsga2: 'NSGA-II', fim: 'Concluído' }[p.fase] || ''}</span><span class="muted small" id="gen-info">${progTxt(p)}</span></div>
          <div class="chart" id="gen-chart">${chartCusto(p.hist || [])}</div>
          ${g.res ? resultadoGeracao(g) : ''}</div>` : ''}
        <div class="panel"><h3>Restrições e critérios</h3><p class="small muted">Alterações aqui valem só para esta geração. As regras obrigatórias têm peso 1000 × peso.</p>
          ${table(regras.map(([k, r]) => ({ k, ...r })), [
            { h: 'Ativa', f: (r) => `<input type="checkbox" data-change="gen-regra" data-k="${r.k}" data-c="ativa" aria-label="Ativa"${r.ativa ? ' checked' : ''}>` },
            { h: 'Regra', f: (r) => esc(r.nome || r.k) },
            { h: 'Tipo', f: (r) => `<select data-change="gen-regra" data-k="${r.k}" data-c="sev" aria-label="Tipo"><option value="hard"${r.sev === 'hard' ? ' selected' : ''}>Obrigatória</option><option value="soft"${r.sev === 'soft' ? ' selected' : ''}>Qualidade</option></select>` },
            { h: 'Peso', f: (r) => `<input type="number" min="0" step="0.5" style="width:72px" data-change="gen-regra" data-k="${r.k}" data-c="peso" value="${r.peso}" aria-label="Peso">` },
          ])}
          <div class="row"><button class="btn small" data-act="gen-reset-regras">Repor regras guardadas</button></div>
        </div>
      </div>
      <div class="panel"><h3>Parâmetros</h3>
        <label class="f">Horário de partida<select id="gen-base"><option value="">Nenhum (do zero)</option>${optList(hs, 'id', (h) => `${h.nome} (${ESTADOS[h.estado]})`, g.base)}</select></label>
        <label class="f">Algoritmo<select id="gen-alg"><option value="s1"${g.alg !== 's2' ? ' selected' : ''}>Solução 1: Greedy + Simulated Annealing</option><option value="s2"${g.alg === 's2' ? ' selected' : ''}>Solução 2: NSGA-II (4 objetivos)</option></select></label>
        <label class="f">Modo<select id="gen-modo"><option value="salas"${g.modo === 'salas' ? ' selected' : ''}>Só reatribuir salas (mantém dias e horas)</option><option value="melhorar"${g.modo === 'melhorar' ? ' selected' : ''}>Melhorar com poucas mudanças de dia e hora</option><option value="zero"${g.modo === 'zero' ? ' selected' : ''}>Refazer tudo (mantém aulas fixas)</option></select></label>
        <label class="f">Âmbito<select id="gen-escopo"><option value="">Todas as aulas</option>${optList(D.q('SELECT id, sigla, nome FROM curso ORDER BY sigla'), 'id', (c) => `Só o curso ${c.sigla}`, g.escopo)}</select></label>
        <p class="small muted">Com um curso escolhido, só as aulas desse curso mudam; as outras ficam como estão mas continuam a contar (salas ocupadas, turmas partilhadas).</p>
        <label class="f">Dias<select id="gen-dias"><option value="5"${g.dias === '5' ? ' selected' : ''}>Segunda a sexta</option><option value="6"${g.dias === '6' ? ' selected' : ''}>Segunda a sábado</option></select></label>
        <label class="f">Horas de início<select id="gen-grelha"><option value="blocos"${g.grelha === 'blocos' ? ' selected' : ''}>Blocos de 1h30 (08:00, 09:30, 11:00, 13:00…)</option><option value="30"${g.grelha === '30' ? ' selected' : ''}>Qualquer meia hora</option></select></label>
        <div class="row"><label class="f">Tempo (s)<input type="number" id="gen-tempo" min="1" max="600" value="${g.tempo}" style="width:80px"></label><label class="f">Semente<input type="number" id="gen-seed" value="${g.seed}" style="width:90px"></label></div>
        <div class="row">${running ? '<button class="btn danger" data-act="gen-stop">Parar</button>' : '<button class="btn primary" data-act="gen-run">Gerar horário</button>'}</div>
        <p class="small muted">Solução 2 (NSGA-II): refaz os dias, horas e salas de todas as aulas ou só das do curso escolhido (as dos outros cursos ficam como no horário de partida). Em "Refazer tudo", a população parte da construção gulosa; em "Melhorar", parte do horário de partida. População de 40 horários, cruzamento uniforme (0,9), mutação de 2/n por aula, e devolve a Frente de Pareto de f₁ (regras obrigatórias), f₂ (1 − ocupação), f₃ (furos) e f₄ (fora da mancha); guarda-se o horário da frente com menor f₁ (desempate pelo custo total).</p>
        <p class="small muted">Solução 1: (1) constrói o horário colocando primeiro as aulas mais difíceis (mais turmas, salas raras, professores com restrições); (2) melhora-o por arrefecimento simulado, movendo aulas, trocando salas entre aulas que se sobrepõem e trocando aulas entre si; (3) melhora só as salas sem mexer nos tempos, como no módulo de melhoria de salas de Martins (2014).</p>
      </div></div>`;
  };
  // Texto de progresso: na construção e na população inicial, que podem demorar mais de um minuto com todos os cursos.
  function progTxt(p) {
    const t = `${num(p.ms / 1000, 1)} s`;
    if (p.fase === 'construcao' && p.porColocar) return `${t} · ${num(p.colocadas, 0)} de ${num(p.porColocar, 0)} aulas colocadas`;
    if (p.fase === 'construcao') return `${t} · a construir o horário inicial (com todos os cursos pode demorar 1 a 2 minutos)`;
    if (p.fase === 'populacao') return `${t} · ${num(p.populacao, 0)} de ${num(p.de, 0)} horários da população inicial`;
    if (p.fase === 'nsga2' || (p.geracao != null && p.fase !== 'fim')) return `${t} · ${num(p.geracao || 0, 0)} gerações`;
    return `${t} · ${num(p.it || 0, 0)} iterações`;
  }
  function chartCusto(hist) {
    if (hist.length < 2) return '<p class="muted small">À espera dos primeiros resultados…</p>';
    const W = 560, H = 170, L = 50, R = 12, T = 12, B = 26;
    const xs = hist.map((p) => p[0]), ys = hist.map((p) => Math.log10(1 + p[1]));
    const xm = Math.max(...xs) || 1, ym = Math.max(...ys) || 1;
    const X = (x) => L + (x / xm) * (W - L - R), Y = (y) => T + (1 - y / ym) * (H - T - B);
    const pts = hist.map((p, i) => `${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ');
    const ticks = [];
    for (let e = 0; e <= Math.ceil(ym); e++) { const v = Math.pow(10, e); if (Math.log10(1 + v) <= ym * 1.001 || e === 0) ticks.push(v); }
    const last = hist[hist.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do custo do melhor horário">
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(Math.log10(1 + v))}" y2="${Y(Math.log10(1 + v))}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(Math.log10(1 + v)) + 3}" text-anchor="end">${num(v, 0)}</text>`).join('')}
      <line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="var(--line)"/>
      <text x="${L}" y="${H - 8}">0 s</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${num(xm / 1000, 1)} s</text>
      <polyline points="${L},${H - B} ${pts} ${X(xs[xs.length - 1])},${H - B}" fill="var(--accent-soft)" stroke="none"/>
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${X(last[0])}" cy="${Y(Math.log10(1 + last[1]))}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"><title>${num(last[1], 1)}</title></circle>
      <text x="${Math.min(X(last[0]) - 6, W - R - 6)}" y="${Y(Math.log10(1 + last[1])) - 8}" text-anchor="end" style="fill:var(--ink)">custo ${num(last[1], 0)}</text>
    </svg><p class="small muted">Custo do melhor horário encontrado (escala logarítmica). Cada violação obrigatória vale pelo menos 1000.</p>`;
  }
  function resultadoGeracao(g) {
    const r = g.res;
    const baseV = g.base ? validar(Number(g.base)) : null;
    const codes = [...new Set([...Object.keys(r.porRegra), ...Object.keys(baseV ? baseV.porRegra : {})])].filter((k) => k !== 'ALTERACOES' || r.porRegra[k]).filter((k) => g.regras[k]);
    const nomeR = (k) => (g.regras[k] && g.regras[k].nome) || k;
    return `<div class="kpis">${kpi(num(r.hard, 0), 'violações obrigatórias', r.hard ? 'hard' : 'ok')}${kpi(num(r.soft, 0), 'violações de qualidade', r.soft ? 'soft' : 'ok')}${kpi(num(r.mudadas, 0), 'aulas mudadas')}${kpi(num(r.melhoriasSalas, 0), 'salas melhoradas na fase 3')}</div>
      ${codes.length ? table(codes.map((k) => ({ k, n: (r.porRegra[k] || {}).n || 0, b: baseV ? ((baseV.porRegra[k] || {}).n || 0) : null })), [{ h: 'Regra', f: (x) => esc(nomeR(x.k)) }, ...(baseV ? [{ h: 'Partida', f: (x) => num(x.b, 0), num: true }] : []), { h: 'Gerado', f: (x) => `<b>${num(x.n, 0)}</b>`, num: true }, ...(baseV ? [{ h: '', f: (x) => diffPill(x.b, x.n, true), num: true }] : [])]) : '<p class="pill ok">O horário gerado cumpre todas as regras ativas.</p>'}
      <p class="small muted">As regras SQL não entram na otimização; são verificadas depois de guardar.</p>
      <div class="row"><input type="text" id="gen-nome" value="${esc(g.nomeSugerido)}" style="flex:1;min-width:200px" aria-label="Nome do horário"><button class="btn primary" data-act="gen-save"${g.saved ? ' disabled' : ''}>${g.saved ? 'Guardado como rascunho' : 'Guardar como rascunho'}</button>${g.saved ? '<button class="btn" data-act="gen-ver">Ver no horário</button>' : ''}</div>`;
  }
  function lerGen() {
    const g = st.gen;
    g.alg = $('#gen-alg').value; g.base = $('#gen-base').value; g.modo = $('#gen-modo').value; g.escopo = $('#gen-escopo').value; g.dias = $('#gen-dias').value; g.grelha = $('#gen-grelha').value;
    g.tempo = Math.max(1, Math.min(600, Number($('#gen-tempo').value) || 8)); g.seed = Number($('#gen-seed').value) || 1;
    if (g.regras && g.regras.ALTERACOES && !g.alteracoesTocada) g.regras.ALTERACOES.ativa = g.modo === 'melhorar';
  }
  function gerar() {
    lerGen();
    const g = st.gen;
    if (g.alg === 's2' && g.modo === 'salas') { toast('A Solução 2 (NSGA-II) muda dias, horas e salas: escolha "Melhorar" ou "Refazer tudo".'); return; }
    if (g.alg === 's2' && g.escopo && !g.base) { toast('Com um curso no âmbito, escolha o horário de partida (as aulas dos outros cursos ficam como nele).'); return; }
    if (g.modo !== 'zero' && !g.base) { toast('Escolha o horário de partida para melhorar.'); return; }
    const rules = JSON.parse(JSON.stringify(g.regras));
    if (rules.ALTERACOES) rules.ALTERACOES.ativa = g.modo === 'melhorar' && !!rules.ALTERACOES.ativa;
    const P = M.buildProblem(D, { horarioId: g.base ? Number(g.base) : null, incluirEmFalta: g.alg !== 's2', rules, escopo: g.escopo ? { cursoId: Number(g.escopo) } : null });
    // Solução 2: com um curso no âmbito, instância desse curso; com todas as aulas, o problema completo.
    const inst = g.alg !== 's2' ? null : g.escopo ? M.instanciaCurso(D, Number(g.base), Number(g.escopo), { rules }) : Object.assign({}, P, { full: P.aulas.map((_, i) => i) });
    if (g.modo === 'melhorar') for (const a of P.aulas) if (a.dia != null && a.sala != null) a.ref = { dia: a.dia, ini: a.ini, sala: a.sala };
    if (g.modo === 'zero') for (const a of P.aulas) if (!a.fixa) { a.dia = null; a.ini = null; a.sala = null; }
    // "Melhorar" na Solução 2: a população parte do horário de partida em vez da construção gulosa.
    const opts = { seed: g.seed, tempoMs: g.tempo * 1000, dias: g.dias === '6' ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4], grelha: g.grelha, modo: g.modo, daPartida: g.alg === 's2' && g.modo === 'melhorar' };
    g.P = P; g.res = null; g.saved = false; g.prog = { fase: 'construcao', ms: 0, hist: [] };
    const orig = P.aulas.map((a) => [a.dia, a.ini, a.sala]);
    const fim = (r0) => {
      worker = null;
      let r = r0;
      if (inst) {
        // Solução 2: o resultado é da instância (curso ou horário completo); as aulas fora dela ficam como no horário de partida.
        const aulas = P.aulas.map((a) => ({ id: a.id, key: a.key, dia: a.dia == null ? -1 : a.dia, ini: a.ini == null ? -1 : a.ini, sala: a.sala == null ? -1 : a.sala }));
        inst.aulas.forEach((a, i) => { if (!a.fixa) aulas[inst.full[i]] = r0.aulas[i]; });
        const v = E.validate(Object.assign({}, P, { aulas: P.aulas.map((a, i) => Object.assign({}, a, { dia: aulas[i].dia < 0 ? null : aulas[i].dia, ini: aulas[i].ini < 0 ? null : aulas[i].ini, sala: aulas[i].sala })) }));
        r = Object.assign({}, r0, { aulas, hard: v.hard, soft: v.soft, porRegra: v.porRegra, custo: v.custo, melhoriasSalas: 0, it: r0.geracoes });
      }
      const mudadas = r.aulas.filter((x, i) => x.dia !== orig[i][0] || x.ini !== orig[i][1] || x.sala !== orig[i][2]).length;
      g.res = Object.assign(r, { total: P.aulas.length, mudadas });
      g.prog = { fase: 'fim', ms: r.ms, it: r.it, hist: r.hist };
      const esc_ = g.escopo ? ' · ' + (D.one('SELECT sigla FROM curso WHERE id = ?', [Number(g.escopo)]) || {}).sigla : '';
      g.nomeSugerido = `Gerado ${new Date().toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })} · ${inst ? 'NSGA-II' : { salas: 'salas', melhorar: 'melhoria', zero: 'novo' }[g.modo]}${esc_}`;
      render();
    };
    try {
      const src = `const EngineFactory = ${EngineFactory.toString()};\nconst E = EngineFactory();\nonmessage = (e) => { const r = (e.data.alg === 's2' ? E.nsga2 : E.solve)(e.data.P, e.data.opts, (p) => postMessage({ t: 'p', p: Object.assign({}, p, { hist: p.hist.slice(-300) }) })); postMessage({ t: 'r', r }); };`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (e) => {
        if (e.data.t === 'p') { g.prog = e.data.p; const c = $('#gen-chart'); if (c && st.view === 'gerar') { c.innerHTML = chartCusto(g.prog.hist); const info = $('#gen-info'); if (info) info.textContent = progTxt(g.prog); } }
        else { worker.terminate(); fim(e.data.r); }
      };
      worker.onerror = () => { worker = null; correrNoMain(inst || P, opts, fim, g.alg); };
      worker.postMessage({ P: inst || P, opts, alg: g.alg });
    } catch (e) {
      worker = null; correrNoMain(inst || P, opts, fim, g.alg);
    }
    render();
  }
  function correrNoMain(P, opts, fim, alg) {
    toast('A gerar sem processo paralelo; a página pode ficar parada alguns segundos.');
    setTimeout(() => fim((alg === 's2' ? E.nsga2 : E.solve)(P, Object.assign({}, opts, { tempoMs: Math.min(opts.tempoMs, 5000) }))), 50);
  }
  function guardarGerado() {
    const g = st.gen; const r = g.res; const P = g.P;
    const nome = ($('#gen-nome').value || g.nomeSugerido).trim();
    const c = cal();
    const hid = D.tx(() => {
      D.run("INSERT INTO horario (nome, ano_letivo, semestre, origem, criado_em, notas, estado, criado_por) VALUES (?, ?, ?, 'gerado', ?, ?, 'rascunho', ?)",
        [nome, c.ano_letivo, c.semestre, agora(), `${g.alg === 's2' ? 'Solução 2 (NSGA-II)' : 'Solução 1 (Greedy + Simulated Annealing)'}, semente ${g.seed}, ${g.tempo} s, modo ${g.modo}${g.escopo ? ', âmbito curso ' + g.escopo : ''}. ${r.hard} obrigatórias, ${r.soft} de qualidade.`, U.username]);
      const id = D.lastId();
      const base = g.base ? D.q('SELECT * FROM aula WHERE horario_id = ?', [Number(g.base)]) : [];
      const porId = new Map(base.map((a) => [a.id, a]));
      // Sessões pontuais (não são aulas, ficam fora do problema): passam do horário base tal como estão.
      const noProblema = new Set(P.aulas.map((a) => a.id).filter((x) => x != null));
      for (const b of base) {
        if (noProblema.has(b.id) || !M.sessaoPontual(b.duracao) || b.reposicao_de != null) continue;
        D.run('INSERT INTO aula (horario_id, turno_id, seq, dia, inicio, duracao, sala_id, fixa, semanas, caracteristica_pedida) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id, b.turno_id, b.seq, b.dia, b.inicio, b.duracao, b.sala_id, b.fixa, b.semanas, b.caracteristica_pedida]);
      }
      P.aulas.forEach((a, i) => {
        const x = r.aulas[i];
        if (x.dia < 0) return;
        const b = a.id != null ? porId.get(a.id) : null;
        D.run('INSERT INTO aula (horario_id, turno_id, seq, dia, inicio, duracao, sala_id, fixa, semanas, caracteristica_pedida) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id, a.turnoId, a.seq, x.dia, x.ini, a.dur, x.sala >= 0 ? P.salas[x.sala].id : (b && a.noRoom ? b.sala_id : null), b ? b.fixa : 0, a.sem, b ? b.caracteristica_pedida : null]);
      });
      return id;
    });
    g.saved = hid;
    changed('Horário gerado', nome);
    toast('Horário guardado como rascunho. Submeta-o para revisão quando estiver pronto.');
    render();
  }

  /* ===== Experiências: Solução 1 (Greedy + SA) vs Solução 2 (NSGA-II) ===== */
  function dispersao(series, ix, iy, nx, ny) {
    const W = 330, H = 230, L = 52, R = 10, T = 10, B = 34;
    const all = [].concat(...series.map((s) => s.pts));
    if (!all.length) return '';
    const xs = all.map((p) => p[ix]), ys = all.map((p) => p[iy]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 - x0 < 1e-9) { x0 -= 1; x1 += 1; } if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
    const X = (v) => L + (v - x0) / (x1 - x0) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const fmt = (v) => (Math.abs(v) < 2 && v % 1 ? num(v, 3) : num(v, 0));
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(nx)} contra ${esc(ny)}" style="max-width:360px">
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="var(--line)"/>
      <text x="${L}" y="${H - B + 13}" style="font-size:10px">${fmt(x0)}</text><text x="${W - R}" y="${H - B + 13}" text-anchor="end" style="font-size:10px">${fmt(x1)}</text>
      <text x="${L - 4}" y="${H - B}" text-anchor="end" style="font-size:10px">${fmt(y0)}</text><text x="${L - 4}" y="${T + 8}" text-anchor="end" style="font-size:10px">${fmt(y1)}</text>
      <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" style="font-size:11px">${esc(nx)}</text>
      <text x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})" style="font-size:11px">${esc(ny)}</text>
      ${series.map((s) => s.pts.map((p) => `<circle cx="${X(p[ix]).toFixed(1)}" cy="${Y(p[iy]).toFixed(1)}" r="${s.r || 2.5}" fill="${s.cor}" fill-opacity="${s.op || 0.55}"/>`).join('')).join('')}
    </svg>`;
  }
  function convergencia(hist, cor) {
    const h = hist.filter((p, i) => !(i === 0 && hist.length > 1 && p[0] === 0));
    if (h.length < 2) return '';
    const W = 420, H = 170, L = 64, R = 10, T = 10, B = 26;
    const xm = Math.max(...h.map((p) => p[0])) || 1;
    let y0 = Math.min(...h.map((p) => p[1])), y1 = Math.max(...h.map((p) => p[1]));
    if (y1 - y0 < 1) { y0 -= 1; y1 += 1; }
    const X = (x) => L + x / xm * (W - L - R), Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    const pts = h.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Convergência" style="max-width:460px">
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="var(--line)"/>
      <text x="${L - 4}" y="${T + 8}" text-anchor="end" style="font-size:10px">${num(y1, 0)}</text><text x="${L - 4}" y="${H - B}" text-anchor="end" style="font-size:10px">${num(y0, 0)}</text>
      <text x="${L}" y="${H - 8}" style="font-size:10px">0 s</text><text x="${W - R}" y="${H - 8}" text-anchor="end" style="font-size:10px">${num(xm / 1000, 0)} s</text>
      <polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }
  VIEWS.experiencias = () => {
    const X = window.ODES_EXPERIENCIAS;
    const umaS2 = !!X && X.s2.length === 1;
    const intro = umaS2
      ? `Resultados do trabalho final sobre o horário completo: ${X.s1.length} execuções da Solução 1 (Greedy + Simulated Annealing, mono-objetivo F(x)) e uma execução da Solução 2 (NSGA-II com os objetivos f₁ a f₄), que parte sempre do mesmo horário do Greedy determinístico.`
      : 'Resultados das 30 execuções de cada abordagem do trabalho final: Solução 1 (Greedy + Simulated Annealing, mono-objetivo F(x)) e Solução 2 (NSGA-II com os objetivos f₁ a f₄).';
    if (!X) return head('Trabalho final', 'Experiências', intro) + '<div class="panel"><p class="muted">Ainda não há resultados. Corra <code>node tools/experiencias.js</code>.</p></div>';
    const m = X.meta, r = X.res, t = r.tabela13;
    const g = (id) => r.metricas.find((x) => x.id === id);
    const d = (id) => (id === 'C2' ? 4 : ['M2', 'TB', 'M5'].includes(id) ? 1 : 0);
    const pfmt = (p) => (p == null ? '—' : p < 0.001 ? '< 0,001' : num(p, 3));
    const s2pts = [].concat(...X.s2.map((x) => x.frente));
    const s1pts = X.s1.map((x) => x.f);
    const ser = [{ pts: s2pts, cor: 'var(--accent)' }, { pts: s1pts, cor: 'var(--hard)', r: 3.5, op: 0.8 }];
    const nomes = ['f₁ obrigatórias', 'f₂ 1 − ocupação', 'f₃ furos + salas', 'f₄ fora da mancha'];
    const conv = (x) => x.hist;
    const histMed = (runs) => runs.length ? conv(runs[0]) : [];
    return head('Trabalho final', 'Experiências', intro)
      + `<div class="panel"><h3>Instância e protocolo</h3><p class="small">${esc(m.instancia)}: ${num(m.aulasLivres, 0)} aulas a horarizar, do ${esc(m.horarioBase)}. ${m.aulasFixas ? `${num(m.aulasFixas, 0)} aulas de outros cursos com turmas partilhadas ficam fixas e ${num(m.reservasDeOutrosCursos, 0)} aulas dos restantes cursos ocupam as salas nas suas semanas. ` : 'Todas as aulas de todos os cursos são horarizadas de novo (dia, hora e sala). '}${m.sessoesPontuais ? `${num(m.sessoesPontuais, 0)} sessões pontuais (seminários de 5 h) não contam como aulas: ficam como no Manual. ` : ''}Orçamento T = ${m.T} s por execução (inclui a construção inicial), sementes ${m.sementes[0]} a ${m.sementes[1]}, ${esc(m.grelha)}. Node ${esc(m.ambiente.node)}, ${esc(m.ambiente.cpu || '')}.</p>
        <div class="kpis">${kpi(num(X.s1.length, 0) + ' + ' + num(X.s2.length, 0), 'execuções (S1 + S2)')}${kpi(num(r.s1Inicial.mediana, 0), 'custo mediano do Greedy inicial (S1)')}${kpi(num(r.s1Inicial.melhoriaMediana * 100, 1) + '%', 'melhoria mediana pelo SA')}${kpi(num(r.s2Info.geracoes, 0), 'gerações por execução (S2, mediana)')}</div></div>
      <div class="panel"><h3>Tabela 13 – Indicadores multiobjetivo</h3>
        ${table([{ a: 'Solução 1 (Greedy + Simulated Annealing)', hv: t.s1.hv, fr: '1', f1: t.s1.f1min }, { a: 'Solução 2 (NSGA-II)', hv: t.s2.hv, fr: `${num(t.s2.frente[0], 1)} ± ${num(t.s2.frente[1], 1)}`, f1: t.s2.f1min }], [{ h: 'Abordagem', k: 'a' }, { h: 'Hipervolume (média ± dp)', f: (x) => `${num(x.hv[0], 4)} ± ${num(x.hv[1], 4)}`, num: true }, { h: 'Dimensão da frente', f: (x) => x.fr, num: true }, { h: 'Execuções com f₁ mínimo', f: (x) => num(x.f1, 1) + '%', num: true }])}
        <p class="small muted">f₁ mínimo observado: ${num(t.f1min, 0)}. Objetivos normalizados entre o mínimo e o máximo observados; ponto de referência (1,1; 1,1; 1,1; 1,1).</p></div>
      <div class="panel"><h3>Tabela 14 – Comparação com o horário manual do ISCTE (medianas)</h3>
        ${table([['M1', 'M1 Conflitos (HC1–HC3)'], ['HARD', 'Violações obrigatórias'], ['M2', 'M2 Taxa de ocupação (%)'], ['M3', 'M3 Furos'], ['M6', 'M6 Aulas seguidas da mesma UC em salas diferentes'], ['M4', 'M4 Aulas fora da mancha'], ['C1', 'C1 Custo total F(x)'], ['C4', 'C4 Aulas não agendadas']].map(([id, n]) => ({ id, n, x: g(id) })), [{ h: 'Métrica', k: 'n' }, { h: 'Horário manual', f: (o) => num(o.x.manual, d(o.id)), num: true }, { h: 'Solução 1', f: (o) => num(o.x.s1.mediana, d(o.id)), num: true }, { h: 'Solução 2', f: (o) => num(o.x.s2.mediana, d(o.id)), num: true }])}</div>
      <div class="panel"><h3>Testes estatísticos (H1 a H3)</h3><p class="small muted">${umaS2 ? 'A melhor solução da Solução 2 (menor f₁ na frente) contra as execuções da Solução 1: Wilcoxon de postos sinalizados para uma amostra, bilateral, 5% de significância, correção de Holm. Â12 é a proporção de execuções da Solução 1 com valor maior do que o da Solução 2 (0,5 = igual).' : 'Mann-Whitney bilateral, 5% de significância, correção de Holm. Â12 é a probabilidade de uma execução da Solução 1 ter valor maior do que uma da Solução 2 (0,5 = igual).'}</p>
        ${table(r.metricas, [{ h: 'Métrica', f: (x) => `${esc(x.id)} ${esc(x.nome)}` }, { h: 'Melhor', f: (x) => x.sentido }, { h: 'Solução 1 mediana [Q1–Q3]', f: (x) => `${num(x.s1.mediana, d(x.id))} <span class="muted small">[${num(x.s1.q1, d(x.id))}–${num(x.s1.q3, d(x.id))}]</span>`, num: true }, { h: 'Solução 2 mediana [Q1–Q3]', f: (x) => `${num(x.s2.mediana, d(x.id))} <span class="muted small">[${num(x.s2.q1, d(x.id))}–${num(x.s2.q3, d(x.id))}]</span>`, num: true },
          { h: 'p (Holm)', f: (x) => (x.pHolm == null ? '—' : `${pfmt(x.pHolm)}${x.signif ? ' <span class="pill ok">sig.</span>' : ''}`), num: true }, { h: 'Â12', f: (x) => (x.pHolm == null ? '—' : num(x.a12, 2)), num: true }, { h: 'Efeito', f: (x) => (x.pHolm == null ? 'orçamento igual' : x.magnitude) }])}</div>
      <div class="panel"><h3>H4 – Conflito entre objetivos (Spearman nas frentes da Solução 2)</h3>
        ${table(r.spearman, [{ h: 'Par', k: 'par' }, { h: 'ρ', f: (x) => num(x.rho, 3), num: true }, { h: 'n', f: (x) => num(x.n, 0), num: true }, { h: 'p (Holm)', f: (x) => pfmt(x.pHolm) + (x.conflito ? ' <span class="pill soft">conflito</span>' : ''), num: true }, { h: 'ρ mediano por execução', f: (x) => (x.medianaPorExecucao == null ? '—' : num(x.medianaPorExecucao, 3)), num: true }, { h: 'Execuções com ρ < 0', f: (x) => `${x.execucoesNegativas} de ${x.execucoes}`, num: true }])}</div>
      <div class="panel"><h3>Figura 1 – Projeções da Frente de Pareto</h3><p class="small muted"><span style="color:var(--accent)">●</span> soluções não dominadas da Solução 2 (${umaS2 ? '1 execução' : X.s2.length + ' execuções'}) · <span style="color:var(--hard)">●</span> solução de cada execução da Solução 1. O horário manual fica fora da escala (f₁ = ${num(X.manual.f[0], 0)}).</p>
        <div class="row" style="flex-wrap:wrap;gap:12px">${dispersao(ser, 0, 1, nomes[0], nomes[1])}${dispersao(ser, 0, 2, nomes[0], nomes[2])}${dispersao(ser, 2, 3, nomes[2], nomes[3])}</div></div>
      <div class="panel"><h3>Convergência (semente ${X.s1[0] ? X.s1[0].seed : ''})</h3><p class="small muted">Custo F(x) ao longo do orçamento T, a partir do fim da construção inicial pelo Greedy.</p><div class="row" style="flex-wrap:wrap;gap:12px"><div style="flex:1;min-width:280px"><p class="small"><b>Solução 1</b>: melhor solução do Simulated Annealing</p>${convergencia(histMed(X.s1), 'var(--hard)')}</div><div style="flex:1;min-width:280px"><p class="small"><b>Solução 2</b>: solução escolhida da frente (menor f₁)</p>${convergencia(histMed(X.s2), 'var(--accent)')}</div></div></div>
      <div class="panel"><details><summary><b>Anexo H – Dados brutos das ${X.s1.length + X.s2.length} execuções</b></summary>
        ${table(X.s1.map((x) => Object.assign({ ab: 'Solução 1', fr: 1, g: x.it }, x)).concat(X.s2.map((x) => Object.assign({ ab: 'Solução 2', fr: x.dimFrente, g: x.geracoes }, x))), [{ h: 'Abordagem', k: 'ab' }, { h: 'Semente', k: 'seed', num: true }, { h: 'M1', k: 'm1', num: true }, { h: 'Obrig.', k: 'hard', num: true }, { h: 'f₁', f: (x) => num(x.f[0], 0), num: true }, { h: 'M2 %', f: (x) => num((1 - x.f[1]) * 100, 1), num: true }, { h: 'M3', f: (x) => num(x.furos != null ? x.furos : x.f[2], 0), num: true }, { h: 'M6', f: (x) => num(x.salaUc, 0), num: true }, { h: 'M4', f: (x) => num(x.f[3], 0), num: true }, { h: 'C1 F(x)', f: (x) => num(x.F, 0), num: true }, { h: 'C2 HV', f: (x) => num(x.hv, 4), num: true }, { h: 'C3', k: 'fr', num: true }, { h: 'C4', k: 'nao', num: true }, { h: 'Melhor aos (s)', f: (x) => num(x.tMelhor / 1000, 1), num: true }, { h: 'M5 (s)', f: (x) => num(x.ms / 1000, 1), num: true }, { h: 'Iter./ger.', f: (x) => num(x.g, 0), num: true }], { maxH: 420 })}</details>
        <p class="small muted">Ficheiros completos: <code>odes/experiencias/anexo-H.csv</code>, <code>resultados.md</code> e <code>runs.json</code>.</p></div>`;
  };

  /* ===== Comparar ===== */
  function metricas(hid) {
    const v = validar(hid);
    const a = D.one('SELECT COUNT(*) n, SUM(duracao) m FROM aula WHERE horario_id = ?', [hid]);
    const o = D.one(`SELECT AVG(CASE WHEN esperados >= capacidade THEN 1.0 ELSE 1.0 * esperados / capacidade END) o, COUNT(DISTINCT sala_id) s,
      AVG(CASE WHEN capacidade >= esperados THEN capacidade - esperados END) vazios,
      SUM(CASE WHEN esperados > capacidade THEN 1 ELSE 0 END) sobre, SUM(CASE WHEN esperados > capacidade THEN esperados - capacidade ELSE 0 END) semLugar,
      AVG(CASE WHEN capacidade >= esperados AND capacidade <= esperados * 1.5 + 10 THEN 1.0 ELSE 0 END) adequada
      FROM v_aula WHERE horario_id = ? AND capacidade > 0`, [hid]);
    // Equilíbrio da ocupação: coeficiente de variação das horas de uso das salas ativas (menor = mais equilibrado).
    const nw = cal().semanas;
    const uso = new Map(D.q('SELECT id FROM sala WHERE ativa = 1').map((x) => [x.id, 0]));
    for (const x of D.q('SELECT sala_id, duracao, semanas FROM aula WHERE horario_id = ? AND sala_id IS NOT NULL', [hid])) if (uso.has(x.sala_id)) uso.set(x.sala_id, uso.get(x.sala_id) + x.duracao * E.pop(x.semanas) / nw);
    const us = [...uso.values()];
    const media = us.reduce((t, x) => t + x, 0) / (us.length || 1);
    const dp = Math.sqrt(us.reduce((t, x) => t + (x - media) * (x - media), 0) / (us.length || 1));
    const r = (k) => (v.porRegra[k] || {}).n || 0;
    const vermelhas = Object.values(v.porRegra).filter((x) => x.sev === 'hard' && x.n).length;
    return { v, n: a.n, horas: (a.m || 0) / 60, ocup: o.o || 0, salas: o.s, vazios: o.vazios || 0, r, semSala: r('NAO_AGENDADA'), pedNao: r('CARACTERISTICA') + r('CARACT_ESSENCIAL'),
      sobre: o.sobre || 0, semLugar: o.semLugar || 0, adequada: o.adequada || 0, equilibrio: media ? dp / media : 0, vermelhas,
      semRepor: D.one("SELECT COUNT(*) n FROM evento_aula WHERE horario_id = ? AND estado = 'sem solução'", [hid]).n };
  }
  /* Indicadores que comprovam (ou não) a melhoria de um horário B face a A: [nome, A, B, menor é melhor, casas decimais, sufixo]. */
  function indicadores(ma, mb) {
    return [
      ['Violações de regras obrigatórias', ma.v.hard, mb.v.hard, true],
      ['Regras obrigatórias com falhas (a vermelho)', ma.vermelhas, mb.vermelhas, true],
      ['Aulas em sobrelotação (mais alunos do que lugares)', ma.sobre, mb.sobre, true],
      ['Estudantes sem lugar sentado (soma)', ma.semLugar, mb.semLugar, true],
      ['Aulas em sala do tamanho certo (%)', Math.round(ma.adequada * 100), Math.round(mb.adequada * 100), false],
      ['Lugares vazios por aula (média)', Math.round(ma.vazios), Math.round(mb.vazios), true],
      ['Desequilíbrio da ocupação das salas (coef. de variação, %)', Math.round(ma.equilibrio * 100), Math.round(mb.equilibrio * 100), true],
      ['Aulas sem sala (que precisam de sala)', ma.semSala, mb.semSala, true],
      ['Pedidos de sala dos docentes não cumpridos', ma.pedNao, mb.pedNao, true],
      ['Aulas suspensas (feriados e eventos) sem reposição', ma.semRepor, mb.semRepor, true],
      ['Violações de critérios de qualidade', ma.v.soft, mb.v.soft, true],
      ['Qualidade global (custo ponderado, menor é melhor)', Math.round(ma.v.custo), Math.round(mb.v.custo), true],
    ];
  }
  function tabelaIndicadores(ma, mb, la, lb) {
    const rows = indicadores(ma, mb);
    const melhor = rows.filter((x) => (x[3] ? x[2] < x[1] : x[2] > x[1])).length, pior = rows.filter((x) => (x[3] ? x[2] > x[1] : x[2] < x[1])).length;
    return `<p class="small">${la} → ${lb}: <span class="pill ok">${melhor} indicadores melhores</span> ${pior ? `<span class="pill hard">${pior} piores</span>` : '<span class="pill">nenhum pior</span>'}</p>`
      + table(rows.map((x) => ({ m: x[0], a: x[1], b: x[2], lb: x[3] })), [{ h: 'Indicador', k: 'm' }, { h: la, f: (x) => num(x.a, 0), num: true }, { h: lb, f: (x) => `<b>${num(x.b, 0)}</b>`, num: true }, { h: 'Diferença', f: (x) => diffPill(x.a, x.b, x.lb), num: true }]);
  }
  VIEWS.comparar = () => {
    const hs = horarios();
    if (!hs.some((h) => h.id === Number(st.cmp.a))) st.cmp.a = hs[0] && hs[0].id;
    if (!hs.some((h) => h.id === Number(st.cmp.b))) st.cmp.b = (hs[1] || hs[0] || {}).id;
    const A = Number(st.cmp.a), B = Number(st.cmp.b);
    const ma = metricas(A), mb = metricas(B);
    const regras = D.q('SELECT codigo, nome, severidade FROM regra WHERE ativa = 1 ORDER BY severidade, id');
    const mud = D.one(`SELECT COUNT(*) n, SUM(CASE WHEN a.dia <> b.dia OR a.inicio <> b.inicio THEN 1 ELSE 0 END) t, SUM(CASE WHEN a.sala_id IS NOT b.sala_id THEN 1 ELSE 0 END) s
      FROM aula a JOIN aula b ON a.turno_id = b.turno_id AND a.seq = b.seq WHERE a.horario_id = ? AND b.horario_id = ?`, [A, B]);
    const extra = regras.map((r) => [r.nome, ma.r(r.codigo), mb.r(r.codigo)]).filter((x) => x[1] || x[2]);
    const lista = D.q(`SELECT va.uc, va.turno, va.dia, va.inicio, va.semanas, va.caracteristica_pedida AS pedido, va.esperados, va.sala AS sa, va.capacidade AS ca, va.tem_caracteristica AS ta, vb.sala AS sb, vb.capacidade AS cb, vb.tem_caracteristica AS tb, vb.dia AS db, vb.inicio AS ib
      FROM aula a JOIN aula b ON a.turno_id = b.turno_id AND a.seq = b.seq JOIN v_aula va ON va.aula_id = a.id JOIN v_aula vb ON vb.aula_id = b.id
      WHERE a.horario_id = ? AND b.horario_id = ? AND (a.sala_id IS NOT b.sala_id OR a.dia <> b.dia OR a.inicio <> b.inicio) ORDER BY va.uc, va.turno LIMIT 300`, [A, B]);
    const salaTxt = (s, c, t, ped, esp) => s ? `${esc(s)} <span class="muted">(${c}${ped && ped !== M.SEM_SALA ? (t ? ', ✓' : ', ✗') : ''})</span>` : '<span class="muted">sem sala</span>';
    return head('Item 3', 'Comparar horários', 'Compare o Horário ISCTE (Manual) com o Horário Otimizado ou outras versões, indicador a indicador, regra a regra e aula a aula.')
      + `<div class="panel"><div class="row"><label class="f">Horário A<select data-change="cmp" data-k="a">${optList(hs, 'id', (h) => `${h.nome} (${ESTADOS[h.estado]})`, A)}</select></label><label class="f">Horário B<select data-change="cmp" data-k="b">${optList(hs, 'id', (h) => `${h.nome} (${ESTADOS[h.estado]})`, B)}</select></label></div>
        <p class="small">${num(mud.n, 0)} aulas existem nos dois horários. Do horário A para o horário B, ${num(mud.t || 0, 0)} mudaram de dia ou hora e ${num(mud.s || 0, 0)} mudaram de sala.</p>
        ${tabelaIndicadores(ma, mb, 'Horário A', 'Horário B')}</div>
      <div class="panel"><h3>Violações por regra</h3>${table(extra.map((x) => ({ m: x[0], a: x[1], b: x[2] })), [{ h: 'Regra', k: 'm' }, { h: 'Horário A', f: (x) => num(x.a, 0), num: true }, { h: 'Horário B', f: (x) => num(x.b, 0), num: true }, { h: 'Diferença', f: (x) => diffPill(x.a, x.b, true), num: true }], { vazio: 'Nenhum dos horários viola regras ativas.' })}</div>
      <div class="panel"><h3>Aulas que mudaram do horário A para o horário B</h3><p class="small muted">Entre parênteses: lugares da sala e se tem a característica pedida (✓ / ✗).</p>
        ${table(lista, [{ h: 'Aula', f: (r) => `<b>${esc(r.uc)}</b> ${esc(r.turno)}` }, { h: 'Quando (A)', f: (r) => `${DC[r.dia]} ${hhmm(r.inicio)}` }, { h: 'Pedido', f: (r) => `<span class="small">${esc(r.pedido || '')}</span>` }, { h: 'Esperados', k: 'esperados', num: true },
          { h: 'Sala A', f: (r) => salaTxt(r.sa, r.ca, r.ta, r.pedido) }, { h: 'Sala B', f: (r) => salaTxt(r.sb, r.cb, r.tb, r.pedido) + (r.db !== r.dia || r.ib !== r.inicio ? ` · ${DC[r.db]} ${hhmm(r.ib)}` : '') }], { maxH: 480, vazio: 'Nenhuma aula mudou.' })}</div>`;
  };

  /* ===== Consultar horários (escopo: por sala, por professor, por turma) ===== */
  VIEWS.consultas = () => {
    const hid = st.horarioId;
    const c = st.consulta;
    if (c.id == null || !D.one(primeiroDe[c.tipo].replace(' ORDER BY', ' WHERE id = ' + Number(c.id) + ' ORDER BY'))) { const r = D.one(primeiroDe[c.tipo]); c.id = r ? r.id : null; }
    const aulas = c.id != null ? aulasDe(hid, c) : [];
    const v = validar(hid);
    const tabs = [['sala', 'Por sala'], ['docente', 'Por professor'], ['turma', 'Por turma']];
    const lists = {
      sala: () => optList(salasAll().filter((s) => s.ativa), 'id', (r) => `${r.codigo} · ${r.capacidade} lugares`, c.id),
      docente: () => optList(docentesAll(), 'id', 'nome', c.id),
      turma: () => optList(turmasAll(), 'id', (r) => `${r.codigo} (${r.sigla})`, c.id),
    };
    let info = '';
    if (c.tipo === 'sala' && c.id) { const s = D.one('SELECT s.*, e.nome AS ed FROM sala s JOIN edificio e ON e.id = s.edificio_id WHERE s.id = ?', [c.id]); const car = D.q('SELECT caracteristica FROM sala_caracteristica WHERE sala_id = ?', [c.id]).map((x) => x.caracteristica); info = `${esc(s.ed)} · ${s.capacidade} lugares${s.capacidade_exame ? ` (${s.capacidade_exame} em exame)` : ''}<div class="chips" style="margin-top:4px">${car.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>`; }
    if (c.tipo === 'docente' && c.id) { const d = D.one('SELECT * FROM docente WHERE id = ?', [c.id]); info = `${esc(d.categoria || '')} · ${esc(d.departamento || '')}`; }
    if (c.tipo === 'turma' && c.id) { const t = D.one("SELECT t.*, c.sigla, c.nome AS cn, COALESCE(t.regime, c.regime, 'diurno') AS regime FROM turma t LEFT JOIN curso c ON c.id = t.curso_id WHERE t.id = ?", [c.id]); info = `${esc(t.sigla || 'sem curso')}${t.cn && t.cn !== t.sigla ? ' · ' + esc(t.cn) : ''} · regime ${regimeTxt(t.regime)}`; }
    const sel = st.sel != null ? D.one(AULAS_SQL + ' AND v.aula_id = ?', [hid, st.sel]) : null;
    const tot = aulas.reduce((s, a) => s + a.duracao, 0);
    return head('Horários', 'Consultar horários', `Horário ${hLabel(hid)}.`)
      + `<div class="tabs" role="tablist">${tabs.map(([k, n]) => `<button role="tab" aria-selected="${c.tipo === k}" data-act="cons-tipo" data-k="${k}">${n}</button>`).join('')}</div>`
      + `<div class="row"><label class="f">${{ sala: 'Sala', docente: 'Professor', turma: 'Turma' }[c.tipo]}<select data-change="cons-id" style="max-width:300px">${lists[c.tipo]() || '<option>—</option>'}</select></label>${semanaSel()}</div>`
      + (info ? `<p class="small">${info}</p>` : '')
      + (c.tipo === 'docente' && !docentesAll().length ? '<div class="callout">Ainda não há professores registados neste conjunto de dados.</div>' : '')
      + `<div class="kpis">${kpi(aulas.length, st.semana ? `aulas na semana ${st.semana}` : 'aulas semanais')}${kpi(horas(tot), 'de aulas')}</div>`
      + `<div class="cols"><div class="stack">${grid({ id: 'tt-q', aulas, viol: can('horario.ver_rascunhos') ? v.porAula : null, clickable: true, selectable: true, mancha: c.tipo === 'turma' ? manchaPara(c) : null, mostrar: c.tipo === 'sala' ? 'turmas' : c.tipo === 'docente' ? 'turmas' : 'docente' })}${legendaGrid()}</div>
        <div class="stack">${sel ? detalheAula(sel, v, false) : '<div class="panel"><p class="small muted">Clique numa aula para ver o detalhe' + (can('pedidos.criar') ? ' e pedir uma alteração' : '') + '.</p></div>'}
        <div class="panel"><h3>Lista</h3>${table(aulas, [{ h: 'Dia', f: (a) => DC[a.dia] }, { h: 'Horas', f: (a) => `${hhmm(a.inicio)}–${hhmm(a.fim)}` }, { h: 'Aula', f: (a) => `<b>${esc(a.uc)}</b> ${esc(a.tipo_aula)} ${esc(a.turno)}` }, { h: c.tipo === 'sala' ? 'Turmas' : 'Sala', f: (a) => esc(c.tipo === 'sala' ? a.turmas : (a.sala || '—')) }], { maxH: 360, vazio: 'Sem aulas.' })}</div></div></div>`;
  };
  AFTER.consultas = () => bindDrag('tt-q', null, (id) => { st.sel = id; render(); });

  /* ===== Aprovação e publicação (governação) ===== */
  function transicao(hid, acao, comentario) {
    const h = horario(hid);
    if (!h) return;
    const nome = h.nome;
    if (acao === 'submeter') {
      if (h.estado !== 'rascunho' || !can('horario.submeter')) return toast('Sem permissão ou estado inválido.');
      D.run("UPDATE horario SET estado = 'em revisao', submetido_por = ? WHERE id = ?", [U.username, hid]);
      changed('Submetido para revisão', nome + (comentario ? ' · ' + comentario : ''));
      toast('Submetido. A direção de curso pode agora aprovar ou devolver.');
    } else if (acao === 'aprovar') {
      if (h.estado !== 'em revisao' || !can('horario.aprovar')) return toast('Sem permissão ou estado inválido.');
      if (h.submetido_por === U.username) return toast('Separação de funções: quem submeteu não pode aprovar.');
      if (U.perfil_id === 'admin' && !comentario) return toast('O administrador aprova em substituição da direção de curso: indique a justificação no comentário.');
      D.run("UPDATE horario SET estado = 'aprovado', aprovado_por = ? WHERE id = ?", [U.username, hid]);
      changed(U.perfil_id === 'admin' ? 'Horário aprovado (administrador em substituição da Direção de curso)' : 'Horário aprovado', nome + (comentario ? ' · ' + comentario : ''));
      toast('Aprovado. O gabinete de horários pode publicá-lo.');
    } else if (acao === 'devolver') {
      if (!['em revisao', 'aprovado'].includes(h.estado) || !can('horario.aprovar')) return toast('Sem permissão ou estado inválido.');
      if (!comentario) return toast('Indique o motivo da devolução.');
      if (U.perfil_id === 'admin') changed('Devolução feita pelo administrador em substituição da Direção de curso', nome);
      D.run("UPDATE horario SET estado = 'rascunho', aprovado_por = NULL, notas = COALESCE(notas, '') || ? WHERE id = ?", [`\nDevolvido por ${U.username} em ${agora().slice(0, 10)}: ${comentario}`, hid]);
      changed('Horário devolvido', `${nome} · ${comentario}`);
      toast('Devolvido ao gabinete de horários com comentário.');
    } else if (acao === 'publicar') {
      if (h.estado !== 'aprovado' || !can('horario.publicar')) return toast('Só se publicam horários aprovados.');
      D.tx(() => {
        for (const x of D.q("SELECT id, nome FROM horario WHERE estado = 'publicado' AND ano_letivo = ? AND semestre = ? AND id <> ?", [h.ano_letivo, h.semestre, hid])) {
          D.run("UPDATE horario SET estado = 'arquivado' WHERE id = ?", [x.id]);
          registar('Horário arquivado', `${x.nome} (substituído por ${nome})`);
        }
        D.run("UPDATE horario SET estado = 'publicado', publicado_em = ? WHERE id = ?", [agora(), hid]);
      });
      changed('Horário publicado', nome);
      st.horarioId = hid;
      toast('Publicado. Docentes e estudantes passam a ver esta versão.');
    } else if (acao === 'nova') {
      if (!can('horario.editar')) return toast('Sem permissão.');
      const id = D.tx(() => {
        D.run("INSERT INTO horario (nome, ano_letivo, semestre, origem, criado_em, notas, estado, criado_por) VALUES (?,?,?,'manual',?,?,'rascunho',?)",
          [h.nome.replace(/ \((rascunho|cópia)[^)]*\)$/, '') + ` (rascunho ${agora().slice(8, 10)}/${agora().slice(5, 7)})`, h.ano_letivo, h.semestre, agora(), 'Nova versão a partir de: ' + h.nome, U.username]);
        const nid = D.lastId();
        D.run('INSERT INTO aula (horario_id, turno_id, seq, dia, inicio, duracao, sala_id, fixa, semanas, caracteristica_pedida, reposicao_de, evento_id) SELECT ?, turno_id, seq, dia, inicio, duracao, sala_id, fixa, semanas, caracteristica_pedida, reposicao_de, evento_id FROM aula WHERE horario_id = ?', [nid, h.id]);
        D.run(`INSERT OR IGNORE INTO evento_aula (evento_id, horario_id, aula_id, semana, nova_aula_id, nova_semana, estado, nota)
          SELECT x.evento_id, :n, b.id, x.semana, nb.id, x.nova_semana, x.estado, x.nota FROM evento_aula x
          JOIN aula a ON a.id = x.aula_id JOIN aula b ON b.horario_id = :n AND b.turno_id = a.turno_id AND b.seq = a.seq
          LEFT JOIN aula na ON na.id = x.nova_aula_id LEFT JOIN aula nb ON nb.horario_id = :n AND nb.turno_id = na.turno_id AND nb.seq = na.seq
          WHERE x.horario_id = :h`, { ':n': nid, ':h': h.id });
        return nid;
      });
      st.horarioId = id; st.undo = []; st.sel = null;
      changed('Nova versão em rascunho', `${nome} → rascunho`);
      toast('Nova versão em rascunho criada e selecionada.');
    }
    render();
  }
  VIEWS.revisao = () => {
    const hs = todosHorarios();
    const pub = hs.filter((h) => h.estado === 'publicado');
    const linha = (h) => {
      const v = validar(h.id);
      const ref = pub.find((p) => p.id !== h.id && p.ano_letivo === h.ano_letivo && p.semestre === h.semestre);
      const vr = ref ? validar(ref.id) : null;
      const acoes = [];
      if (h.estado === 'rascunho' && can('horario.submeter')) acoes.push(`<button class="btn small primary" data-act="wf" data-a="submeter" data-id="${h.id}">Submeter</button>`);
      if (h.estado === 'em revisao' && can('horario.aprovar')) acoes.push(h.submetido_por === U.username ? '<span class="small muted">submetido por si: outra pessoa aprova</span>' : `<button class="btn small primary" data-act="wf" data-a="aprovar" data-id="${h.id}">Aprovar</button>`);
      if (['em revisao', 'aprovado'].includes(h.estado) && can('horario.aprovar')) acoes.push(`<button class="btn small" data-act="wf" data-a="devolver" data-id="${h.id}">Devolver</button>`);
      if (h.estado === 'aprovado' && can('horario.publicar')) acoes.push(`<button class="btn small primary" data-act="wf" data-a="publicar" data-id="${h.id}" data-confirm="1">Publicar</button>`);
      acoes.push(`<button class="btn small" data-act="ver-h" data-id="${h.id}">Ver</button>`);
      return `<tr><td><b>${esc(h.nome)}</b><br><span class="small muted">${esc(h.origem)} · criado por ${esc(h.criado_por || '—')}${h.submetido_por ? ` · submetido por ${esc(h.submetido_por)}` : ''}${h.aprovado_por ? ` · aprovado por ${esc(h.aprovado_por)}` : ''}${h.publicado_em ? ` · publicado ${esc(h.publicado_em.slice(0, 10))}` : ''}</span>${h.notas && /Devolvido/.test(h.notas) ? `<br><span class="small">${esc(h.notas.split('\n').filter((x) => /Devolvido/.test(x)).pop())}</span>` : ''}</td>
        <td>${estadoPill(h.estado)}</td><td class="num">${num(v.hard, 0)}${vr ? ' ' + diffPill(vr.hard, v.hard, true) : ''}</td><td class="num">${num(v.soft, 0)}${vr ? ' ' + diffPill(vr.soft, v.soft, true) : ''}</td><td><div class="row">${acoes.join('')}</div></td></tr>`;
    };
    const ativos = hs.filter((h) => h.estado !== 'arquivado');
    const arq = hs.filter((h) => h.estado === 'arquivado');
    const hist = D.q("SELECT * FROM registo WHERE acao IN ('Submetido para revisão','Horário aprovado','Horário devolvido','Horário publicado','Horário arquivado','Nova versão em rascunho','Horário gerado') ORDER BY id DESC LIMIT 30");
    return head('Governação', 'Aprovação e publicação', 'Cada versão de horário passa por rascunho → em revisão → aprovado → publicado. Entre parênteses, a diferença face ao horário publicado do mesmo semestre.')
      + `<div class="panel"><div class="row"><label class="f" style="flex:1;min-width:220px">Comentário (obrigatório para devolver)<input type="text" id="wf-coment" placeholder="Ex.: Rever as salas do 1.º ano de LEI"></label></div>
        <div class="tablewrap"><table><thead><tr><th>Versão</th><th>Estado</th><th class="num">Obrigatórias</th><th class="num">Qualidade</th><th>Ações</th></tr></thead><tbody>${ativos.map(linha).join('')}</tbody></table></div>
        ${arq.length ? `<details><summary class="small">${arq.length} versão(ões) arquivada(s)</summary><div class="tablewrap"><table><tbody>${arq.map(linha).join('')}</tbody></table></div></details>` : ''}</div>`
      + `<div class="panel"><h3>Histórico de decisões</h3>${table(hist, [{ h: 'Quando', f: (r) => `<span class="mono small">${esc(r.quando.replace('T', ' '))}</span>` }, { h: 'Quem', f: (r) => esc(r.utilizador || r.ator) }, { h: 'Ação', k: 'acao' }, { h: 'Detalhe', k: 'detalhe' }], { vazio: 'Sem decisões registadas.' })}</div>`;
  };

  /* ===== Pedidos de alteração ===== */
  function pedidoForm() {
    const p = st.pedido;
    if (!p) return '';
    const a = D.one(AULAS_SQL + ' AND v.aula_id = ?', [horario(p.aulaHid) ? p.aulaHid : st.horarioId, p.aulaId]) || D.one('SELECT v.*, NULL AS turmas FROM v_aula v WHERE aula_id = ?', [p.aulaId]);
    if (!a) return '';
    return `<form class="panel" data-submit="pedido"><h3>Pedir alteração: ${esc(a.uc)} ${esc(a.turno)}</h3>
      <p class="small">${esc(a.uc_nome)} · ${DIAS[a.dia]} ${hhmm(a.inicio)}–${hhmm(a.fim)} · ${esc(a.sala || 'sem sala')} · ${esc(semTxt(a.semanas))}</p>
      <label class="f">Motivo<textarea id="pd-motivo" rows="3" required placeholder="Ex.: a sala não tem computadores; tenho outra aula noutro edifício a seguir"></textarea></label>
      <div class="formgrid"><label class="f">Dia proposto<select id="pd-dia" data-change="pd-slot"><option value="">Manter</option>${DIAS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></label>
        <label class="f">Início proposto<select id="pd-ini" data-change="pd-slot"><option value="">Manter</option>${TIMES.filter((m) => m + a.duracao <= 1410).map((m) => `<option value="${m}">${hhmm(m)}</option>`).join('')}</select></label>
        <label class="f">Sala proposta<select id="pd-sala">${salasPedido(a, null, null)}</select></label>
        <label class="f">Alunos previstos em sala<input type="number" id="pd-alunos" min="1" max="999" data-change="pd-slot" placeholder="opcional (esperados: ${a.esperados})"></label></div>
      <p class="small muted" id="pd-sala-nota">Só aparecem as salas livres nesse dia, hora e semanas da aula. ${a.inscritos} inscritos · ${esc(presencaCurta(a))}. Se indicar os alunos que costumam estar em sala, a lista de salas e a regra da capacidade usam esse número.</p>
      <div class="row"><button class="btn primary" type="submit">Enviar pedido</button><button class="btn" type="button" data-act="pedido-cancel">Cancelar</button></div></form>`;
  }
  /* Salas livres para o pedido: no dia e hora propostos (ou os atuais) e nas semanas da aula. */
  function salasPedido(a, dia, ini, previstos) {
    const d = dia == null ? a.dia : dia, i0 = ini == null ? a.inicio : ini;
    const P = M.buildProblem(D, { horarioId: a.horario_id, blocos: false });
    const idx = P.aulas.findIndex((x) => x.id === a.aula_id);
    const alunos = previstos > 0 ? previstos : idx >= 0 ? P.aulas[idx].esperado : (a.inscritos || 1);
    const res = E.searchRooms(P, { dia: d, ini: i0, dur: a.duracao, alunos, car: a.caracteristica_pedida, semanas: a.semanas, ignorar: idx })
      .filter((x) => x.livre && x.sala.id !== a.sala_id);
    const ok = res.filter((x) => x.capOk), pequenas = res.filter((x) => !x.capOk);
    const op = (x) => `<option value="${x.sala.id}">${esc(x.sala.codigo)} · ${x.sala.cap} lugares${x.carOk ? '' : x.carEq ? ' · equivalente' : a.caracteristica_pedida ? ' · sem ' + esc(a.caracteristica_pedida) : ''}${x.capOk ? '' : ' · pequena'}</option>`;
    return `<option value="">Manter / indiferente</option>`
      + (ok.length ? `<optgroup label="Livres (${ok.length})">${ok.map(op).join('')}</optgroup>` : '<option disabled>Nenhuma sala livre com lugares suficientes</option>')
      + (pequenas.length ? `<optgroup label="Livres mas pequenas (${pequenas.length})">${pequenas.map(op).join('')}</optgroup>` : '');
  }
  SUBMIT.pedido = () => {
    const p = st.pedido;
    const a = D.one('SELECT * FROM v_aula WHERE aula_id = ?', [p.aulaId]);
    const motivo = $('#pd-motivo').value.trim();
    if (!motivo) { toast('Indique o motivo.'); return; }
    const prop = { dia: $('#pd-dia').value === '' ? null : Number($('#pd-dia').value), inicio: $('#pd-ini').value === '' ? null : Number($('#pd-ini').value), sala_id: $('#pd-sala').value === '' ? null : Number($('#pd-sala').value) };
    const prev = Number($('#pd-alunos').value);
    if (prev > 0) prop.alunos_previstos = Math.round(prev);
    const txt = [prop.dia != null ? DIAS[prop.dia] : '', prop.inicio != null ? hhmm(prop.inicio) : '', prop.sala_id ? D.one('SELECT codigo FROM sala WHERE id = ?', [prop.sala_id]).codigo : '', prop.alunos_previstos ? prop.alunos_previstos + ' alunos' : ''].filter(Boolean).join(' ') || 'sem proposta concreta';
    const tipo = tipoPedido(prop);
    const apr = {};
    for (const pf of APROVADORES[tipo]) apr[pf] = pf === U.perfil_id ? { decisao: 'aprovado', por: U.username, em: agora(), nota: 'autor do pedido' } : null;
    D.run('INSERT INTO pedido (criado_em, autor, perfil, horario_id, aula_id, resumo, motivo, proposta, tipo, aprovacoes) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [agora(), U.username, U.perfil_id, a.horario_id, a.aula_id, `${a.uc} ${a.turno} · ${DC[a.dia]} ${hhmm(a.inicio)} ${a.sala || ''} → ${txt}`, motivo, JSON.stringify(prop), tipo, JSON.stringify(apr)]);
    changed('Pedido de alteração', `${a.uc} ${a.turno}: ${motivo.slice(0, 120)}`);
    st.pedido = null; st.view = 'pedidos';
    toast(`Pedido enviado para aprovação: ${APROVADORES[tipo].filter((pf) => !apr[pf]).map((pf) => PAPEL[pf]).join(' e ')}.`);
    render();
  };
  /* Participação esperada (componente.taxa_presenca): no futuro vem do Fénix, a partir do que o aluno indica ao
     inscrever-se. Enquanto o Fénix não envia dados fica o valor por omissão (100%), ou seja, esperados = inscritos. */
  const taxaAula = (a) => { const r = D.one('SELECT c.taxa_presenca AS t FROM turno t JOIN componente c ON c.id = t.componente_id WHERE t.id = ?', [a.turno_id]); return r && r.t != null ? r.t : 1; };
  function presencaCurta(a) {
    const t = taxaAula(a);
    return t === 1 ? 'participação esperada 100% (por omissão, sem dados do Fénix)' : `participação esperada ${Math.round(t * 100)}% (${a.esperados} alunos)`;
  }
  function presencaTxt(a) {
    const t = taxaAula(a);
    return `<p class="small">Estimativa de presença (Fénix): ${t === 1 ? '<span class="muted">sem dados do Fénix</span> · conta-se 100% dos inscritos' : `<b>${Math.round(t * 100)}%</b> · ${a.esperados} alunos esperados`}</p>`;
  }
  function alunosPedidoTxt(r) {
    let prop = {}; try { prop = JSON.parse(r.proposta || '{}'); } catch (e) { prop = {}; }
    if (!prop.alunos_previstos) return '';
    const a = D.one('SELECT inscritos, esperados FROM v_aula WHERE aula_id = ?', [r.aula_id]);
    return `<br><span class="pill">${prop.alunos_previstos} alunos previstos em sala</span>${a ? ` <span class="small muted">${a.inscritos} inscritos${a.esperados !== a.inscritos ? `, ${a.esperados} esperados` : ''}</span>` : ''}`;
  }
  /* Impacto de um pedido nas regras: compara as violações da aula antes e depois da proposta,
     no horário onde seria aplicado (o rascunho escolhido ou o horário do pedido). */
  function impactoPedido(p, hid, cacheP) {
    const prop = JSON.parse(p.proposta || '{}');
    if (prop.dia == null && prop.inicio == null && prop.sala_id == null && !prop.alunos_previstos) return null;
    const orig = D.one('SELECT turno_id, seq FROM aula WHERE id = ?', [p.aula_id]);
    if (!orig || hid == null) return null;
    const P = cacheP.get(hid) || (cacheP.set(hid, M.buildProblem(D, { horarioId: hid })), cacheP.get(hid));
    const i = P.aulas.findIndex((a) => a.turnoId === orig.turno_id && a.seq === orig.seq);
    if (i < 0) return null;
    const a = P.aulas[i];
    const antes = E.violationsOf(P, i);
    const salaIdx = prop.sala_id != null ? P.salas.findIndex((x) => x.id === prop.sala_id) : a.sala;
    const P2 = Object.assign({}, P, { aulas: P.aulas.slice() });
    P2.aulas[i] = Object.assign({}, a, { dia: prop.dia != null ? prop.dia : a.dia, ini: prop.inicio != null ? prop.inicio : a.ini, sala: salaIdx, _rooms: undefined });
    // Alunos indicados pelo professor: passam à frente dos esperados (inscritos × participação) na regra da capacidade.
    if (prop.alunos_previstos > 0) Object.assign(P2.aulas[i], { esperado: prop.alunos_previstos, inscritos: prop.alunos_previstos });
    const depois = E.violationsOf(P2, i);
    const k = (v) => v.codigo + '|' + v.aulas.slice().sort((x, y) => x - y).join(',');
    const ka = new Set(antes.map(k)), kd = new Set(depois.map(k));
    const novas = depois.filter((v) => !ka.has(k(v))), resolvidas = antes.filter((v) => !kd.has(k(v)));
    return { novasHard: novas.filter((v) => v.sev === 'hard'), novasSoft: novas.filter((v) => v.sev !== 'hard'), resolvidas };
  }
  function impactoTxt(im) {
    if (!im) return '<span class="small muted">sem proposta concreta</span>';
    const nomes = (l) => [...new Set(l.map((v) => v.nome || v.codigo))].join(', ');
    const out = [];
    if (im.novasHard.length) out.push(`<span class="pill hard">+${im.novasHard.length} obrigatória${im.novasHard.length > 1 ? 's' : ''}</span> <span class="small">${esc(nomes(im.novasHard))}</span>`);
    if (im.novasSoft.length) out.push(`<span class="pill soft">+${im.novasSoft.length} qualidade</span> <span class="small">${esc(nomes(im.novasSoft))}</span>`);
    if (im.resolvidas.length) out.push(`<span class="pill ok">−${im.resolvidas.length} resolvida${im.resolvidas.length > 1 ? 's' : ''}</span> <span class="small">${esc(nomes(im.resolvidas))}</span>`);
    return out.length ? out.join('<br>') : '<span class="pill ok">sem efeito nas regras</span>';
  }
  VIEWS.pedidos = () => {
    const dec = can('pedidos.decidir');
    const pf = U.perfil_id;
    let rows = D.q('SELECT p.*, h.nome AS hnome, h.estado AS hestado FROM pedido p LEFT JOIN horario h ON h.id = p.horario_id ORDER BY (p.estado = \'pendente\') DESC, p.id DESC');
    // Cada perfil vê os seus pedidos e os que passam por si: gestor de horários todos, gestão de espaços os de sala,
    // direção de curso os de mudança de horário das aulas do seu curso.
    rows = rows.filter((r) => r.autor === U.username || (dec && (pf === 'gestor' || pf === 'admin'
      || (pf === 'espacos' && (r.tipo || 'horario') === 'sala')
      || (pf === 'curso' && (r.tipo || 'horario') === 'horario' && (!U.curso_id || cursosDaAula(r.aula_id).includes(U.curso_id))))));
    const rasc = D.q("SELECT id, nome FROM horario WHERE estado = 'rascunho' ORDER BY id DESC");
    const pill = (e) => `<span class="pill ${e === 'aprovado' ? 'ok' : e === 'rejeitado' ? 'hard' : 'soft'}">${e}</span>`;
    const alvoSel = st.pdAlvo !== undefined ? st.pdAlvo : (rasc[0] ? String(rasc[0].id) : '');
    const cacheP = new Map();
    const imp = new Map(rows.filter((r) => r.estado === 'pendente').map((r) => [r.id, impactoPedido(r, alvoSel ? Number(alvoSel) : r.horario_id, cacheP)]));
    const circuito = (r) => {
      const apr = aprovacoesDe(r);
      return Object.entries(apr).map(([k, x]) => `<div class="small">${x ? (x.decisao === 'aprovado' ? '<span class="pill ok">✓</span>' : '<span class="pill hard">✗</span>') : '<span class="pill soft">a aguardar</span>'} ${esc(PAPEL[k] || k)}${x ? ` <span class="muted">· ${esc(x.por)} ${esc(String(x.em).slice(0, 16).replace('T', ' '))}${x.nota ? ': ' + esc(x.nota) : ''}</span>` : ''}</div>`).join('');
    };
    const intro = dec ? 'Pedidos de docentes e direções de curso. Um pedido só de sala é aprovado pela gestão de espaços; uma mudança de dia ou hora precisa da direção de curso e do gestor de horários. Quando todos aprovam, a alteração pode ser aplicada a uma versão em rascunho, com validação das regras.'
      : 'Os seus pedidos e o estado de cada aprovação. Um pedido só de sala é aprovado pela gestão de espaços; uma mudança de dia ou hora precisa da direção de curso e do gestor de horários. Para pedir, clique numa aula no seu horário.';
    return head('Governação', 'Pedidos de alteração', intro)
      + pedidoForm()
      + (dec ? `<div class="panel"><div class="row"><label class="f">Aplicar as aprovações em<select id="pd-alvo" data-change="pd-alvo"><option value="">Não aplicar (só registar a decisão)</option>${optList(rasc, 'id', 'nome', alvoSel)}</select></label><label class="f" style="flex:1;min-width:200px">Comentário da decisão<input type="text" id="pd-coment" placeholder="${U.perfil_id === 'admin' ? 'Obrigatório: justificação da substituição (ex.: gestor de espaços ausente por doença)' : 'Opcional ao aprovar, obrigatório ao rejeitar'}"></label></div>${rasc.length ? '' : '<p class="small muted">Não há versões em rascunho: para aplicar pedidos, crie uma nova versão a partir do horário publicado.</p>'}</div>` : '')
      + `<div class="panel">${table(rows, [
        { h: 'Pedido', f: (r) => `<b>${esc(r.resumo)}</b><br><span class="pill">${(r.tipo || 'horario') === 'sala' ? 'só sala' : 'dia/hora'}</span> <span class="small">${esc(r.motivo || '')}</span>${alunosPedidoTxt(r)}` },
        { h: 'Autor', f: (r) => `${esc(r.autor)}<br><span class="small muted">${esc(r.criado_em.slice(0, 16).replace('T', ' '))}</span>` },
        { h: 'Horário', f: (r) => `<span class="small">${esc(r.hnome || '—')}</span>` },
        { h: 'Estado', f: (r) => pill(r.estado) + (r.aplicado ? `<br><span class="small muted">aplicado em ${esc(r.aplicado)}</span>` : r.estado === 'aprovado' ? '<br><span class="small muted">por aplicar</span>' : '') },
        { h: 'Quem aprova', f: circuito },
        ...(dec ? [{ h: 'Impacto nas regras', f: (r) => (r.estado === 'pendente' ? impactoTxt(imp.get(r.id)) : '') }] : []),
        ...(dec ? [{ h: '', f: (r) => {
          if (r.estado === 'aprovado' && !r.aplicado && can('horario.editar')) return `<div class="row"><button class="btn small" data-act="pd-aplicar" data-id="${r.id}">Aplicar</button><button class="btn small" data-act="goto-aula" data-id="${r.aula_id}">Ver aula</button></div>`;
          const subs = papeisEmFalta(r);
          if (subs.length) {
            const hardA = (imp.get(r.id) || { novasHard: [] }).novasHard.length;
            return `<div class="small muted">Em substituição de:</div><div class="row">${subs.map((k) => (hardA ? '' : `<button class="btn small primary" data-act="pd-dec" data-id="${r.id}" data-d="aprovado" data-subst="${k}">Aprovar por ${esc(PAPEL[k])}</button>`) + `<button class="btn small danger" data-act="pd-dec" data-id="${r.id}" data-d="rejeitado" data-subst="${k}">Rejeitar por ${esc(PAPEL[k])}</button>`).join('')}<button class="btn small" data-act="goto-aula" data-id="${r.aula_id}">Ver aula</button></div>`;
          }
          const meu = papelNoPedido(r);
          if (!meu) return r.estado === 'pendente' ? `<span class="small muted">${r.autor === U.username ? 'O seu pedido' : 'Não depende de si'}</span>` : '';
          const hard = (imp.get(r.id) || { novasHard: [] }).novasHard.length;
          return `<div class="row">${hard ? '<button class="btn small" disabled title="A proposta viola regras obrigatórias: só pode ser rejeitada">Aprovar</button>' : `<button class="btn small primary" data-act="pd-dec" data-id="${r.id}" data-d="aprovado">Aprovar como ${esc(PAPEL[meu])}</button>`}<button class="btn small danger" data-act="pd-dec" data-id="${r.id}" data-d="rejeitado">Rejeitar</button><button class="btn small" data-act="goto-aula" data-id="${r.aula_id}">Ver aula</button></div>`;
        } }] : []),
      ], { vazio: dec ? 'Sem pedidos.' : 'Ainda não fez pedidos.' })}</div>`;
  };

  /* Circuito de aprovação: um pedido só de sala vai ao gestor de espaços; uma mudança de dia ou hora precisa da
     direção de curso e do gestor de horários. Só quando todos aprovam o pedido fica aprovado (e pode ser aplicado). */
  const APROVADORES = { sala: ['espacos'], horario: ['curso', 'gestor'] };
  const PAPEL = { espacos: 'Gestão de espaços', curso: 'Direção de curso', gestor: 'Gestor de horários' };
  const tipoPedido = (prop) => (prop && prop.dia == null && prop.inicio == null && (prop.sala_id != null || prop.alunos_previstos) ? 'sala' : 'horario');
  function aprovacoesDe(p) {
    let apr = null;
    try { apr = JSON.parse(p.aprovacoes || 'null'); } catch (e) { apr = null; }
    if (!apr) { apr = {}; for (const pf of APROVADORES[p.tipo || 'horario']) apr[pf] = null; }
    return apr;
  }
  const cursosDaAula = (aulaId) => D.q('SELECT DISTINCT t.curso_id FROM aula a JOIN turno_turma tt ON tt.turno_id = a.turno_id JOIN turma t ON t.id = tt.turma_id WHERE a.id = ?', [aulaId]).map((x) => x.curso_id);
  /* O utilizador pode decidir a sua parte deste pedido? */
  /* O administrador pode decidir em substituição de qualquer aprovador em falta (ausência, doença), mas não nos seus próprios pedidos. */
  function papeisEmFalta(p) {
    if (!U || U.perfil_id !== 'admin' || !can('pedidos.decidir') || p.estado !== 'pendente' || p.autor === U.username) return [];
    const apr = aprovacoesDe(p);
    return Object.keys(apr).filter((k) => !apr[k]);
  }
  function papelNoPedido(p, subst) {
    if (subst) return papeisEmFalta(p).includes(subst) ? subst : null;
    if (!U || !can('pedidos.decidir') || p.estado !== 'pendente') return null;
    const pf = U.perfil_id;
    if (pf === 'admin') return papeisEmFalta(p)[0] || null;
    const apr = aprovacoesDe(p);
    if (!(pf in apr) || apr[pf]) return null;
    if (pf === 'curso' && U.curso_id && !cursosDaAula(p.aula_id).includes(U.curso_id)) return null;
    return pf;
  }
  /* Aplica a proposta de um pedido aprovado na versão em rascunho escolhida. */
  function aplicarPedido(p, alvo) {
    const prop = JSON.parse(p.proposta || '{}');
    if (!alvo || (prop.dia == null && prop.inicio == null && prop.sala_id == null)) return { ok: true, nota: '' };
    const orig = D.one('SELECT turno_id, seq, dia, inicio, sala_id FROM aula WHERE id = ?', [p.aula_id]);
    const alvoAula = orig && D.one('SELECT id, dia, inicio, sala_id FROM aula WHERE horario_id = ? AND turno_id = ? AND seq = ?', [Number(alvo), orig.turno_id, orig.seq]);
    if (!alvoAula) return { ok: false, msg: 'A aula do pedido não existe na versão escolhida.' };
    const prevH = st.horarioId; st.horarioId = Number(alvo);
    const r = moverAula(alvoAula.id, prop.dia != null ? prop.dia : alvoAula.dia, prop.inicio != null ? prop.inicio : alvoAula.inicio, prop.sala_id != null ? prop.sala_id : alvoAula.sala_id, { soSala: p.tipo === 'sala' });
    st.horarioId = prevH;
    if (!r || !r.ok) return { ok: false, msg: 'A proposta viola regras obrigatórias na versão escolhida: não foi aplicada.' };
    const nome = D.one('SELECT nome FROM horario WHERE id = ?', [Number(alvo)]).nome;
    D.run('UPDATE pedido SET aplicado = ? WHERE id = ?', [`${nome} (${agora().slice(0, 16).replace('T', ' ')}, ${U.username})`, p.id]);
    return { ok: true, nota: ` (aplicado em ${nome})` };
  }
  function decidirPedido(id, decisao, subst) {
    const p = D.one('SELECT * FROM pedido WHERE id = ?', [id]);
    const pf = p && papelNoPedido(p, subst);
    if (!pf) { toast('Este pedido não espera a sua aprovação.'); return; }
    const admin = U.perfil_id === 'admin';
    let coment = ($('#pd-coment') || {}).value || '';
    if (decisao === 'rejeitado' && !coment.trim()) { toast('Indique o motivo da rejeição no comentário.'); return; }
    if (admin && !coment.trim()) { toast(`Decide em substituição de ${PAPEL[pf]}: indique a justificação no comentário (por exemplo, ausência por doença).`); return; }
    if (admin) coment = `administrador em substituição de ${PAPEL[pf]}: ${coment.trim()}`;
    const apr = aprovacoesDe(p);
    let estado = 'pendente', nota = '';
    if (decisao === 'aprovado') {
      const alvo = ($('#pd-alvo') || {}).value;
      const im = impactoPedido(p, alvo ? Number(alvo) : p.horario_id, new Map());
      if (im && im.novasHard.length) { toast('A proposta viola regras obrigatórias: o pedido só pode ser rejeitado.'); return; }
      apr[pf] = { decisao: 'aprovado', por: U.username, em: agora(), nota: coment.trim() || null };
      if (Object.values(apr).every((x) => x && x.decisao === 'aprovado')) {
        estado = 'aprovado';
        const r = aplicarPedido(p, alvo);
        if (!r.ok) toast(r.msg + ' O pedido fica aprovado; pode aplicá-lo mais tarde.');
        nota = r.nota || '';
      }
    } else {
      apr[pf] = { decisao: 'rejeitado', por: U.username, em: agora(), nota: coment.trim() };
      estado = 'rejeitado';
    }
    D.run('UPDATE pedido SET estado = ?, aprovacoes = ?, decidido_por = ?, decidido_em = ?, comentario = ? WHERE id = ?',
      [estado, JSON.stringify(apr), estado === 'pendente' ? p.decidido_por : U.username, estado === 'pendente' ? p.decidido_em : agora(), estado === 'pendente' ? p.comentario : ((coment.trim() + nota).trim() || null), id]);
    const falta = Object.entries(apr).filter(([, x]) => !x).map(([k]) => PAPEL[k]);
    changed(decisao === 'aprovado' ? `Pedido aprovado (${PAPEL[pf]}${admin ? ', pelo administrador em substituição' : ''})` : `Pedido rejeitado (${PAPEL[pf]}${admin ? ', pelo administrador em substituição' : ''})`, p.resumo + nota + (admin ? ' · ' + coment : ''));
    toast(decisao === 'rejeitado' ? 'Pedido rejeitado.' : estado === 'aprovado' ? 'Pedido aprovado' + nota + '.' : `Aprovação registada. Falta: ${falta.join(' e ')}.`);
    render();
  }
  function aplicarAprovado(id) {
    const p = D.one('SELECT * FROM pedido WHERE id = ?', [id]);
    const alvo = ($('#pd-alvo') || {}).value;
    if (!p || p.estado !== 'aprovado' || p.aplicado) return;
    if (!alvo) { toast('Escolha a versão em rascunho onde aplicar.'); return; }
    const r = aplicarPedido(p, alvo);
    toast(r.ok ? 'Pedido aplicado' + r.nota + '.' : r.msg);
    render();
  }


  /* ===== Pessoal: docente e estudante ===== */
  const LEG_DISP = '<span><i style="background:repeating-linear-gradient(135deg,var(--indisp) 0 4px,transparent 4px 7px)"></i>Indisponível</span><span><i style="background:var(--pref)"></i>Preferido</span>';
  const semHorario = () => `<div class="callout">Ainda não há nenhum horário publicado que possa consultar.</div>`;
  VIEWS.meu = () => {
    const hid = st.horarioId;
    const v = validar(hid);
    const sel = st.sel != null && hid != null ? D.one(AULAS_SQL + ' AND v.aula_id = ?', [hid, st.sel]) : null;
    const lado = `<div class="stack">${pedidoForm()}${sel ? detalheAula(sel, v, false) : `<div class="panel"><p class="small muted">Clique numa aula para ver o detalhe${can('pedidos.criar') ? ' e pedir uma alteração ao gabinete de horários' : ''}.</p></div>`}</div>`;
    if (U.docente_id) {
      const d = D.one('SELECT * FROM docente WHERE id = ?', [U.docente_id]);
      if (!d) return head('Docente', 'O meu horário', 'A sua conta não está associada a nenhum docente registado.');
      const aulas = aulasDe(hid, { tipo: 'docente', id: d.id });
      const tot = aulas.reduce((s, a) => s + a.duracao, 0);
      const disp = D.q('SELECT * FROM disponibilidade WHERE docente_id = ?', [d.id]);
      const ucs = [...new Set(aulas.map((a) => a.uc_nome))];
      const nv = aulas.filter((a) => (v.porAula.get(a.aula_id) || []).length).length;
      return head('Docente', `Horário de ${esc(d.nome)}`, `${esc(d.categoria || '')}${d.departamento ? ' · ' + esc(d.departamento) : ''} · ${hid ? hLabel(hid) : 'sem horário'}`)
        + (hid == null ? semHorario() : '')
        + `<div class="row">${semanaSel()}</div>`
        + `<div class="kpis">${kpi(aulas.length, st.semana ? `aulas na semana ${st.semana}` : 'aulas semanais')}${kpi(horas(tot), `de ${horas(d.horas_max)} máximas`, tot > d.horas_max ? 'soft' : '')}${kpi(ucs.length, 'UCs')}${kpi(nv, 'aulas com avisos', nv ? 'soft' : 'ok')}</div>`
        + `<div class="cols"><div class="stack">${grid({ id: 'tt-m', aulas, viol: v.porAula, disp, clickable: true, selectable: true, mostrar: 'turmas' })}${legendaGrid(LEG_DISP)}</div>${lado}</div>`;
    }
    const t = D.one("SELECT t.*, COALESCE(t.regime, c.regime, 'diurno') AS regime, c.nome AS curso, c.sigla FROM turma t LEFT JOIN curso c ON c.id = t.curso_id WHERE t.id = ?", [U.turma_id]);
    if (!t) return head('Estudante', 'O meu horário', 'A sua conta não está associada a nenhuma turma.');
    const aulas = aulasDe(hid, { tipo: 'turma', id: t.id });
    const tot = aulas.reduce((s, a) => s + a.duracao, 0);
    const porDia = [0, 1, 2, 3, 4].map((d) => aulas.filter((a) => a.dia === d).length);
    return head('Estudante', `Horário da turma ${esc(t.codigo)}`, `${esc(t.curso || t.sigla || '')} · regime ${regimeTxt(t.regime)} · ${hid ? hLabel(hid) : 'sem horário'}`)
      + (hid == null ? semHorario() : '')
      + `<div class="row">${semanaSel()}</div>`
      + `<div class="kpis">${kpi(aulas.length, st.semana ? `aulas na semana ${st.semana}` : 'aulas semanais')}${kpi(horas(tot), 'de aulas')}${kpi(porDia.filter((n) => n === 0).length, 'dias úteis sem aulas')}</div>`
      + `<div class="cols"><div class="stack">${grid({ id: 'tt-m', aulas, clickable: true, selectable: true, mancha: mancha(t.regime) })}${legendaGrid()}</div>${lado}</div>`;
  };
  AFTER.meu = () => bindDrag('tt-m', null, (id) => { st.sel = id; render(); });

  VIEWS.disp = () => {
    const did = U.docente_id;
    const d = D.one('SELECT * FROM docente WHERE id = ?', [did]);
    const disp = D.q('SELECT * FROM disponibilidade WHERE docente_id = ? ORDER BY dia, inicio', [did]);
    // Mostra só as aulas da semana escolhida, para coincidir com as datas do cabeçalho (todas, se não houver semana).
    const aulas = aulasDe(st.horarioId, { tipo: 'docente', id: did });
    return head('Docente', 'Disponibilidade', 'Indique quando <b>não pode</b> dar aulas e, se quiser, quando <b>prefere</b>. O gabinete de horários, a validação e o gerador usam esta informação.')
      + `<div class="panel"><div class="row"><span class="small">Pincel:</span>${[['indisponivel', 'Indisponível'], ['preferido', 'Preferido'], ['apagar', 'Apagar']].map(([k, n]) => `<button class="btn${st.paint === k ? ' primary' : ''}" data-act="pincel" data-k="${k}">${n}</button>`).join('')}
        <span class="muted small">Clique e arraste sobre a grelha. As suas aulas aparecem por cima, para referência.</span><div style="flex:1"></div><button class="btn danger" data-act="disp-limpar" data-confirm="1">Limpar tudo</button></div></div>`
      + grid({ id: 'tt-p', aulas, disp, paint: true, dias: [0, 1, 2, 3, 4, 5], mostrar: 'turmas' })
      + legendaGrid(LEG_DISP)
      + `<div class="panel"><h3>Períodos registados</h3>${table(disp, [{ h: 'Dia', f: (r) => DIAS[r.dia] }, { h: 'De', f: (r) => hhmm(r.inicio) }, { h: 'Até', f: (r) => hhmm(r.fim) }, { h: 'Tipo', f: (r) => (r.tipo === 'indisponivel' ? '<span class="pill hard">indisponível</span>' : '<span class="pill ok">preferido</span>') }], { vazio: `${esc(d ? d.nome : '')} ainda não registou disponibilidade.` })}</div>`;
  };
  AFTER.disp = () => {
    const tt = $('#tt-p'); if (!tt) return;
    let painting = false; const cells = new Set();
    const mark = (c) => { if (!c || !c.classList || !c.classList.contains('cell')) return; cells.add(c.dataset.dia + ':' + c.dataset.m); c.style.background = st.paint === 'indisponivel' ? 'var(--indisp)' : st.paint === 'preferido' ? 'var(--pref)' : 'var(--surface-2)'; };
    const end = () => { if (!painting) return; painting = false; aplicarPintura(cells); };
    tt.addEventListener('pointerdown', (e) => {
      if (!e.target.classList.contains('cell')) return;
      e.preventDefault(); painting = true; mark(e.target);
      window.addEventListener('pointerup', end, { once: true });
    });
    tt.addEventListener('pointermove', (e) => { if (painting) mark(document.elementFromPoint(e.clientX, e.clientY)); });
  };
  function aplicarPintura(cells) {
    const did = U.docente_id;
    if (!cells.size || !did || !can('disponibilidade.propria')) return;
    const g = {};
    for (const x of D.q('SELECT * FROM disponibilidade WHERE docente_id = ?', [did])) for (let m = x.inicio; m < x.fim; m += 30) g[x.dia + ':' + m] = x.tipo;
    for (const k of cells) { if (st.paint === 'apagar') delete g[k]; else g[k] = st.paint; }
    const out = [];
    for (let d = 0; d < 6; d++) {
      let cur = null;
      for (let m = 480; m <= 1410; m += 30) {
        const t = g[d + ':' + m];
        if (cur && (t !== cur.tipo || m === 1410)) { out.push(cur); cur = null; }
        if (t && !cur && m < 1410) cur = { dia: d, inicio: m, fim: m + 30, tipo: t }; else if (cur) cur.fim = m + 30;
      }
    }
    D.tx(() => {
      D.run('DELETE FROM disponibilidade WHERE docente_id = ?', [did]);
      for (const x of out) D.run('INSERT INTO disponibilidade (docente_id, dia, inicio, fim, tipo) VALUES (?,?,?,?,?)', [did, x.dia, x.inicio, x.fim, x.tipo]);
    });
    changed('Disponibilidade atualizada', `${out.length} períodos`);
    render();
  }
  VIEWS.avisos = () => {
    const v = validar(st.horarioId);
    const ids = new Set(aulasDe(st.horarioId, { tipo: 'docente', id: U.docente_id }, true).map((a) => a.aula_id));
    const vs = v.violacoes.filter((x) => !x.erro && x.aulas.some((id) => ids.has(id)));
    return head('Docente', 'Avisos', `Problemas que envolvem as suas aulas em ${hLabel(st.horarioId)}. O gabinete de horários vê os mesmos avisos.`)
      + `<div class="panel">${violList(vs, { vazio: 'Não há avisos sobre as suas aulas.', semLink: true })}</div>`;
  };
  VIEWS.ucs = () => {
    /* Uma linha da base de dados é uma aula semanal num conjunto de semanas; a mesma hora pode aparecer em várias
       linhas quando muda a sala ou há reposições. Aqui junta-se por dia e hora e indicam-se as semanas. */
    const DS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const brutas = D.q(`SELECT uc, uc_nome, tipo_aula, turno, docente, dia, inicio, fim, semanas, sala
      FROM v_aula_turma WHERE horario_id = ? AND turma_id = ? ORDER BY uc, tipo_aula, turno, dia, inicio`, [st.horarioId, U.turma_id]);
    const porTurno = new Map();
    for (const a of brutas) {
      const k = a.uc + '|' + a.tipo_aula + '|' + a.turno;
      if (!porTurno.has(k)) porTurno.set(k, { uc: a.uc, uc_nome: a.uc_nome, tipo_aula: a.tipo_aula, turno: a.turno, docente: a.docente, horas: new Map(), salas: new Set() });
      const r = porTurno.get(k);
      if (!r.docente && a.docente) r.docente = a.docente;
      const kh = a.dia + '|' + a.inicio + '|' + a.fim;
      if (!r.horas.has(kh)) r.horas.set(kh, { dia: a.dia, inicio: a.inicio, fim: a.fim, semanas: 0 });
      r.horas.get(kh).semanas |= a.semanas;
      if (a.sala) r.salas.add(a.sala);
    }
    const nw = cal().semanas, todas = (1 << nw) - 1;
    const rows = [...porTurno.values()].map((r) => Object.assign(r, {
      quando: [...r.horas.values()].map((h) => `${DS[h.dia] || ''} ${hhmm(h.inicio)}–${hhmm(h.fim)}${(h.semanas & todas) === todas ? '' : ` (${E.semTxt(h.semanas & todas, nw)})`}`).join('; '),
      salas: [...r.salas].join(', '),
    }));
    return head('Estudante', 'As minhas UCs', 'Turnos, professores e salas da sua turma.')
      + `<div class="panel">${table(rows, [{ h: 'UC', f: (r) => `<b>${esc(r.uc)}</b> ${esc(r.uc_nome)}` }, { h: 'Tipo', k: 'tipo_aula' }, { h: 'Turno', k: 'turno' }, { h: 'Professor', f: (r) => esc(r.docente || '—') }, { h: 'Quando', k: 'quando' }, { h: 'Sala', f: (r) => esc(r.salas || '—') }], { vazio: 'Sem aulas no horário publicado.' })}</div>`;
  };

  /* ===== Direção de curso ===== */
  const cursoAtual = () => D.one('SELECT * FROM curso WHERE id = ?', [U.curso_id]);
  VIEWS.plano = () => {
    const hid = st.horarioId;
    const c = cursoAtual();
    if (!c) return head('Direção de curso', 'Plano e cobertura', 'A sua conta não está associada a um curso.');
    const rows = D.q(`SELECT (SELECT MIN(p.ano) FROM plano_estudos p WHERE p.curso_id = :c AND p.uc_id = u.id) AS ano, u.id, u.codigo, u.nome, u.ects,
        (SELECT group_concat(DISTINCT c.tipo_aula_id) FROM componente c WHERE c.uc_id = u.id) AS comps,
        (SELECT COUNT(*) FROM turno t JOIN componente c ON c.id = t.componente_id WHERE c.uc_id = u.id) AS turnos,
        (SELECT COUNT(*) FROM turno t JOIN componente c ON c.id = t.componente_id WHERE c.uc_id = u.id AND t.docente_id IS NULL) AS sem_doc,
        (SELECT COUNT(*) FROM aula a JOIN turno t ON t.id = a.turno_id JOIN componente c ON c.id = t.componente_id WHERE c.uc_id = u.id AND a.horario_id = :h) AS agendadas,
        (SELECT COUNT(*) FROM aula a JOIN turno t ON t.id = a.turno_id JOIN componente c ON c.id = t.componente_id WHERE c.uc_id = u.id AND a.horario_id = :h AND a.sala_id IS NULL AND COALESCE(a.caracteristica_pedida, t.caracteristica_pedida, '') <> :ss) AS sem_sala,
        (SELECT group_concat(DISTINCT d.nome) FROM turno t JOIN componente c ON c.id = t.componente_id JOIN docente d ON d.id = t.docente_id WHERE c.uc_id = u.id) AS docentes
      FROM uc u WHERE u.id IN (SELECT uc_id FROM plano_estudos WHERE curso_id = :c)
        OR u.id IN (SELECT c.uc_id FROM componente c JOIN turno t ON t.componente_id = c.id JOIN turno_turma tt ON tt.turno_id = t.id JOIN turma tm ON tm.id = tt.turma_id WHERE tm.curso_id = :c)
      ORDER BY ano, u.nome`, { ':c': c.id, ':h': hid, ':ss': M.SEM_SALA });
    const v = validar(hid);
    const ucViol = {};
    const aulaUc = new Map(D.q('SELECT aula_id, uc_id FROM v_aula WHERE horario_id = ?', [hid]).map((r) => [r.aula_id, r.uc_id]));
    for (const x of v.violacoes) { if (x.erro) continue; const us = new Set(x.aulas.map((id) => aulaUc.get(id)).filter(Boolean)); for (const k of us) (ucViol[k] = ucViol[k] || { h: 0, s: 0 })[x.sev === 'hard' ? 'h' : 's']++; }
    const nT = D.one('SELECT COUNT(*) n, SUM(n_alunos) a FROM turma WHERE curso_id = ?', [c.id]);
    return head('Direção de curso', `Plano e cobertura · ${esc(c.sigla)}`, `${esc(c.nome)} · regime ${regimeTxt(c.regime)} · ${hLabel(hid)}`)
      + `<div class="kpis">${kpi(rows.length, 'UCs')}${kpi(nT.n, 'turmas')}${kpi(rows.reduce((s, r) => s + r.agendadas, 0), 'aulas semanais no horário')}${kpi(rows.reduce((s, r) => s + r.sem_sala, 0), 'aulas sem sala', rows.some((r) => r.sem_sala) ? 'hard' : 'ok')}${kpi(rows.filter((r) => r.sem_doc).length, 'UCs com turnos sem professor', rows.some((r) => r.sem_doc) ? 'soft' : 'ok')}</div>`
      + `<div class="panel">${table(rows, [
        { h: 'Ano', f: (r) => r.ano || '—', num: true }, { h: 'UC', f: (r) => `<b>${esc(r.nome)}</b> <span class="muted small">${esc(r.codigo)}</span>` }, { h: 'Tipos de aula', f: (r) => esc(r.comps || '') }, { h: 'Turnos', k: 'turnos', num: true },
        { h: 'Professores', f: (r) => `<span class="small">${esc(r.docentes || '')}</span>${r.sem_doc ? ` <span class="pill soft">${r.sem_doc} sem professor</span>` : ''}` },
        { h: 'Aulas', f: (r) => `${r.agendadas}${r.sem_sala ? ` <span class="pill hard">${r.sem_sala} sem sala</span>` : ''}`, num: true },
        { h: 'Problemas', f: (r) => { const x = ucViol[r.id]; return x ? `${x.h ? `<span class="pill hard">${x.h}</span> ` : ''}${x.s ? `<span class="pill soft">${x.s}</span>` : ''}` : '<span class="pill ok">0</span>'; } },
      ], { maxH: 640 })}</div>`;
  };
  VIEWS.turmas = () => {
    const c = cursoAtual();
    if (!c) return head('Direção de curso', 'Horários das turmas', 'A sua conta não está associada a um curso.');
    const ts = D.q('SELECT * FROM turma WHERE curso_id = ? ORDER BY codigo', [c.id]);
    if (!ts.some((t) => t.id === st.cursoTurmaId)) st.cursoTurmaId = ts[0] && ts[0].id;
    const hid = st.horarioId;
    const v = validar(hid);
    const aulas = st.cursoTurmaId ? aulasDe(hid, { tipo: 'turma', id: st.cursoTurmaId }) : [];
    const sel = st.sel != null ? D.one(AULAS_SQL + ' AND v.aula_id = ?', [hid, st.sel]) : null;
    return head('Direção de curso', `Horários das turmas · ${esc(c.sigla)}`, `${hLabel(hid)}. As alterações pedem-se ao gabinete de horários.`)
      + `<div class="row"><label class="f">Turma<select data-change="curso-turma" style="max-width:280px">${optList(ts, 'id', (t) => `${t.codigo} · ${t.n_alunos} estudantes`, st.cursoTurmaId)}</select></label>${semanaSel()}</div>`
      + `<div class="cols"><div class="stack">${grid({ id: 'tt-c', aulas, viol: v.porAula, clickable: true, selectable: true, mancha: manchaPara({ tipo: 'turma', id: st.cursoTurmaId }) })}${legendaGrid()}</div>
        <div class="stack">${pedidoForm()}${sel ? detalheAula(sel, v, false) : '<div class="panel"><p class="small muted">Clique numa aula para ver o detalhe e pedir uma alteração.</p></div>'}</div></div>`;
  };
  AFTER.turmas = () => bindDrag('tt-c', null, (id) => { st.sel = id; render(); });
  VIEWS.problemas = () => {
    const c = cursoAtual();
    if (!c) return head('Direção de curso', 'Problemas do curso', 'A sua conta não está associada a um curso.');
    const v = validar(st.horarioId);
    const ids = new Set(aulasDe(st.horarioId, { tipo: 'curso', id: c.id }, true).map((a) => a.aula_id));
    const vs = v.violacoes.filter((x) => !x.erro && x.aulas.some((id) => ids.has(id)));
    const hard = vs.filter((x) => x.sev === 'hard'), soft = vs.filter((x) => x.sev !== 'hard');
    const porRegra = {};
    for (const x of vs) (porRegra[x.codigo] = porRegra[x.codigo] || { nome: x.nome, sev: x.sev, n: 0 }).n++;
    return head('Direção de curso', `Problemas do curso · ${esc(c.sigla)}`, `Violações que afetam turmas do curso em ${hLabel(st.horarioId)}. Use-as para aprovar, devolver ou pedir alterações.`)
      + `<div class="kpis">${kpi(hard.length, 'obrigatórias', hard.length ? 'hard' : 'ok')}${kpi(soft.length, 'de qualidade', soft.length ? 'soft' : 'ok')}</div>`
      + `<div class="panel"><h3>Por regra</h3>${table(Object.values(porRegra).sort((a, b) => (a.sev === b.sev ? b.n - a.n : a.sev === 'hard' ? -1 : 1)), [{ h: 'Regra', k: 'nome' }, { h: 'Tipo', f: (r) => sevPill(r.sev) }, { h: 'Ocorrências', k: 'n', num: true }], { vazio: 'Nenhuma.' })}</div>`
      + `<div class="cols even"><div class="panel"><h3>Regras obrigatórias</h3>${violList(hard, { vazio: 'Nenhuma.', semLink: !can('horario.ver_rascunhos') })}</div><div class="panel"><h3>Critérios de qualidade</h3>${violList(soft, { vazio: 'Nenhuma.', semLink: !can('horario.ver_rascunhos') })}</div></div>`;
  };

  /* ===== Espaços ===== */
  const NW = () => cal().semanas;
  VIEWS.ocupacao = () => {
    const hid = st.horarioId;
    const salas = salasAll().filter((s) => s.ativa);
    const aulas = aulasDe(hid).filter((a) => a.sala_id);
    const res = D.q('SELECT * FROM reserva');
    const nw = NW();
    const peso = (a) => st.semana ? 1 : E.pop(a.semanas) / nw;
    const blocos = [[480, 570], [570, 660], [660, 750], [780, 870], [870, 960], [960, 1050], [1080, 1170], [1170, 1260], [1260, 1350]];
    const dias = [0, 1, 2, 3, 4];
    const occ = {};
    const add = (sid, dia, ini, fim, w) => { for (const [bi, [b0, b1]] of blocos.entries()) { const o = Math.max(0, Math.min(fim, b1) - Math.max(ini, b0)); if (o > 0) { const k = `${sid}:${dia}:${bi}`; occ[k] = (occ[k] || 0) + (o / 90) * w; } } };
    for (const a of aulas) add(a.sala_id, a.dia, a.inicio, a.fim, peso(a));
    for (const r of res) add(r.sala_id, r.dia, r.inicio, r.fim, 1);
    const dispMin = dias.length * blocos.length * 90;
    const porSala = new Map();
    for (const a of aulas) { if (!porSala.has(a.sala_id)) porSala.set(a.sala_id, []); porSala.get(a.sala_id).push(a); }
    const ignorar = new Set([M.SEM_SALA, 'Sala/anfiteatro aulas']);
    const stats = salas.map((s) => {
      const as = porSala.get(s.id) || [];
      const min = as.reduce((t, a) => t + a.duracao * peso(a), 0);
      const lug = as.length ? as.reduce((t, a) => t + Math.min(1, a.esperados / Math.max(1, s.capacidade)), 0) / as.length : 0;
      const carErr = as.filter((a) => a.caracteristica_pedida && !ignorar.has(a.caracteristica_pedida) && !a.tem_caracteristica).length;
      const cheia = as.filter((a) => a.esperados > s.capacidade).length;
      return { s, n: as.length, uso: min / dispMin, lug, carErr, cheia };
    });
    const usadas = stats.filter((x) => x.n);
    const media = stats.reduce((t, x) => t + x.uso, 0) / (stats.length || 1);
    const sub = stats.filter((x) => x.uso < 0.15).length;
    const lugMed = usadas.reduce((t, x) => t + x.lug, 0) / (usadas.length || 1);
    const pct = (x) => Math.round(x * 100) + '%';
    const mostrar = stats.slice().sort((a, b) => b.uso - a.uso).slice(0, 60);
    const colsT = `minmax(70px, auto) repeat(${dias.length * blocos.length}, minmax(10px, 1fr))`;
    let heat = `<div class="heat" style="grid-template-columns:${colsT}"><div></div>${dias.map((d) => `<div class="dh" style="grid-column:span ${blocos.length}">${DC[d]}</div>`).join('')}`;
    for (const x of mostrar) {
      heat += `<div class="lbl">${esc(x.s.codigo)}</div>`;
      for (const d of dias) for (let bi = 0; bi < blocos.length; bi++) {
        const o = Math.min(1, occ[`${x.s.id}:${d}:${bi}`] || 0);
        heat += `<div class="c" style="--o:${o.toFixed(2)}" title="${esc(x.s.codigo)} · ${DIAS[d]} ${hhmm(blocos[bi][0])}–${hhmm(blocos[bi][1])}: ${o ? Math.round(o * 100) + '% ocupado' : 'livre'}"></div>`;
      }
    }
    heat += '</div>';
    return head('Espaços', 'Ocupação das salas', `${hLabel(hid)}. Segunda a sexta, blocos de 1h30 entre as 08:00 e as 22:30. ${st.semana ? `Semana ${esc(semanaTxt(st.semana))}.` : 'Média das semanas do semestre (aulas que só ocorrem em algumas semanas pesam menos).'}`)
      + `<div class="row">${semanaSel()}</div>`
      + `<div class="kpis">${kpi(pct(media), 'utilização média do tempo')}${kpi(sub, 'salas usadas menos de 15% do tempo', sub ? 'soft' : '')}${kpi(pct(lugMed), 'lugares ocupados por aula (média)')}${kpi(num(stats.reduce((t, x) => t + x.carErr, 0), 0), 'aulas em sala sem a característica pedida', '')}${kpi(num(stats.reduce((t, x) => t + x.cheia, 0), 0), 'aulas com mais alunos do que lugares', '')}</div>`
      + `<div class="panel"><h3>Mapa de ocupação</h3><p class="small muted">As ${mostrar.length} salas mais usadas.</p><div class="legend"><span>Livre</span><span style="display:inline-block;width:120px;height:10px;border-radius:2px;background:linear-gradient(to right, var(--surface-2), var(--accent))"></span><span>Ocupado</span></div><div class="tablewrap" style="padding:10px">${heat}</div></div>`
      + `<div class="panel"><h3>Por sala</h3>${table(stats.sort((a, b) => b.uso - a.uso), [
        { h: 'Sala', f: (r) => `<b>${esc(r.s.codigo)}</b>` }, { h: 'Tipo', f: (r) => esc(r.s.tipo_id) }, { h: 'Lugares', f: (r) => r.s.capacidade, num: true }, { h: 'Aulas', k: 'n', num: true },
        { h: 'Utilização do tempo', f: (r) => `<div class="row" style="flex-wrap:nowrap"><div class="bar" style="flex:1;min-width:60px"><i style="width:${Math.min(100, r.uso * 100)}%"></i></div><span class="mono small">${pct(r.uso)}</span></div>` },
        { h: 'Lugares ocupados', f: (r) => (r.n ? pct(r.lug) : '—'), num: true }, { h: 'Sem a característica pedida', f: (r) => (r.carErr ? `<span class="pill soft">${r.carErr}</span>` : '0'), num: true }, { h: 'Sobrelotadas', f: (r) => (r.cheia ? `<span class="pill hard">${r.cheia}</span>` : '0'), num: true },
      ], { maxH: 520 })}</div>`;
  };

  function pesqCampos(q) {
    return `<label class="f">Dia<select data-change="pesq" data-k="dia">${DIAS.map((d, i) => `<option value="${i}"${i === Number(q.dia) ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="f">Início<select data-change="pesq" data-k="ini">${TIMES.map((m) => `<option value="${m}"${m === Number(q.ini) ? ' selected' : ''}>${hhmm(m)}</option>`).join('')}</select></label>
      <label class="f">Duração<select data-change="pesq" data-k="dur">${[30, 60, 90, 120, 180].map((m) => `<option value="${m}"${m === Number(q.dur) ? ' selected' : ''}>${hhmm(m)}</option>`).join('')}</select></label>
      <label class="f">Pessoas<input type="number" min="1" data-change="pesq" data-k="alunos" value="${esc(q.alunos)}" style="width:80px"></label>
      <label class="f">Semana<select data-change="pesq" data-k="semana"><option value="0">Todas</option>${Array.from({ length: NW() }, (_, i) => `<option value="${i + 1}"${i + 1 === Number(q.semana) ? ' selected' : ''}>${esc(semanaTxt(i + 1))}</option>`).join('')}</select></label>
      <label class="f">Característica<select data-change="pesq" data-k="car" style="max-width:240px"><option value="">Qualquer</option>${optList(D.q('SELECT nome FROM caracteristica ORDER BY nome'), 'nome', 'nome', q.car)}</select></label>
      <label class="f">Edifício<select data-change="pesq" data-k="edificio"><option value="">Qualquer</option>${optList(D.q('SELECT * FROM edificio ORDER BY id'), 'id', (e) => `${e.id} · ${e.nome}`, q.edificio)}</select></label>`;
  }
  VIEWS.pesquisa = () => {
    const q = st.pesquisa;
    const P = M.buildProblem(D, { horarioId: st.horarioId });
    const sem = Number(q.semana) ? 1 << (Number(q.semana) - 1) : undefined;
    let res = E.searchRooms(P, { dia: Number(q.dia), ini: Number(q.ini), dur: Number(q.dur), alunos: Number(q.alunos) || 1, car: q.car || null, edificio: q.edificio, semanas: sem });
    const gerir = can('reservas.gerir');
    if (!gerir) res = res.filter((r) => r.livre && r.capOk);
    const motivos = (r) => [r.livre ? '' : 'ocupada', r.capOk ? '' : 'sem lugares suficientes', q.car && !r.carOk ? (r.carEq ? 'característica equivalente' : 'sem a característica') : '', r.desperdicio > 25 ? `${r.desperdicio} lugares vazios` : '', q.edificio && r.sala.edificio !== q.edificio ? 'outro edifício' : ''].filter(Boolean).join(', ');
    return head('Espaços', 'Pesquisa de salas', 'Ordena as salas pela adequação ao pedido: livre, com a característica pedida, lugares suficientes com pouco desperdício e no edifício preferido (critérios de Martins, 2014).' + (gerir ? '' : ' Mostra só as salas livres.'))
      + `<div class="panel"><div class="row">${pesqCampos(q)}</div>${gerir ? '<div class="row"><label class="f" style="flex:1;min-width:220px">Motivo da reserva<input type="text" id="res-motivo" placeholder="Ex.: Defesa de dissertação"></label></div><p class="small muted">As reservas valem todas as semanas para esse dia e hora e contam como ocupação na validação e na geração.</p>' : ''}</div>`
      + `<div class="panel"><h3>${res.filter((r) => r.livre).length} salas livres</h3>${table(res, [
        { h: 'Sala', f: (r) => `<b>${esc(r.sala.codigo)}</b>` }, { h: 'Edifício', f: (r) => esc(r.sala.edificio) }, { h: 'Lugares', f: (r) => r.sala.cap, num: true },
        { h: 'Características', f: (r) => `<span class="small">${esc((r.sala.car || []).filter((c) => c !== 'Horário sala visível portal público').slice(0, 4).join(', '))}${(r.sala.car || []).length > 5 ? '…' : ''}</span>` },
        { h: 'Estado', f: (r) => (r.livre ? (r.capOk && (!q.car || r.carOk) ? '<span class="pill ok">adequada</span>' : '<span class="pill soft">livre</span>') : '<span class="pill hard">ocupada</span>') },
        { h: 'Notas', f: (r) => `<span class="small">${esc(motivos(r))}</span>` },
        ...(gerir ? [{ h: '', f: (r) => (r.livre ? `<button class="btn small" data-act="reservar" data-sala="${r.sala.id}">Reservar</button>` : '') }] : []),
      ], { max: 80, vazio: 'Não há salas livres nesse período.' })}</div>`;
  };
  VIEWS.salas = () => {
    const ed = can('salas.editar');
    const salas = salasAll();
    if (!salas.some((s) => s.id === st.salaSel)) st.salaSel = salas[0] && salas[0].id;
    const s = D.one('SELECT * FROM sala WHERE id = ?', [st.salaSel]);
    const tem = new Set(D.q('SELECT caracteristica FROM sala_caracteristica WHERE sala_id = ?', [st.salaSel]).map((r) => r.caracteristica));
    const cars = D.q('SELECT c.nome, (SELECT COUNT(*) FROM sala_caracteristica x WHERE x.caracteristica = c.nome) AS n FROM caracteristica c ORDER BY c.nome');
    return head('Espaços', 'Salas e características', 'O cadastro de salas e as características que os docentes podem pedir. A validação e o gerador usam estes dados de imediato.' + (ed ? '' : ' O seu perfil só pode consultar.'))
      + `<div class="panel"><div class="row"><label class="f">Sala<select data-change="sala-sel" style="max-width:260px">${optList(salas, 'id', (x) => `${x.codigo} · ${x.capacidade} lugares${x.ativa ? '' : ' (inativa)'}`, st.salaSel)}</select></label>${s ? `<span class="small muted">${esc(s.equipamento || '')}</span>` : ''}</div>
        ${s ? `<div class="chips">${cars.map((c) => `<label class="chip${tem.has(c.nome) ? ' ok' : ''}"><input type="checkbox" data-change="sala-car" data-k="${esc(c.nome)}"${tem.has(c.nome) ? ' checked' : ''}${ed ? '' : ' disabled'}> ${esc(c.nome)} <span class="muted">${c.n}</span></label>`).join('')}</div>` : ''}</div>`
      + tabelaEditor('sala', false, ed);
  };
  VIEWS.reservas = () => {
    const rows = D.q('SELECT r.*, s.codigo FROM reserva r JOIN sala s ON s.id = r.sala_id ORDER BY r.dia, r.inicio');
    return head('Espaços', 'Reservas', 'Reservas de salas fora das aulas. Contam como ocupação na validação e o gerador não as usa.')
      + `<div class="panel">${table(rows, [{ h: 'Sala', f: (r) => `<b>${esc(r.codigo)}</b>` }, { h: 'Dia', f: (r) => DIAS[r.dia] }, { h: 'Horas', f: (r) => `${hhmm(r.inicio)}–${hhmm(r.fim)}` }, { h: 'Motivo', k: 'motivo' }, { h: 'Pedido por', k: 'pedido_por' }, { h: '', f: (r) => `<button class="btn small danger" data-act="res-del" data-id="${r.id}" data-confirm="1">Apagar</button>` }], { vazio: 'Sem reservas.' })}
        <div class="row"><button class="btn" data-act="view" data-k="pesquisa">Nova reserva</button></div></div>`;
  };

  /* ===== Administração: contas, permissões, segregação de funções, registo ===== */
  const permsDe = (perfilId) => new Set(D.q('SELECT permissao_id FROM perfil_permissao WHERE perfil_id = ?', [perfilId]).map((r) => r.permissao_id));
  const pessoa = (nome) => String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*\([^)]*\)\s*/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
  /* Regras de incompatibilidade violadas por um conjunto de permissões. */
  function conflitosPerms(set) {
    return SC.incompatibilidades.filter((r) => r.a.some((p) => set.has(p)) && r.b.some((p) => set.has(p)));
  }
  /* Conflitos se a conta (nome, perfil) existir: no próprio perfil ou com outras contas ativas da mesma pessoa. */
  function conflitosConta(nome, perfilId, excetoId) {
    const out = conflitosPerms(permsDe(perfilId)).map((r) => ({ r, com: null }));
    const p = pessoa(nome);
    for (const o of D.q('SELECT id, username, nome, perfil_id FROM utilizador WHERE ativo = 1 AND id IS NOT ?', [excetoId == null ? null : excetoId])) {
      if (pessoa(o.nome) !== p || o.perfil_id === perfilId) continue;
      const juntas = new Set([...permsDe(perfilId), ...permsDe(o.perfil_id)]);
      for (const r of conflitosPerms(juntas)) out.push({ r, com: o });
    }
    return out;
  }
  const conflitoTxt = (cs) => cs.map((c) => `${c.r.nome}${c.com ? ` (a mesma pessoa já tem a conta ${c.com.username}, perfil ${c.com.perfil_id})` : ' (no próprio perfil)'}: ${c.r.motivo}`).join(' ');
  function auditoriaSod() {
    const out = [];
    for (const [pid] of SC.perfis) for (const r of conflitosPerms(permsDe(pid))) out.push({ tipo: 'Perfil', quem: pid, regra: r.nome });
    const us = D.q('SELECT id, username, nome, perfil_id FROM utilizador WHERE ativo = 1');
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      if (pessoa(us[i].nome) !== pessoa(us[j].nome) || us[i].perfil_id === us[j].perfil_id) continue;
      for (const r of conflitosPerms(new Set([...permsDe(us[i].perfil_id), ...permsDe(us[j].perfil_id)]))) out.push({ tipo: 'Pessoa', quem: `${us[i].username} + ${us[j].username}`, regra: r.nome });
    }
    return out;
  }
  function painelSod() {
    const a = auditoriaSod();
    return `<div class="panel"><h3>Segregação de funções</h3><p class="small muted">Combinações de permissões que nunca podem estar no mesmo perfil nem com a mesma pessoa (contas com o mesmo nome). A aplicação recusa criar contas, mudar perfis ou alterar permissões que as violem.</p>
      ${table(SC.incompatibilidades, [{ h: 'Regra', f: (r) => `<b>${esc(r.nome)}</b><br><span class="small">${esc(r.motivo)}</span>` }, { h: 'Não pode ter ao mesmo tempo', f: (r) => `<span class="mono small">${esc(r.a.join(', '))}</span><br>e <span class="mono small">${esc(r.b.join(', '))}</span>` }])}
      ${a.length ? `<div class="callout warn"><b>${a.length} situação(ões) a corrigir:</b>${a.map((x) => `<br>• ${esc(x.tipo)} ${esc(x.quem)}: ${esc(x.regra)}`).join('')}</div>` : '<p class="pill ok">Nenhum perfil nem pessoa acumula funções incompatíveis.</p>'}</div>`;
  }
  const ligacao = (u) => u.docente_id ? `docente: ${esc((D.one('SELECT nome FROM docente WHERE id = ?', [u.docente_id]) || {}).nome || u.docente_id)}` : u.curso_id ? `curso: ${esc((D.one('SELECT sigla FROM curso WHERE id = ?', [u.curso_id]) || {}).sigla || u.curso_id)}` : u.turma_id ? `turma: ${esc((D.one('SELECT codigo FROM turma WHERE id = ?', [u.turma_id]) || {}).codigo || u.turma_id)}` : '<span class="muted">—</span>';
  VIEWS.utilizadores = () => {
    const us = D.q('SELECT * FROM utilizador ORDER BY perfil_id, username');
    const n = st.novaConta || { username: '', nome: '', perfil: 'docente', liga: '' };
    const bloq = (u) => u.bloqueado_ate && u.bloqueado_ate > agora();
    const perfisOpt = (sel) => SC.perfis.map(([id, nome]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(nome)}</option>`).join('');
    return head('Administração', 'Utilizadores', 'Contas, perfis e estado. As senhas guardam-se só como hash; uma senha reposta é temporária e tem de ser mudada na entrada seguinte.')
      + (st.senhaTemp ? `<div class="callout warn"><b>Senha temporária de ${esc(st.senhaTemp.u)}:</b> <span class="mono">${esc(st.senhaTemp.s)}</span><br><span class="small">Mostrada só agora. Entregue-a por um canal seguro; a pessoa terá de a mudar ao entrar.</span> <button class="btn small" data-act="senha-ok">Já entreguei</button></div>` : '')
      + `<div class="panel">${table(us, [
        { h: 'Conta', f: (u) => `<b class="mono">${esc(u.username)}</b><br><span class="small">${esc(u.nome)}</span>` },
        { h: 'Perfil', f: (u) => u.id === U.id ? `${esc(u.perfil_id)} <span class="muted small">(a sua conta)</span>` : `<select data-change="u-perfil" data-id="${u.id}" aria-label="Perfil">${perfisOpt(u.perfil_id)}</select>` },
        { h: 'Ligação', f: ligacao },
        { h: 'Estado', f: (u) => `${u.ativo ? '<span class="pill ok">ativa</span>' : '<span class="pill">desativada</span>'}${bloq(u) ? ' <span class="pill hard">bloqueada</span>' : ''}${u.falhas ? ` <span class="small muted">${u.falhas} falha(s)</span>` : ''}${u.mudar_senha ? ' <span class="pill soft">tem de mudar a senha</span>' : ''}` },
        { h: 'Última entrada', f: (u) => `<span class="mono small">${esc((u.ultimo_login || '—').replace('T', ' '))}</span>` },
        { h: '', f: (u) => u.id === U.id ? '' : `<div class="row">${bloq(u) || u.falhas ? `<button class="btn small" data-act="u-desbloq" data-id="${u.id}">Desbloquear</button>` : ''}<button class="btn small" data-act="u-reset" data-id="${u.id}" data-confirm="1">Repor senha</button><button class="btn small${u.ativo ? ' danger' : ''}" data-act="u-ativo" data-id="${u.id}"${u.ativo ? ' data-confirm="1"' : ''}>${u.ativo ? 'Desativar' : 'Ativar'}</button></div>` },
      ])}</div>`
      + `<form class="panel" data-submit="conta"><h3>Nova conta</h3><div class="formgrid">
        <label class="f">Utilizador<input type="text" id="nc-u" value="${esc(n.username)}" required pattern="[a-z0-9_.\\-]{3,30}" autocapitalize="none" spellcheck="false" placeholder="ex.: ana.silva"></label>
        <label class="f">Nome<input type="text" id="nc-n" value="${esc(n.nome)}" required></label>
        <label class="f">Perfil<select id="nc-p" data-change="nc-perfil">${perfisOpt(n.perfil)}</select></label>
        ${n.perfil === 'docente' ? `<label class="f">Docente<select id="nc-l"><option value="">—</option>${optList(docentesAll(), 'id', 'nome', n.liga)}</select></label>` : n.perfil === 'curso' ? `<label class="f">Curso<select id="nc-l"><option value="">—</option>${optList(D.q('SELECT id, sigla, nome FROM curso ORDER BY sigla'), 'id', (c) => c.sigla, n.liga)}</select></label>` : n.perfil === 'estudante' ? `<label class="f">Turma<select id="nc-l"><option value="">—</option>${optList(turmasAll(), 'id', (t) => `${t.codigo} (${t.sigla})`, n.liga)}</select></label>` : ''}
      </div><div class="row"><button class="btn primary" type="submit">Criar com senha temporária</button><span class="small muted">A senha é gerada aleatoriamente e mostrada uma única vez.</span></div></form>`
      + painelSod();
  };
  SUBMIT.conta = async () => {
    const username = $('#nc-u').value.trim().toLowerCase(), nome = $('#nc-n').value.trim(), perfil = $('#nc-p').value, l = $('#nc-l') ? $('#nc-l').value : '';
    st.novaConta = { username, nome, perfil, liga: l };
    if (!can('utilizadores.gerir')) return;
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) { toast('Utilizador: 3 a 30 letras minúsculas, números, ponto, hífen ou _.'); return; }
    if (!nome) { toast('Indique o nome.'); return; }
    if (D.one('SELECT 1 x FROM utilizador WHERE username = ?', [username])) { toast('Já existe uma conta com esse utilizador.'); return; }
    const cs = conflitosConta(nome, perfil, null);
    if (cs.length) { registar('Conta recusada', `${username} (${perfil}): segregação de funções`); changed(); toast('Recusado por segregação de funções. ' + conflitoTxt(cs)); return; }
    const senha = senhaTemporaria(), sal = novoSal();
    let hash;
    try { hash = await pbkdf2(senha, sal); } catch (e) { toast('Este browser não permite calcular senhas (é preciso https).'); return; }
    D.run('INSERT INTO utilizador (username, nome, perfil_id, docente_id, curso_id, turma_id, sal, hash, mudar_senha) VALUES (?,?,?,?,?,?,?,?,1)',
      [username, nome, perfil, perfil === 'docente' && l ? Number(l) : null, perfil === 'curso' && l ? Number(l) : null, perfil === 'estudante' && l ? Number(l) : null, sal, hash]);
    changed('Conta criada', `${username} · ${perfil}`);
    st.senhaTemp = { u: username, s: senha }; st.novaConta = null;
    render();
  };
  VIEWS.permissoes = () => {
    const ed = can('permissoes.gerir');
    const m = {};
    for (const r of D.q('SELECT * FROM perfil_permissao')) m[r.perfil_id + '|' + r.permissao_id] = true;
    const perms = D.q('SELECT * FROM permissao ORDER BY area, id');
    const nUs = Object.fromEntries(D.q('SELECT perfil_id, COUNT(*) n FROM utilizador WHERE ativo = 1 GROUP BY perfil_id').map((r) => [r.perfil_id, r.n]));
    return head('Administração', 'Perfis e permissões', 'O que cada perfil pode fazer. O menu e as ações de cada pessoa seguem esta matriz.' + (ed ? '' : ' O seu perfil só pode consultar.'))
      + `<div class="panel"><div class="tablewrap"><table class="perm"><thead><tr><th>Permissão</th>${SC.perfis.map(([id, nome]) => `<th title="${esc(nome)}">${esc(nome)}<br><span class="muted small">${nUs[id] || 0} conta(s)</span></th>`).join('')}</tr></thead><tbody>
        ${perms.map((p) => `<tr><td><span class="mono small">${esc(p.id)}</span><br><span class="small">${esc(p.descricao)}</span></td>${SC.perfis.map(([id]) => {
          const fixa = id === 'admin' && (p.id === 'utilizadores.gerir' || p.id === 'permissoes.gerir');
          return `<td style="text-align:center"><input type="checkbox" data-change="perm" data-p="${id}" data-x="${esc(p.id)}" aria-label="${esc(id + ' ' + p.id)}"${m[id + '|' + p.id] ? ' checked' : ''}${!ed || fixa ? ' disabled' : ''}${fixa ? ' title="O administrador mantém sempre esta permissão"' : ''}></td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="small muted">O administrador mantém sempre a gestão de utilizadores e de permissões, para nunca ficar sem acesso. As alterações ficam no registo de auditoria.</p></div>`
      + `<div class="panel"><h3>Perfis</h3>${table(SC.perfis.map(([id, nome, d]) => ({ id, nome, d })), [{ h: 'Perfil', f: (r) => `<b>${esc(r.nome)}</b>` }, { h: 'Função', k: 'd' }])}</div>`
      + painelSod();
  };
  function alterarPermissao(el) {
    const p = el.dataset.p, x = el.dataset.x;
    if (!can('permissoes.gerir') || (p === 'admin' && (x === 'utilizadores.gerir' || x === 'permissoes.gerir'))) { render(); return; }
    if (el.checked) {
      const nova = permsDe(p); nova.add(x);
      const cs = conflitosPerms(nova);
      let pess = [];
      if (!cs.length) {
        for (const u of D.q('SELECT id, nome FROM utilizador WHERE ativo = 1 AND perfil_id = ?', [p])) {
          for (const o of D.q('SELECT username, perfil_id, nome FROM utilizador WHERE ativo = 1 AND id <> ? AND perfil_id <> ?', [u.id, p])) {
            if (pessoa(o.nome) === pessoa(u.nome) && conflitosPerms(new Set([...nova, ...permsDe(o.perfil_id)])).length) pess.push(o.username);
          }
        }
      }
      if (cs.length || pess.length) {
        registar('Permissão recusada', `${p} + ${x}: segregação de funções`); changed();
        toast(cs.length ? `Recusado: ${cs[0].nome}. ${cs[0].motivo}` : `Recusado: a mesma pessoa tem também a conta ${pess[0]} e ficaria com funções incompatíveis.`);
        render(); return;
      }
      D.run('INSERT OR IGNORE INTO perfil_permissao (perfil_id, permissao_id) VALUES (?,?)', [p, x]);
    } else D.run('DELETE FROM perfil_permissao WHERE perfil_id = ? AND permissao_id = ?', [p, x]);
    changed(el.checked ? 'Permissão concedida' : 'Permissão retirada', `${p}: ${x}`);
    U = carregarUtilizador(U.username);
    render();
  }
  VIEWS.registo = () => {
    const f = (st.regFiltro || '').toLowerCase();
    let rows = D.q('SELECT * FROM registo ORDER BY id DESC LIMIT 5000');
    if (f) rows = rows.filter((r) => [r.quando, r.ator, r.acao, r.detalhe, r.utilizador].some((x) => String(x || '').toLowerCase().includes(f)));
    const tot = D.one('SELECT COUNT(*) n FROM registo').n;
    const seg = D.one("SELECT COUNT(*) n FROM registo WHERE acao IN ('Entrada recusada','Conta bloqueada','Conta recusada','Permissão recusada')").n;
    return head('Administração', 'Registo de auditoria', 'Quem fez o quê e quando: entradas, alterações a dados, regras, horários, contas e permissões. Só de acréscimo: a base de dados recusa alterar ou apagar linhas.')
      + `<div class="kpis">${kpi(num(tot, 0), 'registos')}${kpi(seg, 'eventos de segurança (entradas recusadas, bloqueios, recusas)', seg ? 'soft' : '')}</div>`
      + `<div class="panel"><div class="row"><label class="f" style="flex:1;min-width:200px">Procurar<input type="search" id="reg-busca" value="${esc(st.regFiltro)}" placeholder="utilizador, ação, texto"></label><button class="btn" data-act="reg-csv">Exportar CSV</button>${st.csvOut && st.csvOut.t === 'registo' ? `<a class="btn primary" href="${st.csvOut.url}" download="${esc(st.csvOut.nome)}">Descarregar</a>` : ''}</div>
        ${table(rows, [{ h: 'Quando', f: (r) => `<span class="mono small">${esc(r.quando.replace('T', ' '))}</span>` }, { h: 'Utilizador', f: (r) => `<span class="mono small">${esc(r.utilizador || '—')}</span>` }, { h: 'Perfil', k: 'ator' }, { h: 'Ação', f: (r) => /recusad|bloquead/i.test(r.acao) ? `<span class="pill hard">${esc(r.acao)}</span>` : esc(r.acao) }, { h: 'Detalhe', f: (r) => `<span class="small">${esc(r.detalhe)}</span>` }], { max: 400, maxH: 640, vazio: 'Nada encontrado.' })}</div>`;
  };

  /* ===== Eventos académicos e reposição de aulas ===== */
  const TIPOS_EVENTO = ['Festa do Caloiro', 'Dia Aberto', 'Cerimónia', 'Conferência institucional', 'Evento académico', 'Atividade extraordinária'];
  const isoDe = (d) => d.toISOString().slice(0, 10);
  const dataPt = (iso) => String(iso).split('-').reverse().join('/');
  VIEWS.eventos = () => {
    const ed = can('eventos.gerir');
    // Direção de curso: só as aulas afetadas do seu curso.
    const cid = U.curso_id ? Number(U.curso_id) : null;
    const doCurso = cid ? ` AND x.aula_id IN (SELECT a.id FROM aula a JOIN turno_turma tt ON tt.turno_id = a.turno_id JOIN turma tm ON tm.id = tt.turma_id WHERE tm.curso_id = ${cid})` : '';
    const evs = D.q(`SELECT e.*, (SELECT COUNT(*) FROM evento_aula x WHERE x.evento_id = e.id AND x.horario_id = :h${doCurso}) n,
        (SELECT COUNT(*) FROM evento_aula x WHERE x.evento_id = e.id AND x.horario_id = :h AND x.estado = 'reagendada'${doCurso}) ok,
        (SELECT group_concat(DISTINCT h.nome) FROM evento_aula x JOIN horario h ON h.id = x.horario_id WHERE x.evento_id = e.id) horarios
      FROM evento e ORDER BY e.data`, { ':h': st.horarioId });
    const rasc = D.q("SELECT id, nome FROM horario WHERE estado = 'rascunho' ORDER BY id DESC");
    const base = horarios().find((h) => h.estado === 'publicado') || horario(st.horarioId);
    const c = cal();
    const sel = st.eventoSel != null ? evs.find((e) => e.id === st.eventoSel) : evs[evs.length - 1];
    const det = sel ? D.q(`SELECT x.*, va.uc, va.uc_nome, va.turno, va.dia, va.inicio, va.fim, va.sala, nv.dia AS ndia, nv.inicio AS nini, nv.sala AS nsala, COALESCE(x.nova_semana, nv.semanas) AS nsemana, x.nova_semana,
        (SELECT group_concat(tm.codigo, ', ') FROM turno_turma tt JOIN turma tm ON tm.id = tt.turma_id WHERE tt.turno_id = va.turno_id) AS turmas
      FROM evento_aula x LEFT JOIN v_aula va ON va.aula_id = x.aula_id LEFT JOIN v_aula nv ON nv.aula_id = x.nova_aula_id
      WHERE x.evento_id = ? AND x.horario_id = ?${doCurso} ORDER BY x.estado DESC, va.inicio, va.uc`, [sel.id, st.horarioId]) : [];
    const quando = (sem, dia, ini, fim) => `${DC[dia]} ${dmy(c.data(sem, dia))} ${hhmm(ini)}${fim != null ? '–' + hhmm(fim) : ''}`;
    const semDe = (mask) => { for (let w = 1; w <= c.semanas; w++) if (mask & (1 << (w - 1))) return w; return null; };
    const f = st.eventoForm || { nome: '', tipo: TIPOS_EVENTO[0], data: '', dia: '1', ini: '08:00', fim: '23:30', alvo: rasc[0] ? String(rasc[0].id) : 'nova', desc: '' };
    return head('Calendário académico', 'Eventos e datas especiais', 'Eventos institucionais que suspendem as aulas (Festa do Caloiro, Dia Aberto, cerimónias, conferências). Ao registar um evento, a aplicação encontra as aulas afetadas, suspende-as nessa data e reagenda cada uma para a data e hora compatível com menor custo, sem criar conflitos de turma, professor ou sala.')
      + (ed ? `<form class="panel" data-submit="evento"><h3>Novo evento</h3><div class="formgrid">
          <label class="f">Nome<input type="text" id="ev-nome" required value="${esc(f.nome)}" placeholder="Ex.: Festa do Caloiro 2022"></label>
          <label class="f">Tipo<select id="ev-tipo">${TIPOS_EVENTO.map((t) => `<option${t === f.tipo ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label class="f">Data<input type="date" id="ev-data" required value="${esc(f.data)}" min="${esc(c.inicio)}" max="${isoDe(c.data(c.semanas, 5))}"></label>
          <label class="f">Duração<select id="ev-dia" data-change="ev-dia"><option value="1"${f.dia === '1' ? ' selected' : ''}>Dia inteiro (sem aulas)</option><option value="0"${f.dia === '0' ? ' selected' : ''}>Só um período do dia</option></select></label>
          ${f.dia === '0' ? `<label class="f">Das<input type="time" id="ev-ini" value="${esc(f.ini)}" step="1800"></label><label class="f">Às<input type="time" id="ev-fim" value="${esc(f.fim)}" step="1800"></label>` : ''}
          <label class="f">Repor as aulas em<select id="ev-alvo">${optList(rasc, 'id', (h) => `${h.nome} (rascunho)`, f.alvo)}${base ? `<option value="nova"${f.alvo === 'nova' || !rasc.length ? ' selected' : ''}>Nova versão em rascunho a partir de "${esc(base.nome)}"</option>` : ''}</select></label>
        </div>
        <label class="f">Descrição<input type="text" id="ev-desc" value="${esc(f.desc)}" placeholder="Opcional"></label>
        <div class="row"><button class="btn primary" type="submit">Registar e repor aulas</button><span class="small muted">As reposições ficam numa versão em rascunho, que segue o fluxo normal de aprovação e publicação.</span></div></form>` : '')
      + (ed && !cid && editavel(horario(st.horarioId)) ? `<div class="panel row"><span>Aulas do horário "${esc(hNome(st.horarioId))}" que ainda calham em feriados: <b>${num(feriadosPorRepor(st.horarioId), 0)}</b>.</span><button class="btn" data-act="rep-feriados">Repor aulas dos feriados</button></div>` : '')
      + `<div class="panel"><h3>Eventos registados${horario(st.horarioId) ? ` <span class="small muted">· no horário ${esc(hNome(st.horarioId))}</span>` : ''}</h3>${table(evs, [
          { h: 'Data', f: (e) => `<span class="mono">${dataPt(e.data)}</span>` }, { h: 'Evento', f: (e) => `<b>${esc(e.nome)}</b><br><span class="small muted">${esc(e.tipo)}${e.descricao ? ' · ' + esc(e.descricao) : ''}</span>` },
          { h: 'Período', f: (e) => (e.inicio == null ? 'dia inteiro' : `${hhmm(e.inicio)}–${hhmm(e.fim)}`) },
          { h: 'Aulas afetadas', f: (e) => `${e.n}${e.n ? ` <span class="pill ${e.ok === e.n ? 'ok' : 'soft'}">${e.ok} reagendadas</span>` : ''}`, num: true },
          { h: 'Horário', f: (e) => `<span class="small">${esc(e.horarios || '—')}</span>` },
          { h: '', f: (e) => `<div class="row"><button class="btn small" data-act="ev-ver" data-id="${e.id}">Ver aulas</button>${ed ? `<button class="btn small danger" data-act="ev-del" data-id="${e.id}" data-confirm="1">Remover e repor</button>` : ''}</div>` },
        ], { vazio: 'Ainda não há eventos registados.' })}</div>`
      + (sel ? `<div class="panel"><h3>${esc(sel.nome)}: aulas suspensas e reposições</h3>
          <div class="kpis">${kpi(det.length, 'aulas suspensas')}${kpi(det.filter((x) => x.estado === 'reagendada').length, 'reagendadas sem conflitos', 'ok')}${kpi(det.filter((x) => x.estado !== 'reagendada').length, 'sem data compatível', det.some((x) => x.estado !== 'reagendada') ? 'hard' : 'ok')}</div>
          ${table(det, [
            { h: 'Aula', f: (x) => `<b>${esc(x.uc || '')}</b> ${esc(x.turno || '')}<br><span class="small muted">${esc(x.turmas || '')}</span>` },
            { h: 'Data original', f: (x) => (x.dia != null ? quando(x.semana, x.dia, x.inicio, x.fim) + (x.sala ? ` · ${esc(x.sala)}` : '') : '—') },
            { h: 'Reposição proposta', f: (x) => (x.estado === 'reagendada' && x.ndia != null ? `<b>${quando(x.nova_semana != null ? x.nova_semana : semDe(x.nsemana), x.ndia, x.nini)}</b>${x.nsala ? ` · ${esc(x.nsala)}` : ''}${x.nova_aula_id === x.aula_id ? ' <span class="pill ok">aula prolongada</span>' : ''}` : '<span class="pill hard">sem data compatível</span>') },
            { h: '', f: (x) => (x.nova_aula_id ? `<button class="btn small" data-act="goto-aula" data-id="${x.nova_aula_id}">Ver no horário</button>` : '') },
          ], { maxH: 520, vazio: 'Nenhuma aula foi afetada por este evento.' })}
          ${det.some((x) => x.estado !== 'reagendada') ? '<p class="small muted">As aulas sem data compatível precisam de decisão manual (por exemplo, aceitar um furo noutra semana ou usar uma sala fora do perfil pedido).</p>' : ''}</div>` : '');
  };
  function novaVersaoDe(h) {
    return D.tx(() => {
      D.run("INSERT INTO horario (nome, ano_letivo, semestre, origem, criado_em, notas, estado, criado_por) VALUES (?,?,?,'manual',?,?,'rascunho',?)",
        [h.nome.replace(/ \((rascunho|cópia)[^)]*\)$/, '') + ` (rascunho ${agora().slice(8, 10)}/${agora().slice(5, 7)})`, h.ano_letivo, h.semestre, agora(), 'Nova versão a partir de: ' + h.nome, U.username]);
      const nid = D.lastId();
      D.run('INSERT INTO aula (horario_id, turno_id, seq, dia, inicio, duracao, sala_id, fixa, semanas, caracteristica_pedida, reposicao_de, evento_id) SELECT ?, turno_id, seq, dia, inicio, duracao, sala_id, fixa, semanas, caracteristica_pedida, reposicao_de, evento_id FROM aula WHERE horario_id = ?', [nid, h.id]);
      D.run(`INSERT OR IGNORE INTO evento_aula (evento_id, horario_id, aula_id, semana, nova_aula_id, nova_semana, estado, nota)
        SELECT x.evento_id, :n, b.id, x.semana, nb.id, x.nova_semana, x.estado, x.nota FROM evento_aula x
        JOIN aula a ON a.id = x.aula_id JOIN aula b ON b.horario_id = :n AND b.turno_id = a.turno_id AND b.seq = a.seq
        LEFT JOIN aula na ON na.id = x.nova_aula_id LEFT JOIN aula nb ON nb.horario_id = :n AND nb.turno_id = na.turno_id AND nb.seq = na.seq
        WHERE x.horario_id = :h`, { ':n': nid, ':h': h.id });
      return nid;
    });
  }
  /* Suspende as aulas afetadas pelo evento no horário hid e reagenda-as (engine.repor). */
  function aplicarEvento(evId, hid) {
    const ev = D.one('SELECT * FROM evento WHERE id = ?', [evId]);
    const dd = dadosData(ev.data);
    // Um evento registado pela direção de curso só suspende as aulas desse curso.
    return M.aplicarSuspensao(D, E, { evId, hid, semana: dd.semana, dia: dd.dia, ini: ev.inicio, fim: ev.fim, cursoId: U.curso_id || null,
      semanas: (row, c) => { const l = []; for (let w = dd.semana; w <= Math.min(c.semanas, dd.semana + 3); w++) l.push(w); return l; } });
  }
  function feriadosPorRepor(hid) {
    const c = cal();
    let n = 0;
    for (const f of c.feriadosLista.filter((x) => !x.evento)) n += D.one('SELECT COUNT(*) n FROM aula WHERE horario_id = ? AND dia = ? AND (semanas & ?) <> 0', [hid, f.dia, 1 << (f.semana - 1)]).n;
    return n;
  }
  SUBMIT.evento = () => {
    if (!can('eventos.gerir')) return;
    const f = st.eventoForm = { nome: $('#ev-nome').value.trim(), tipo: $('#ev-tipo').value, data: $('#ev-data').value, dia: $('#ev-dia').value, ini: ($('#ev-ini') || {}).value || '08:00', fim: ($('#ev-fim') || {}).value || '23:30', alvo: $('#ev-alvo').value, desc: $('#ev-desc').value.trim() };
    const dd = dadosData(f.data);
    if (!f.nome || !dd) { toast('Indique o nome e a data do evento.'); return; }
    if (dd.semana < 1 || dd.semana > dd.n) { toast(`A data fica fora do semestre (${dd.n} semanas).`); return; }
    if (dd.dia > 5) { toast('Ao domingo não há aulas.'); return; }
    const ini = f.dia === '1' ? null : toMin(f.ini), fim = f.dia === '1' ? null : toMin(f.fim);
    if (f.dia === '0' && !(fim > ini)) { toast('A hora de fim tem de ser depois da de início.'); return; }
    let hid = f.alvo === 'nova' ? null : Number(f.alvo);
    if (hid != null && !editavel(horario(hid))) { toast('Só se repõem aulas num horário em rascunho.'); return; }
    const t0 = Date.now();
    if (hid == null) {
      const base = horarios().find((h) => h.estado === 'publicado') || horario(st.horarioId);
      if (!base) { toast('Não há horário de partida.'); return; }
      hid = novaVersaoDe(base);
      registar('Nova versão em rascunho', `${base.nome} → rascunho (para o evento ${f.nome})`);
    }
    D.run('INSERT INTO evento (nome, tipo, data, inicio, fim, descricao, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?)', [f.nome, f.tipo, f.data, ini, fim, (U.curso_id ? [f.desc, `só aulas do curso ${(D.one('SELECT sigla FROM curso WHERE id = ?', [U.curso_id]) || {}).sigla}`].filter(Boolean).join(' · ') : f.desc) || null, U.username, agora()]);
    const evId = D.lastId();
    const r = aplicarEvento(evId, hid);
    changed('Evento registado', `${f.nome} (${dataPt(f.data)}${ini != null ? ` ${f.ini}–${f.fim}` : ''}): ${r.n} aulas suspensas, ${r.ok} reagendadas em ${hNome(hid)}`);
    st.eventoSel = evId; st.eventoForm = null; st.horarioId = hid;
    toast(`${r.n} aulas afetadas; ${r.ok} reagendadas sem conflitos (${num((Date.now() - t0) / 1000, 1)} s).`);
    render();
  };
  function removerEvento(evId) {
    const ev = D.one('SELECT * FROM evento WHERE id = ?', [evId]);
    const ligados = D.q('SELECT DISTINCT horario_id FROM evento_aula WHERE evento_id = ?', [evId]).map((x) => horario(x.horario_id)).filter(Boolean);
    const bloq = ligados.filter((h) => !editavel(h));
    if (bloq.length) { toast(`O horário "${bloq[0].nome}" já não está em rascunho: crie uma nova versão para desfazer o evento.`); return; }
    const dd = dadosData(ev.data);
    D.tx(() => {
      for (const x of D.q('SELECT * FROM evento_aula WHERE evento_id = ?', [evId])) {
        D.run('UPDATE aula SET semanas = semanas | ? WHERE id = ?', [1 << (x.semana - 1), x.aula_id]);
        if (x.nova_aula_id === x.aula_id && x.nova_semana) D.run('UPDATE aula SET semanas = semanas & ~? WHERE id = ?', [1 << (x.nova_semana - 1), x.aula_id]);
        else if (x.nova_aula_id) D.run('DELETE FROM aula WHERE id = ?', [x.nova_aula_id]);
      }
      D.run('DELETE FROM evento WHERE id = ?', [evId]);
    });
    changed('Evento removido', `${ev.nome} (${dataPt(ev.data)}): aulas repostas na data original`);
    st.eventoSel = null; render();
  }

  /* ===== A minha conta ===== */
  VIEWS.conta = () => {
    const u = D.one('SELECT * FROM utilizador WHERE id = ?', [U.id]);
    const perms = D.q('SELECT p.* FROM perfil_permissao pp JOIN permissao p ON p.id = pp.permissao_id WHERE pp.perfil_id = ? ORDER BY p.area, p.id', [U.perfil_id]);
    const meus = D.q('SELECT * FROM registo WHERE utilizador = ? ORDER BY id DESC LIMIT 15', [U.username]);
    return head('Conta', 'A minha conta', `${esc(U.nome)} · ${esc(U.perfil)} · <span class="mono">${esc(U.username)}</span>`)
      + (U.mudar_senha ? '<div class="callout warn"><b>Tem de definir uma senha nova antes de continuar.</b> A senha atual é temporária.</div>' : '')
      + `<div class="cols even"><form class="panel" data-submit="senha" autocomplete="off"><h3>Mudar a senha</h3>
          <input type="text" autocomplete="username" value="${esc(U.username)}" hidden>
          <label class="f">Senha atual<input type="password" id="ps-a" autocomplete="current-password" required></label>
          <label class="f">Senha nova<input type="password" id="ps-n" autocomplete="new-password" required minlength="10"></label>
          <label class="f">Repetir a senha nova<input type="password" id="ps-c" autocomplete="new-password" required></label>
          <p class="small muted">Pelo menos 10 caracteres, com letras e números, sem o nome de utilizador.</p>
          <div class="row"><button class="btn primary" type="submit">Guardar senha</button></div></form>
        ${U.turma_id ? '' : `<div class="panel"><h3>O que o seu perfil pode fazer</h3>${perms.length ? `<ul class="small" style="margin:0;padding-left:18px">${perms.map((p) => `<li>${esc(p.descricao)}</li>`).join('')}</ul>` : '<p class="small">Consultar o horário publicado da sua turma.</p>'}
          <p class="small muted">Última entrada: ${esc((u.ultimo_login || '—').replace('T', ' '))} (UTC).</p></div>`}</div>`
      + (U.docente_id || U.turma_id ? '' : `<div class="panel"><h3>A sua atividade recente</h3>${table(meus, [{ h: 'Quando', f: (r) => `<span class="mono small">${esc(r.quando.replace('T', ' '))}</span>` }, { h: 'Ação', k: 'acao' }, { h: 'Detalhe', f: (r) => `<span class="small">${esc(r.detalhe)}</span>` }])}</div>`);
  };
  SUBMIT.senha = async () => {
    const a = $('#ps-a').value, n = $('#ps-n').value, c = $('#ps-c').value;
    const u = D.one('SELECT * FROM utilizador WHERE id = ?', [U.id]);
    let h;
    try { h = await pbkdf2(a, u.sal); } catch (e) { toast('Este browser não permite calcular senhas (é preciso https).'); return; }
    if (!iguais(h, u.hash)) { registar('Mudança de senha recusada', 'senha atual errada'); changed(); toast('A senha atual não está correta.'); return; }
    if (n !== c) { toast('As duas senhas novas não coincidem.'); return; }
    if (n === a) { toast('A senha nova tem de ser diferente da atual.'); return; }
    const e = politicaSenha(n, U.username);
    if (e) { toast(e); return; }
    const sal = novoSal();
    D.run('UPDATE utilizador SET sal = ?, hash = ?, mudar_senha = 0 WHERE id = ?', [sal, await pbkdf2(n, sal), U.id]);
    U = carregarUtilizador(U.username);
    changed('Senha alterada', '');
    toast('Senha alterada.');
    if (st.view === 'conta') { const vs = visiveis().map((v) => v[0]); st.view = vs.includes(INICIO[U.perfil_id]) ? INICIO[U.perfil_id] : vs[0]; }
    render();
  };

  /* ---------- Ações ---------- */
  const blobUrl = (txt, tipo) => { if (st.csvOut && st.csvOut.url) URL.revokeObjectURL(st.csvOut.url); return URL.createObjectURL(new Blob([txt], { type: tipo || 'text/csv;charset=utf-8' })); };
  function irParaAula(id) {
    const a = D.one('SELECT * FROM v_aula WHERE aula_id = ?', [id]);
    if (!a) return;
    if (a.horario_id !== st.horarioId && horarios().some((h) => h.id === a.horario_id)) st.horarioId = a.horario_id;
    const podeHorario = visiveis().some((v) => v[0] === 'horario');
    if (!podeHorario) { st.sel = id; st.view = U.docente_id || U.turma_id ? 'meu' : 'consultas'; render(); return; }
    if (st.filtro.tipo !== 'turma' || !D.one('SELECT 1 x FROM turno_turma WHERE turno_id = ? AND turma_id = ?', [a.turno_id, st.filtro.id])) {
      const t = D.one('SELECT turma_id FROM turno_turma WHERE turno_id = ? LIMIT 1', [a.turno_id]);
      st.filtro = t ? { tipo: 'turma', id: t.turma_id } : { tipo: 'uc', id: a.uc_id };
    }
    if (st.semana && !(a.semanas & (1 << (st.semana - 1)))) st.semana = 0;
    st.sel = id; st.sugestoes = null; st.view = 'horario'; render();
    const b = $(`.blk[data-aula="${id}"]`); if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const ACT = {
    view: (el) => { st.view = el.dataset.k; st.sel = null; st.bloqueio = null; st.sugestoes = null; st.csvOut = null; render(); window.scrollTo(0, 0); },
    sair: () => sair('pelo utilizador'),
    reset: async () => {
      if (!can('dados.editar')) return;
      await IDB.del('db-' + st.ds);
      D = freshDb(st.ds); rev++; vcache.clear();
      U = carregarUtilizador(U.username);
      if (!U) { sair('Dados repostos: entre de novo.'); return; }
      registar('Dados repostos', DATASETS[st.ds].nome); save();
      iniciarSessao(); toast('Dados iniciais repostos.');
    },
    'lg-fill': (el) => { $('#lg-u').value = el.dataset.u; $('#lg-p').value = el.dataset.s; $('#lg-go').focus(); },
    'goto-aula': (el) => irParaAula(Number(el.dataset.id)),
    'viol-ver': (el) => { st.violSel = st.violSel === el.dataset.k ? null : el.dataset.k; render(); },
    'ver-regra': (el) => { st.view = 'horario'; st.vfiltro = 'r:' + el.dataset.k; render(); },
    'sel-close': () => { st.sel = null; st.bloqueio = null; st.sugestoes = null; render(); },
    'cmp-chave': () => { const { base, alt } = horariosChave(); if (base && alt) st.cmp = { a: base.id, b: alt.id }; st.view = 'comparar'; render(); },
    'ver-h': (el) => { st.horarioId = Number(el.dataset.id); st.view = 'horario'; st.sel = null; st.undo = []; render(); },
    'ed-save': (el) => {
      const id = Number(el.dataset.id);
      const sala = $('#ed-sala').value === '' ? null : Number($('#ed-sala').value);
      const a = D.one('SELECT fixa FROM aula WHERE id = ?', [id]);
      const r = moverAula(id, Number($('#ed-dia').value), Number($('#ed-ini').value), sala);
      const fixa = $('#ed-fixa') && $('#ed-fixa').checked ? 1 : 0;
      if (r && r.ok && a && a.fixa !== fixa) { D.run('UPDATE aula SET fixa = ? WHERE id = ?', [fixa, id]); changed(fixa ? 'Aula fixada' : 'Aula desfixada', `aula ${id}`); }
      st.sugestoes = null; render();
    },
    forcar: (el) => {
      const b = st.bloqueio; const just = ($('#forcar-just').value || '').trim();
      if (!b) return;
      if (just.length < 5) { toast('Escreva uma justificação (fica no registo de auditoria).'); return; }
      moverAula(b.id, b.dia, b.ini, b.sala, { forcar: true, justificacao: just }); st.bloqueio = null; render();
    },
    sugerir: (el) => {
      const id = Number(el.dataset.id);
      const P = M.buildProblem(D, { horarioId: st.horarioId });
      const idx = P.aulas.findIndex((a) => a.id === id);
      const temSab = P.aulas.some((a) => a.dia === 5);
      const list = E.suggest(P, idx, { dias: temSab ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4], grelha: 'blocos', n: 6 });
      st.sugestoes = { id, list: list.map((s) => ({ ...s, salaId: s.sala >= 0 ? P.salas[s.sala].id : null, sala: s.sala >= 0 ? P.salas[s.sala].codigo : 'sem sala' })) };
      render();
    },
    'aplicar-sug': (el) => { moverAula(Number(el.dataset.id), Number(el.dataset.dia), Number(el.dataset.ini), el.dataset.sala === '' ? null : Number(el.dataset.sala)); st.sugestoes = null; render(); },
    undo: () => {
      const u = st.undo.pop(); if (!u) return;
      const h = horario((D.one('SELECT horario_id FROM aula WHERE id = ?', [u.id]) || {}).horario_id);
      if (!editavel(h)) { toast('Só se desfaz em horários em rascunho.'); return; }
      D.run('UPDATE aula SET dia = ?, inicio = ?, sala_id = ? WHERE id = ?', [u.dia, u.ini, u.sala, u.id]);
      for (const o of u.outras || []) D.run('UPDATE aula SET dia = ?, inicio = ?, sala_id = ? WHERE id = ?', [o.dia, o.ini, o.sala, o.id]);
      changed('Alteração desfeita', `aula ${u.id}`); st.sel = u.id; toast('Alteração desfeita.'); render();
    },
    'h-del': () => {
      const h = horario(st.horarioId);
      if (!editavel(h)) { toast('Só se apagam horários em rascunho.'); return; }
      D.run('DELETE FROM horario WHERE id = ?', [h.id]); changed('Horário apagado', h.nome); st.horarioId = null; st.sel = null; toast('Rascunho apagado.'); render();
    },
    'csv-aulas': () => {
      const hid = st.horarioId; const h = horario(hid); const c = cal();
      const rows = D.q(`SELECT v.*, (SELECT group_concat(tm.codigo, ', ') FROM turno_turma tt JOIN turma tm ON tm.id = tt.turma_id WHERE tt.turno_id = v.turno_id) AS turmas,
          (SELECT group_concat(DISTINCT cu.sigla) FROM turno_turma tt JOIN turma tm ON tm.id = tt.turma_id JOIN curso cu ON cu.id = tm.curso_id WHERE tt.turno_id = v.turno_id) AS cursos,
          (SELECT group_concat(sc.caracteristica, ', ') FROM sala_caracteristica sc WHERE sc.sala_id = v.sala_id) AS caracteristicas_sala
        FROM v_aula v WHERE horario_id = ?`, [hid]);
      const x = IMP.exportarIscte(rows, { inicio: c.inicio, semanas: c.semanas }, D.q('SELECT data FROM feriado'));
      const nome = (h.nome.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'horario') + '.csv';
      st.csvOut = { t: 'aulas', url: blobUrl(x.csv), nome, info: `${num(x.linhas, 0)} linhas (uma por aula e data, no formato da Proposta de Horário). ${num(x.saltadas, 0)} ocorrências que calham em feriados não foram exportadas.` };
      registar('Exportação CSV', h.nome);
      render();
    },
    'csv-out': (el) => { const t = el.dataset.t; const cs = cols(t).map((c) => c.name).filter((k) => !(t === 'utilizador' && (k === 'sal' || k === 'hash'))); st.csvOut = { t, txt: [cs.join(','), ...D.q(`SELECT * FROM ${t}`).map((r) => cs.map((k) => csvCell(r[k])).join(','))].join('\n') }; render(); },
    'csv-close': () => { st.csvOut = null; render(); },
    'reg-csv': () => {
      const rows = D.q('SELECT * FROM registo ORDER BY id');
      const cs = ['id', 'quando', 'utilizador', 'ator', 'acao', 'detalhe'];
      st.csvOut = { t: 'registo', url: blobUrl('﻿' + [cs.join(';'), ...rows.map((r) => cs.map((k) => csvCell(r[k])).join(';'))].join('\r\n')), nome: 'registo-auditoria.csv' };
      registar('Registo exportado', `${rows.length} linhas`); changed();
      render();
    },
    copy: (el) => {
      const ta = document.getElementById(el.dataset.src);
      const done = () => toast('Copiado.');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); toast('Selecionado: use Ctrl+C para copiar.'); });
      else { ta.select(); toast('Selecionado: use Ctrl+C para copiar.'); }
    },
    'dados-tab': (el) => { st.dadosTab = el.dataset.k; render(); },
    'acad-tab': (el) => { st.acadTab = el.dataset.k; st.tabelaBusca = ''; render(); },
    'row-add': (el) => {
      const t = el.dataset.t;
      if (PROTEGIDAS.has(t) || !(can('dados.editar') || (t === 'sala' && can('salas.editar')))) { toast('Sem permissão.'); return; }
      const vals = {};
      $$('[data-new]').forEach((i) => { if (i.value !== '') vals[i.dataset.new] = /^-?\d+(\.\d+)?$/.test(i.value) ? Number(i.value) : i.value; });
      const k = Object.keys(vals);
      if (!k.length) { toast('Preencha pelo menos um campo.'); return; }
      try { D.run(`INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, k.map((x) => vals[x])); changed('Registo criado', `${t}: ${JSON.stringify(vals).slice(0, 200)}`); toast('Registo acrescentado.'); render(); }
      catch (e) { toast('Não foi possível acrescentar: ' + e.message); }
    },
    'row-del': (el) => {
      const t = el.dataset.t;
      if (PROTEGIDAS.has(t) || !(can('dados.editar') || (t === 'sala' && can('salas.editar')))) { toast('Sem permissão.'); return; }
      try { D.run(`DELETE FROM ${t} WHERE rowid = ?`, [Number(el.dataset.rid)]); changed('Registo apagado', `${t} #${el.dataset.rid}`); render(); }
      catch (e) { toast('Não foi possível apagar: ' + e.message); }
    },
    'sql-run': runSql,
    'imp-run': importar,
    'imp-modelo': () => { const t = $('#imp-tab').value; st.importTab = t; st.importCsv = modeloCsv(t); render(); },
    'isc-import': importarIscte,
    'doc-import': importarDocentesCiencia,
    'nr-test': () => {
      const r = lerNovaRegra();
      try { r.teste = { rows: D.q(r.sql, { ':horario': st.horarioId }) }; if (r.teste.rows.length && !('mensagem' in r.teste.rows[0])) r.teste = { erro: 'A consulta tem de devolver uma coluna chamada mensagem.' }; }
      catch (e) { r.teste = { erro: e.message }; }
      render();
    },
    'nr-save': () => {
      if (!can('regras.editar')) return;
      const r = lerNovaRegra();
      if (!/^[A-Z0-9_]{3,}$/.test(r.codigo) || !r.nome) { toast('Indique um código (letras, números e _) e um nome.'); return; }
      if (!/^\s*(select|with)\b/i.test(r.sql)) { toast('A regra tem de ser uma consulta SELECT.'); return; }
      try { D.q(r.sql, { ':horario': st.horarioId }); } catch (e) { toast('A consulta tem um erro: ' + e.message); return; }
      try {
        D.run("INSERT INTO regra (codigo, nome, descricao, implementacao, parametros, severidade, peso, ativa, sql, origem, alterada_em) VALUES (?,?,?,'sql','{}',?,?,1,?,?,?)", [r.codigo, r.nome, r.descricao, r.severidade, r.peso, r.sql, 'Criada por ' + U.username, agora()]);
      } catch (e) { toast('Não foi possível guardar: ' + e.message); return; }
      changed('Regra criada', `${r.codigo}: ${r.nome}`); st.novaRegra = null; toast('Regra guardada e ativa.'); render();
    },
    'regra-del': (el) => { if (!can('regras.editar')) return; const r = D.one('SELECT codigo FROM regra WHERE id = ?', [Number(el.dataset.id)]); D.run('DELETE FROM regra WHERE id = ?', [Number(el.dataset.id)]); changed('Regra apagada', r.codigo); render(); },
    'gen-run': gerar,
    'gen-stop': () => { if (worker) worker.terminate(); worker = null; st.gen.prog = null; toast('Geração parada.'); render(); },
    'gen-save': guardarGerado,
    'gen-ver': () => { st.horarioId = st.gen.saved; st.view = 'horario'; st.sel = null; render(); },
    'gen-reset-regras': () => { st.gen.regras = null; render(); },
    wf: (el) => {
      const c = $('#wf-coment');
      transicao(el.dataset.id ? Number(el.dataset.id) : st.horarioId, el.dataset.a, c ? c.value.trim() : '');
    },
    pedir: (el) => { st.pedido = { aulaId: Number(el.dataset.id), aulaHid: st.horarioId }; if (!['meu', 'turmas', 'pedidos'].includes(st.view)) st.view = 'pedidos'; render(); const f = $('#pd-motivo'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } },
    'pedido-cancel': () => { st.pedido = null; render(); },
    'pd-dec': (el) => decidirPedido(Number(el.dataset.id), el.dataset.d, el.dataset.subst || null),
    'pd-aplicar': (el) => aplicarAprovado(Number(el.dataset.id)),
    'cr-sugerir': () => {
      const f = lerCriar(); const dd = dadosData(f.data);
      if (!dd || dd.dia > 5) { toast('Indique uma data de segunda a sábado.'); return; }
      const ini = toMin(f.ini), fim = toMin(f.fim);
      let mask = 0; if (f.rep === 'unica') mask = 1 << (dd.semana - 1); else for (let w = f.rep === 'todas' ? 1 : dd.semana; w <= dd.n; w++) mask |= 1 << (w - 1);
      const P = M.buildProblem(D, { horarioId: st.horarioId });
      const alt = E.searchRooms(P, { dia: dd.dia, ini, dur: fim - ini, alunos: alunosCriar(f), car: f.car || null, semanas: mask }).filter((x) => x.livre && x.capOk).slice(0, 6);
      st.criarRes = { ok: false, erro: alt.length ? 'Salas livres e adequadas para esse período (escolha uma):' : 'Não há salas livres com lugares suficientes nesse período.', novas: [], alternativas: alt };
      render();
    },
    'cr-sala': (el) => { lerCriar(); st.criar.sala = el.dataset.id; st.criarRes = null; render(); },
    'cr-forcar': () => { const j = ($('#cr-just').value || '').trim(); if (j.length < 5) { toast('Escreva uma justificação (fica no registo de auditoria).'); return; } criarAula(true, j); },
    'cal-save': () => {
      if (!can('dados.editar')) return;
      const ano = $('#cal-ano').value.trim(), ini = $('#cal-ini').value, sem = Math.max(1, Math.min(30, Number($('#cal-sem').value) || 14)), notas = $('#cal-notas').value.trim();
      if (!ini || new Date(ini + 'T00:00:00Z').getUTCDay() !== 1) { toast('O início do semestre tem de ser uma segunda-feira.'); return; }
      const c = cal();
      if (c.id != null) D.run('UPDATE calendario SET ano_letivo = ?, inicio = ?, semanas = ?, notas = ? WHERE id = ?', [ano, ini, sem, notas, c.id]);
      else D.run('INSERT INTO calendario (ano_letivo, semestre, inicio, semanas, notas) VALUES (?,1,?,?,?)', [ano, ini, sem, notas]);
      changed('Calendário alterado', `${ano}: início ${ini}, ${sem} semanas`); toast('Calendário guardado.'); render();
    },
    'fer-add': () => {
      if (!can('dados.editar')) return;
      const d = $('#fer-data').value, n = $('#fer-nome').value.trim(), t = $('#fer-tipo').value;
      if (!d || !n) { toast('Indique a data e o nome.'); return; }
      try { D.run('INSERT INTO feriado (data, nome, tipo) VALUES (?,?,?)', [d, n, t]); } catch (e) { toast('Não foi possível acrescentar: ' + e.message); return; }
      changed('Feriado acrescentado', `${d} ${n}`); render();
    },
    'fer-del': (el) => { if (!can('dados.editar')) return; D.run('DELETE FROM feriado WHERE data = ?', [el.dataset.id]); changed('Feriado apagado', el.dataset.id); render(); },
    'cons-tipo': (el) => { st.consulta = { tipo: el.dataset.k, id: null }; st.sel = null; render(); },
    pincel: (el) => { st.paint = el.dataset.k; render(); },
    'disp-limpar': () => { if (!U.docente_id || !can('disponibilidade.propria')) return; D.run('DELETE FROM disponibilidade WHERE docente_id = ?', [U.docente_id]); changed('Disponibilidade apagada', ''); render(); },
    reservar: (el) => {
      if (!can('reservas.gerir')) return;
      const q = st.pesquisa; const motivo = ($('#res-motivo').value || '').trim() || 'Reserva';
      D.run('INSERT INTO reserva (sala_id, dia, inicio, fim, motivo, pedido_por) VALUES (?,?,?,?,?,?)', [Number(el.dataset.sala), Number(q.dia), Number(q.ini), Number(q.ini) + Number(q.dur), motivo, U.username]);
      const s = D.one('SELECT codigo FROM sala WHERE id = ?', [Number(el.dataset.sala)]);
      changed('Sala reservada', `${s.codigo}, ${DIAS[q.dia]} ${hhmm(Number(q.ini))}: ${motivo}`); toast(`${s.codigo} reservada.`); render();
    },
    'res-del': (el) => { if (!can('reservas.gerir')) return; D.run('DELETE FROM reserva WHERE id = ?', [Number(el.dataset.id)]); changed('Reserva apagada', '#' + el.dataset.id); render(); },
    'ev-ver': (el) => { st.eventoSel = Number(el.dataset.id); render(); },
    'ev-del': (el) => { if (can('eventos.gerir')) removerEvento(Number(el.dataset.id)); },
    'rep-feriados': () => {
      if (!can('eventos.gerir') || !editavel(horario(st.horarioId))) return toast('Só se repõem aulas num horário em rascunho.');
      const t0 = Date.now();
      const r = M.reporFeriados(D, E, st.horarioId, U.username);
      changed('Aulas de feriados repostas', `${hNome(st.horarioId)}: ${r.n} aulas em ${r.feriados} feriados, ${r.ok} repostas (${r.prolongadas} prolongadas)`);
      toast(`${r.n} aulas em feriados; ${r.ok} repostas numa semana posterior, ${r.prolongadas} delas prolongando a própria aula (${num((Date.now() - t0) / 1000, 1)} s).`);
      render();
    },
    cenario: (el) => { st.horarioId = Number(el.dataset.id); st.sel = null; render(); },
    'senha-ok': () => { st.senhaTemp = null; render(); },
    'u-desbloq': (el) => { if (!can('utilizadores.gerir')) return; const u = D.one('SELECT username FROM utilizador WHERE id = ?', [Number(el.dataset.id)]); D.run('UPDATE utilizador SET falhas = 0, bloqueado_ate = NULL WHERE id = ?', [Number(el.dataset.id)]); changed('Conta desbloqueada', u.username); render(); },
    'u-ativo': (el) => {
      const id = Number(el.dataset.id);
      if (!can('utilizadores.gerir') || id === U.id) return;
      const u = D.one('SELECT * FROM utilizador WHERE id = ?', [id]);
      if (!u.ativo) { const cs = conflitosConta(u.nome, u.perfil_id, u.id); if (cs.length) { registar('Conta recusada', `${u.username}: segregação de funções`); changed(); toast('Não pode ser ativada. ' + conflitoTxt(cs)); return; } }
      D.run('UPDATE utilizador SET ativo = ? WHERE id = ?', [u.ativo ? 0 : 1, id]); changed(u.ativo ? 'Conta desativada' : 'Conta ativada', u.username); render();
    },
    'u-reset': async (el) => {
      const id = Number(el.dataset.id);
      if (!can('utilizadores.gerir') || id === U.id) return;
      const u = D.one('SELECT username FROM utilizador WHERE id = ?', [id]);
      const senha = senhaTemporaria(), sal = novoSal();
      let hash; try { hash = await pbkdf2(senha, sal); } catch (e) { toast('Este browser não permite calcular senhas (é preciso https).'); return; }
      D.run('UPDATE utilizador SET sal = ?, hash = ?, mudar_senha = 1, falhas = 0, bloqueado_ate = NULL WHERE id = ?', [sal, hash, id]);
      changed('Senha reposta', u.username); st.senhaTemp = { u: u.username, s: senha }; render();
    },
  };
  const CHG = {
    semana: (el) => { st.semana = Number(el.value); render(); },
    'filtro-tipo': (el) => { const t = el.value; const r = D.one(primeiroDe[t]); st.filtro = { tipo: t, id: r ? r.id : null }; st.sel = null; render(); },
    'filtro-id': (el) => { st.filtro.id = Number(el.value); st.sel = null; render(); },
    'cons-id': (el) => { st.consulta.id = Number(el.value); st.sel = null; render(); },
    'cr-uc': () => { const f = lerCriar(); f.turno = ''; f.docente = ''; f.insc = ''; f.car = ''; st.criarRes = null; render(); },
    'cr-turno': () => { const f = lerCriar(); f.docente = ''; f.insc = ''; f.car = ''; render(); },
    vfiltro: (el) => { st.vfiltro = el.value; render(); },
    regra: (el) => {
      if (!can('regras.editar')) { render(); return; }
      const id = Number(el.dataset.id), c = el.dataset.c;
      if (!['ativa', 'severidade', 'peso', 'parametros', 'sql'].includes(c)) return;
      let v = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
      if (c === 'peso') v = Number(v) || 0;
      if (c === 'parametros') { try { v = JSON.stringify(JSON.parse(v)); } catch (e) { toast('JSON inválido: ' + e.message); return; } }
      if (c === 'sql') { if (!/^\s*(select|with)\b/i.test(v)) { toast('A regra tem de ser uma consulta SELECT.'); return; } try { D.q(v, { ':horario': st.horarioId }); } catch (e) { toast('Erro na consulta: ' + e.message); return; } }
      D.run(`UPDATE regra SET ${c} = ?, versao = versao + 1, alterada_em = ? WHERE id = ?`, [v, agora(), id]);
      const r = D.one('SELECT codigo FROM regra WHERE id = ?', [id]);
      changed('Regra alterada', `${r.codigo}.${c} = ${String(v).slice(0, 120)}`);
      if (st.gen) st.gen.regras = null;
      toast('Regra atualizada. A validação já usa o novo valor.'); render();
    },
    'pd-slot': () => {
      const p = st.pedido; if (!p) return;
      const a = D.one('SELECT * FROM v_aula WHERE aula_id = ?', [p.aulaId]); if (!a) return;
      const dv = $('#pd-dia').value, iv = $('#pd-ini').value;
      const sel = $('#pd-sala').value;
      $('#pd-sala').innerHTML = salasPedido(a, dv === '' ? null : Number(dv), iv === '' ? null : Number(iv), Number($('#pd-alunos').value) || null);
      if ([...$('#pd-sala').options].some((o) => o.value === sel)) $('#pd-sala').value = sel;
    },
    cell: (el) => {
      const t = el.dataset.t;
      if (PROTEGIDAS.has(t) || !(can('dados.editar') || (t === 'sala' && can('salas.editar')))) { toast('Sem permissão.'); render(); return; }
      const v = el.value === '' ? null : /^-?\d+(\.\d+)?$/.test(el.value) ? Number(el.value) : el.value;
      try { D.run(`UPDATE ${t} SET ${el.dataset.c} = ? WHERE rowid = ?`, [v, Number(el.dataset.rid)]); changed('Dado alterado', `${t}.${el.dataset.c} = ${String(v).slice(0, 80)}`); el.style.background = 'var(--ok-soft)'; }
      catch (e) { toast('Valor rejeitado: ' + e.message); render(); }
    },
    tabela: (el) => { st.tabela = el.value; st.tabelaBusca = ''; st.csvOut = null; render(); },
    'fonte-estado': (el) => { if (!can('dados.editar')) return; D.run('UPDATE fonte SET estado = ? WHERE id = ?', [el.value, Number(el.dataset.id)]); const f = D.one('SELECT informacao FROM fonte WHERE id = ?', [Number(el.dataset.id)]); changed('Estado de fonte', `${f.informacao}: ${el.value}`); render(); },
    'sql-ex': (el) => { if (el.value === '') return; st.sql = EXEMPLOS_SQL[Number(el.value)][1]; render(); },
    'gen-regra': (el) => {
      const r = st.gen.regras[el.dataset.k]; const c = el.dataset.c;
      if (c === 'ativa') { r.ativa = el.checked; if (el.dataset.k === 'ALTERACOES') st.gen.alteracoesTocada = true; } else if (c === 'peso') r.peso = Number(el.value) || 0; else r.sev = el.value;
    },
    cmp: (el) => { st.cmp[el.dataset.k] = Number(el.value); render(); },
    'pd-alvo': (el) => { st.pdAlvo = el.value; render(); },
    pesq: (el) => { st.pesquisa[el.dataset.k] = el.value; render(); },
    'curso-turma': (el) => { st.cursoTurmaId = Number(el.value); st.sel = null; render(); },
    'sala-sel': (el) => { st.salaSel = Number(el.value); render(); },
    'sala-car': (el) => {
      if (!can('salas.editar')) { render(); return; }
      const k = el.dataset.k; const s = D.one('SELECT codigo FROM sala WHERE id = ?', [st.salaSel]);
      if (el.checked) D.run('INSERT OR IGNORE INTO sala_caracteristica (sala_id, caracteristica) VALUES (?,?)', [st.salaSel, k]);
      else D.run('DELETE FROM sala_caracteristica WHERE sala_id = ? AND caracteristica = ?', [st.salaSel, k]);
      changed(el.checked ? 'Característica acrescentada' : 'Característica retirada', `${s.codigo}: ${k}`); render();
    },
    'u-perfil': (el) => {
      const id = Number(el.dataset.id);
      if (!can('utilizadores.gerir') || id === U.id) { render(); return; }
      const u = D.one('SELECT * FROM utilizador WHERE id = ?', [id]);
      const cs = conflitosConta(u.nome, el.value, u.id);
      if (cs.length) { registar('Conta recusada', `${u.username} → ${el.value}: segregação de funções`); changed(); toast('Recusado por segregação de funções. ' + conflitoTxt(cs)); render(); return; }
      D.run('UPDATE utilizador SET perfil_id = ? WHERE id = ?', [el.value, id]); changed('Perfil alterado', `${u.username}: ${u.perfil_id} → ${el.value}`); render();
    },
    'nc-perfil': (el) => { st.novaConta = { username: $('#nc-u').value, nome: $('#nc-n').value, perfil: el.value, liga: '' }; render(); },
    perm: alterarPermissao,
    'ev-dia': (el) => { st.eventoForm = { nome: $('#ev-nome').value, tipo: $('#ev-tipo').value, data: $('#ev-data').value, dia: el.value, ini: '08:00', fim: '13:00', alvo: $('#ev-alvo').value, desc: $('#ev-desc').value }; render(); },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.dataset.confirm && !el.classList.contains('armed')) {
      e.preventDefault();
      el.classList.add('armed'); const t = el.textContent; el.textContent = 'Confirmar?';
      setTimeout(() => { el.classList.remove('armed'); el.textContent = t; }, 3000);
      return;
    }
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'lg-ds') {
      st.ds = el.value; ui.set('ds', st.ds); vcache.clear(); rev++;
      D = await loadDb(st.ds); st.loginErr = ''; renderLogin(); return;
    }
    if (el.id === 'hsel') { st.horarioId = Number(el.value); st.sel = null; st.undo = []; st.bloqueio = null; st.csvOut = null; render(); return; }
    if (el.id === 'gen-modo' && st.gen) { lerGen(); render(); return; }
    if (el.id === 'imp-file' && el.files && el.files[0]) { const txt = await lerFicheiro(el.files[0]); st.importCsv = txt; st.importTab = $('#imp-tab').value; render(); return; }
    if (el.dataset.change && CHG[el.dataset.change]) CHG[el.dataset.change](el, e);
  });
  let buscaT = null;
  document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id !== 'tab-busca' && id !== 'reg-busca') return;
    clearTimeout(buscaT); const v = e.target.value;
    buscaT = setTimeout(() => { if (id === 'tab-busca') st.tabelaBusca = v; else st.regFiltro = v; render(); const i = $('#' + id); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 250);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'sql' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); }
  });

  /* ---------- Arranque ---------- */
  D = await loadDb(st.ds);
  const sess = ss.get();
  if (sess && sess.ds === st.ds && Date.now() - sess.t < INATIVIDADE_MIN * 60000) U = carregarUtilizador(sess.u);
  if (U) iniciarSessao(); else render();
})();
