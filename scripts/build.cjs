// Bundles web/src -> public/. Needs: npm install (esbuild, marked, highlight.js)
//   node scripts/build.cjs            code-split ES modules, content-hashed files in public/assets/, pre-compressed .br/.gz
//   node scripts/build.cjs --single   one classic script (public/app.js + app.css), the old layout (fallback for very old WebViews)
//   add --dev to skip minification
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public');
const single = process.argv.includes('--single');
const APP_VERSION = require('../package.json').version;
const target = ['chrome105', 'edge105', 'firefox110', 'safari16'];

const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const compress = (file) => {
  const buf = fs.readFileSync(file);
  if (buf.length < 1024) return;
  fs.writeFileSync(file + '.br', zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
  fs.writeFileSync(file + '.gz', zlib.gzipSync(buf, { level: 9 }));
};
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const common = { absWorkingDir: root, bundle: true, minify: !process.argv.includes('--dev'), legalComments: 'none', logLevel: 'warning', target, metafile: true, define: { __APP_VERSION__: JSON.stringify(APP_VERSION) } };
  let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  rm(path.join(out, 'assets'));
  for (const f of ['app.js', 'app.css', 'index.html', 'sw.js']) for (const x of ['', '.br', '.gz']) rm(path.join(out, f + x));

  if (single) {
    await esbuild.build({ ...common, entryPoints: ['web/src/main.js'], outfile: 'public/app.js', format: 'iife' });
    await esbuild.build({ ...common, entryPoints: ['web/src/style.css'], outfile: 'public/app.css' });
  } else {
    const js = await esbuild.build({ ...common, entryPoints: { app: 'web/src/main.js' }, outdir: 'public/assets', entryNames: '[name]-[hash]', chunkNames: 'c-[name]-[hash]', format: 'esm', splitting: true });
    const css = await esbuild.build({ ...common, entryPoints: { app: 'web/src/style.css' }, outdir: 'public/assets', entryNames: '[name]-[hash]' });
    const find = (m, src) => Object.keys(m.metafile.outputs).find((k) => m.metafile.outputs[k].entryPoint === src);
    const entryJs = find(js, 'web/src/main.js');
    const entryCss = find(css, 'web/src/style.css');
    // modulepreload the entry's static imports so the browser fetches them in parallel
    const pre = (js.metafile.outputs[entryJs].imports || []).filter((i) => i.kind === 'import-statement').map((i) => path.basename(i.path));
    html = html
      .replace('href="app.css"', `href="assets/${path.basename(entryCss)}"`)
      .replace('<script src="app.js" defer></script>', [...pre.map((f) => `<link rel="modulepreload" href="assets/${f}">`), `<script type="module" src="assets/${path.basename(entryJs)}"></script>`].join('\n'));
  }
  // PWA: static files (manifest, icons), then the service worker listing exactly what the shell is
  html = html.replace('</head>', '<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#131720">\n<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n<meta name="mobile-web-app-capable" content="yes">\n</head>');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  rm(path.join(out, 'icons'));
  fs.cpSync(path.join(root, 'web/static'), out, { recursive: true });
  {
    const shell = ['/', '/index.html', '/manifest.webmanifest', ...walk(out).map((f) => '/' + path.relative(out, f).split(path.sep).join('/')).filter((u) => /^\/(assets\/.+\.(js|css)|icons\/.+\.png)$/.test(u))];
    const uniq = [...new Set(shell)].sort();
    const version = require('node:crypto').createHash('sha256').update(uniq.map((u) => (u.endsWith('/') ? 'root' : fs.readFileSync(path.join(out, u === '/index.html' ? 'index.html' : u))) ).join('\n')).digest('hex').slice(0, 12);
    fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync(path.join(root, 'web/sw.template.js'), 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(uniq)));
  }
  if (!process.env.VERCEL) for (const f of [...walk(out)].filter((f) => /\.(js|css|html)$/.test(f))) compress(f); // Vercel compresses by itself
  const sizes = walk(out).filter((f) => /\.(js|css|html)$/.test(f) && !f.includes('node_modules')).map((f) => [path.relative(out, f), fs.statSync(f).size, fs.existsSync(f + '.br') ? fs.statSync(f + '.br').size : 0]).sort((a, b) => b[1] - a[1]);
  for (const [f, s, b] of sizes.slice(0, 40)) console.log(`${f.padEnd(44)} ${(s / 1024).toFixed(1).padStart(7)} KB   br ${(b / 1024).toFixed(1).padStart(6)} KB`);
  console.log(single ? 'built public/ (single script)' : 'built public/ (code-split modules)');
})().catch((e) => { console.error(e); process.exit(1); });
