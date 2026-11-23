# Dados

| Pasta | Conteúdo |
|---|---|
| `source/` | Ficheiros CSV originais disponibilizados no âmbito do projeto: caracterização das salas (`Projeto 1 - Gestao de Horarios do ISCTE - CaracterizaçãoDasSalas.csv`) e horário de exemplo (`Projeto 1 - Gestao de Horarios do ISCTE - HorarioDeExemplo.csv`) |
| `schedules/` | Horário manual do ISCTE e Horário Otimizado para o 1.º semestre de 2022/23, exportados no formato CSV do ISCTE, com uma linha por aula e data, bem como o resumo da importação (`resumo-importacao.json`) |
| `teachers/` | Docentes por unidade curricular recolhidos do diretório público Ciência-Iscte (`docentes-2022-23.json`): nome, categoria, departamento, escola, URL do perfil e unidades curriculares. Não contém endereços de correio eletrónico |
| `experiments/` | Resultados de 30 execuções da Solução 1 e 30 execuções da Solução 2 (T = 300 s, seeds 1001–1030): execuções brutas (`runs.json`), análise (`resultados.json` e `resultados.md`) e tabela por execução (`anexo-H.csv`, Anexo H do relatório) |

O conjunto de dados predefinido utilizado pela aplicação é gerado a partir destes ficheiros e guardado em `frontend/js/data-iscte.js`.
