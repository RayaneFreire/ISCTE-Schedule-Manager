# Backend

The application has no server: all logic runs in the browser (`frontend/js/`). This folder holds the Node.js tools that build the data, run the experiments and produce the statistics. They load the same engine as the browser (`frontend/js/engine.js`), so results are identical in both.

Run them from the repository root after `npm install`. `SQL` below is `node_modules/sql.js/dist/sql-asm.js`.

| Tool | Usage |
|---|---|
| `tools/experiencias.js` | `node backend/tools/experiencias.js SQL data/experiments [T=300] [course=TODOS] [seed=1001] [runs=30]` runs Solution 1 and Solution 2 and writes the results. `SO_ANALISE=1` only redoes the analysis from `runs.json`; `SO_S2=1` / `SEM_S2=1` run only or skip Solution 2 |
| `tools/estatisticas.js` | statistics library: hypervolume, Mann-Whitney + Holm, Â12, Spearman, result tables |
| `tools/gerar-otimizado.js` | `node backend/tools/gerar-otimizado.js SQL 600 1001` generates the Optimized Schedule in `frontend/js/data-iscte.js` |
| `tools/build-iscte.js` | `node backend/tools/build-iscte.js SQL <timetable.csv> <rooms.csv> [seconds] [csvDir]` imports ISCTE's timetable proposal and builds `frontend/js/data-iscte.js` |
| `tools/docentes-ciencia.js` | `node backend/tools/docentes-ciencia.js [out.json] [2022/2023] [1]` collects teachers per course unit from the public Ciência-Iscte directory |
| `tools/integrar-docentes.js` | `node backend/tools/integrar-docentes.js SQL data/teachers/docentes-2022-23.json` adds the teachers to the default dataset without changing the schedules |
| `tools/reotimizar-salas.js` | reassigns only the rooms of the Optimized Schedule |
| `tools/build-sample.js` | builds the small demo dataset |
| `tools/contas.js` | generates the PBKDF2 hashes of the demo accounts |

Code comments and console output are in Portuguese.
