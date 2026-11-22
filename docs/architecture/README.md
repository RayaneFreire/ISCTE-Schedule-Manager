# Arquitetura

Esta pasta contém os diagramas que descrevem a arquitetura e o modelo de dados do **ISCTE Schedule Manager**.

- `figura_01_arquitetura_plataforma.png` — arquitetura geral da aplicação, incluindo as fontes CSV, a recolha de docentes do Ciência-Iscte, a importação, a camada de dados e o motor de otimização.
- `figura_01_arquitetura_plataforma.svg` — versão vetorial editável da Figura 1.
- `figura_02_modelo_er_nucleo_academico.png` — modelo entidade–relação do núcleo académico e dos dados dos docentes.
- `figura_02_modelo_er_nucleo_academico.svg` — versão vetorial editável da Figura 2.
- `figura_03_modelo_er_salas.png` — modelo entidade–relação das salas e respetivas características.
- `figura_04_modelo_er_horarios.png` — modelo entidade–relação dos horários, aulas, eventos e disponibilidades.
- `figura_05_modelo_er_governacao.png` — modelo entidade–relação dos utilizadores, perfis, permissões, pedidos, registos e regras.

As Figuras 1 e 2 foram atualizadas para refletir a importação descrita nas secções 5.2 e 5.3 do relatório. Os elementos destacados a amarelo representam os dados e relações acrescentados ou detalhados na nova secção sobre os docentes.

Antes da entrega final, os nomes dos campos devem ser confirmados com a implementação efetiva de `schema.js`.

