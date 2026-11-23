# Backend

A aplicação não possui um servidor: toda a lógica é executada no navegador, em `frontend/js/`. Esta pasta contém as ferramentas Node.js utilizadas para preparar os dados, executar as experiências e produzir as estatísticas. As ferramentas carregam o mesmo motor usado pelo navegador (`frontend/js/engine.js`), garantindo a utilização da mesma lógica em ambos os contextos.

Os comandos devem ser executados a partir da raiz do repositório, após `npm install`. Nos exemplos abaixo, `SQL` corresponde a `node_modules/sql.js/dist/sql-asm.js`.

| Ferramenta | Utilização |
|---|---|
| `tools/experiencias.js` | `node backend/tools/experiencias.js SQL data/experiments [T=300] [course=TODOS] [seed=1001] [runs=30]` executa as Soluções 1 e 2 e guarda os resultados. `SO_ANALISE=1` repete apenas a análise de `runs.json`; `SO_S2=1` e `SEM_S2=1` permitem executar apenas a Solução 2 ou ignorá-la |
| `tools/estatisticas.js` | Biblioteca estatística: hipervolume, Mann–Whitney com correção de Holm, Â12, Spearman e geração das tabelas de resultados |
| `tools/gerar-otimizado.js` | `node backend/tools/gerar-otimizado.js SQL 600 1001` gera o Horário Otimizado em `frontend/js/data-iscte.js` |
| `tools/build-iscte.js` | `node backend/tools/build-iscte.js SQL <timetable.csv> <rooms.csv> [seconds] [csvDir]` importa a proposta de horários do ISCTE e gera `frontend/js/data-iscte.js` |
| `tools/docentes-ciencia.js` | `node backend/tools/docentes-ciencia.js [out.json] [2022/2023] [1]` recolhe os docentes de cada unidade curricular a partir do diretório público Ciência-Iscte |
| `tools/integrar-docentes.js` | `node backend/tools/integrar-docentes.js SQL data/teachers/docentes-2022-23.json` adiciona os docentes ao conjunto de dados predefinido sem alterar os horários |
| `tools/reotimizar-salas.js` | Volta a atribuir apenas as salas do Horário Otimizado |
| `tools/build-sample.js` | Gera o pequeno conjunto de dados de demonstração |
| `tools/contas.js` | Gera os hashes PBKDF2 das contas de demonstração |

Os comentários do código e as mensagens apresentadas na consola estão em português.
