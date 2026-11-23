# Base de Dados

A aplicação utiliza uma base de dados SQLite, através de sql.js, criada no navegador e armazenada no IndexedDB. O esquema contém 32 tabelas.

- `schema.sql`: esquema completo, extraído de `frontend/js/schema.js`, que constitui a fonte principal. Para voltar a gerar este ficheiro:

  ```bash
  node -e "require('fs').writeFileSync('database/schema.sql', require('./frontend/js/schema.js').DDL)"
  ```

- `frontend/js/model.js`: consultas à base de dados e transformação do modelo relacional para o motor de otimização.

## Principais áreas

| Área | Tabelas |
|---|---|
| Núcleo académico | `curso`, `uc`, `plano_estudos`, `turma`, `docente`, `docencia`, `tipo_aula`, `componente`, `turno`, `turno_turma` |
| Salas | `edificio`, `tipo_sala`, `sala`, `caracteristica`, `sala_caracteristica`, `reserva` |
| Horários e calendário | `calendario`, `feriado`, `horario`, `aula`, `evento`, `evento_aula`, `disponibilidade` |
| Regras e configuração | `regra`, `parametro`, `fonte` |
| Governação e auditoria | `perfil`, `permissao`, `perfil_permissao`, `utilizador`, `pedido`, `registo` |

Os nomes das tabelas e das colunas estão em português, de acordo com o domínio da aplicação. Os diagramas ER encontram-se no relatório, no Anexo C.
