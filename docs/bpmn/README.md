# Diagramas BPMN

Esta pasta contém os diagramas BPMN desenvolvidos para representar o processo de gestão dos horários académicos do ISCTE.

## Fase A — Preparação e Validação dos Dados Académicos

Representa o processo de recolha, organização e validação dos dados necessários para a construção dos horários. Inclui a informação relativa a cursos, unidades curriculares, turmas, docentes, salas, disponibilidade de recursos e preferências dos docentes. Após a verificação da consistência e completude dos dados, a informação validada é disponibilizada para a Fase B.

Ficheiros:
- `fase_a_preparacao_e_validacao_dos_dados_academicos.bpmn` — ficheiro editável em formato BPMN 2.0;
- `fase_a_preparacao_e_validacao_dos_dados_academicos.png` — versão para visualização.

## Fase B — Geração e Validação dos Horários

Representa o processo de construção de uma proposta de horário, a atribuição dos recursos necessários e a verificação das restrições definidas. Inclui a validação da disponibilidade das salas, dos docentes e das turmas, bem como da capacidade das salas. Caso sejam identificados conflitos ou incompatibilidades, a proposta é ajustada e novamente validada. Quando não existem conflitos, o horário é consolidado e disponibilizado para a Fase C.

Ficheiros:
- `fase_b_geracao_e_validacao_dos_horarios.bpmn` — ficheiro editável em formato BPMN 2.0;
- `fase_b_geracao_e_validacao_dos_horarios.png` — versão para visualização.

## Fase C — Aprovação e Publicação dos Horários

Representa o processo de análise e aprovação do horário validado. O gestor académico verifica a consistência final e confirma o cumprimento das regras de negócio. Caso o horário não seja aprovado, são solicitados ajustamentos e este é devolvido à Fase B para nova validação. Quando aprovado, o sistema consolida a versão final e publica o horário para consulta por sala, docente e turma.

Ficheiros:
- `fase_c_aprovacao_e_publicacao_dos_horarios.bpmn` — ficheiro editável em formato BPMN 2.0;
- `fase_c_aprovacao_e_publicacao_dos_horarios.png` — versão para visualização.
