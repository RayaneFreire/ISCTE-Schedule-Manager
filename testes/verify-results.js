/* Regression check: recomputes the statistical analysis from the raw runs
   (data/experiments/runs.json) and checks that it matches the published results
   (data/experiments/resultados.json) and the frontend data (frontend/js/data-experiencias.js).
   Usage: node testes/verify-results.js   (after npm install) */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const root = path.join(__dirname, '..');
const sql = path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-asm.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ism-'));
fs.copyFileSync(path.join(root, 'data', 'experiments', 'runs.json'), path.join(tmp, 'runs.json'));
const appData = path.join(root, 'frontend', 'js', 'data-experiencias.js');
const before = fs.readFileSync(appData, 'utf8');
cp.execFileSync(process.execPath, [path.join(root, 'backend', 'tools', 'experiencias.js'), sql, tmp, '300', 'TODOS', '1001', '30'],
  { env: Object.assign({}, process.env, { SO_ANALISE: '1' }), stdio: 'inherit' });
let ok = true;
const same = (a, b, name) => { const r = a === b; console.log((r ? 'OK   ' : 'FAIL ') + name); ok = ok && r; };
same(fs.readFileSync(path.join(tmp, 'resultados.json'), 'utf8'), fs.readFileSync(path.join(root, 'data', 'experiments', 'resultados.json'), 'utf8'), 'resultados.json');
same(fs.readFileSync(path.join(tmp, 'anexo-H.csv'), 'utf8'), fs.readFileSync(path.join(root, 'data', 'experiments', 'anexo-H.csv'), 'utf8'), 'anexo-H.csv');
same(fs.readFileSync(appData, 'utf8'), before, 'frontend/js/data-experiencias.js');
const m = JSON.parse(fs.readFileSync(path.join(tmp, 'runs.json'), 'utf8')).manual;
same(m.m1 + '/' + m.hard + '/' + m.nao, '444/2222/740', 'manual schedule: conflicts 444, hard violations 2222, unscheduled 740');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
