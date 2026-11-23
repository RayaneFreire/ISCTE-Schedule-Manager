# Resultados das experiências (Horário completo (todos os cursos))

Instância Horário completo (todos os cursos): 6209 aulas a horarizar (2022/23 · 1.º sem. · Horário ISCTE (Manual)); Todas as aulas de todos os cursos são horarizadas de novo. 5 sessões pontuais (seminários de 5 h em 1 a 3 semanas, mais longos do que o maior bloco de 4h30) não contam como aulas: mantêm o dia, a hora e a sala do Manual e não entram nas métricas. Orçamento T = 300 s por execução, sementes 1001–1030, blocos de 90 min, segunda a sexta. Ambiente: Node v22.23.5, Intel(R) Xeon(R) Processor @ 2.30GHz (Solução 1) e @ 2.10GHz (Solução 2) (4 núcleos).

## Tabela 13 – Indicadores multiobjetivo por abordagem (30 execuções da Solução 1 e 30 da Solução 2)

| Abordagem | Hipervolume (média ± dp) | Dimensão da frente (média ± dp) | Execuções com f₁ mínimo (%) |
|---|---|---|---|
| Solução 1 (Greedy + Simulated Annealing) | 0,2056 ± 0,0353 | 1 | 3,3 |
| Solução 2 (NSGA-II) | 0,3576 ± 0,0366 | 39,8 ± 0,5 | 0,0 |

f₁ mínimo observado: 261 083,3. Objetivos normalizados entre o mínimo e o máximo observados nas duas abordagens, ponto de referência r = (1,1; 1,1; 1,1; 1,1).

## Tabela 14 – Comparação com o horário manual do ISCTE (medianas)

| Métrica | Horário manual | Solução 1 | Solução 2 |
|---|---|---|---|
| M1 Conflitos | 444 | 26 | 810 |
| Violações obrigatórias | 2222 | 172 | 963 |
| M2 Taxa de ocupação (%) | 72,0 | 77,1 | 82,0 |
| M3 Furos | 468 | 1230 | 1384 |
| M6 Aulas seguidas da mesma UC em salas diferentes | 192 | 100 | 222 |
| M4 Aulas fora da mancha | 398 | 618 | 914 |
| C1 Custo total F(x) | 3 351 652 | 280 385 | 1 633 706 |
| C4 Aulas não agendadas | 740 | 0 | 0 |

## Testes estatísticos (Solução 1 vs Solução 2)

Mann-Whitney bilateral, nível de significância de 5%, correção de Holm sobre as métricas testadas. Â12 = probabilidade de uma execução da Solução 1 ter valor maior do que uma da Solução 2 (0,5 = sem diferença).

| Métrica | Sentido | Solução 1 mediana [Q1–Q3] | Solução 2 mediana [Q1–Q3] | p | p (Holm) | Â12 | Efeito |
|---|---|---|---|---|---|---|---|
| M1 Conflitos (HC1–HC3) | menor é melhor | 26 [22–28] | 810 [799–828] | < 0,001 | < 0,001 * | 0,00 | grande |
| HARD Violações obrigatórias (total) | menor é melhor | 172 [168–175] | 963 [953–980] | < 0,001 | < 0,001 * | 0,00 | grande |
| M2 Taxa de ocupação (%) | maior é melhor | 77,1 [76,8–77,2] | 82,0 [81,9–82,1] | < 0,001 | < 0,001 * | 0,00 | grande |
| M3 Furos | menor é melhor | 1230 [1168–1273] | 1384 [1350–1406] | < 0,001 | < 0,001 * | 0,03 | grande |
| M6 Aulas seguidas da mesma UC em salas diferentes | menor é melhor | 100 [93–104] | 222 [211–227] | < 0,001 | < 0,001 * | 0,00 | grande |
| M4 Aulas fora da mancha | menor é melhor | 618 [594–631] | 914 [891–941] | < 0,001 | < 0,001 * | 0,00 | grande |
| F1 f₁ (penalização obrigatória) | menor é melhor | 270 450 [266 475–275 154] | 1 618 317 [1 597 212–1 647 179] | < 0,001 | < 0,001 * | 0,00 | grande |
| C1 Custo total F(x) | menor é melhor | 280 385 [276 548–284 557] | 1 633 706 [1 612 999–1 662 577] | < 0,001 | < 0,001 * | 0,00 | grande |
| C2 Hipervolume | maior é melhor | 0,2126 [0,1826–0,2277] | 0,369 [0,3285–0,386] | < 0,001 | < 0,001 * | 0,00 | grande |
| C4 Aulas não agendadas | menor é melhor | 0 [0–0] | 0 [0–0] | 1,00 | 1,00 | 0,50 | desprezável |
| TB Tempo até à melhor solução (s) | menor é melhor | 281,6 [280,2–284,6] | 60,4 [58,1–64,3] | < 0,001 | < 0,001 * | 1,00 | grande |
| M5 Tempo de execução (s) | menor é melhor | 294,3 [293,9–295,7] | 300,1 [300,0–300,1] | — | — | — | orçamento igual |

## H4 – Correlação de Spearman entre objetivos nas frentes da Solução 2

| Par | ρ (todas as soluções não dominadas) | n | p (Holm) | Mediana de ρ por execução | Execuções com ρ < 0 |
|---|---|---|---|---|---|
| f1 × f2 | -0,948 | 1193 | < 0,001 (conflito) | -0,988 | 30 de 30 |
| f1 × f3 | 0,931 | 1193 | < 0,001 | 0,97 | 0 de 30 |
| f1 × f4 | 0,743 | 1193 | < 0,001 | 0,886 | 0 de 30 |
| f2 × f3 | -0,913 | 1193 | < 0,001 (conflito) | -0,975 | 30 de 30 |
| f2 × f4 | -0,716 | 1193 | < 0,001 (conflito) | -0,913 | 30 de 30 |
| f3 × f4 | 0,711 | 1193 | < 0,001 | 0,91 | 0 de 30 |

## Outros registos

- Solução 1: custo mediano do Greedy inicial 1 634 698; o Simulated Annealing baixa-o em 82,7% (mediana).
- Solução 2: 105 gerações e 4203 avaliações por execução (medianas).
- Dados brutos de cada execução: anexo-H.csv (Anexo H).
