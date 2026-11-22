/* Estatísticas das experiências: hipervolume, Mann-Whitney com correção de Holm, Â12 de Vargha-Delaney
   e correlação de Spearman entre objetivos (H4). Usado por tools/experiencias.js. */
const E = require('../../frontend/js/engine.js')();

const mediana = (v) => { const s = v.slice().sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const quantil = (v, q) => { const s = v.slice().sort((a, b) => a - b); if (!s.length) return NaN; const p = (s.length - 1) * q, i = Math.floor(p); return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (p - i); };
const media = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const dp = (v) => { const m = media(v); return v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0; };

function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

function postos(v) {
  const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  const empates = [];
  for (let i = 0; i < o.length;) {
    let j = i;
    while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
    const m = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[o[k][1]] = m;
    if (j > i) empates.push(j - i + 1);
    i = j + 1;
  }
  return { r, empates };
}

/* Mann-Whitney (bilateral, aproximação normal com correção de empates e de continuidade) e Â12 = P(X > Y) + 0,5 P(X = Y). */
function mannWhitney(x, y) {
  const n1 = x.length, n2 = y.length, n = n1 + n2;
  const { r, empates } = postos(x.concat(y));
  const R1 = r.slice(0, n1).reduce((a, b) => a + b, 0);
  const U1 = R1 - n1 * (n1 + 1) / 2;
  const mu = n1 * n2 / 2;
  const tie = empates.reduce((a, t) => a + t ** 3 - t, 0);
  const v = n1 * n2 / 12 * ((n + 1) - tie / (n * (n - 1)));
  let p = 1, z = 0;
  if (v > 0) { z = (Math.abs(U1 - mu) - 0.5) / Math.sqrt(v); z = Math.max(0, z); p = Math.min(1, 2 * (1 - phi(z))); }
  return { U: U1, z, p, a12: U1 / (n1 * n2) };
}

/* Wilcoxon de postos sinalizados para uma amostra (bilateral, aproximação normal com correção de empates e de
   continuidade): compara as execuções x da Solução 1 com o valor único m0 da Solução 2 (a sua melhor solução).
   Â12 = P(X > m0) + 0,5 P(X = m0). */
function wilcoxon1(x, m0) {
  const d = x.map((v) => v - m0).filter((v) => Math.abs(v) > 1e-9);
  const n = d.length;
  const a12 = x.length ? (x.filter((v) => v > m0 + 1e-9).length + 0.5 * x.filter((v) => Math.abs(v - m0) <= 1e-9).length) / x.length : 0.5;
  if (!n) return { W: 0, z: 0, p: 1, a12, n };
  const { r, empates } = postos(d.map(Math.abs));
  const Wp = r.reduce((a, rk, i) => a + (d[i] > 0 ? rk : 0), 0);
  const mu = n * (n + 1) / 4;
  const v = n * (n + 1) * (2 * n + 1) / 24 - empates.reduce((a, t) => a + t ** 3 - t, 0) / 48;
  let z = 0, p = 1;
  if (v > 0) { z = Math.max(0, (Math.abs(Wp - mu) - 0.5) / Math.sqrt(v)); p = Math.min(1, 2 * (1 - phi(z))); }
  return { W: Wp, z, p, a12, n };
}

function holm(ps) {
  const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const m = ps.length, adj = new Array(m);
  let max = 0;
  o.forEach(([p, i], k) => { max = Math.max(max, Math.min(1, (m - k) * p)); adj[i] = max; });
  return adj;
}

function spearman(x, y) {
  const rx = postos(x).r, ry = postos(y).r, n = x.length;
  const mx = media(rx), my = media(ry);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  const rho = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  // Teste t com n − 2 graus de liberdade (aproximação normal para n grande).
  const t = Math.abs(rho) < 1 ? rho * Math.sqrt((n - 2) / (1 - rho * rho)) : Infinity;
  const p = n > 3 ? Math.min(1, 2 * (1 - phi(Math.abs(t) * (1 - 1 / (4 * (n - 2)))))) : 1;
  return { rho, n, p };
}

const magnitude = (a) => { const d = Math.abs(a - 0.5) * 2; return d < 0.147 ? 'desprezável' : d < 0.33 ? 'pequena' : d < 0.474 ? 'média' : 'grande'; };

function analisar(dados) {
  const s1 = dados.s1, s2 = dados.s2;
  // Normalização pelos mínimos e máximos observados (todas as soluções das duas abordagens).
  const todos = s1.map((r) => r.f).concat(...s2.map((r) => r.frente.map((x) => x.f)));
  const lo = [0, 1, 2, 3].map((k) => Math.min(...todos.map((f) => f[k])));
  const hi = [0, 1, 2, 3].map((k) => Math.max(...todos.map((f) => f[k])));
  const norm = (f) => f.map((v, k) => (hi[k] - lo[k] > 1e-12 ? (v - lo[k]) / (hi[k] - lo[k]) : 0));
  const ref = [1.1, 1.1, 1.1, 1.1];
  for (const r of s1) r.hv = E.hipervolume([norm(r.f)], ref);
  for (const r of s2) { r.hv = E.hipervolume(r.frente.map((x) => norm(x.f)), ref); r.dimFrente = r.frente.length; }
  const f1min = Math.min(...s1.map((r) => r.f[0]), ...s2.map((r) => r.f[0]));

  const metricas = [
    ['M1', 'Conflitos (HC1–HC3)', (r) => r.m1, 'menor'],
    ['HARD', 'Violações obrigatórias (total)', (r) => r.hard, 'menor'],
    ['M2', 'Taxa de ocupação (%)', (r) => r.ocupacao * 100, 'maior'],
    ['M3', 'Furos', (r) => (r.furos != null ? r.furos : r.f[2]), 'menor'],
    ['M6', 'Aulas seguidas da mesma UC em salas diferentes', (r) => r.salaUc, 'menor'],
    ['M4', 'Aulas fora da mancha', (r) => r.f[3], 'menor'],
    ['F1', 'f₁ (penalização obrigatória)', (r) => r.f[0], 'menor'],
    ['C1', 'Custo total F(x)', (r) => r.F, 'menor'],
    ['C2', 'Hipervolume', (r) => r.hv, 'maior'],
    ['C4', 'Aulas não agendadas', (r) => r.nao, 'menor'],
    ['TB', 'Tempo até à melhor solução (s)', (r) => r.tMelhor / 1000, 'menor'],
    ['M5', 'Tempo de execução (s)', (r) => r.ms / 1000, 'menor'],
  ];
  const linhas = metricas.map(([id, nome, g, sentido]) => {
    const a = s1.map(g), b = s2.map(g);
    // Uma só execução da Solução 2 (determinística a partir do Greedy): Wilcoxon de uma amostra contra o seu valor.
    const t = b.length === 1 ? Object.assign(wilcoxon1(a, b[0]), { U: null }) : mannWhitney(a, b);
    return { id, nome, sentido, s1: { mediana: mediana(a), q1: quantil(a, 0.25), q3: quantil(a, 0.75), media: media(a), dp: dp(a) },
      s2: { mediana: mediana(b), q1: quantil(b, 0.25), q3: quantil(b, 0.75), media: media(b), dp: dp(b) },
      manual: id === 'C2' || id === 'TB' || id === 'M5' ? null : g(Object.assign({ tMelhor: 0, ms: 0 }, dados.manual)), U: t.U, W: t.W, teste: b.length === 1 ? 'wilcoxon1' : 'mann-whitney', z: t.z, p: t.p, a12: t.a12, magnitude: magnitude(t.a12) };
  });
  const testadas = linhas.filter((l) => l.id !== 'M5');
  holm(testadas.map((l) => l.p)).forEach((p, k) => { testadas[k].pHolm = p; testadas[k].signif = p < 0.05; });

  // H4: correlação de Spearman entre objetivos nas frentes da Solução 2 (todas as soluções não dominadas).
  const pts = [].concat(...s2.map((r) => r.frente.map((x) => x.f)));
  const pares = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(([i, j]) => {
    const s = spearman(pts.map((f) => f[i]), pts.map((f) => f[j]));
    const porRun = s2.filter((r) => r.frente.length >= 4).map((r) => spearman(r.frente.map((x) => x.f[i]), r.frente.map((x) => x.f[j])).rho);
    return { par: `f${i + 1} × f${j + 1}`, rho: s.rho, n: s.n, p: s.p, medianaPorExecucao: porRun.length ? mediana(porRun) : null, execucoesNegativas: porRun.filter((x) => x < 0).length, execucoes: porRun.length };
  });
  holm(pares.map((x) => x.p)).forEach((p, k) => { pares[k].pHolm = p; pares[k].conflito = p < 0.05 && pares[k].rho < 0; });

  const tab13 = {
    s1: { hv: [media(s1.map((r) => r.hv)), dp(s1.map((r) => r.hv))], frente: [1, 0], f1min: 100 * s1.filter((r) => Math.abs(r.f[0] - f1min) < 1e-6).length / s1.length },
    s2: { hv: [media(s2.map((r) => r.hv)), dp(s2.map((r) => r.hv))], frente: [media(s2.map((r) => r.dimFrente)), dp(s2.map((r) => r.dimFrente))], f1min: 100 * s2.filter((r) => Math.abs(r.f[0] - f1min) < 1e-6).length / s2.length },
    f1min,
  };
  const s1Inicial = { mediana: mediana(s1.map((r) => r.custoInicial)), melhoriaMediana: mediana(s1.map((r) => 1 - r.F / r.custoInicial)) };
  return { normalizacao: { min: lo, max: hi, ref }, metricas: linhas, spearman: pares, tabela13: tab13, s1Inicial,
    s2Info: { geracoes: mediana(s2.map((r) => r.geracoes)), avaliacoes: mediana(s2.map((r) => r.avaliacoes)) }, manual: dados.manual };
}

const n0 = (v, d) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('pt-PT', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d == null ? 0 : Math.min(d, 2) }));
const pfmt = (p) => (p < 0.001 ? '< 0,001' : n0(p, 3));

function anexoH(dados, res) {
  const cab = ['abordagem', 'semente', 'M1_conflitos', 'violacoes_obrigatorias', 'f1', 'f2', 'M2_ocupacao_pct', 'f3', 'M3_furos', 'M6_mesma_uc_salas_diferentes', 'M4_fora_mancha', 'C1_custo_F', 'C2_hipervolume', 'C3_dim_frente', 'C4_nao_agendadas', 'custo_inicial_greedy', 'tempo_ate_melhor_s', 'M5_tempo_s', 'iteracoes_ou_geracoes', 'avaliacoes'];
  const l = [cab.join(';')];
  const fx = (v, d) => (v == null ? '' : String(+Number(v).toFixed(d)).replace('.', ','));
  for (const r of dados.s1) l.push(['Solução 1', r.seed, r.m1, r.hard, fx(r.f[0], 2), fx(r.f[1], 5), fx(r.ocupacao * 100, 2), r.f[2], r.furos, r.salaUc, r.f[3], fx(r.F, 2), fx(r.hv, 6), 1, r.nao, fx(r.custoInicial, 2), fx(r.tMelhor / 1000, 2), fx(r.ms / 1000, 2), r.it, ''].join(';'));
  for (const r of dados.s2) l.push(['Solução 2', r.seed, r.m1, r.hard, fx(r.f[0], 2), fx(r.f[1], 5), fx(r.ocupacao * 100, 2), r.f[2], r.furos, r.salaUc, r.f[3], fx(r.F, 2), fx(r.hv, 6), r.dimFrente, r.nao, fx(r.custoInicial, 2), fx(r.tMelhor / 1000, 2), fx(r.ms / 1000, 2), r.geracoes, r.avaliacoes].join(';'));
  const m = dados.manual;
  l.push(['Horário manual', '', m.m1, m.hard, fx(m.f[0], 2), fx(m.f[1], 5), fx(m.ocupacao * 100, 2), m.f[2], m.furos, m.salaUc, m.f[3], fx(m.F, 2), '', '', m.nao, '', '', '', '', ''].join(';'));
  return '﻿' + l.join('\n') + '\n';
}

function relatorio(dados, res) {
  const M_ = dados.meta, t = res.tabela13;
  const g = (id) => res.metricas.find((x) => x.id === id);
  const L = [];
  L.push(`# Resultados das experiências (${M_.instancia})`, '');
  L.push(`Instância ${M_.instancia}: ${M_.aulasLivres} aulas a horarizar (${M_.horarioBase}); ${M_.aulasFixas ? `${M_.aulasFixas} aulas de outros cursos com turmas partilhadas ficam fixas e ${M_.reservasDeOutrosCursos} aulas dos restantes cursos ocupam as salas. ` : 'Todas as aulas de todos os cursos são horarizadas de novo. '}${M_.sessoesPontuais ? `${M_.sessoesPontuais} sessões pontuais (seminários de 5 h em 1 a 3 semanas, mais longos do que o maior bloco de 4h30) não contam como aulas: mantêm o dia, a hora e a sala do Manual e não entram nas métricas. ` : ''}${M_.aulasSemBlocoPossivel ? `${M_.aulasSemBlocoPossivel} aulas duram mais do que um bloco de 4h30 e não cabem na grelha. ` : ''}Orçamento T = ${M_.T} s por execução, sementes ${M_.sementes[0]}–${M_.sementes[1]}, ${M_.grelha}. Ambiente: Node ${M_.ambiente.node}, ${M_.ambiente.cpu} (${M_.ambiente.nucleos} núcleos).`, '');
  const umaS2 = dados.s2.length === 1;
  L.push(`## Tabela 13 – Indicadores multiobjetivo por abordagem (${dados.s1.length} execuções da Solução 1${umaS2 ? ', 1 da Solução 2' : ` e ${dados.s2.length} da Solução 2`})`, '');
  L.push('| Abordagem | Hipervolume (média ± dp) | Dimensão da frente (média ± dp) | Execuções com f₁ mínimo (%) |', '|---|---|---|---|');
  L.push(`| Solução 1 (Greedy + Simulated Annealing) | ${n0(t.s1.hv[0], 4)} ± ${n0(t.s1.hv[1], 4)} | 1 | ${n0(t.s1.f1min, 1)} |`);
  L.push(`| Solução 2 (NSGA-II) | ${n0(t.s2.hv[0], 4)} ± ${n0(t.s2.hv[1], 4)} | ${n0(t.s2.frente[0], 1)} ± ${n0(t.s2.frente[1], 1)} | ${n0(t.s2.f1min, 1)} |`, '');
  L.push(`f₁ mínimo observado: ${n0(t.f1min, 1)}. Objetivos normalizados entre o mínimo e o máximo observados nas duas abordagens, ponto de referência r = (1,1; 1,1; 1,1; 1,1).`, '');
  L.push('## Tabela 14 – Comparação com o horário manual do ISCTE (medianas)', '');
  L.push('| Métrica | Horário manual | Solução 1 | Solução 2 |', '|---|---|---|---|');
  for (const [id, nome, d] of [['M1', 'M1 Conflitos', 0], ['HARD', 'Violações obrigatórias', 0], ['M2', 'M2 Taxa de ocupação (%)', 1], ['M3', 'M3 Furos', 0], ['M6', 'M6 Aulas seguidas da mesma UC em salas diferentes', 0], ['M4', 'M4 Aulas fora da mancha', 0], ['C1', 'C1 Custo total F(x)', 0], ['C4', 'C4 Aulas não agendadas', 0]]) {
    const x = g(id);
    L.push(`| ${nome} | ${n0(x.manual, d)} | ${n0(x.s1.mediana, d)} | ${n0(x.s2.mediana, d)} |`);
  }
  L.push('', '## Testes estatísticos (Solução 1 vs Solução 2)', '');
  L.push(umaS2
    ? 'A Solução 2 corre uma só vez: parte sempre do mesmo horário construído pelo Greedy determinístico, e nenhuma geração o melhora no orçamento T, pelo que repetir as execuções daria o mesmo resultado. Compara-se a sua melhor solução (a de menor f₁ na frente) com as 30 execuções da Solução 1: teste de Wilcoxon de postos sinalizados para uma amostra, bilateral, nível de significância de 5%, correção de Holm sobre as métricas testadas. Â12 = proporção de execuções da Solução 1 com valor maior do que o da Solução 2 (0,5 = sem diferença).'
    : 'Mann-Whitney bilateral, nível de significância de 5%, correção de Holm sobre as métricas testadas. Â12 = probabilidade de uma execução da Solução 1 ter valor maior do que uma da Solução 2 (0,5 = sem diferença).', '');
  L.push('| Métrica | Sentido | Solução 1 mediana [Q1–Q3] | Solução 2 mediana [Q1–Q3] | p | p (Holm) | Â12 | Efeito |', '|---|---|---|---|---|---|---|---|');
  for (const x of res.metricas) {
    const d = x.id === 'C2' ? 4 : (x.id === 'M2' || x.id === 'TB' || x.id === 'M5') ? 1 : 0;
    L.push(`| ${x.id} ${x.nome} | ${x.sentido} é melhor | ${n0(x.s1.mediana, d)} [${n0(x.s1.q1, d)}–${n0(x.s1.q3, d)}] | ${n0(x.s2.mediana, d)} [${n0(x.s2.q1, d)}–${n0(x.s2.q3, d)}] | ${x.pHolm == null ? '—' : pfmt(x.p)} | ${x.pHolm == null ? '—' : pfmt(x.pHolm) + (x.signif ? ' *' : '')} | ${x.pHolm == null ? '—' : n0(x.a12, 2)} | ${x.pHolm == null ? 'orçamento igual' : x.magnitude} |`);
  }
  L.push('', '## H4 – Correlação de Spearman entre objetivos nas frentes da Solução 2', '');
  L.push('| Par | ρ (todas as soluções não dominadas) | n | p (Holm) | Mediana de ρ por execução | Execuções com ρ < 0 |', '|---|---|---|---|---|---|');
  for (const x of res.spearman) L.push(`| ${x.par} | ${n0(x.rho, 3)} | ${x.n} | ${pfmt(x.pHolm)}${x.conflito ? ' (conflito)' : ''} | ${n0(x.medianaPorExecucao, 3)} | ${x.execucoesNegativas} de ${x.execucoes} |`);
  L.push('', '## Outros registos', '');
  L.push(`- Solução 1: custo mediano do Greedy inicial ${n0(res.s1Inicial.mediana)}; o Simulated Annealing baixa-o em ${n0(res.s1Inicial.melhoriaMediana * 100, 1)}% (mediana).`);
  L.push(`- Solução 2: ${n0(res.s2Info.geracoes)} gerações e ${n0(res.s2Info.avaliacoes)} avaliações por execução (medianas).`);
  L.push('- Dados brutos de cada execução: anexo-H.csv (Anexo H).');
  return L.join('\n') + '\n';
}

module.exports = { analisar, anexoH, relatorio, mannWhitney, holm, spearman, mediana };
