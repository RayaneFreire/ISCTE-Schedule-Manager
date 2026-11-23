# Testes

O ficheiro `verify-results.js` contém um teste de regressão. Este teste volta a calcular a análise estatística a partir das execuções brutas guardadas em `data/experiments/runs.json` e verifica se:

- `resultados.json` e `anexo-H.csv` correspondem aos resultados publicados;
- `frontend/js/data-experiencias.js`, utilizado na página *Experiências* da aplicação, permanece inalterado;
- o horário manual continua a apresentar 444 conflitos, 2 222 violações obrigatórias e 740 aulas não agendadas segundo as regras atuais.

```bash
npm install
npm test
```

O teste demora apenas alguns segundos e não altera nenhum ficheiro do repositório.
