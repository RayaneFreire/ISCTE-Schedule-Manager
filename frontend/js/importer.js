/* Importação dos ficheiros do ISCTE (horário de exemplo e caracterização das salas)
   para o modelo de dados, com adaptação ao calendário de outro ano letivo.
   Corre no browser (Fontes e recolha) e em node (tools/build-iscte.js). */
(function (root) {
  'use strict';

  const DIA_COD = { Seg: 0, Ter: 1, Qua: 2, Qui: 3, Sex: 4, 'Sáb': 5, Sab: 5 };
  const DAY = 86400000;
  const SEM_SALA = 'Não necessita de sala';

  function parseCSV(txt, sep) {
    txt = String(txt).replace(/^﻿/, '');
    if (!sep) {
      const first = txt.split('\n')[0] || '';
      sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    }
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  const toMin = (s) => { const p = String(s).split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); };
  const parseDate = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim()); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null; };
  const isoUTC = (t) => new Date(t).toISOString().slice(0, 10);
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const ptDate = (t) => { const d = new Date(t); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear(); };
  const pop = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
  const mode = (arr) => { const c = new Map(); let best = null, bn = 0; for (const x of arr) { const n = (c.get(x) || 0) + 1; c.set(x, n); if (n > bn) { bn = n; best = x; } } return best; };

  /* Nomes de sala que o Excel transformou em números (1E02 → 1,00E+02). */
  function corrigirNomeSala(n) {
    const m = /^(\d),00E\+(\d{2})$/.exec(String(n).trim());
    return m ? m[1] + 'E' + m[2] : String(n).trim();
  }

  const EDIFICIOS = [
    [/Ala Aut/i, 'AA', 'Ala Autónoma'], [/Edif[ií]cio II/i, 'E2', 'Edifício II'],
    [/Sedas Nunes/i, 'SN', 'Edifício Sedas Nunes'], [/Polidesport/i, 'PD', 'Polidesportivo'],
  ];
  function edificio(nome) {
    for (const [re, id, n] of EDIFICIOS) if (re.test(nome)) return [id, n];
    const id = nome.replace(/\(.*\)/, '').trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4) || 'X';
    return [id, nome.replace(/\s*\(.*\)\s*/, '').trim()];
  }

  /* PL significa Pós-Laboral (regime da turma), nunca um tipo de aula. Nos códigos de turno
     o sufixo PL não indica a tipologia, por isso essas aulas ficam com tipo "ND" (não indicado). */
  const TIPOS_AULA = { T: 'Teórica', TP: 'Teórico-prática', ND: 'Não indicado', OT: 'Orientação tutorial', TC: 'Trabalho de campo', S: 'Seminário', L: 'Laboratório', P: 'Prática', E: 'Estágio', O: 'Outra' };
  const PL_RE = /(^|[-\s])PL([-\s]|$)/;
  const ehPosLaboral = (codigo) => PL_RE.test(String(codigo || ''));
  function partirTurno(t) {
    const m = /^(.*?)(TP|PL|OT|TC|T|S|L|P|E)(\d+)$/.exec(t);
    if (!m || !m[1]) return { prefixo: t, tipo: 'O', n: '1' };
    return { prefixo: m[1], tipo: m[2] === 'PL' ? 'ND' : m[2], n: m[3] };
  }
  const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'à', 'ao', 'para', 'com', 'na', 'no', 'I', 'II', 'III']);
  function siglaDe(nome) {
    const ws = String(nome).split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));
    let s = ws.map((w) => w[0].toUpperCase()).join('');
    const roman = /\b(I{1,3}|IV|V)$/.exec(nome);
    if (roman) s += roman[1];
    return s.slice(0, 8) || String(nome).slice(0, 6);
  }

  /* Tipo de sala (agregado) a partir das características reais da sala. */
  function tipoSala(car, nome) {
    if (car.has('Anfiteatro aulas') || /audit[óo]rio/i.test(nome)) return 'AUD';
    if ([...car].some((c) => /^Laborat|^Arq \d|Sala de Arquitectura/.test(c))) return 'LAB';
    if (car.has('Sala de Aulas normal') || car.has('Sala Aulas Mestrado') || car.has('Sala Aulas Mestrado Plus') || car.has('BYOD (Bring Your Own Device)')) return 'SALA';
    if (car.has('Sala Reunião') || car.has('Focus Group')) return 'SEM';
    return 'OUT';
  }
  const TIPOS_SALA = [['AUD', 'Anfiteatro / auditório'], ['SALA', 'Sala de aula'], ['LAB', 'Laboratório / sala especializada'], ['SEM', 'Sala de reunião / seminário'], ['OUT', 'Outro espaço (não letivo)']];

  /* Características com significado especial na aplicação. */
  const CARACT_DESC = {
    [SEM_SALA]: 'Pedido sem sala (aula fora do campus, online ou orientação)',
    'Sala/anfiteatro aulas': 'Pedido genérico: serve uma sala de aulas normal ou um anfiteatro',
    'Lab ISTA': 'Pedida no horário, mas nenhuma sala do ficheiro de salas a tem',
  };
  // Pedidos genéricos que ficam satisfeitos por qualquer uma das características indicadas.
  const ALTERNATIVAS = { 'Sala/anfiteatro aulas': ['Sala de Aulas normal', 'Anfiteatro aulas', 'Sala Aulas Mestrado', 'Sala Aulas Mestrado Plus'] };
  // Salas que servem razoavelmente quando falta a característica pedida (custo reduzido).
  const EQUIVALENTES = {
    'Sala de Aulas normal': ['Sala Aulas Mestrado', 'Sala Aulas Mestrado Plus', 'BYOD (Bring Your Own Device)'],
    'Sala Aulas Mestrado': ['Sala Aulas Mestrado Plus', 'Sala de Aulas normal'],
    'Sala Aulas Mestrado Plus': ['Sala Aulas Mestrado'],
    'Anfiteatro aulas': ['Sala de Aulas normal'],
    'BYOD (Bring Your Own Device)': ['Laboratório de Informática', 'Sala de Aulas normal'],
    'Laboratório de Redes de Computadores I': ['Laboratório de Redes de Computadores II'],
    'Laboratório de Redes de Computadores II': ['Laboratório de Redes de Computadores I'],
    'Laboratório de Arquitectura de Computadores I': ['Laboratório de Arquitectura de Computadores II'],
    'Laboratório de Arquitectura de Computadores II': ['Laboratório de Arquitectura de Computadores I'],
    'Lab ISTA': ['Laboratório de Informática'],
  };
  // Pedidos que exigem mesmo a característica (equipamento específico): regra obrigatória.
  const essencial = (c) => /^Laborat[óo]rio de |^Arq \d$/.test(c);

  const CAL_ORIGEM = { ano: '2022/23', inicio: '2022-09-12', semanas: 14, feriados: [['2022-10-05', 'Implantação da República'], ['2022-11-01', 'Dia de Todos os Santos'], ['2022-12-01', 'Restauração da Independência'], ['2022-12-08', 'Imaculada Conceição']] };
  const CAL_2026 = {
    ano: '2026/27', semestre: 1, inicio: '2026-09-14', semanas: 14,
    notas: 'Início assumido a 14/09/2026 (segunda-feira), à semelhança de 2022/23 (12/09/2022). Confirmar com o calendário escolar oficial do ISCTE e corrigir aqui; as semanas das aulas mantêm-se.',
    feriados: [['2026-10-05', 'Implantação da República', 'feriado'], ['2026-11-01', 'Dia de Todos os Santos (domingo)', 'feriado'], ['2026-12-01', 'Restauração da Independência', 'feriado'], ['2026-12-08', 'Imaculada Conceição', 'feriado'], ['2026-12-25', 'Natal', 'feriado'], ['2027-01-01', 'Ano Novo', 'feriado']],
  };

  // Calendário de 2022/23, o mesmo do horário de exemplo do professor (o horário é gerado como se fosse 2022/23).
  const CAL_2022 = {
    ano: '2022/23', semestre: 1, inicio: '2022-09-12', semanas: 14,
    notas: 'Calendário de 2022/23, o do horário de exemplo do professor: semana 1 começa a 12/09/2022.',
    feriados: [['2022-10-05', 'Implantação da República', 'feriado'], ['2022-11-01', 'Dia de Todos os Santos', 'feriado'], ['2022-12-01', 'Restauração da Independência', 'feriado'], ['2022-12-08', 'Imaculada Conceição', 'feriado']],
  };

  /* Semana (1..n) e dia (0..6, segunda = 0) de uma data em relação ao início do semestre. */
  function semanaDe(t, inicio) {
    const d = Math.floor((t - fromIso(inicio)) / DAY);
    return { semana: Math.floor(d / 7) + 1, dia: ((d % 7) + 7) % 7 };
  }
  /* Máscaras de feriados por dia da semana para um calendário. */
  function mascarasFeriados(cal, feriados) {
    const m = [0, 0, 0, 0, 0, 0, 0];
    for (const f of feriados) {
      const s = semanaDe(fromIso(f[0] || f.data), cal.inicio);
      if (s.semana >= 1 && s.semana <= cal.semanas) m[s.dia] |= 1 << (s.semana - 1);
    }
    return m;
  }
  const dataDaSemana = (cal, semana, dia) => fromIso(cal.inicio) + ((semana - 1) * 7 + dia) * DAY;

  /* ---------- Importação ---------- */
  function iscte(horarioTxt, salasTxt, opts) {
    opts = opts || {};
    const origem = opts.origem || CAL_ORIGEM;
    const alvo = opts.alvo || CAL_2022;
    const NW = alvo.semanas;
    const rel = { linhas: 0, semData: 0, foraSemestre: 0, semSala: 0, semSalaPedidoSemSala: 0, salasCorrigidas: [], salasForaCadastro: [], semanasRecuperadas: 0, emFeriadoAlvo: 0, avisos: [] };

    /* Salas */
    const sr = parseCSV(salasTxt).filter((r) => r.some((x) => x !== ''));
    const sh = sr[0].map((x) => x.trim());
    const carCols = sh.slice(5);
    const edificios = new Map();
    const salas = [];
    const salaPorNome = new Map();
    const caracteristicas = new Map(carCols.map((c) => [c, CARACT_DESC[c] || null]));
    const salaCar = [];
    sr.slice(1).forEach((r) => {
      const nomeOrig = r[1].trim();
      if (!nomeOrig) return;
      const codigo = corrigirNomeSala(nomeOrig);
      if (codigo !== nomeOrig) rel.salasCorrigidas.push(nomeOrig + ' → ' + codigo);
      const [eid, enome] = edificio(r[0]);
      edificios.set(eid, enome);
      const car = new Set(carCols.filter((c, k) => String(r[5 + k] || '').trim().toUpperCase() === 'X'));
      const id = salas.length + 1;
      const tipo = tipoSala(car, codigo);
      const piso = (/^[A-Z]{0,2}(\d)[.\dA-Z]/.exec(codigo) || [])[1];
      salas.push([id, codigo, eid, piso != null ? Number(piso) : null, Number(r[2]) || 0, Number(r[3]) || null, tipo, [...car].filter((c) => c !== 'Horário sala visível portal público').join(', '), tipo === 'OUT' ? 0 : 1]);
      salaPorNome.set(nomeOrig, id); salaPorNome.set(codigo, id);
      for (const c of car) salaCar.push([id, c]);
    });

    /* Horário: agrupa as ocorrências (uma linha por data) em aulas semanais com máscara de semanas. */
    const hr = parseCSV(horarioTxt);
    const hh = hr[0].map((x) => x.trim());
    const col = (nome) => hh.findIndex((x) => x.toLowerCase() === nome.toLowerCase());
    const C = {
      curso: col('Curso'), uc: col('Unidade de execução'), turno: col('Turno'), turma: col('Turma'), insc: col('Inscritos no turno'),
      dsem: col('Dia da Semana'), ini: col('Início'), fim: col('Fim'), dia: col('Dia'), pedida: col('Características da sala pedida para a aula'),
      sala: col('Sala da aula'), lot: col('Lotação'), reais: col('Características reais da sala'),
    };
    const grupos = new Map();
    const turnos = new Map();
    const lotacaoForaCadastro = new Map();
    const holOrigem = mascarasFeriados(origem, origem.feriados);
    for (const r of hr.slice(1)) {
      if (!r.some((x) => x && x.trim() !== '')) continue;
      rel.linhas++;
      const t = parseDate(r[C.dia]);
      if (t == null || !r[C.ini]) { rel.semData++; continue; }
      const s = semanaDe(t, origem.inicio);
      if (s.semana < 1 || s.semana > origem.semanas || s.dia > 5) { rel.foraSemestre++; continue; }
      const turno = r[C.turno].trim();
      const ini = toMin(r[C.ini]), fim = toMin(r[C.fim]);
      const salaNome = r[C.sala].trim();
      const pedida = r[C.pedida].trim() || null;
      if (!salaNome) { rel.semSala++; if (pedida === SEM_SALA) rel.semSalaPedidoSemSala++; }
      if (salaNome && !salaPorNome.has(salaNome) && !lotacaoForaCadastro.has(salaNome)) lotacaoForaCadastro.set(salaNome, Number(r[C.lot]) || 0);
      const key = [turno, s.dia, ini, fim, salaNome, pedida || ''].join('|');
      let g = grupos.get(key);
      if (!g) { g = { turno, dia: s.dia, ini, dur: fim - ini, sala: salaNome, pedida, mask: 0 }; grupos.set(key, g); }
      g.mask |= 1 << (s.semana - 1);
      let T = turnos.get(turno);
      if (!T) { T = { codigo: turno, uc: r[C.uc].trim(), turmas: new Set(), cursos: new Set(), insc: 0, pedidas: [], durs: [] }; turnos.set(turno, T); }
      for (const x of r[C.turma].split(',')) if (x.trim()) T.turmas.add(x.trim());
      for (const x of r[C.curso].split(',')) if (x.trim()) T.cursos.add(x.trim());
      T.insc = Math.max(T.insc, Number(r[C.insc]) || 0);
      if (pedida) T.pedidas.push(pedida);
      T.durs.push(fim - ini);
    }
    // Salas usadas no horário que não constam da caracterização: entram no cadastro, assinaladas.
    for (const [nome, lot] of lotacaoForaCadastro) {
      const id = salas.length + 1;
      salas.push([id, nome, 'X', null, lot, null, 'SALA', 'Não consta do ficheiro de caracterização das salas', 1]);
      edificios.set('X', 'Edifício desconhecido');
      salaPorNome.set(nome, id);
      rel.salasForaCadastro.push(nome);
    }
    // Espaços não letivos que aparecem no horário passam a contar como salas ativas.
    const usadasSala = new Set([...grupos.values()].map((g) => salaPorNome.get(g.sala)).filter(Boolean));
    for (const s of salas) if (!s[8] && usadasSala.has(s[0])) s[8] = 1;
    for (const g of grupos.values()) if (g.pedida && !caracteristicas.has(g.pedida)) caracteristicas.set(g.pedida, CARACT_DESC[g.pedida] || 'Pedida no horário, mas não é uma coluna do ficheiro de salas');

    /* Turmas e cursos */
    const cursoVotos = new Map();
    for (const T of turnos.values()) {
      if (T.cursos.size !== 1) continue;
      const c = [...T.cursos][0];
      for (const tm of T.turmas) { if (!cursoVotos.has(tm)) cursoVotos.set(tm, new Map()); const v = cursoVotos.get(tm); v.set(c, (v.get(c) || 0) + 1); }
    }
    const turmaNomes = new Set();
    for (const T of turnos.values()) for (const tm of T.turmas) turmaNomes.add(tm);
    const cursoSet = new Set();
    for (const T of turnos.values()) for (const c of T.cursos) cursoSet.add(c);
    const cursosArr = [...cursoSet].sort();
    const cursoId = new Map(cursosArr.map((c, i) => [c, i + 1]));
    const turmasArr = [...turmaNomes].sort();
    const turmaId = new Map(turmasArr.map((t, i) => [t, i + 1]));
    const turmaCurso = new Map();
    for (const tm of turmasArr) {
      const v = cursoVotos.get(tm);
      if (v) turmaCurso.set(tm, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]);
      else for (const T of turnos.values()) if (T.turmas.has(tm)) { turmaCurso.set(tm, [...T.cursos][0]); break; }
    }
    // Regime (PL = Pós-Laboral): PL no código da turma ou do curso, ou maioria das aulas a começar às 18:00 ou depois.
    const noite = new Map(), noiteT = new Map();
    for (const g of grupos.values()) {
      const T = turnos.get(g.turno);
      for (const tm of T.turmas) {
        const c = turmaCurso.get(tm); const x = noite.get(c) || [0, 0]; x[1]++; if (g.ini >= 1080) x[0]++; noite.set(c, x);
        const y = noiteT.get(tm) || [0, 0]; y[1]++; if (g.ini >= 1080) y[0]++; noiteT.set(tm, y);
      }
    }
    const grau = (c) => (/^L/.test(c) ? 'Licenciatura' : /^M/.test(c) ? 'Mestrado' : /^D/.test(c) ? 'Doutoramento' : /^PG/.test(c) ? 'Pós-graduação' : 'Outro');
    const cursos = cursosArr.map((c) => {
      const x = noite.get(c) || [0, 1];
      const regime = ehPosLaboral(c) || x[0] / x[1] >= 0.6 ? 'pos-laboral' : 'diurno';
      return [cursoId.get(c), c, c, grau(c), regime];
    });
    const turmaAno = (tm) => { const m = /(\d)\s*$/.exec(tm.replace(/-?PL(?=-|$)/g, '')); return m && +m[1] >= 1 && +m[1] <= 5 ? +m[1] : null; };
    const turmaN = new Map();
    for (const T of turnos.values()) if (T.turmas.size === 1) { const tm = [...T.turmas][0]; turmaN.set(tm, Math.max(turmaN.get(tm) || 0, T.insc)); }
    const regimeTurma = (tm) => { const y = noiteT.get(tm) || [0, 1]; return ehPosLaboral(tm) || y[0] / y[1] >= 0.6 ? 'pos-laboral' : 'diurno'; };
    const turmas = turmasArr.map((tm) => [turmaId.get(tm), turmaCurso.has(tm) ? cursoId.get(turmaCurso.get(tm)) : null, turmaAno(tm), tm, turmaN.get(tm) || 0, regimeTurma(tm)]);

    /* UCs, componentes e turnos */
    const ucs = [], ucPorChave = new Map(), comps = [], compPorChave = new Map(), turnoRows = [], turnoTurma = [], plano = new Set(), tiposAula = new Set();
    const turnoId = new Map();
    const codigosUsados = new Map();
    for (const T of [...turnos.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
      const p = partirTurno(T.codigo);
      let ucKey = p.prefixo + '|' + T.uc;
      let uid = ucPorChave.get(ucKey);
      if (!uid) {
        uid = ucs.length + 1;
        let cod = p.prefixo;
        const n = codigosUsados.get(cod) || 0;
        codigosUsados.set(cod, n + 1);
        if (n) cod = cod + '-' + (n + 1);
        // Sem siglas inventadas: a UC é identificada pelo código real (prefixo do turno) e pelo nome do CSV.
        ucs.push([uid, cod, null, T.uc, null, null]);
        ucPorChave.set(ucKey, uid);
      }
      for (const c of T.cursos) plano.add(cursoId.get(c) + ':' + uid);
      tiposAula.add(p.tipo);
      const ck = uid + '|' + p.tipo;
      let cid = compPorChave.get(ck);
      if (!cid) { cid = comps.length + 1; comps.push({ id: cid, uc: uid, tipo: p.tipo, durs: [], n: [] }); compPorChave.set(ck, cid); }
      const comp = comps[cid - 1];
      comp.durs.push(...T.durs);
      const id = turnoRows.length + 1;
      turnoId.set(T.codigo, id);
      const ped = T.pedidas.length ? mode(T.pedidas) : null;
      turnoRows.push([id, cid, T.codigo, null, T.insc, ped]);
      for (const tm of T.turmas) turnoTurma.push([id, turmaId.get(tm)]);
    }

    /* Aulas: semanas adaptadas ao calendário alvo */
    const holAlvo = mascarasFeriados(alvo, alvo.feriados);
    const aulas = [];
    const seq = new Map();
    const lista = [...grupos.values()].sort((a, b) => a.turno.localeCompare(b.turno) || a.dia - b.dia || a.ini - b.ini);
    for (const g of lista) {
      let m = g.mask;
      // Semanas sem aula por causa de um feriado: marca-se a aula perdida nessa semana; a reposição (reporFeriados) passa-a para uma semana posterior.
      const buraco = holOrigem[g.dia] & ~m;
      for (let w = 0; w < origem.semanas; w++) {
        if (!(buraco & (1 << w))) continue;
        // Só quando a aula acontece na semana anterior e na seguinte (padrão regular).
        if (w > 0 && (m & (1 << (w - 1))) && (m & (1 << (w + 1)))) { m |= 1 << w; rel.semanasRecuperadas++; }
      }
      m &= (1 << NW) - 1;
      rel.emFeriadoAlvo += pop(m & holAlvo[g.dia]);
      const tid = turnoId.get(g.turno);
      const k = (seq.get(tid) || 0) + 1; seq.set(tid, k);
      aulas.push([tid, k, g.dia, g.ini, g.dur, g.sala ? salaPorNome.get(g.sala) : null, 0, m, g.pedida]);
      const comp = comps[turnoRows[tid - 1][1] - 1];
      comp.n.push(pop(m));
    }
    const componentes = comps.map((c) => [c.id, c.uc, c.tipo, mode(c.durs) || 90, 1, null, 1]);

    /* Características e regras do conjunto de dados */
    const carRows = [...caracteristicas.entries()].map(([nome, desc]) => [nome, desc || (essencial(nome) ? 'Equipamento específico (pedido obrigatório)' : null)]);
    const usadas = new Set([...grupos.values()].map((g) => g.pedida).filter(Boolean));
    const essenciais = [...usadas].filter(essencial).sort();
    const equivalentes = {};
    for (const k in EQUIVALENTES) if (usadas.has(k)) equivalentes[k] = EQUIVALENTES[k];

    rel.aulas = aulas.length; rel.turnos = turnoRows.length; rel.ucs = ucs.length; rel.turmas = turmas.length; rel.cursos = cursos.length; rel.salas = salas.length;
    rel.ocorrencias = aulas.reduce((s, a) => s + pop(a[7]), 0);
    rel.semanasPorAula = {};
    for (const a of aulas) { const n = pop(a[7]); rel.semanasPorAula[n] = (rel.semanasPorAula[n] || 0) + 1; }
    rel.semSalaSemPedido = rel.semSala - rel.semSalaPedidoSemSala;
    const comSala = new Set(salas.flatMap((s) => (s[7] || '').split(', ')));
    rel.pedidasSemSala = [...usadas].filter((c) => c !== SEM_SALA && !ALTERNATIVAS[c] && !salaCar.some((x) => x[1] === c));
    rel.origem = origem; rel.alvo = { ano: alvo.ano, inicio: alvo.inicio, semanas: alvo.semanas };
    void comSala;

    return {
      tables: {
        curso: { cols: ['id', 'sigla', 'nome', 'grau', 'regime'], rows: cursos },
        uc: { cols: ['id', 'codigo', 'sigla', 'nome', 'ects', 'departamento'], rows: ucs },
        plano_estudos: { cols: ['curso_id', 'uc_id', 'ano', 'semestre', 'obrigatoria'], rows: [...plano].map((k) => { const [c, u] = k.split(':').map(Number); return [c, u, null, alvo.semestre || 1, 1]; }) },
        turma: { cols: ['id', 'curso_id', 'ano', 'codigo', 'n_alunos', 'regime'], rows: turmas },
        tipo_sala: { cols: ['id', 'nome'], rows: TIPOS_SALA },
        tipo_aula: { cols: ['id', 'nome'], rows: [...tiposAula].sort().map((t) => [t, TIPOS_AULA[t] || t]) },
        edificio: { cols: ['id', 'nome'], rows: [...edificios.entries()] },
        caracteristica: { cols: ['nome', 'descricao'], rows: carRows },
        sala: { cols: ['id', 'codigo', 'edificio_id', 'piso', 'capacidade', 'capacidade_exame', 'tipo_id', 'equipamento', 'ativa'], rows: salas },
        sala_caracteristica: { cols: ['sala_id', 'caracteristica'], rows: salaCar },
        componente: { cols: ['id', 'uc_id', 'tipo_aula_id', 'duracao_min', 'aulas_semana', 'tipo_sala_id', 'taxa_presenca'], rows: componentes },
        turno: { cols: ['id', 'componente_id', 'codigo', 'docente_id', 'inscritos', 'caracteristica_pedida'], rows: turnoRows },
        turno_turma: { cols: ['turno_id', 'turma_id'], rows: turnoTurma },
        calendario: { cols: ['id', 'ano_letivo', 'semestre', 'inicio', 'semanas', 'notas'], rows: [[1, alvo.ano, alvo.semestre || 1, alvo.inicio, alvo.semanas, alvo.notas || null]] },
        feriado: { cols: ['data', 'nome', 'tipo'], rows: alvo.feriados.map((f) => [f[0], f[1], f[2] || 'feriado']) },
      },
      aulas,
      aulaCols: ['turno_id', 'seq', 'dia', 'inicio', 'duracao', 'sala_id', 'fixa', 'semanas', 'caracteristica_pedida'],
      regrasOpts: { essenciais, equivalentes, alternativas: ALTERNATIVAS },
      relatorio: rel,
    };
  }

  /* Exporta um horário (linhas de v_aula com turmas e cursos) para o formato CSV do ISCTE,
     uma linha por data no calendário indicado, saltando feriados. */
  function exportarIscte(aulas, cal, feriados) {
    const DS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const fer = new Set(feriados.map((f) => f.data || f[0]));
    const head = ['Curso', 'Unidade de execução', 'Turno', 'Turma', 'Inscritos no turno', 'Dia da Semana', 'Início', 'Fim', 'Dia', 'Características da sala pedida para a aula', 'Sala da aula', 'Lotação', 'Características reais da sala'];
    const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + ':00';
    const cell = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const out = [head.join(';')];
    const rows = [];
    let saltadas = 0;
    for (const a of aulas) for (let w = 1; w <= cal.semanas; w++) {
      if (!(a.semanas & (1 << (w - 1)))) continue;
      const t = dataDaSemana(cal, w, a.dia);
      if (fer.has(isoUTC(t))) { saltadas++; continue; }
      rows.push([t, a.inicio, [a.cursos, a.uc_nome, a.turno, a.turmas, a.inscritos, DS[a.dia], hm(a.inicio), hm(a.fim), ptDate(t), a.caracteristica_pedida, a.sala, a.capacidade, a.caracteristicas_sala]]);
    }
    rows.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (const r of rows) out.push(r[2].map(cell).join(';'));
    return { csv: '﻿' + out.join('\r\n') + '\r\n', linhas: rows.length, saltadas };
  }

  const api = { parseCSV, iscte, exportarIscte, mascarasFeriados, semanaDe, dataDaSemana, fromIso, isoUTC, ptDate, pop, corrigirNomeSala, CAL_2026, CAL_2022, CAL_ORIGEM, SEM_SALA, ALTERNATIVAS, EQUIVALENTES };
  if (typeof module !== 'undefined') module.exports = api;
  root.ODES_IMPORT = api;
})(typeof window !== 'undefined' ? window : globalThis);
