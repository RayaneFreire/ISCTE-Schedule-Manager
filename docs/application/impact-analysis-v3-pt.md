# ISCTE Schedule Manager: análise de impacto e alterações de 19/10/2026

## 1. Dependências e impactos (antes de implementar)

| Pedido | Base de dados | Lógica / API interna | Permissões | Dashboards e interface |
|---|---|---|---|---|
| Nomes ("Horário ISCTE (Manual)", "Proposta de Horário", "ISCTE Schedule Manager") | Nomes dos horários e do conjunto de dados na carga inicial; chave do IndexedDB passou a v3 para não misturar com a base antiga | Ferramenta de importação e nomes dos CSV exportados | — | Todos os títulos, relatórios, comparação, painel geral, login |
| Estudante = MIG-A1 | Conta ligada à turma MIG-A1 | Todas as consultas de aulas filtram pela turma da conta, independentemente da vista pedida | Novas permissões `horarios.consultar`, `salas.pesquisar`, `planeamento.ver`; o estudante não tem nenhuma | Menu só com "O meu horário", "As minhas UCs" e "Conta"; detalhe de aula simplificado; sem legenda nem marcas de violação; removido "Só são visíveis horários publicados." |
| Docente sem "Atividade recente" | — | — | — | Bloco removido para contas ligadas a docente ou turma |
| PL = Pós-Laboral | Nova coluna `turma.regime` | Importação reconhece PL no código da turma (também no meio, "-PL-"; antes só no fim); mancha horária passa a ser por turma | — | Tipo de aula "Prática laboratorial" eliminado; regime mostrado como "Pós-Laboral (PL)" |
| Comparação | — | Indicadores calculados da mesma forma para qualquer par de horários | — | Texto "do horário A para o horário B"; tabela de indicadores com contagem de melhores e piores |
| Eventos e datas especiais | Tabelas `evento` e `evento_aula`; colunas `aula.reposicao_de` e `aula.evento_id` | Novo `repor()` no motor; feriados do calendário incluem eventos de dia inteiro | Nova permissão `eventos.gerir` (gestor de horários) | Nova página com formulário, lista de eventos e aulas suspensas/reagendadas |
| Regras | `MUDANCA_EDIFICIO` desativada; `ESTABILIDADE_SALA` apagada | Motor deixa de calcular a estabilidade de sala | — | Página de regras |
| Otimizado melhor que o Manual | — | Nova fase 4 no gerador (equilíbrio de ocupação das salas) | — | Painel geral e comparação com 11 indicadores |

## 2. Evidência sobre PL

- Nos códigos de **turma**, "PL" marca pós-laboral: cerca de 90% das aulas dessas turmas são à noite. Há 38 códigos com PL; com a correção ficam 183 turmas em regime pós-laboral. As aulas fora da mancha horária desceram de 950 para 384 porque a mancha passou a ser por turma.
- Nos códigos de **turno** (por exemplo `L0705PL13`), o sufixo PL aparece sobretudo em aulas de dia de turmas diurnas, por isso não pode significar pós-laboral. Ficou como "tipo não indicado" em vez de "Prática laboratorial".

## 3. Horário ISCTE (Manual) vs Horário Otimizado (240 s)

| Indicador | Manual | Otimizado |
|---|---|---|
| Violações de regras obrigatórias | 2152 | 865 |
| Regras obrigatórias com falhas (a vermelho) | 5 | 5 |
| Aulas em sobrelotação | 703 | 185 |
| Estudantes sem lugar sentado | 5664 | 501 |
| Aulas em sala do tamanho certo | 62% | 86% |
| Lugares vazios por aula | 23 | 13 |
| Desequilíbrio da ocupação (coef. de variação) | 59% | 58% |
| Aulas sem sala | 740 | 19 |
| Pedidos de sala não cumpridos | 288 | 155 |
| Qualidade global (custo, menor é melhor) | 3 211 509 | 1 653 630 |

O Otimizado é melhor ou igual em todos. As regras a vermelho ficam em 5 porque três delas (sobreposição de turma, aulas seguidas da mesma UC, e capacidade em 50 aulas sem sala grande livre a essa hora) só se resolvem mudando dias e horas.

## 4. Eventos: comportamento e pressupostos

- O evento suspende as aulas dessa data (dia inteiro ou só no período indicado).
- Cada aula é reagendada na mesma semana ou nas três seguintes. Prefere a hora e a sala originais e nunca aceita conflitos de turma, docente ou sala, nem falta de lugares.
- As reposições vão para uma versão em rascunho (nova ou existente) que segue o fluxo normal de aprovação. Remover o evento desfaz tudo.
- Teste: Festa do Caloiro em 02/10/2026 (sexta), 388 aulas suspensas, 385 reagendadas, 3 sinalizadas sem data compatível (laboratórios muito ocupados).

## 5. Sugestões de melhoria

1. **Bloqueio real no servidor.** A app corre no browser, por isso o bloqueio do estudante é feito na interface e nas consultas. Num sistema real, as mesmas permissões têm de estar numa API com autenticação no servidor (SSO do ISCTE).
2. **Dados de docentes.** Sem docentes no ficheiro, o otimizador só muda salas. Com docentes, pode mudar horas e baixar as 5 regras a vermelho.
3. **Data de início do semestre.** Foi assumida 14/09/2026; convém confirmar com o calendário oficial, porque afeta feriados e eventos.
4. **Sufixo PL nos turnos.** Confirmar com o professor o significado (ficou "tipo não indicado").
5. **Notificações.** Avisar docentes e turmas afetados quando um evento reagenda aulas.
