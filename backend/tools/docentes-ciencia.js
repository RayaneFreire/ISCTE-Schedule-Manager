/* Recolhe os docentes do Ciência-Iscte (https://ciencia.iscte-iul.pt/authors/index/A ... Z) e as UCs que cada um
   lecionou num ano e semestre (por omissão 2022/2023, 1.º semestre), a partir da tabela "Atividades Letivas" de
   https://ciencia.iscte-iul.pt/authors/<perfil>/teaching.
   Guarda o nome, a categoria, o departamento, a escola, o endereço do perfil e as UCs (código, nome, cursos e se é
   coordenador). Não recolhe emails nem outros contactos.
   Uso (Node 18 ou mais recente, num computador com acesso ao site):
     node tools/docentes-ciencia.js [saida.json] [ano=2022/2023] [semestre=1] [pasta de cache=.cache-ciencia]
   O resultado importa-se na app em Dados > Importar > Docentes do Ciência-Iscte. */
const fs = require('fs');
const path = require('path');

const saida = process.argv[2] || 'docentes-2022-23.json';
const ANO = process.argv[3] || '2022/2023';
const SEM = String(process.argv[4] || '1');
const CACHE = process.argv[5] || '.cache-ciencia';
const BASE = 'https://ciencia.iscte-iul.pt';
const PAUSA_MS = 300, PARALELO = 4;

fs.mkdirSync(CACHE, { recursive: true });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function obter(url) {
  const f = path.join(CACHE, url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_') + '.html');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ISCTE Schedule Manager (trabalho académico)' } });
      if (r.status === 404) return '';
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      fs.writeFileSync(f, html);
      await dorme(PAUSA_MS);
      return html;
    } catch (e) {
      if (t === 3) { console.error('Falhou', url, e.message); return ''; }
      await dorme(1000 * 2 ** t);
    }
  }
  return '';
}

const texto = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// Perfis listados no índice de uma letra (os dois blocos: primeiro e último nome).
function perfisDoIndice(html) {
  const out = new Map();
  const re = /href="((?:https:\/\/ciencia\.iscte-iul\.pt)?\/authors\/(?!index)([a-z0-9-]+))"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2];
    const nome = texto(m[3]);
    if (!nome || out.has(slug)) continue;
    const curto = /\(([^)]+)\)\s*$/.exec(nome);
    out.set(slug, { slug, nomeCompleto: nome.replace(/\s*\([^)]*\)\s*$/, ''), nome: curto ? curto[1] : nome });
  }
  return out;
}

// Linhas da tabela "Atividades Letivas": ano, semestre, UC (ligação ao fenix-mais), cursos, coordenador.
// O endereço da UC pode ter mais de um hífen (ex.: /courses/02497-0-847452882078406).
function atividades(html) {
  const out = [];
  for (const tr of html.split(/<tr\b[^>]*>/i).slice(1)) {
    const linha = tr.split(/<\/tr>/i)[0];
    const tds = linha.split(/<td\b[^>]*>/i).slice(1).map((x) => x.split(/<\/td>/i)[0]);
    if (tds.length < 3) continue;
    const cel = tds.map((x) => texto(x));
    const iAno = cel.findIndex((c) => /^\d{4}\/\d{4}$/.test(c));
    const link = /href="(https?:\/\/fenix[^"]*\/courses\/([a-z0-9]+)-[0-9-]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(linha);
    if (iAno < 0 || !link) continue;
    const sem = (cel.find((c, k) => k > iAno && /^[12]\s*º/.test(c)) || '').charAt(0);
    const iUc = cel.findIndex((c) => c === texto(link[3]));
    out.push({
      ano: cel[iAno], semestre: sem, codigo: link[2].toUpperCase(), nome: texto(link[3]), url: link[1],
      cursos: iUc >= 0 && cel[iUc + 1] && cel[iUc + 1] !== '--' ? cel[iUc + 1] : null,
      coordenador: iUc >= 0 ? /^sim$/i.test(cel[iUc + 2] || '') : false,
    });
  }
  return out;
}

// Categoria, departamento e escola, tirados do cabeçalho do perfil.
function perfil(html) {
  const t = texto(html);
  const categoria = (/(Professor(?:a)? (?:Catedrátic[oa]|Associad[oa]|Auxiliar|Adjunt[oa]|Coordenador[a]?|Convidad[oa]|Emérit[oa])(?: Convidad[oa])?(?: \(com Agregação\))?|Assistente(?: Convidad[oa])?|Leitor(?:a)?|Investigador(?:a)? (?:Principal|Auxiliar|Coordenador[a]?|Júnior|Convidad[oa]))/.exec(t) || [])[1] || null;
  const departamento = (/(Departamento de [^()|]+?)\s*\(/.exec(t) || /(Departamento de [A-ZÀ-Úa-zà-ú ,]+)/.exec(t) || [])[1] || null;
  const escola = (/\((ISTA|IBS|ECSH|ESPP)\)/.exec(t) || [])[1] || null;
  return { categoria, departamento: departamento ? departamento.trim() : null, escola };
}

(async () => {
  const perfis = new Map();
  for (const letra of 'abcdefghijklmnopqrstuvwxyz') {
    const html = await obter(`${BASE}/authors/index/${letra}`);
    for (const [k, v] of perfisDoIndice(html)) if (!perfis.has(k)) perfis.set(k, v);
    console.log(`Letra ${letra.toUpperCase()}: ${perfis.size} perfis`);
  }
  const lista = [...perfis.values()];
  const docentes = [];
  let feitos = 0;
  async function trabalhador() {
    while (lista.length) {
      const p = lista.shift();
      const html = await obter(`${BASE}/authors/${p.slug}/teaching`);
      const ucs = atividades(html).filter((a) => a.ano === ANO && a.semestre === SEM);
      if (ucs.length) {
        const uniq = new Map();
        for (const u of ucs) {
          const x = uniq.get(u.codigo);
          if (!x) uniq.set(u.codigo, { codigo: u.codigo, nome: u.nome, cursos: u.cursos, coordenador: u.coordenador });
          else { x.coordenador = x.coordenador || u.coordenador; if (u.cursos && !x.cursos) x.cursos = u.cursos; }
        }
        docentes.push(Object.assign({ nome: p.nome, nomeCompleto: p.nomeCompleto, url: `${BASE}/authors/${p.slug}` }, perfil(html), { ucs: [...uniq.values()] }));
      }
      if (++feitos % 100 === 0) console.log(`${feitos} perfis lidos, ${docentes.length} com UCs em ${ANO} ${SEM}.º semestre`);
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabalhador));
  docentes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const out = { fonte: `${BASE}/authors/index/A`, recolhidoEm: new Date().toISOString(), ano: ANO, semestre: Number(SEM), perfisLidos: perfis.size, docentes };
  fs.writeFileSync(saida, JSON.stringify(out, null, 1));
  console.log(`Gravado ${saida}: ${docentes.length} docentes com UCs em ${ANO}, ${SEM}.º semestre.`);
})();
