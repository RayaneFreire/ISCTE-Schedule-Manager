# Frontend

Esta pasta contém a aplicação web completa. A aplicação é estática e executada no navegador. Para a abrir, deve utilizar-se um servidor HTTP, por exemplo através do comando `npm start` na raiz do repositório.

| Ficheiro | Função |
|---|---|
| `index.html` | Estrutura e estilos da página; carrega sql.js através da CDN jsDelivr |
| `js/app.js` | Interface: início de sessão, menus por permissão e todas as vistas da aplicação |
| `js/engine.js` | Motor de regras (semanas, feriados e características das salas), pesquisa de salas e algoritmos Greedy, Simulated Annealing e NSGA-II. É partilhado com as ferramentas Node.js da pasta `backend/` |
| `js/model.js` | Acesso à base de dados e transformação do modelo relacional para o motor de otimização |
| `js/schema.js` | Esquema SQL, regras, perfis, permissões e contas de demonstração; é a fonte de `database/schema.sql` |
| `js/importer.js` | Importa e exporta horários no formato CSV do ISCTE |
| `js/data-iscte.js` | Conjunto de dados predefinido: dados do ISCTE de 2022/23, incluindo os horários manual e otimizado; é gerado por `backend/tools/build-iscte.js` |
| `js/data-experiencias.js` | Resultados experimentais apresentados na página *Experiências*; é gerado por `backend/tools/experiencias.js` |
| `js/data.js`, `js/sample-horarios.js` | Pequeno conjunto de dados de demonstração |

Os dados são guardados no IndexedDB do navegador, separadamente para cada utilizador. O botão *Repor dados iniciais* permite restaurar o conjunto de dados predefinido.
