# ISCTE Schedule Manager

## Descrição

Projeto desenvolvido no âmbito da unidade curricular de **Otimização e Decisão em Engenharia de Software**, no ISCTE.

O ISCTE Schedule Manager é uma aplicação web para apoiar a gestão e a otimização de horários académicos. A solução permite importar e consultar dados académicos, identificar conflitos, avaliar a qualidade dos horários e produzir propostas de horário através de técnicas de Search-Based Software Engineering (SBSE).

O projeto compara duas abordagens de otimização:

- **Solução 1:** construção Greedy seguida de Simulated Annealing;
- **Solução 2:** NSGA-II, baseado em otimização multiobjetivo.

## Equipa

- Rayane Santos
- Ângela Matsinhe
- Vera Antsiferova

## Objetivos

- apoiar a geração e a otimização de horários académicos;
- identificar conflitos e violações das restrições definidas;
- melhorar a utilização das salas e dos recursos académicos;
- comparar diferentes soluções de horário através de métricas de qualidade;
- apoiar os gestores académicos no processo de decisão;
- disponibilizar informação adequada aos diferentes perfis de utilizador.

## Perfis de Utilizador

- Administrador;
- Gestor de Horários;
- Gestor de Espaços;
- Diretor de Curso;
- Docente;
- Estudante.

## Estrutura do Projeto

```text
ISCTE-Schedule-Manager/
├── backend/              ferramentas Node.js para importação, experiências e análise estatística
├── frontend/             aplicação web, motor de regras e algoritmos de otimização
├── database/             esquema da base de dados SQLite
├── data/                 dados de origem, horários, docentes e resultados experimentais
├── docs/
│   ├── application/      documentação técnica e funcional da aplicação
│   ├── architecture/     diagramas de arquitetura e modelos de dados
│   ├── articles/         artigos científicos, normas e referências
│   ├── bpmn/             diagramas BPMN e respetivos ficheiros editáveis
│   ├── presentation/     materiais de apresentação
│   ├── report/           relatório final do projeto
│   └── requirements/     requisitos funcionais e não funcionais
├── prototypes/           documentação do protótipo funcional
├── testes/               testes de regressão dos resultados experimentais
├── package.json          dependências e comandos do projeto
└── README.md
```

## Tecnologias e Métodos

- HTML, CSS e JavaScript;
- SQLite através de sql.js;
- IndexedDB para armazenamento no navegador;
- Node.js para as ferramentas de apoio e execução das experiências;
- Greedy e Simulated Annealing;
- NSGA-II;
- BPMN 2.0;
- modelos Entidade–Relacionamento;
- GitHub para gestão dos artefactos do projeto.

A aplicação é executada integralmente no navegador e não possui um servidor de backend próprio.

## Funcionalidades Principais

### Gestão de Horários

- consulta, importação e exportação de horários;
- geração e otimização de propostas de horário;
- identificação de conflitos e violações;
- comparação da qualidade de diferentes horários;
- aprovação, publicação e gestão de alterações.

### Gestão de Salas e Recursos

- consulta da disponibilidade das salas;
- verificação da capacidade e das características necessárias;
- apoio à atribuição e à otimização da ocupação das salas.

### Análise e Resultados

- configuração de restrições, critérios e pesos;
- apresentação de indicadores de qualidade;
- comparação experimental das duas abordagens de otimização;
- análise estatística dos resultados obtidos.

## Execução

Requer Node.js 18 ou uma versão posterior.

```bash
npm install
npm start
```

A aplicação fica disponível em `http://localhost:8080`.

Para executar os testes de regressão:

```bash
npm test
```

Para reproduzir a análise estatística ou as experiências:

```bash
npm run analysis
npm run experiments
```

As experiências completas podem demorar várias horas.

## Documentação

A documentação técnica, os requisitos, os diagramas BPMN, os modelos de dados, as referências e o relatório encontram-se na pasta `docs/`.

Os dados utilizados e os resultados das experiências encontram-se na pasta `data/`.

## Estado do Projeto

Versão final do projeto académico, desenvolvida para fins educacionais.
