/* Motor de regras e gerador de horários.
   EngineFactory é autocontido (não usa nada de fora) para poder correr também
   num Web Worker criado a partir do seu próprio código-fonte. */
function EngineFactory() {
  'use strict';

  const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  // Blocos padrão (estilo ISCTE): 08:00–12:30, 13:00–17:30, 18:00–22:30, aulas de 1h30.
  const RUNS = [[480, 750], [780, 1050], [1080, 1350]];

  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const fh = (m) => (Math.round((m / 60) * 10) / 10).toString().replace('.', ',') + ' h';
  const pop = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

  /* Semanas de uma máscara em texto: "sem. 1–4, 6". */
  function semTxt(m, n) {
    if (m === (1 << n) - 1) return 'todas as semanas';
    const out = [];
    let w = 0;
    while (w < n) {
      if (!(m & (1 << w))) { w++; continue; }
      let e = w;
      while (e + 1 < n && (m & (1 << (e + 1)))) e++;
      out.push(e > w ? `${w + 1}–${e + 1}` : `${w + 1}`);
      w = e + 1;
    }
    return (out.length === 1 && !out[0].includes('–') ? 'semana ' : 'semanas ') + out.join(', ');
  }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function startsFor(dur, grelha) {
    const out = [];
    if (grelha === '30') {
      for (let s = 480; s + dur <= 1410; s += 30) out.push(s);
    } else {
      for (const [a, b] of RUNS) for (let s = a; s + dur <= b; s += 90) out.push(s);
    }
    return out;
  }

  /* ---------- Estado ----------
     P.aulas: [{id, turno, uc, ucCod, tipoAula, docente(idx|-1), turmas:[idx], dur, req (característica pedida), noRoom,
                sem (máscara de semanas), inscritos, esperado, fixa, dia, ini, sala(idx|-1), ref:{dia,ini,sala}|null, label}]
     P.salas: [{id, codigo, edificio, cap, tipo, car:[características]}]
     P.turmas: [{id, codigo, regime}]
     P.docentes: [{id, nome, horasMax, indisp:[{dia,ini,fim}], pref:[...]}]
     P.turnos: [{id, codigo}]
     P.bloqueios: [{sala, dia, ini, fim, motivo}]
     P.nSemanas, P.feriados: [máscara por dia da semana]
     P.rules: {CODIGO: {ativa, sev, peso, params, nome}} */
  function createState(P) {
    const n = P.aulas.length;
    const NW = P.nSemanas || 14;
    const S = {
      P, n, NW, FULL: (1 << NW) - 1,
      D: new Int16Array(n), I: new Int16Array(n), R: new Int16Array(n), M: new Int32Array(n),
      porTurma: P.turmas.map(() => []), porDocente: P.docentes.map(() => []),
      porTurno: P.turnos.map(() => []), porSala: P.salas.map(() => new Set()),
      bloqPorSala: P.salas.map(() => []),
      car: P.salas.map((s) => new Set(s.car || [])),
      hol: P.feriados || [0, 0, 0, 0, 0, 0, 0],
      cache: new Map(),
      blocos: P.blocos || [],
    };
    P.aulas.forEach((a, i) => {
      S.D[i] = a.dia == null ? -1 : a.dia;
      S.I[i] = a.ini == null ? -1 : a.ini;
      S.R[i] = a.sala == null ? -1 : a.sala;
      S.M[i] = a.sem == null ? S.FULL : (a.sem & S.FULL);
      for (const t of a.turmas) S.porTurma[t].push(i);
      if (a.docente >= 0) S.porDocente[a.docente].push(i);
      S.porTurno[a.turno].push(i);
      if (S.R[i] >= 0 && S.D[i] >= 0) S.porSala[S.R[i]].add(i);
    });
    for (const b of P.bloqueios || []) if (b.sala >= 0) S.bloqPorSala[b.sala].push(b);
    S.W = {};
    for (const k in P.rules) {
      const r = P.rules[k];
      S.W[k] = r.ativa ? (r.sev === 'hard' ? 1000 * (r.peso || 1) : (r.peso || 0)) : 0;
    }
    S.ess = new Set(((P.rules.CARACT_ESSENCIAL || {}).params || {}).caracteristicas || []);
    return S;
  }

  const rule = (S, k) => S.P.rules[k] || { ativa: false, params: {} };
  const on = (S, k) => S.W[k] > 0;
  const overlap = (a1, b1, a2, b2) => Math.max(0, Math.min(b1, b2) - Math.max(a1, a2));

  function push(out, S, codigo, aulas, msg, custo) {
    if (!out) return;
    const r = rule(S, codigo);
    out.push({ codigo, sev: r.sev, nome: r.nome, aulas: aulas.map((i) => S.P.aulas[i].id), msg, custo });
  }

  function need(S, a) {
    const p = rule(S, 'CAPACIDADE').params || {};
    return p.usar_participacao === false ? a.inscritos : a.esperado;
  }

  /* Quão bem a sala s serve o pedido da aula a:
     0 tem a característica (ou uma alternativa aceite), 1 tem uma equivalente,
     2 não tem, 3 não tem e o pedido é essencial (laboratório, sala especializada). */
  function carMatch(S, a, s) {
    if (!a.req || a.noRoom) return 0;
    const car = S.car[s];
    if (car.has(a.req)) return 0;
    const p = rule(S, 'CARACTERISTICA').params || {};
    const alt = (p.alternativas || {})[a.req];
    if (alt && alt.some((c) => car.has(c))) return 0;
    if (S.ess.has(a.req) && on(S, 'CARACT_ESSENCIAL')) return 3;
    const eq = (p.equivalentes || {})[a.req];
    return eq && eq.some((c) => car.has(c)) ? 1 : 2;
  }

  /* ---------- Custos por aula ---------- */
  function aulaCost(S, i, out) {
    const a = S.P.aulas[i];
    let c = 0;
    if (S.D[i] < 0 || (S.R[i] < 0 && !a.noRoom)) {
      if (on(S, 'NAO_AGENDADA')) { c += S.W.NAO_AGENDADA; push(out, S, 'NAO_AGENDADA', [i], `${a.label}${S.D[i] >= 0 ? ` (${DIAS[S.D[i]].slice(0, 3)} ${hhmm(S.I[i])})` : ''} não tem ${S.D[i] < 0 ? 'dia/hora' : 'sala'}${a.req ? ` (pede ${a.req})` : ''}`, 1); }
      if (S.D[i] < 0) return c;
    }
    const d = S.D[i], ini = S.I[i], fim = ini + a.dur;
    const lb = `${a.label} (${DIAS[d].slice(0, 3)} ${hhmm(ini)})`;
    if (on(S, 'FORA_MANCHA')) {
      const p = rule(S, 'FORA_MANCHA').params || {};
      for (const reg of a.regimes) {
        const m = p[reg];
        if (!m) continue;
        if (!m.dias.includes(d) || ini < m.inicio || fim > m.fim) {
          c += S.W.FORA_MANCHA;
          push(out, S, 'FORA_MANCHA', [i], `${a.label}: ${DIAS[d]} ${hhmm(ini)}–${hhmm(fim)} fora da mancha ${reg} (${hhmm(m.inicio)}–${hhmm(m.fim)})`, 1);
          break;
        }
      }
    }
    if (on(S, 'FERIADOS')) {
      const lost = pop(S.M[i] & (S.hol[d] || 0));
      if (lost) {
        c += S.W.FERIADOS * lost;
        push(out, S, 'FERIADOS', [i], `${a.label}: ${lost} aula${lost > 1 ? 's' : ''} em feriado (${DIAS[d].toLowerCase()}, ${semTxt(S.M[i] & S.hol[d], S.NW)})`, lost);
      }
    }
    if (S.R[i] >= 0) {
      const s = S.P.salas[S.R[i]];
      const cm = carMatch(S, a, S.R[i]);
      if (cm === 3) {
        c += S.W.CARACT_ESSENCIAL;
        push(out, S, 'CARACT_ESSENCIAL', [i], `${lb}: pediu ${a.req}, mas ${s.codigo} não tem`, 1);
      } else if (cm > 0 && on(S, 'CARACTERISTICA')) {
        const p = rule(S, 'CARACTERISTICA').params || {};
        const k = cm === 1 ? (p.custo_equivalente != null ? p.custo_equivalente : 0.3) : 1;
        if (k > 0) {
          c += S.W.CARACTERISTICA * k;
          push(out, S, 'CARACTERISTICA', [i], `${lb}: pediu ${a.req}, está em ${s.codigo}${cm === 1 ? ' (equivalente)' : ''}`, k);
        }
      }
      const nd = need(S, a);
      if (on(S, 'CAPACIDADE')) {
        const tol = ((rule(S, 'CAPACIDADE').params || {}).tolerancia_pct || 0) / 100;
        if (nd > s.cap * (1 + tol)) {
          const k = 1 + (nd - s.cap) / 20;
          c += S.W.CAPACIDADE * k;
          push(out, S, 'CAPACIDADE', [i], `${lb}: ${nd} estudantes esperados em ${s.codigo} (${s.cap} lugares)`, k);
        }
      }
      if (on(S, 'DESPERDICIO')) {
        const lim = (rule(S, 'DESPERDICIO').params || {}).limite_lugares || 25;
        const livres = s.cap - nd;
        if (livres > lim) {
          const k = (livres - lim) / 25;
          c += S.W.DESPERDICIO * k;
          push(out, S, 'DESPERDICIO', [i], `${lb}: ${livres} lugares vazios em ${s.codigo}`, k);
        }
      }
    }
    if (a.docente >= 0) {
      const doc = S.P.docentes[a.docente];
      if (on(S, 'INDISP_DOCENTE')) {
        for (const x of doc.indisp) if (x.dia === d && overlap(ini, fim, x.ini, x.fim) > 0) {
          c += S.W.INDISP_DOCENTE;
          push(out, S, 'INDISP_DOCENTE', [i], `${a.label}: ${doc.nome} indisponível ${DIAS[d]} ${hhmm(x.ini)}–${hhmm(x.fim)}`, 1);
          break;
        }
      }
      if (on(S, 'PREF_DOCENTE') && doc.pref.length) {
        if (!doc.pref.some((x) => x.dia === d && ini >= x.ini && fim <= x.fim)) {
          c += S.W.PREF_DOCENTE;
          push(out, S, 'PREF_DOCENTE', [i], `${a.label}: fora dos períodos preferidos de ${doc.nome}`, 1);
        }
      }
    }
    if (a.ref && S.W.ALTERACOES > 0) {
      const p = rule(S, 'ALTERACOES').params || {};
      let k = 0;
      if (a.ref.dia !== d || a.ref.ini !== ini) k = 1;
      else if (a.ref.sala !== S.R[i]) k = p.custo_sala != null ? p.custo_sala : 0.3;
      if (k) { c += S.W.ALTERACOES * k; push(out, S, 'ALTERACOES', [i], `${a.label} mudou face ao horário base`, k); }
    }
    return c;
  }

  function byDay(S, list) {
    const days = [[], [], [], [], [], []];
    for (const i of list) if (S.D[i] >= 0) days[S.D[i]].push(i);
    for (const l of days) l.sort((x, y) => S.I[x] - S.I[y]);
    return days;
  }

  /* Agrupa as aulas de um dia pelas semanas em que acontecem juntas.
     Devolve [{list, w}], onde w é o número de semanas com exatamente essas aulas. */
  function weekGroups(S, l) {
    if (!l.length) return [];
    const m0 = S.M[l[0]];
    let same = true;
    for (const i of l) if (S.M[i] !== m0) { same = false; break; }
    if (same) return [{ list: l, w: pop(m0) }];
    const groups = new Map();
    for (let w = 0; w < S.NW; w++) {
      const b = 1 << w;
      const sub = [];
      for (const i of l) if (S.M[i] & b) sub.push(i);
      if (!sub.length) continue;
      const k = sub.join(',');
      const g = groups.get(k);
      if (g) g.w++; else groups.set(k, { list: sub, w: 1 });
    }
    return [...groups.values()];
  }

  /* Junta violações repetidas em vários grupos de semanas (conta as semanas). */
  function collector() {
    const acc = new Map();
    return {
      add(key, codigo, aulas, msg, k, w) {
        const x = acc.get(key);
        if (x) x.w += w; else acc.set(key, { codigo, aulas, msg, k, w });
      },
      flush(S, out) {
        let c = 0;
        for (const x of acc.values()) {
          const hard = rule(S, x.codigo).sev === 'hard';
          const f = hard ? 1 : Math.min(1, x.w / S.NW);
          const kk = x.k * f;
          c += S.W[x.codigo] * kk;
          if (out) push(out, S, x.codigo, x.aulas, x.msg + (x.w < S.NW ? ` [${x.w} sem.]` : ''), kk);
        }
        return c;
      },
    };
  }

  function overlapsIn(S, list, codigo, what, out) {
    let c = 0;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const i = list[x], j = list[y];
      if (S.D[i] < 0 || S.D[i] !== S.D[j]) continue;
      const mm = S.M[i] & S.M[j];
      if (!mm) continue;
      const o = overlap(S.I[i], S.I[i] + S.P.aulas[i].dur, S.I[j], S.I[j] + S.P.aulas[j].dur);
      if (o > 0) {
        const k = 1 + o / 90;
        c += S.W[codigo] * k;
        if (out) push(out, S, codigo, [i, j], `${what}: ${S.P.aulas[i].label} e ${S.P.aulas[j].label} sobrepostas (${DIAS[S.D[i]]} ${hhmm(Math.max(S.I[i], S.I[j]))}${mm === S.FULL ? '' : ', ' + semTxt(mm, S.NW)})`, k);
      }
    }
    return c;
  }

  function buildingChanges(S, groups, what, col) {
    const p = rule(S, 'MUDANCA_EDIFICIO').params || {};
    const gap = p.intervalo_max_min != null ? p.intervalo_max_min : 30;
    for (const g of groups) {
      const l = g.list;
      for (let k = 1; k < l.length; k++) {
        const i = l[k - 1], j = l[k];
        if (S.R[i] < 0 || S.R[j] < 0) continue;
        const gp = S.I[j] - (S.I[i] + S.P.aulas[i].dur);
        if (gp >= 0 && gp <= gap && S.P.salas[S.R[i]].edificio !== S.P.salas[S.R[j]].edificio) {
          col.add('E' + i + ':' + j, 'MUDANCA_EDIFICIO', [i, j], `${what}: muda do edifício ${S.P.salas[S.R[i]].edificio} para ${S.P.salas[S.R[j]].edificio} em ${gp} min`, 1, g.w);
        }
      }
    }
  }

  /* ---------- Custos por turma ---------- */
  function turmaCost(S, t, out) {
    const list = S.porTurma[t];
    const tm = S.P.turmas[t];
    let c = 0;
    if (on(S, 'CONF_TURMA')) c += overlapsIn(S, list, 'CONF_TURMA', tm.codigo, out);
    const chains = on(S, 'MAX_SEGUIDAS_UC'), edif = on(S, 'MUDANCA_EDIFICIO'), furos = on(S, 'FUROS_TURMA'), maxDia = on(S, 'MAX_DIA_TURMA');
    const mesmaSala = on(S, 'MESMA_SALA_UC');
    if (!chains && !edif && !furos && !maxDia && !mesmaSala) return c;
    const gapSala = (rule(S, 'MESMA_SALA_UC').params || {}).intervalo_max_min != null ? rule(S, 'MESMA_SALA_UC').params.intervalo_max_min : 30;
    const col = collector();
    const pc = rule(S, 'MAX_SEGUIDAS_UC').params || {};
    const max = pc.max_min || 180, gap = pc.intervalo_max_min != null ? pc.intervalo_max_min : 15;
    const minFuro = (rule(S, 'FUROS_TURMA').params || {}).minimo_min || 60;
    const maxD = (rule(S, 'MAX_DIA_TURMA').params || {}).max_min || 360;
    byDay(S, list).forEach((dl, d) => {
      if (!dl.length) return;
      const groups = weekGroups(S, dl);
      for (const g of groups) {
        const l = g.list;
        if (chains) {
          // Cadeias de aulas da mesma UC (aulas de outras UCs à mesma hora não quebram a cadeia).
          const porUc = new Map();
          for (const i of l) { const u = S.P.aulas[i].uc; if (!porUc.has(u)) porUc.set(u, []); porUc.get(u).push(i); }
          for (const ul of porUc.values()) {
            if (ul.length < 2 && S.P.aulas[ul[0]].dur <= max) continue;
            let k = 0;
            while (k < ul.length) {
              const chain = [ul[k]];
              let end = S.I[ul[k]] + S.P.aulas[ul[k]].dur, total = S.P.aulas[ul[k]].dur;
              let m = k + 1;
              while (m < ul.length && S.I[ul[m]] - end <= gap) {
                end = Math.max(end, S.I[ul[m]] + S.P.aulas[ul[m]].dur);
                total += S.P.aulas[ul[m]].dur; chain.push(ul[m]); m++;
              }
              if (total > max) {
                col.add('C' + chain.join(','), 'MAX_SEGUIDAS_UC', chain, `${tm.codigo}: ${fh(total)} seguidas de ${S.P.aulas[ul[k]].ucCod} (${DIAS[d]})`, 1 + (total - max) / 90, g.w);
              }
              k = m;
            }
          }
        }
        if (mesmaSala) {
          // Aulas seguidas da mesma UC para a turma devem ficar na mesma sala.
          const ult = new Map();
          for (const j of l) {
            const u = S.P.aulas[j].uc;
            const i = ult.get(u);
            ult.set(u, j);
            if (i == null || S.R[i] < 0 || S.R[j] < 0 || S.R[i] === S.R[j]) continue;
            const gp = S.I[j] - (S.I[i] + S.P.aulas[i].dur);
            if (gp >= 0 && gp <= gapSala) {
              col.add('S' + i + ':' + j, 'MESMA_SALA_UC', [i, j], `${tm.codigo}: ${S.P.aulas[i].label} em ${S.P.salas[S.R[i]].codigo} e logo a seguir ${S.P.aulas[j].label} em ${S.P.salas[S.R[j]].codigo} (${DIAS[d].toLowerCase()} ${hhmm(S.I[j])})`, 1, g.w);
            }
          }
        }
        if (furos) for (let k = 1; k < l.length; k++) {
          const gp = S.I[l[k]] - (S.I[l[k - 1]] + S.P.aulas[l[k - 1]].dur);
          if (gp >= minFuro) col.add('F' + l[k - 1] + ':' + l[k], 'FUROS_TURMA', [l[k - 1], l[k]], `${tm.codigo}: furo de ${fh(gp)} à ${DIAS[d].toLowerCase()}`, gp / 90, g.w);
        }
        if (maxDia) {
          const tot = l.reduce((s, i) => s + S.P.aulas[i].dur, 0);
          if (tot > maxD) col.add('D' + l.join(','), 'MAX_DIA_TURMA', l, `${tm.codigo}: ${fh(tot)} de aulas à ${DIAS[d].toLowerCase()}`, (tot - maxD) / 90, g.w);
        }
      }
      if (edif) buildingChanges(S, groups, tm.codigo, col);
    });
    return c + col.flush(S, out);
  }

  /* ---------- Custos por docente ---------- */
  function docenteCost(S, d, out) {
    const list = S.porDocente[d];
    const doc = S.P.docentes[d];
    let c = 0;
    if (on(S, 'CONF_DOCENTE')) c += overlapsIn(S, list, 'CONF_DOCENTE', doc.nome, out);
    if (on(S, 'MUDANCA_EDIFICIO') && (rule(S, 'MUDANCA_EDIFICIO').params || {}).incluir_docentes !== false) {
      const col = collector();
      for (const l of byDay(S, list)) if (l.length > 1) buildingChanges(S, weekGroups(S, l), doc.nome, col);
      c += col.flush(S, out);
    }
    if (on(S, 'CARGA_DOCENTE')) {
      const tot = list.reduce((s, i) => s + S.P.aulas[i].dur * pop(S.M[i]) / S.NW, 0);
      if (tot > doc.horasMax) {
        const kk = (tot - doc.horasMax) / 90;
        c += S.W.CARGA_DOCENTE * kk;
        push(out, S, 'CARGA_DOCENTE', list, `${doc.nome}: ${fh(tot)} semanais em média (máximo ${fh(doc.horasMax)})`, kk);
      }
    }
    return c;
  }

  /* ---------- Custos por sala ---------- */
  function salaCost(S, s, out) {
    if (!on(S, 'CONF_SALA')) return 0;
    const list = [...S.porSala[s]];
    const sala = S.P.salas[s];
    let c = overlapsIn(S, list, 'CONF_SALA', sala.codigo, out);
    for (const b of S.bloqPorSala[s]) for (const i of list) {
      if (S.D[i] === b.dia && (b.sem == null || (b.sem & S.M[i])) && overlap(S.I[i], S.I[i] + S.P.aulas[i].dur, b.ini, b.fim) > 0) {
        c += S.W.CONF_SALA;
        push(out, S, 'CONF_SALA', [i], `${sala.codigo}: ${S.P.aulas[i].label} coincide com a reserva "${b.motivo}"`, 1);
      }
    }
    return c;
  }

  /* ---------- Custos por turno ---------- */
  function turnoCost(S, u, out) {
    const list = S.porTurno[u];
    if (list.length < 2) return 0;
    let c = 0;
    if (on(S, 'MESMO_DIA_TURNO')) {
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
        const i = list[x], j = list[y];
        if (S.D[i] >= 0 && S.D[i] === S.D[j] && (S.M[i] & S.M[j])) {
          // Aulas seguidas do mesmo turno contam como um bloco único (já coberto por MAX_SEGUIDAS_UC).
          const gp = S.I[i] < S.I[j] ? S.I[j] - S.I[i] - S.P.aulas[i].dur : S.I[i] - S.I[j] - S.P.aulas[j].dur;
          if (gp >= 0 && gp <= 15) continue;
          c += S.W.MESMO_DIA_TURNO;
          push(out, S, 'MESMO_DIA_TURNO', [i, j], `${S.P.aulas[i].label}: duas aulas à ${DIAS[S.D[i]].toLowerCase()}`, 1);
        }
      }
    }
    return c;
  }

  /* ---------- Blocos (aulas seguidas da mesma UC e turma no Manual) ----------
     Cada aula do bloco tem de estar no mesmo dia que a primeira, à mesma distância que no Manual. */
  function blocoCost(S, b, out) {
    if (!on(S, 'BLOCO_SEPARADO')) return 0;
    const B = S.blocos[b], L = B.m[0];
    if (S.D[L] < 0) return 0;
    let c = 0;
    for (let k = 1; k < B.m.length; k++) {
      const i = B.m[k];
      if (S.D[i] < 0) continue;
      if (S.D[i] !== S.D[L] || S.I[i] - S.I[L] !== B.off[k]) {
        c += S.W.BLOCO_SEPARADO;
        if (out) push(out, S, 'BLOCO_SEPARADO', [L, i], `${S.P.aulas[L].label} e ${S.P.aulas[i].label} deviam estar seguidas no mesmo dia, como no Manual (${DIAS[S.D[L]].toLowerCase()} ${hhmm(S.I[L])} e ${DIAS[S.D[i]].toLowerCase()} ${hhmm(S.I[i])})`, 1);
      }
    }
    return c;
  }
  const blocoDe = (S, i) => { const b = S.P.aulas[i].bloco; return b != null && b >= 0 ? S.blocos[b] : null; };
  /* Mudanças para pôr a aula i no dia d à hora ini com a sala r, levando o resto do bloco (mesmas distâncias).
     As outras aulas do bloco ficam na sua sala se estiver livre; senão, na sala de i (se não houver aula do
     bloco em paralelo nela) ou na primeira sala livre entre as mais indicadas. */
  function moverBloco(S, i, d, ini, r) {
    const B = blocoDe(S, i);
    if (!B) return [[i, d, ini, r]];
    const k0 = B.m.indexOf(i), base = ini - B.off[k0];
    const ch = [[i, d, ini, r]];
    const ocupa = (s, a0, dur, mk) => ch.some(([j, , ij, rj]) => rj === s && (S.M[j] & mk) && overlap(a0, a0 + dur, ij, ij + S.P.aulas[j].dur) > 0);
    B.m.forEach((j, k) => {
      const ij = base + B.off[k], a = S.P.aulas[j];
      if (j === i) return;
      if (a.noRoom) { ch.push([j, d, ij, -1]); return; }
      const livre = (s) => s >= 0 && !ocupa(s, ij, a.dur, S.M[j]) && roomFree(S, s, d, ij, a.dur, j);
      let rj = -1;
      if (livre(r) && carMatch(S, a, r) <= 1) rj = r;
      else if (livre(S.R[j])) rj = S.R[j];
      else { for (const s of rankedRooms(S, j).slice(0, 8)) if (livre(s)) { rj = s; break; } if (rj < 0) rj = rankedRooms(S, j)[0]; }
      ch.push([j, d, ij, rj]);
    });
    return ch;
  }
  /* Horas de início possíveis para a aula i, contando com o bloco (o bloco inteiro cabe num período da grelha). */
  function startsAula(S, i, starts) {
    const B = blocoDe(S, i);
    if (!B) return starts(S.P.aulas[i].dur);
    const off = B.off[B.m.indexOf(i)];
    return starts(B.span).map((s) => s + off);
  }

  function entityCost(S, key, out) {
    const k = key[0], id = +key.slice(1);
    if (k === 'a') return aulaCost(S, id, out);
    if (k === 't') return turmaCost(S, id, out);
    if (k === 'd') return docenteCost(S, id, out);
    if (k === 's') return salaCost(S, id, out);
    if (k === 'b') return blocoCost(S, id, out);
    return turnoCost(S, id, out);
  }

  function allKeys(S) {
    const keys = [];
    for (let i = 0; i < S.n; i++) keys.push('a' + i);
    S.P.turmas.forEach((_, i) => keys.push('t' + i));
    S.P.docentes.forEach((_, i) => keys.push('d' + i));
    S.P.salas.forEach((_, i) => keys.push('s' + i));
    S.P.turnos.forEach((_, i) => keys.push('u' + i));
    S.blocos.forEach((_, i) => keys.push('b' + i));
    return keys;
  }

  function fullCost(S) {
    let total = 0;
    S.cache.clear();
    for (const k of allKeys(S)) { const c = entityCost(S, k); S.cache.set(k, c); total += c; }
    S.total = total;
    return total;
  }

  function evaluate(S) {
    const out = [];
    for (const k of allKeys(S)) entityCost(S, k, out);
    let hard = 0, soft = 0, custo = 0;
    const porRegra = {};
    for (const v of out) {
      const w = S.W[v.codigo] || 0;
      if (v.sev === 'hard') hard++; else soft++;
      custo += w * v.custo;
      const r = porRegra[v.codigo] || (porRegra[v.codigo] = { n: 0, custo: 0 });
      r.n++; r.custo += w * v.custo;
    }
    return { violacoes: out, hard, soft, custo, porRegra };
  }

  function keysFor(S, i, extraSala) {
    const a = S.P.aulas[i];
    const ks = ['a' + i, 'u' + a.turno];
    for (const t of a.turmas) ks.push('t' + t);
    if (a.docente >= 0) ks.push('d' + a.docente);
    if (S.R[i] >= 0) ks.push('s' + S.R[i]);
    if (extraSala != null && extraSala >= 0) ks.push('s' + extraSala);
    if (a.bloco != null && a.bloco >= 0) ks.push('b' + a.bloco);
    return ks;
  }

  function setAula(S, i, d, ini, r) {
    if (S.R[i] >= 0 && S.D[i] >= 0) S.porSala[S.R[i]].delete(i);
    S.D[i] = d; S.I[i] = ini; S.R[i] = r;
    if (r >= 0 && d >= 0) S.porSala[r].add(i);
  }

  // Aplica uma mudança e devolve o delta de custo (atualizando a cache).
  function tryMove(S, changes) {
    const keys = new Set();
    for (const [i, , , r] of changes) for (const k of keysFor(S, i, r)) keys.add(k);
    let before = 0;
    for (const k of keys) before += S.cache.get(k) || 0;
    const prev = changes.map(([i]) => [i, S.D[i], S.I[i], S.R[i]]);
    for (const [i, d, ini, r] of changes) setAula(S, i, d, ini, r);
    let after = 0;
    const nv = [];
    for (const k of keys) { const c = entityCost(S, k); nv.push([k, c]); after += c; }
    return {
      delta: after - before,
      commit() { for (const [k, c] of nv) S.cache.set(k, c); S.total += after - before; },
      revert() { for (let x = prev.length - 1; x >= 0; x--) setAula(S, ...prev[x]); },
    };
  }

  /* ---------- Pesquisa e ordenação de salas (Martins 2014) ----------
     Ordena salas pela adequação: característica pedida, capacidade suficiente e menor desperdício. */
  function roomFit(S, a, s) {
    const sala = S.P.salas[s];
    const nd = need(S, a);
    let f = [0, 3, 10, 60][carMatch(S, a, s)];
    if (nd > sala.cap) f += 50 + (nd - sala.cap);
    else f += (sala.cap - nd) / 25;
    return f;
  }

  function rankedRooms(S, i) {
    const a = S.P.aulas[i];
    if (a.noRoom) return [];
    if (!a._rooms) a._rooms = S.P.salas.map((_, s) => s).sort((x, y) => roomFit(S, a, x) - roomFit(S, a, y));
    return a._rooms;
  }

  function roomFree(S, s, d, ini, dur, self, mask) {
    if (s < 0) return true;
    const m = mask == null ? (self >= 0 ? S.M[self] : S.FULL) : mask;
    for (const j of S.porSala[s]) {
      if (j === self || S.D[j] !== d || !(S.M[j] & m)) continue;
      if (overlap(ini, ini + dur, S.I[j], S.I[j] + S.P.aulas[j].dur) > 0) return false;
    }
    for (const b of S.bloqPorSala[s]) if (b.dia === d && (b.sem == null || (b.sem & m)) && overlap(ini, ini + dur, b.ini, b.fim) > 0) return false;
    return true;
  }

  /* Salas onde já estão outras aulas da mesma UC e turma (regra MESMA_SALA_UC): entram como candidatas. */
  function salasIrmas(S, i, max) {
    if (!on(S, 'MESMA_SALA_UC')) return [];
    const a = S.P.aulas[i], out = [];
    for (const t of a.turmas) for (const j of S.porTurma[t]) {
      if (j === i || S.P.aulas[j].uc !== a.uc || S.R[j] < 0 || out.includes(S.R[j])) continue;
      out.push(S.R[j]);
      if (out.length >= max) return out;
    }
    return out;
  }
  const comIrmas = (S, i, rooms, max) => {
    const x = salasIrmas(S, i, max || 3).filter((r) => !rooms.includes(r));
    return x.length ? rooms.concat(x) : rooms;
  };

  /* Pesquisa de salas para a gestão de espaços e para o editor. */
  function searchRooms(P, q) {
    const S = createState(P);
    const fake = { req: q.car || null, noRoom: false, esperado: q.alunos, inscritos: q.alunos };
    const mask = q.semanas == null ? S.FULL : (q.semanas & S.FULL);
    return P.salas.map((sala, s) => {
      const livre = roomFree(S, s, q.dia, q.ini, q.dur, q.ignorar != null ? q.ignorar : -1, mask);
      const cm = carMatch(S, fake, s);
      const capOk = sala.cap >= q.alunos;
      const desperdicio = Math.max(0, sala.cap - q.alunos);
      let score = roomFit(S, fake, s);
      if (q.edificio && sala.edificio !== q.edificio) score += 2;
      return { s, sala, livre, carOk: cm === 0, carEq: cm === 1, capOk, desperdicio, score };
    }).sort((x, y) => (y.livre - x.livre) || x.score - y.score);
  }

  /* ---------- Gerador ----------
     opts.modo: 'zero' (refaz), 'melhorar' (parte do horário base), 'salas' (só reatribui salas) */
  function solve(P, opts, onProgress) {
    opts = opts || {};
    const rand = rng(opts.seed || 1);
    const S = createState(P);
    const dias = opts.dias || [0, 1, 2, 3, 4];
    const soSalas = opts.modo === 'salas';
    const startsCache = {};
    const starts = (dur) => startsCache[dur] || (startsCache[dur] = startsFor(dur, opts.grelha));
    const free = [];
    for (let i = 0; i < S.n; i++) if (!P.aulas[i].fixa && !(soSalas && P.aulas[i].noRoom)) free.push(i);
    const t0 = Date.now();
    const limite = opts.tempoMs || 8000;
    const hist = [];
    const report = (fase, extra) => {
      if (!onProgress) return;
      onProgress(Object.assign({ fase, ms: Date.now() - t0, custo: S.total }, extra || {}));
    };

    if (opts.modo === 'zero') for (const i of free) setAula(S, i, -1, -1, -1);
    fullCost(S);
    hist.push([0, S.total]);
    report('construcao', { hist });

    // Fase 1: construção gulosa, aulas mais difíceis primeiro ("peso dos eventos", Martins 2014).
    const peso = (i) => {
      const a = P.aulas[i];
      const nRooms = a.noRoom ? 20 : P.salas.filter((s, k) => carMatch(S, a, k) <= 1 && s.cap >= a.esperado).length;
      const doc = a.docente >= 0 ? P.docentes[a.docente] : null;
      const B = blocoDe(S, i);
      return a.turmas.length * 3 + (B ? B.span : a.dur) / 45 + 10 / (1 + nRooms) + (doc && doc.indisp.length ? 2 : 0) + rand() * (opts.ruido || 0);
    };
    if (!soSalas) {
      // Num bloco só se coloca a primeira aula; as outras vão com ela (moverBloco).
      const porColocar = free.filter((i) => S.D[i] < 0 && (!blocoDe(S, i) || blocoDe(S, i).m[0] === i)).sort((x, y) => peso(y) - peso(x));
      let ultimo = Date.now(), k = 0;
      for (const i of porColocar) {
        // Progresso da construção (só informação; não altera o resultado).
        if (onProgress && Date.now() - ultimo > 500) { ultimo = Date.now(); report('construcao', { hist, colocadas: k, porColocar: porColocar.length }); }
        k++;
        const a = P.aulas[i];
        let best = null;
        const rooms = a.noRoom ? [-1] : comIrmas(S, i, rankedRooms(S, i).slice(0, opts.salasCandidatas || 6));
        const emBloco = !!blocoDe(S, i);
        for (const d of dias) for (const ini of startsAula(S, i, starts)) for (const r of rooms) {
          const mv = tryMove(S, emBloco ? moverBloco(S, i, d, ini, r) : [[i, d, ini, r]]);
          const delta = mv.delta + (opts.ruido ? rand() * opts.ruido : 0);
          mv.revert();
          if (!best || delta < best.delta) best = { d, ini, r, delta };
        }
        if (best) tryMove(S, emBloco ? moverBloco(S, i, best.d, best.ini, best.r) : [[i, best.d, best.ini, best.r]]).commit();
      }
    } else {
      // Aulas com dia e hora mas sem sala recebem a melhor sala livre.
      for (const i of free) {
        if (S.D[i] < 0 || S.R[i] >= 0) continue;
        let bestR = null, n = 0;
        for (const r of rankedRooms(S, i)) {
          if (!roomFree(S, r, S.D[i], S.I[i], P.aulas[i].dur, i)) continue;
          const mv = tryMove(S, [[i, S.D[i], S.I[i], r]]);
          if (!bestR || mv.delta < bestR.delta) bestR = { r, delta: mv.delta };
          mv.revert();
          if (++n >= 15) break;
        }
        if (bestR && bestR.delta < 0) tryMove(S, [[i, S.D[i], S.I[i], bestR.r]]).commit();
      }
    }
    fullCost(S);
    hist.push([Date.now() - t0, S.total]);
    report('construcao', { hist });
    const custoInicial = S.total, msConstrucao = Date.now() - t0;
    let tMelhor = msConstrucao;
    if (opts.soConstrucao) {
      return { aulas: P.aulas.map((a, i) => ({ id: a.id, key: a.key, dia: S.D[i], ini: S.I[i], sala: S.R[i] })),
        custo: S.total, custoInicial, ms: msConstrucao, tMelhor, hist, D: S.D.slice(), I: S.I.slice(), R: S.R.slice() };
    }

    // Fase 2: arrefecimento simulado (simulated annealing).
    let best = { total: S.total, D: S.D.slice(), I: S.I.slice(), R: S.R.slice() };
    const T0 = opts.T0 || 6, T1 = 0.02;
    let it = 0, aceites = 0, lastRep = Date.now();
    const fimSA = t0 + limite * 0.9;
    const K = soSalas ? 14 : 8;
    if (free.length) {
      while (Date.now() < fimSA) {
        for (let rep = 0; rep < 200; rep++) {
          it++;
          const frac = Math.min(1, (Date.now() - t0) / limite);
          const T = T0 * Math.pow(T1 / T0, frac);
          const i = free[Math.floor(rand() * free.length)];
          const a = P.aulas[i];
          const rr = rankedRooms(S, i);
          const u = soSalas ? 0.5 + rand() * 0.5 : rand();
          let changes;
          if (u < 0.5) {
            const d = dias[Math.floor(rand() * dias.length)];
            const st = startsAula(S, i, starts);
            if (!st.length) continue;
            const ini = st[Math.floor(rand() * st.length)];
            let r = a.noRoom ? -1 : S.R[i];
            if (!a.noRoom && (r < 0 || !roomFree(S, r, d, ini, a.dur, i) || rand() < 0.3)) {
              r = rr[0];
              const cand = comIrmas(S, i, [], 3).concat(rr.slice(0, 8));
              for (const x of cand) if (roomFree(S, x, d, ini, a.dur, i)) { r = x; break; }
            }
            changes = moverBloco(S, i, d, ini, r);
          } else if (u < 0.78) {
            if (S.D[i] < 0 || a.noRoom) continue;
            const irmas = rand() < 0.25 ? salasIrmas(S, i, 3) : [];
            const r = irmas.length ? irmas[Math.floor(rand() * irmas.length)] : rr[Math.floor(rand() * Math.min(K, rr.length))];
            if (r === S.R[i]) continue;
            // Só reatribuir salas: nunca cria sobreposições de sala que não existiam.
            if (soSalas && !roomFree(S, r, S.D[i], S.I[i], a.dur, i)) continue;
            changes = [[i, S.D[i], S.I[i], r]];
          } else if (soSalas || u < 0.9) {
            // Troca de salas entre duas aulas que se sobrepõem (Martins 2014: troca de salas entre eventos).
            if (S.D[i] < 0 || a.noRoom) continue;
            const r = rr[Math.floor(rand() * Math.min(K, rr.length))];
            if (r === S.R[i]) continue;
            let j = -1, nOcc = 0;
            for (const x of S.porSala[r]) {
              if (S.D[x] !== S.D[i] || !(S.M[x] & S.M[i])) continue;
              if (overlap(S.I[i], S.I[i] + a.dur, S.I[x], S.I[x] + P.aulas[x].dur) > 0) { j = x; nOcc++; }
            }
            if (nOcc !== 1 || P.aulas[j].fixa || P.aulas[j].noRoom) continue;
            if (soSalas && S.R[i] >= 0) {
              let ocupada = false;
              for (const x of S.porSala[S.R[i]]) {
                if (x === i || x === j || S.D[x] !== S.D[j] || !(S.M[x] & S.M[j])) continue;
                if (overlap(S.I[j], S.I[j] + P.aulas[j].dur, S.I[x], S.I[x] + P.aulas[x].dur) > 0) { ocupada = true; break; }
              }
              if (ocupada) continue;
            }
            changes = [[i, S.D[i], S.I[i], r], [j, S.D[j], S.I[j], S.R[i]]];
          } else {
            const j = free[Math.floor(rand() * free.length)];
            if (j === i || P.aulas[j].dur !== a.dur || S.D[i] < 0 || S.D[j] < 0 || blocoDe(S, i) || blocoDe(S, j)) continue;
            changes = [[i, S.D[j], S.I[j], S.R[i]], [j, S.D[i], S.I[i], S.R[j]]];
          }
          const mv = tryMove(S, changes);
          if (mv.delta <= 0 || rand() < Math.exp(-mv.delta / T)) {
            mv.commit(); aceites++;
            if (S.total < best.total - 1e-9) { best = { total: S.total, D: S.D.slice(), I: S.I.slice(), R: S.R.slice() }; tMelhor = Date.now() - t0; }
          } else mv.revert();
        }
        if (Date.now() - lastRep > 250) {
          lastRep = Date.now();
          hist.push([Date.now() - t0, best.total]);
          report('otimizacao', { hist, it, aceites, melhor: best.total });
        }
      }
    }
    // Repõe a melhor solução encontrada.
    for (let i = 0; i < S.n; i++) setAula(S, i, best.D[i], best.I[i], best.R[i]);
    fullCost(S);

    // Fase 3: melhorar a atribuição de salas sem mexer nos tempos (MAS, Martins 2014).
    let melhorias = 0;
    for (let pass = 0; pass < 3; pass++) {
      let mudou = false;
      for (const i of free) {
        if (S.D[i] < 0 || P.aulas[i].noRoom) continue;
        let bestR = null;
        const cand = comIrmas(S, i, rankedRooms(S, i).slice(0, opts.salasFase3 || 40));
        for (const r of cand) {
          if (r === S.R[i] || !roomFree(S, r, S.D[i], S.I[i], P.aulas[i].dur, i)) continue;
          const mv = tryMove(S, [[i, S.D[i], S.I[i], r]]);
          if (mv.delta < -1e-9 && (!bestR || mv.delta < bestR.delta)) bestR = { r, delta: mv.delta };
          mv.revert();
        }
        if (bestR) { tryMove(S, [[i, S.D[i], S.I[i], bestR.r]]).commit(); mudou = true; melhorias++; tMelhor = Date.now() - t0; }
      }
      if (!mudou) break;
    }
    fullCost(S);

    // Fase 4: equilibrar a ocupação das salas. Passa aulas das salas mais usadas para salas
    // equivalentes menos usadas, só quando o custo não piora (nenhuma regra fica pior).
    let equilibradas = 0;
    if (opts.equilibrar !== false) {
      const peso = (i) => P.aulas[i].dur * pop(S.M[i]);
      const uso = P.salas.map(() => 0);
      for (let i = 0; i < S.n; i++) if (S.R[i] >= 0 && S.D[i] >= 0) uso[S.R[i]] += peso(i);
      const tol = opts.equilibrioTol || 0;
      for (let pass = 0; pass < 3; pass++) {
        let mudou = false;
        const ordem = free.filter((i) => S.R[i] >= 0 && S.D[i] >= 0 && !P.aulas[i].noRoom).sort((x, y) => uso[S.R[y]] - uso[S.R[x]]);
        for (const i of ordem) {
          const r0 = S.R[i], w = peso(i);
          let bestR = null;
          for (const r of rankedRooms(S, i).slice(0, opts.salasFase3 || 40)) {
            if (r === r0 || uso[r] + w >= uso[r0] || !roomFree(S, r, S.D[i], S.I[i], P.aulas[i].dur, i)) continue;
            const mv = tryMove(S, [[i, S.D[i], S.I[i], r]]);
            const ganho = uso[r0] - uso[r] - w;
            if (mv.delta <= tol + 1e-9 && (!bestR || mv.delta < bestR.delta - 1e-9 || (Math.abs(mv.delta - bestR.delta) < 1e-9 && ganho > bestR.ganho))) bestR = { r, delta: mv.delta, ganho };
            mv.revert();
          }
          if (bestR) {
            tryMove(S, [[i, S.D[i], S.I[i], bestR.r]]).commit();
            uso[r0] -= w; uso[bestR.r] += w; equilibradas++; mudou = true;
          }
        }
        if (!mudou) break;
      }
      fullCost(S);
    }
    hist.push([Date.now() - t0, S.total]);
    const ev = evaluate(S);
    report('fim', { hist, it, aceites, melhor: S.total });
    return {
      aulas: P.aulas.map((a, i) => ({ id: a.id, key: a.key, dia: S.D[i], ini: S.I[i], sala: S.R[i] })),
      custo: S.total, custoInicial, msConstrucao, tMelhor, it, aceites, melhoriasSalas: melhorias, equilibradas, ms: Date.now() - t0, hist, hard: ev.hard, soft: ev.soft, porRegra: ev.porRegra,
      D: S.D.slice(), I: S.I.slice(), R: S.R.slice(),
    };
  }

  /* ---------- Modelo multiobjetivo (Solução 2) ----------
     f1 soma das penalizações das regras obrigatórias (peso × gravidade)
     f2 1 − média de min(1, esperados / capacidade) nas aulas com sala
     f3 qualidade das turmas: furos (FUROS_TURMA, intervalos ≥ 60 min) + aulas seguidas da mesma UC em salas diferentes (MESMA_SALA_UC)
     f4 aulas fora da mancha horária (FORA_MANCHA)
     Também devolve F (custo mono-objetivo), M1 (HC1–HC3), total de violações obrigatórias e não agendadas. */
  const CONFLITOS = new Set(['CONF_SALA', 'CONF_DOCENTE', 'CONF_TURMA']);
  function objetivos(S, ev) {
    ev = ev || evaluate(S);
    let f1 = 0, f3 = 0, f4 = 0, m1 = 0, hard = 0, nao = 0, furos = 0, salaUc = 0;
    for (const v of ev.violacoes) {
      if (v.sev === 'hard') { f1 += (S.W[v.codigo] || 0) * v.custo; hard++; if (CONFLITOS.has(v.codigo)) m1++; if (v.codigo === 'NAO_AGENDADA') nao++; }
      if (v.codigo === 'FUROS_TURMA') { f3++; furos++; }
      else if (v.codigo === 'MESMA_SALA_UC') { f3++; salaUc++; }
      else if (v.codigo === 'FORA_MANCHA') f4++;
    }
    let soma = 0, n = 0;
    for (let i = 0; i < S.n; i++) {
      if (S.R[i] < 0 || S.D[i] < 0) continue;
      const cap = S.P.salas[S.R[i]].cap;
      if (!(cap > 0)) continue;
      soma += Math.min(1, need(S, S.P.aulas[i]) / cap); n++;
    }
    const ocup = n ? soma / n : 0;
    return { f: [f1, 1 - ocup, f3, f4], F: ev.custo, m1, hard, nao, ocupacao: ocup, soft: ev.soft, furos, salaUc };
  }

  function evaluateArrays(P, D, I, R) {
    const S = createState(P);
    for (let i = 0; i < S.n; i++) setAula(S, i, D[i], I[i], R[i]);
    fullCost(S);
    return objetivos(S);
  }

  const domina = (a, b) => {
    let melhor = false;
    for (let k = 0; k < a.length; k++) { if (a[k] > b[k]) return false; if (a[k] < b[k]) melhor = true; }
    return melhor;
  };

  // Ordenação rápida por não dominância (Deb et al. 2002). Devolve as frentes (listas de índices).
  function frentes(pop) {
    const n = pop.length, S_ = pop.map(() => []), cnt = new Int32Array(n), F = [[]];
    for (let p = 0; p < n; p++) {
      for (let q = 0; q < n; q++) {
        if (p === q) continue;
        if (domina(pop[p].f, pop[q].f)) S_[p].push(q);
        else if (domina(pop[q].f, pop[p].f)) cnt[p]++;
      }
      if (!cnt[p]) { pop[p].rank = 0; F[0].push(p); }
    }
    let k = 0;
    while (F[k].length) {
      const nx = [];
      for (const p of F[k]) for (const q of S_[p]) if (--cnt[q] === 0) { pop[q].rank = k + 1; nx.push(q); }
      F.push(nx); k++;
    }
    F.pop();
    return F;
  }

  function aglomeracao(pop, idx) {
    for (const i of idx) pop[i].crowd = 0;
    if (idx.length <= 2) { for (const i of idx) pop[i].crowd = Infinity; return; }
    const m = pop[idx[0]].f.length;
    for (let k = 0; k < m; k++) {
      const o = idx.slice().sort((a, b) => pop[a].f[k] - pop[b].f[k]);
      const lo = pop[o[0]].f[k], hi = pop[o[o.length - 1]].f[k];
      pop[o[0]].crowd = pop[o[o.length - 1]].crowd = Infinity;
      if (hi - lo < 1e-12) continue;
      for (let x = 1; x < o.length - 1; x++) pop[o[x]].crowd += (pop[o[x + 1]].f[k] - pop[o[x - 1]].f[k]) / (hi - lo);
    }
  }

  /* NSGA-II (Solução 2).
     opts: seed, tempoMs (orçamento T, inclui a construção da população inicial), populacao (40), pc (0,9),
     dias, grelha, salasTop (8), ruido (0), inicial ({D,I,R} da construção; se faltar, corre o Greedy com o ruído e a semente dados,
     como na Solução 1, para que execuções com sementes diferentes partam de horários diferentes). */
  function nsga2(P, opts, onProgress) {
    opts = opts || {};
    const t0 = Date.now();
    const rand = rng(opts.seed || 1);
    const N = opts.populacao || 40, pc = opts.pc != null ? opts.pc : 0.9, top = opts.salasTop || 8;
    const limite = opts.tempoMs || 8000;
    const dias = opts.dias || [0, 1, 2, 3, 4];
    const startsCache = {};
    const starts = (dur) => startsCache[dur] || (startsCache[dur] = startsFor(dur, opts.grelha));
    const S = createState(P);
    const free = [];
    for (let i = 0; i < S.n; i++) if (!P.aulas[i].fixa) free.push(i);
    const nl = free.length, pm = nl ? 2 / nl : 0;
    const porDur = new Map();
    for (const i of free) { const d = P.aulas[i].dur; if (!porDur.has(d)) porDur.set(d, []); porDur.get(d).push(i); }
    let avaliacoes = 0;
    const avaliar = (ind) => {
      for (let i = 0; i < S.n; i++) setAula(S, i, ind.D[i], ind.I[i], ind.R[i]);
      fullCost(S);
      const o = objetivos(S);
      avaliacoes++;
      ind.f = o.f; ind.F = o.F; ind.m1 = o.m1; ind.hard = o.hard; ind.nao = o.nao; ind.ocupacao = o.ocupacao; ind.furos = o.furos; ind.salaUc = o.salaUc;
      return ind;
    };
    // Recoloca a aula i (dia e hora ao acaso, sala livre entre as `top` mais indicadas, se houver).
    // Num bloco, recoloca o bloco inteiro (mesmo dia, mesmas distâncias do Manual).
    const recolocar = (ind, i) => {
      const B = blocoDe(S, i);
      const st = startsAula(S, B ? B.m[0] : i, starts);
      if (!st.length) return;
      const d = dias[Math.floor(rand() * dias.length)], ini = st[Math.floor(rand() * st.length)];
      for (const [j, k] of B ? B.m.map((j, k) => [j, k]) : [[i, 0]]) {
        ind.D[j] = d;
        ind.I[j] = ini + (B ? B.off[k] : 0);
        ind.R[j] = P.aulas[j].noRoom ? -1 : salaTop(ind, j);
      }
    };
    // Unidades do cruzamento: aulas soltas ou blocos inteiros.
    const unidades = [];
    for (const i of free) { const B = blocoDe(S, i); if (!B) unidades.push([i]); else if (B.m[0] === i) unidades.push(B.m); }
    const salaTop = (ind, i) => {
      const rr = rankedRooms(S, i).slice(0, top);
      if (!rr.length) return -1;
      // Estado S carregado com o indivíduo? Não necessariamente; escolhe ao acaso entre as top.
      return rr[Math.floor(rand() * rr.length)];
    };
    const novo = (src) => ({ D: src.D.slice(), I: src.I.slice(), R: src.R.slice() });

    // População inicial: Greedy (com ruído controlado pela semente) + variantes com 3% a 28% das aulas recolocadas.
    let base = opts.inicial;
    let custoInicial = null;
    // opts.daPartida: a população parte do horário recebido (dias, horas e salas de P) em vez da construção gulosa.
    if (!base && opts.daPartida) base = { D: S.D.slice(), I: S.I.slice(), R: S.R.slice() };
    if (!base) {
      const g = solve(P, { modo: 'zero', soConstrucao: true, ruido: opts.ruido || 0, seed: opts.seed || 1, dias, grelha: opts.grelha },
        onProgress ? (p) => onProgress(Object.assign({}, p, { fase: 'construcao', ms: Date.now() - t0, hist: [] })) : null);
      base = { D: g.D, I: g.I, R: g.R }; custoInicial = g.custo;
    }
    const pop = [avaliar(novo(base))];
    while (pop.length < N && Date.now() - t0 < limite) {
      const x = novo(base);
      const frac = 0.03 + rand() * 0.25;
      for (const i of free) if (rand() < frac) recolocar(x, i);
      pop.push(avaliar(x));
      if (onProgress) onProgress({ fase: 'populacao', ms: Date.now() - t0, it: 0, populacao: pop.length, de: N, custo: pop[0].F, hist: [[Date.now() - t0, pop[0].F]] });
    }
    let F = frentes(pop);
    for (const f of F) aglomeracao(pop, f);
    const melhorDe = (lista) => lista.reduce((b, x) => (!b || x.f[0] < b.f[0] - 1e-9 || (Math.abs(x.f[0] - b.f[0]) <= 1e-9 && x.F < b.F)) ? x : b, null);
    let sel = melhorDe(F[0].map((i) => pop[i]));
    let tMelhor = Date.now() - t0;
    const hist = [[tMelhor, sel.F]];
    let ger = 0;
    const torneio = () => {
      const a = pop[Math.floor(rand() * pop.length)], b = pop[Math.floor(rand() * pop.length)];
      if (a.rank !== b.rank) return a.rank < b.rank ? a : b;
      return a.crowd >= b.crowd ? a : b;
    };
    let atual = pop;
    while (Date.now() - t0 < limite) {
      const filhos = [];
      while (filhos.length < N && Date.now() - t0 < limite) {
        const p1 = torneio(), p2 = torneio();
        const c1 = novo(p1), c2 = novo(p2);
        if (rand() < pc) {
          for (const un of unidades) if (rand() < 0.5) for (const i of un) {
            c1.D[i] = p2.D[i]; c1.I[i] = p2.I[i]; c1.R[i] = p2.R[i];
            c2.D[i] = p1.D[i]; c2.I[i] = p1.I[i]; c2.R[i] = p1.R[i];
          }
        }
        for (const c of [c1, c2]) {
          for (const i of free) {
            if (rand() >= pm) continue;
            const u = rand(), a = P.aulas[i];
            if (u < 0.5) recolocar(c, i);
            else if (u < 0.8) { if (!a.noRoom && c.D[i] >= 0) c.R[i] = salaTop(c, i); }
            else {
              const l = porDur.get(a.dur);
              const j = l[Math.floor(rand() * l.length)];
              if (j !== i && c.D[i] >= 0 && c.D[j] >= 0 && !blocoDe(S, i) && !blocoDe(S, j)) {
                const d = c.D[i], s = c.I[i];
                c.D[i] = c.D[j]; c.I[i] = c.I[j]; c.D[j] = d; c.I[j] = s;
              }
            }
          }
          if (filhos.length < N) filhos.push(avaliar(c));
        }
      }
      if (!filhos.length) break;
      // Sobreviventes (μ + λ).
      const uniao = atual.concat(filhos);
      F = frentes(uniao);
      const prox = [];
      for (const f of F) {
        aglomeracao(uniao, f);
        if (prox.length + f.length <= N) { for (const i of f) prox.push(uniao[i]); continue; }
        const resto = f.slice().sort((a, b) => uniao[b].crowd - uniao[a].crowd);
        for (const i of resto) { if (prox.length >= N) break; prox.push(uniao[i]); }
        break;
      }
      atual = prox;
      pop.length = 0; pop.push(...atual);
      F = frentes(pop);
      for (const f of F) aglomeracao(pop, f);
      ger++;
      const s2 = melhorDe(F[0].map((i) => pop[i]));
      if (s2.f[0] < sel.f[0] - 1e-9 || (Math.abs(s2.f[0] - sel.f[0]) <= 1e-9 && s2.F < sel.F - 1e-9)) { sel = s2; tMelhor = Date.now() - t0; }
      hist.push([Date.now() - t0, sel.F]);
      if (onProgress) onProgress({ fase: 'nsga2', ms: Date.now() - t0, it: ger, geracao: ger, avaliacoes, frente: F[0].length, melhor: sel.F, custo: sel.F, f1: sel.f[0], hist });
    }
    // Frente final (sem duplicados nos objetivos).
    const vistos = new Set();
    const frente = [];
    for (const i of F[0]) {
      const k = pop[i].f.map((v) => v.toFixed(6)).join('|');
      if (vistos.has(k)) continue;
      vistos.add(k); frente.push(pop[i]);
    }
    sel = melhorDe(frente);
    return {
      frente: frente.map((x) => ({ f: x.f, F: x.F, m1: x.m1, hard: x.hard, nao: x.nao, ocupacao: x.ocupacao })),
      escolhida: { f: sel.f, F: sel.F, m1: sel.m1, hard: sel.hard, nao: sel.nao, ocupacao: sel.ocupacao, furos: sel.furos, salaUc: sel.salaUc },
      aulas: P.aulas.map((a, i) => ({ id: a.id, key: a.key, dia: sel.D[i], ini: sel.I[i], sala: sel.R[i] })),
      D: sel.D, I: sel.I, R: sel.R,
      geracoes: ger, avaliacoes, custoInicial, tMelhor, ms: Date.now() - t0, hist,
    };
  }

  /* Hipervolume exato (fatias recursivas) de pontos já normalizados, para minimização, com ponto de referência r. */
  function hipervolume(pontos, r) {
    const pts = pontos.filter((p) => p.every((v, k) => v < r[k]));
    const rec = (ps, d) => {
      if (!ps.length) return 0;
      if (d === 1) return r[0] - Math.min(...ps.map((p) => p[0]));
      const o = ps.slice().sort((a, b) => a[d - 1] - b[d - 1]);
      let v = 0;
      for (let k = 0; k < o.length; k++) {
        const prox = k + 1 < o.length ? o[k + 1][d - 1] : r[d - 1];
        const w = prox - o[k][d - 1];
        if (w > 0) v += w * rec(o.slice(0, k + 1), d - 1);
      }
      return v;
    };
    return rec(pts, r.length);
  }

  /* Reposição de aulas suspensas por um evento académico.
     pedidos: [{idx, semanas: [semanas candidatas, por preferência], evitar: [{semana, dia, ini, fim}]}]
     As aulas idx já estão em P (sem dia nem sala). Coloca uma de cada vez, na semana, dia, hora e
     sala com menor custo que não crie violações de regras obrigatórias; as seguintes já contam com as anteriores. */
  function repor(P, pedidos, opts) {
    opts = opts || {};
    const S = createState(P);
    fullCost(S);
    const dias = opts.dias || [0, 1, 2, 3, 4, 5];
    const res = [];
    const ordem = pedidos.slice().sort((x, y) => P.aulas[y.idx].turmas.length - P.aulas[x.idx].turmas.length);
    for (const pd of ordem) {
      const i = pd.idx, a = P.aulas[i];
      let escolhido = null, nc = 0;
      for (let wi = 0; wi < pd.semanas.length && !escolhido; wi++) {
        const w = pd.semanas[wi], bit = 1 << (w - 1);
        S.M[i] = bit;
        // Primeiro tenta o mesmo dia, hora e sala (prolongar a aula para outra semana).
        if (a.diaOriginal != null && a.iniOriginal != null && !(S.hol[a.diaOriginal] & bit) && dias.includes(a.diaOriginal)
          && !(pd.evitar || []).some((e) => e.semana === w && e.dia === a.diaOriginal && overlap(a.iniOriginal, a.iniOriginal + a.dur, e.ini, e.fim) > 0)
          && (a.noRoom || (a.salaOriginal != null && a.salaOriginal >= 0 && roomFree(S, a.salaOriginal, a.diaOriginal, a.iniOriginal, a.dur, i, bit)))) {
          const r = a.noRoom ? -1 : a.salaOriginal;
          const mv = tryMove(S, [[i, a.diaOriginal, a.iniOriginal, r]]);
          const out = [];
          for (const k of keysFor(S, i, r)) entityCost(S, k, out);
          if (!out.some((v) => v.sev === 'hard' && v.aulas.includes(a.id))) { mv.commit(); escolhido = { w, d: a.diaOriginal, ini: a.iniOriginal, r, delta: mv.delta }; break; }
          mv.revert();
        }
        const cands = [];
        const inis = [a.iniOriginal, ...startsFor(a.dur, 'blocos')].filter((x, k, arr) => x != null && arr.indexOf(x) === k && x + a.dur <= 1410);
        for (const d of dias) {
          if (S.hol[d] & bit) continue;
          for (const ini of inis) {
            if ((pd.evitar || []).some((e) => e.semana === w && e.dia === d && overlap(ini, ini + a.dur, e.ini, e.fim) > 0)) continue;
            let rooms = [-1];
            if (!a.noRoom) {
              if (a.salaOriginal != null && a.salaOriginal >= 0 && roomFree(S, a.salaOriginal, d, ini, a.dur, i, bit)) rooms = [a.salaOriginal];
              else { rooms = []; for (const r of rankedRooms(S, i)) { if (roomFree(S, r, d, ini, a.dur, i, bit)) rooms.push(r); if (rooms.length >= 4) break; } }
            }
            for (const r of rooms) {
              const mv = tryMove(S, [[i, d, ini, r]]);
              const pen = (ini === a.iniOriginal ? 0 : 6) + (r === a.salaOriginal ? 0 : 2) + (a.diaOriginal == null || d === a.diaOriginal ? 0 : 4);
              cands.push({ w, d, ini, r, delta: mv.delta, score: mv.delta + pen });
              mv.revert();
            }
          }
        }
        nc += cands.length;
        cands.sort((x, y) => x.score - y.score);
        for (const c of cands.slice(0, opts.verificar || 20)) {
          const mv = tryMove(S, [[i, c.d, c.ini, c.r]]);
          const out = [];
          for (const k of keysFor(S, i, c.r)) entityCost(S, k, out);
          if (!out.some((v) => v.sev === 'hard' && v.aulas.includes(a.id))) { mv.commit(); escolhido = c; break; }
          mv.revert();
        }
      }
      if (!escolhido) { S.M[i] = 0; res.push({ idx: i, ok: false, candidatos: nc }); continue; }
      res.push({ idx: i, ok: true, semana: escolhido.w, dia: escolhido.d, ini: escolhido.ini, sala: escolhido.r, delta: escolhido.delta });
    }
    return res;
  }

  /* Sugere as melhores posições (dia, hora, sala) para uma aula, mantendo as outras. */
  function suggest(P, idx, opts) {
    opts = opts || {};
    const S = createState(P);
    fullCost(S);
    const a = P.aulas[idx];
    const res = [];
    const rooms = a.noRoom ? [-1] : rankedRooms(S, idx).slice(0, 10);
    for (const d of opts.dias || [0, 1, 2, 3, 4]) for (const ini of startsFor(a.dur, opts.grelha)) {
      for (const r of rooms) {
        if (!roomFree(S, r, d, ini, a.dur, idx)) continue;
        const mv = tryMove(S, [[idx, d, ini, r]]);
        res.push({ dia: d, ini, sala: r, delta: mv.delta });
        mv.revert();
      }
    }
    res.sort((x, y) => x.delta - y.delta);
    return res.slice(0, opts.n || 6);
  }

  function validate(P) {
    const S = createState(P);
    fullCost(S);
    return evaluate(S);
  }

  /* Violações em que uma aula participa (para validar uma criação ou alteração antes de gravar). */
  function violationsOf(P, idx) {
    const S = createState(P);
    const out = [];
    for (const k of keysFor(S, idx)) entityCost(S, k, out);
    const id = P.aulas[idx].id;
    const seen = new Set();
    return out.filter((v) => v.aulas.includes(id)).filter((v) => { const k = v.codigo + '|' + v.msg; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  return { DIAS, RUNS, hhmm, startsFor, createState, validate, solve, nsga2, objetivos, evaluateArrays, hipervolume, frentes, suggest, repor, searchRooms, violationsOf, rng, semTxt, pop };
}

if (typeof window !== 'undefined') window.EngineFactory = EngineFactory;
if (typeof module !== 'undefined') module.exports = EngineFactory;
