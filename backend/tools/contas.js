/* Gera as contas de demonstração (sal + hash PBKDF2-SHA256) para js/schema.js.
   Uso: node tools/contas.js  (imprime o bloco a colar em schema.js) */
const crypto = require('crypto');
const ITER = 100000;
const contas = [
  ['admin', 'Administração de sistemas (demo)', 'admin'],
  ['gestor', 'Gabinete de horários (demo)', 'gestor'],
  ['curso', 'Direção de curso (demo)', 'curso'],
  ['docente', 'Docente (demo)', 'docente'],
  ['estudante', 'Estudante (demo)', 'estudante'],
  ['espacos', 'Gestão de espaços (demo)', 'espacos'],
];
const rows = contas.map(([u, n, p]) => {
  const senha = u + '2026!';
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(senha, sal, ITER, 32, 'sha256').toString('hex');
  return `    [${JSON.stringify(u)}, ${JSON.stringify(n)}, ${JSON.stringify(p)}, '${sal}', '${hash}', ${JSON.stringify(senha)}],`;
});
console.log(`  const PBKDF2_ITER = ${ITER};\n  // username, nome, perfil, sal, hash (PBKDF2-SHA256), senha de demonstração mostrada no ecrã de entrada\n  const contasDemo = [\n${rows.join('\n')}\n  ];`);
