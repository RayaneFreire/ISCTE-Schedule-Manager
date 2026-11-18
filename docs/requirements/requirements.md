# Requisitos do ISCTE Schedule Manager

## 1. Objetivo

O ISCTE Schedule Manager tem como objetivo apoiar a preparação, geração, avaliação, consulta e gestão de horários académicos.

A plataforma trata a construção de horários como um problema de otimização. Para cada aula, os algoritmos procuram atribuir um dia, uma hora de início e uma sala, respeitando restrições obrigatórias e considerando critérios de qualidade.

## 2. Âmbito

O sistema constitui uma prova de conceito académica orientada para o contexto do ISCTE. O seu âmbito inclui:

- organização e consulta dos dados académicos;
- geração automática de propostas de horário;
- identificação de conflitos e violações;
- comparação entre versões de horário;
- apoio à aprovação e publicação;
- gestão de alterações durante o semestre;
- execução e avaliação das abordagens Greedy com Simulated Annealing e NSGA-II.

O protótipo não corresponde a uma plataforma pronta para utilização em produção.

## 3. Perfis de Utilizador

| Perfil | Responsabilidades principais |
|---|---|
| Administrador | Gerir utilizadores, perfis, permissões, regras e auditoria. |
| Gestor de Horários | Gerar, validar, alterar, submeter e publicar horários. |
| Gestor de Espaços | Consultar a disponibilidade, capacidade, características e ocupação das salas. |
| Direção de Curso | Analisar versões de horário, consultar indicadores e participar no processo de aprovação. |
| Docente | Consultar horários, registar preferências e indisponibilidades e apresentar pedidos de alteração. |
| Estudante | Consultar o horário e os detalhes das aulas. |

## 4. Requisitos Funcionais

### 4.1 Utilizadores e Permissões

| ID | Requisito |
|---|---|
| RF01 | A plataforma deve permitir a autenticação dos utilizadores. |
| RF02 | A plataforma deve apresentar funcionalidades de acordo com o perfil e as permissões do utilizador autenticado. |
| RF03 | O administrador deve poder gerir utilizadores, perfis e permissões. |
| RF04 | A plataforma deve aplicar separação de funções nas operações de submissão, aprovação e administração. |

### 4.2 Dados Académicos

| ID | Requisito |
|---|---|
| RF05 | A plataforma deve permitir importar dados académicos e dados de salas a partir de ficheiros estruturados. |
| RF06 | A plataforma deve permitir consultar cursos, unidades curriculares, turmas, turnos, docentes, salas e respetivas características. |
| RF07 | A plataforma deve validar a integridade e a completude dos dados necessários para a construção dos horários. |
| RF08 | A plataforma deve registar as fontes de informação e os problemas identificados durante a importação dos dados. |

### 4.3 Consulta e Validação de Horários

| ID | Requisito |
|---|---|
| RF09 | A plataforma deve permitir consultar horários por turma, docente e sala. |
| RF10 | A plataforma deve identificar conflitos de sala, docente e turma. |
| RF11 | A plataforma deve identificar outras violações obrigatórias, incluindo capacidade insuficiente, características essenciais em falta, indisponibilidade do docente e aulas não agendadas. |
| RF12 | A plataforma deve calcular critérios de qualidade, incluindo períodos mortos, ocupação das salas e aulas fora da mancha horária. |
| RF13 | A plataforma deve apresentar as violações e os indicadores de qualidade associados a cada versão de horário. |

### 4.4 Geração e Otimização

| ID | Requisito |
|---|---|
| RF14 | A plataforma deve permitir gerar uma proposta de horário através da combinação de Greedy e Simulated Annealing. |
| RF15 | A plataforma deve permitir executar a abordagem multiobjetivo NSGA-II. |
| RF16 | A plataforma deve permitir selecionar o âmbito, a grelha temporal, a semente e o orçamento de tempo da geração. |
| RF17 | A plataforma deve permitir configurar as regras, os pesos e os parâmetros utilizados na avaliação dos horários. |
| RF18 | A plataforma deve guardar os horários gerados como novas versões, sem eliminar o horário de referência. |
| RF19 | A plataforma deve permitir comparar versões de horário através das mesmas métricas. |
| RF20 | A plataforma deve apresentar os resultados experimentais, a evolução do custo e a Frente de Pareto quando aplicável. |

### 4.5 Alterações, Aprovação e Publicação

| ID | Requisito |
|---|---|
| RF21 | O Gestor de Horários deve poder criar e alterar aulas. |
| RF22 | A plataforma deve validar o impacto de uma alteração antes de a guardar. |
| RF23 | Docentes e responsáveis académicos devem poder apresentar pedidos de alteração. |
| RF24 | O Gestor de Horários deve poder analisar e decidir sobre os pedidos de alteração. |
| RF25 | A plataforma deve permitir submeter uma versão de horário para revisão. |
| RF26 | A Direção de Curso deve poder aprovar ou devolver uma versão com uma justificação. |
| RF27 | O Gestor de Horários deve poder publicar um horário aprovado. |
| RF28 | A plataforma deve conservar o histórico das versões publicadas e arquivadas. |

### 4.6 Salas, Calendário e Auditoria

| ID | Requisito |
|---|---|
| RF29 | A plataforma deve permitir pesquisar salas disponíveis e adequadas às necessidades de uma aula. |
| RF30 | A plataforma deve permitir gerir feriados e eventos académicos que afetem aulas. |
| RF31 | A plataforma deve apoiar a identificação e a reposição de aulas afetadas por eventos ou feriados. |
| RF32 | A plataforma deve manter um registo de auditoria das operações relevantes. |

## 5. Requisitos Não Funcionais

| ID | Requisito |
|---|---|
| RNF01 | O protótipo deve funcionar num navegador moderno. |
| RNF02 | A execução dos algoritmos não deve bloquear a interação com a interface. |
| RNF03 | A plataforma deve conservar localmente os dados necessários entre sessões do navegador. |
| RNF04 | A plataforma deve aplicar controlo de acesso baseado em perfis e permissões. |
| RNF05 | As palavras-passe não devem ser guardadas em texto simples. |
| RNF06 | A plataforma deve limitar tentativas de autenticação consecutivas e terminar sessões inativas. |
| RNF07 | A base de dados deve aplicar chaves, restrições de domínio e integridade referencial. |
| RNF08 | As experiências devem ser reproduzíveis através do registo das sementes, parâmetros, dados e ambiente de execução. |
| RNF09 | As duas abordagens de otimização devem ser avaliadas com os mesmos dados, regras e orçamento de tempo. |
| RNF10 | As alterações relevantes devem ser rastreáveis através do histórico de versões e do registo de auditoria. |
| RNF11 | O código deve separar a interface, o acesso aos dados e o motor de otimização em componentes identificáveis. |
| RNF12 | A interface deve apresentar de forma compreensível os conflitos, as métricas e os resultados dos algoritmos. |

## 6. Relação com os Processos BPMN

| Fase | Requisitos relacionados |
|---|---|
| Fase A - Preparação e validação dos dados | RF05 a RF08, RF29 e RF30. |
| Fase B - Geração e validação dos horários | RF09 a RF22 e RF31. |
| Fase C - Aprovação e publicação | RF23 a RF28 e RF32. |

## 7. Restrições e Limitações do Protótipo

- O protótipo é executado integralmente no navegador e não utiliza um servidor próprio.
- A persistência utiliza SQLite através de `sql.js` e IndexedDB.
- O protótipo não suporta utilização concorrente por vários utilizadores reais.
- A autenticação não está integrada com o sistema institucional do ISCTE.
- Os dados disponibilizados não incluem informação completa sobre docentes, pelo que foram utilizados docentes fictícios.
- Os pesos das restrições e alguns critérios de qualidade foram definidos experimentalmente pela equipa.
- A avaliação experimental foi realizada sobre uma instância académica específica e não representa todo o processo institucional do ISCTE.
- Uma versão de produção exigiria serviços de backend, persistência centralizada, autenticação institucional, monitorização e mecanismos de recuperação.
