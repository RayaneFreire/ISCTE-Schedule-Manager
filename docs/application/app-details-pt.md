# ISCTE Schedule Manager: protótipo da aplicação (itens 1, 2 e 3)

Aplicação web que corre toda no browser: base de dados SQLite (sql.js), motor de regras e gerador de horários em JavaScript. Um único conjunto de dados: a **Proposta de Horário** do ISCTE (os CSV enviados pelo professor). As UCs são exatamente as do CSV, com o nome do CSV e o código real (prefixo do turno); não há siglas nem UCs inventadas.

Nomes usados na aplicação: **Proposta de Horário** = os dados importados dos CSV; **Horário ISCTE (Manual)** = o horário tal como veio na proposta; **Horário Otimizado** = a versão melhorada pelo gerador. **PL = Pós-Laboral** (regime da turma), nunca um tipo de aula.

## Como abrir

- Demo publicada: https://claude.ai/artifact/TuSZssVpmWrEw1uxN1wHP4
- Localmente: servir a pasta em `localhost` ou https (por exemplo `python3 -m http.server` dentro de `app/` e abrir `http://localhost:8000/`). O login usa `crypto.subtle`, que o browser só oferece em contexto seguro. Precisa de internet para carregar o sql.js do jsDelivr.
- A base de dados fica no IndexedDB do browser (uma por conjunto de dados). "Repor dados iniciais" volta ao início.

## Conjuntos de dados

- **ISCTE 2022/23 · Proposta de Horário** (predefinido): os dois CSV do professor (horário de exemplo de 2022/23 e caracterização das salas), no calendário de 2022/23 do próprio ficheiro (semana 1 a 12/09/2022; feriados 5/10, 1/11, 1/12 e 8/12/2022), construídos por `tools/build-iscte.js`. Inclui os docentes reais do Ciência-Iscte (atividades letivas de 2022/23, 1.º semestre), integrados por `tools/integrar-docentes.js` a 21/11/2026 (ver "Docentes do Ciência-Iscte"); o docente fictício foi retirado.
- A demonstração com dados fictícios foi retirada da aplicação (19/10), para não aparecerem UCs que não existem no CSV. Das 759 UCs do CSV, 12 só têm aulas fora do 1.º semestre (janeiro a abril de 2023) e por isso não entram neste horário.

## Contas, perfis e governação

| Utilizador | Senha | Perfil |
|---|---|---|
| admin | admin2026! | Administrador (contas, perfis, permissões, registo; vê todos os pedidos e reservas e decide em substituição de um aprovador ausente, com justificação) |
| gestor | gestor2026! | Gestor de horários |
| curso | curso2026! | Direção de curso (LEI) |
| docente | docente2026! | Docente (ligado ao docente com mais turnos atribuídos sem estimativa) |
| estudante | estudante2026! | Estudante da turma MIG-A1 (só vê o horário publicado da sua turma) |
| espacos | espacos2026! | Gestão de espaços |

- Senhas só como hash PBKDF2-SHA256 (100 000 iterações, sal por conta); bloqueio de 15 min após 5 falhas; sessão termina após 30 min sem atividade; uma senha temporária obriga a mudar na entrada seguinte.
- Permissões por perfil (17 permissões × 6 perfis), editáveis pelo administrador.
- **Segregação de funções** (`SCHEMA.incompatibilidades`): gestão de horários × gestão de espaços, submeter × aprovar, administração × alteração de horários. Nunca no mesmo perfil nem com a mesma pessoa (contas com o mesmo nome); a aplicação recusa e regista a tentativa.
- Fluxo: rascunho → em revisão → aprovado (por outra pessoa) → publicado (o anterior do semestre é arquivado). Só se editam rascunhos. Docentes e estudantes só veem horários publicados. O estudante não tem consultas, pesquisa de salas, reservas nem áreas de espaços; mudar de vista à força cai na sua página, e as consultas à base de dados filtram pela sua turma. O detalhe de aula que vê mostra só UC, docente, horário, sala, tipo de aula e informação académica (sem pedidos do docente, características da sala, violações nem alertas). Os docentes não têm "Atividade recente". Pedidos de alteração com decisão do gabinete.
- Registo de auditoria só de acréscimo (triggers na base de dados).
- É um protótipo: num sistema real a autenticação seria no servidor, com SSO institucional.

## Escopo (Proposta de Escopo)

- Gestão de salas: "Salas e características", "Ocupação", "Pesquisa de salas", "Reservas".
- Gestão académica: professores, UCs e turmas ("Gestão académica").
- Criação de aulas com UC, professor, turma, sala, data, hora de início e de fim ("Criar aula"). Antes de gravar valida sala ocupada, conflito de professor, conflito de turma e capacidade: estas bloqueiam (pode forçar-se com justificação, que fica no registo); os critérios de qualidade só avisam. O mesmo vale para arrastar ou editar aulas no horário.
- Consultas por sala, por professor e por turma ("Consultar horários").

## Horário ISCTE (Manual) e Horário Otimizado

`tools/build-iscte.js` importa a Proposta de Horário e valida o Horário ISCTE (Manual). O Horário Otimizado é gerado por `node tools/gerar-otimizado.js <sql-wasm.js> 600 1001`: Solução 1 completa (dias, horas e salas de todas as aulas, com os docentes do Ciência-Iscte), seguida da reposição das aulas que calham em feriados. Execução de 22/11/2026, com os blocos de aulas seguidas: violações obrigatórias 2222 → 180, conflitos (turma, docente, sala) 444 → 29, blocos separados 0, aulas seguidas da mesma UC em salas diferentes 192 → 137. As 5 sessões pontuais (seminários de 5 h em 1 a 3 semanas, mais longos do que o maior bloco de 4h30) não contam como aulas: ficam com o dia, a hora e a sala do Manual, ocupam a sala, mas não são validadas nem mudadas. A tabela seguinte é de uma versão antiga (só salas, calendário de 2026/27); os valores atuais estão na página "Comparar horários":

| Indicador | Manual | Otimizado |
|---|---|---|
| Violações de regras obrigatórias | 2152 | 865 |
| Aulas em sobrelotação | 703 | 185 |
| Estudantes sem lugar sentado (soma) | 5664 | 501 |
| Aulas em sala do tamanho certo | 62% | 86% |
| Lugares vazios por aula (média) | 23 | 13 |
| Desequilíbrio da ocupação das salas (coef. de variação) | 59% | 58% |
| Aulas sem sala que precisam de sala | 740 | 19 |
| Pedidos de laboratório/sala especializada não cumpridos | 36 | 24 |
| Outros pedidos de sala não cumpridos | 252 | 131 |
| Salas demasiado grandes | 1011 | 269 |
| Qualidade global (custo ponderado) | 3 211 509 | 1 653 630 |
| Sobreposições de sala | 0 | 0 |

As regras obrigatórias com falhas continuam a ser 5 nos dois: as sobreposições de turma (369) e as sequências longas da mesma UC (403) dependem de dias e horas, e ficam 50 aulas sem sala com lugares suficientes nessa hora.

## Cenários e feriados

- **Cenários**: todos os perfis (incluindo docente e estudante) podem alternar entre o Horário ISCTE (Manual) e o Horário Otimizado, no seletor "Horário" ou nos botões "Cenário" no topo das páginas de horário, para ver como o seu horário fica em cada um.
- **Aulas em feriados**: cada feriado do semestre fica registado como evento do tipo "Feriado" e as aulas desse dia passam para uma semana posterior. Primeiro tenta prolongar a aula (mesmo dia, hora e sala) para a semana a seguir à sua última; se não der, procura outra data posterior sem conflitos. Em 2022/23 os feriados calham a quarta (5/10), terça (1/11) e quinta (1/12 e 8/12): 733 aulas afetadas e 725 repostas no Manual (259 prolongadas); no Otimizado, gerado pela Solução 1, as reposições são refeitas depois da geração; as restantes ficam assinaladas sem data compatível. Os dois horários ISCTE já vêm tratados; num rascunho novo o gestor usa "Repor aulas dos feriados" na página de eventos.

## Eventos e datas especiais

Página "Eventos e datas especiais" (gestor de horários). Um evento (Festa do Caloiro, Dia Aberto, cerimónia, conferência...) num dia inteiro ou num período suspende as aulas dessa data e reagenda cada uma (`E.repor`): procura a mesma semana e as três seguintes, prefere a hora e a sala originais e só aceita posições sem violar regras obrigatórias (turma, docente, sala, capacidade). As reposições ficam numa versão em rascunho, que segue o fluxo de aprovação. Remover o evento desfaz tudo. 

CSV no formato do ISCTE (uma linha por aula e data) em `dados/`: `horario-2022-23-iscte-manual.csv`, `horario-2022-23-otimizado.csv` e `resumo-importacao.json`.

## Estrutura

```
index.html              estilos e estrutura da página
js/schema.js            esquema SQL, regras, perfis, permissões, incompatibilidades e contas de demonstração
js/data-iscte.js        dados do ISCTE 2022/23 e os dois horários (tools/build-iscte.js)
js/data-experiencias.js resultados das 30 + 30 execuções (tools/experiencias.js)
js/importer.js          leitura dos CSV do ISCTE, adaptação do calendário e exportação no mesmo formato
js/model.js             acesso à base de dados e tradução do modelo relacional para o motor
js/engine.js            motor de regras (semanas, feriados, características), pesquisa de salas e gerador
js/app.js               interface: login, menu por permissões e todas as vistas
tools/experiencias.js   node tools/experiencias.js <sql-asm.js> <pasta> [T=300] [curso=TODOS] [semente=1001] [execuções=30]  (SEM_S2=1 salta a Solução 2)
tools/estatisticas.js   hipervolume, Mann-Whitney + Holm, Â12, Spearman, Tabelas 13 e 14, Anexo H
tools/docentes-ciencia.js  node tools/docentes-ciencia.js [saida.json] [2022/2023] [1]  (recolha do Ciência-Iscte)
tools/build-iscte.js    node tools/build-iscte.js <sql-asm.js> <HorarioDeExemplo.csv> <Caracterização.csv> [segundos] [pastaCSV]
tools/contas.js         gera os hashes das contas de demonstração
```

## Item 1: fontes de informação

Catálogo editável (tabela `fonte`) com informação, tabelas do modelo onde entra, fonte, responsável, formato, método, periodicidade, RGPD e estado da recolha. Importação de CSV para qualquer tabela, exportação CSV e verificações de qualidade (UCs sem componentes, turnos sem docente, etc.).

## Item 2: modelo de dados e regras

Tabelas: `curso`, `uc`, `plano_estudos`, `turma`, `docente`, `tipo_sala`, `edificio`, `sala`, `tipo_aula`, `componente`, `turno`, `turno_turma`, `docencia`, `horario`, `aula`, `evento`, `evento_aula`, `disponibilidade`, `reserva`, `regra`, `fonte`, `registo`, e as vistas `v_aula` e `v_aula_turma`. O diagrama ER e o dicionário de dados são gerados a partir do esquema real.

As regras são dados (tabela `regra`), por isso evoluem sem reprogramar:
1. **Parâmetros** em JSON (por exemplo `MAX_SEGUIDAS_UC.max_min = 180`, a regra das 3 horas do enunciado).
2. **Tipo e peso**: obrigatória (hard) ou critério de qualidade (soft).
3. **Regras novas em SQL**: uma consulta sobre as vistas que devolve `aula_id` e `mensagem`, com `:horario` como parâmetro.

Regras do motor: sobreposição de sala, docente e turma; aulas seguidas da mesma UC acima do limite; capacidade (inscritos × participação esperada); indisponibilidade do docente; aulas por agendar; fora da mancha horária; tipo de sala diferente do pedido; sala demasiado grande; mudança de edifício (desativada por decisão do grupo); furos; duas aulas do mesmo turno no mesmo dia; horas por dia; preferências do docente; carga semanal; alterações face ao horário base.

## Item 3: geração

1. **Construção gulosa**: coloca primeiro as aulas mais difíceis (mais turmas, poucas salas compatíveis, docentes com restrições) na posição de menor custo.
2. **Arrefecimento simulado**: move aulas, troca salas e troca aulas entre si; o custo é avaliado de forma incremental por entidade (turma, docente, sala, turno, aula).
3. **Melhoria de salas sem mexer nos tempos**.
4. **Equilíbrio da ocupação**: passa aulas das salas mais usadas para salas equivalentes menos usadas, só quando nenhuma regra fica pior.

O utilizador escolhe as regras ativas, o tipo e o peso de cada uma, dias, grelha de horas, tempo e semente, e se quer refazer tudo ou melhorar um horário existente com poucas mudanças. Aulas marcadas como fixas não se movem.

## Trabalho final: Solução 1, Solução 2 e experiências

- **Aulas seguidas na mesma sala** (regra de qualidade `MESMA_SALA_UC`, peso 10): aulas seguidas da mesma UC para a mesma turma, no mesmo dia (intervalo até 30 min), devem ficar na mesma sala. Os dois algoritmos usam a sala da aula "irmã" como candidata; na Solução 2 a regra conta no objetivo f₃ (furos + mudanças de sala). Casos: 192 no Manual, 137 no Otimizado, 100 na Solução 1 (mediana) e 163 na Solução 2.

- **Blocos de aulas seguidas** (regra obrigatória `BLOCO_SEPARADO`): aulas da mesma UC e turma seguidas no mesmo dia no Manual (intervalo até 30 min) formam um bloco que os algoritmos movem junto (mesmo dia, mesma distância entre aulas, de preferência a mesma sala). Cada bloco soma no máximo 3 h por semana (a regra `MAX_SEGUIDAS_UC` continua a contar) e ocupa no máximo 4h30. 1 591 blocos. Na edição manual, mover uma aula de um bloco move as outras.

- **Solução 1** (Greedy + Simulated Annealing, mono-objetivo F(x), obrigatórias × 1000): o gerador acima. Em modo "Refazer tudo", com ruído 1 controlado pela semente; regista o custo do Greedy inicial e o tempo até à melhor solução.
- **Solução 2** (NSGA-II, `E.nsga2`): quatro objetivos a minimizar, f₁ penalizações obrigatórias ponderadas, f₂ = 1 − média de min(1, esperados/capacidade), f₃ furos ≥ 60 min, f₄ aulas fora da mancha. População 40 (Greedy com ruído controlado pela semente, como na Solução 1, + variantes com 3% a 28% das aulas recolocadas, sala entre as 8 mais indicadas), torneio binário por nível e aglomeração, cruzamento uniforme 0,9, mutação 2/n_l por aula (recolocar 50%, sala 30%, troca com aula de igual duração 20%), sobreviventes (μ + λ), paragem no orçamento T. Devolve a primeira frente e escolhe a solução com menor f₁ (desempate pelo menor F). Disponível em "Gerar horário" (Algoritmo: Solução 2), com um curso no âmbito.
- **Instância (21/11/2026)**: o horário completo do Horário ISCTE (Manual) de 2022/23, 6 209 aulas de todos os cursos, com os docentes do Ciência-Iscte (`tools/experiencias.js`, curso `TODOS` por omissão; uma sigla de curso restringe a instância a esse curso).
- **Experiências** (`tools/experiencias.js`): T = 300 s por execução (a construção pelo Greedy demora ~80 s com 6 209 aulas), blocos de 90 min, segunda a sexta. Solução 1: 30 execuções, sementes 1001–1030. Solução 2: 30 execuções com as mesmas sementes (22/11/2026); a população inicial parte do Greedy com o ruído dessa semente, ou seja, do mesmo horário inicial da execução correspondente da Solução 1. A melhor solução de cada execução da Solução 2 (menor f₁ na frente) é comparada com as 30 da Solução 1 pelo teste de Mann-Whitney (Wilcoxon de soma de postos) com correção de Holm e Â12; a Solução 1 correu num Xeon a 2,30 GHz e a Solução 2 num Xeon a 2,10 GHz (3 execuções em paralelo); Spearman entre objetivos na frente (H4). Resultados em `experiencias/` (`resultados.md`, `anexo-H.csv`, `runs.json`) e na página "Experiências".

## Docentes do Ciência-Iscte

`tools/docentes-ciencia.js` percorre o índice de autores (A a Z) de https://ciencia.iscte-iul.pt/authors/index/A, lê a tabela "Atividades Letivas" de cada perfil e guarda os docentes com UCs em 2022/2023, 1.º semestre: nome, categoria, departamento, escola, endereço do perfil e UCs (código do fenix-mais, nome, cursos, coordenador). Não guarda emails. O JSON importa-se em "Dados e modelo › Importar › Docentes do Ciência-Iscte": só se usam as UCs do CSV (pelo código); uma UC com um só docente fica com ele em todos os turnos; com vários, os turnos são distribuídos sem sobreposições e marcados como estimativa (`turno.docente_estimado`), porque o site não diz que turno cada um dá. A tabela `docencia` guarda a relação UC–docente tal como está no site. O site não é acessível a partir do ambiente onde a app foi construída; a recolha foi feita num computador do grupo a 21/11/2026 (`dados/docentes-2022-23.json`). Alguns endereços de UC no fenix-mais têm mais de um hífen (corrigido na ferramenta).

`tools/integrar-docentes.js` (`node tools/integrar-docentes.js <sql.js dist/sql-wasm.js> dados/docentes-2022-23.json`) aplica a mesma importação aos dados por omissão (`js/data-iscte.js`), sem gerar de novo os horários: aulas, dias, horas e salas ficam iguais, e os resultados em `experiencias/` não mudam.

| Indicador | Valor |
|---|---|
| Perfis lidos no diretório | 2647 |
| Docentes com UCs em 2022/23, 1.º semestre | 496 |
| Docentes importados (com UCs na Proposta de Horário) | 445 (353 com categoria, 338 com departamento) |
| UCs com docente (de 747) | 556 |
| UCs do Ciência-Iscte sem correspondência | 196 |
| Turnos com docente (de 1706) | 1288 |
| dos quais atribuídos por estimativa | 773 |
| Turnos sem docente livre (ficam por atribuir) | 9 |

As UCs com um só docente são atribuídas primeiro; numa UC com vários, um turno sem nenhum docente livre fica sem docente em vez de criar uma sobreposição. Com os docentes, a validação passa a contar sobreposições de docente (75 no Manual, todas em UCs com um só docente no site; nenhuma no Otimizado, gerado pela Solução 1) e excesso de carga semanal (57 em ambos). As indisponibilidades e preferências continuam vazias.

## Pontos em aberto do documento, já tratados

- **Pedidos de alteração**: a lista mostra o impacto de cada pedido nas regras (violações novas obrigatórias e de qualidade, e as que resolve) no rascunho onde seria aplicado; um pedido que viola regras obrigatórias não pode ser aprovado, só rejeitado.
- **Menus por perfil**: a "Ocupação de salas" passou a ser só da Gestão de espaços.

## Conhecimento usado da literatura

- **Martins (2014)**, *Melhoramentos na pesquisa de salas em software de geração de horários*, U.Porto: critérios de adequação de sala (tipo, capacidade próxima dos alunos, penalização de lugares vazios), mesmo edifício entre aulas seguidas, estabilidade de sala, ordenação dos eventos por peso, e a fase de melhoria de salas que não move eventos no tempo. Usados no motor, na pesquisa de salas da gestão de espaços e na fase 3 do gerador.
- **Müller, Rudová e Müllerová (2018)**, ITC 2019: separação entre restrições obrigatórias e critérios ponderados, e o modelo de dados (salas, turmas/turnos, tempos possíveis, estudantes).
- **UniTime**: ideia de importar os dados dos sistemas académicos para um modelo próprio.
