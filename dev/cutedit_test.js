// Tests for the CEP panel's cut editor (docs/dsgarage/CUT_EDIT_SPEC.md §9.1) on the emulated AE object model (dev/aeom.js).
//   node dev/cutedit_test.js              run every test (needs JIZURA_AE.jsx, and build/com.852wa.jizura from build_cep.py)
//   node dev/cutedit_test.js --baseline   rewrite dev/cutedit_baseline.json from the current engine (T-1: only on a known-good engine)
//   JZ_AE_JSX=<path> node dev/cutedit_test.js --baseline   … from another build of JIZURA_AE.jsx (e.g. the engine before a change)
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const AEOM = require('./aeom');
const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'cutedit_baseline.json');
const EXPORTS = 'thisObj.__jz = { jzMakePlan: jzMakePlan, jzBuild: jzBuild, log: function () { return JZLOG; }, JZ_DATA: JZ_DATA, JZ_REG: JZ_REG, jzOrder: jzOrder, jzMoodEnabled: jzMoodEnabled, jzParseJSON: jzParseJSON, jzFitContrast: jzFitContrast, jzMixHex: jzMixHex, jzKeyStyle: jzKeyStyle' +
  (process.argv.includes('--baseline') ? '' : ', jzCutCtx: jzCutCtx, JZ_CUTEDIT: JZ_CUTEDIT') + ' };\n})(this);';
const SRC = fs.readFileSync(process.env.JZ_AE_JSX || path.join(ROOT, 'JIZURA_AE.jsx'), 'utf8').replace(/^#target.*\n/, '').replace(/jzUI\(thisObj\);\s*\}\)\(this\);\s*$/, EXPORTS);
// ExtendScript is ES3: run the engine in a realm without ES5+ built-ins (same as dev/ae_test.js)
const ES3_PRELUDE = `(function(){
  function del(o, list) { for (var i = 0; i < list.length; i++) delete o[list[i]]; }
  del(Array.prototype, ['forEach','map','filter','some','every','reduce','reduceRight','indexOf','lastIndexOf','find','findIndex','includes','fill','flat','flatMap','keys','values','entries','copyWithin']);
  del(Array, ['isArray','from','of']);
  del(Object, ['keys','create','defineProperty','defineProperties','getPrototypeOf','freeze','seal','assign','entries','values','getOwnPropertyNames','fromEntries']);
  del(String.prototype, ['trim','trimStart','trimEnd','trimLeft','trimRight','includes','startsWith','endsWith','repeat','padStart','padEnd','codePointAt','normalize']);
  del(Function.prototype, ['bind']); del(Date, ['now']); del(String, ['fromCodePoint']);
  del(Math, ['sign','trunc','hypot','log2','log10','cbrt']);
  del(Number, ['isFinite','isNaN','isInteger','parseFloat','parseInt']);
  this.JSON = undefined;
}).call(this);`;
function load() {
  const env = AEOM.makeEnv({ fonts: () => true });
  for (const k of ['JSON', 'Math', 'Date', 'String', 'Number', 'Array', 'Object', 'RegExp', 'Error', 'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'encodeURIComponent', 'decodeURIComponent']) delete env.ctx[k];
  vm.createContext(env.ctx);
  vm.runInContext(ES3_PRELUDE, env.ctx);
  vm.runInContext(SRC, env.ctx, { filename: 'JIZURA_AE.jsx' });
  return { env, JZ: env.ctx.__jz };
}

// ---------------------------------------------------------------- results
let failed = 0;
const results = [];
function check(id, ok, detail) { results.push({ id, ok: !!ok }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`); }

// ---------------------------------------------------------------- fingerprint of everything a build made
// every comp: its settings, every layer (switches, timing, parent, source) and the whole property tree (values, expressions, keys)
function propTree(p) {
  const o = [p.matchName, p.name === p.matchName ? 0 : p.name, p.enabled === false ? 0 : 1];
  if (p._v !== undefined) o.push(p._v);
  if (p._expr) o.push('=' + p._expr, p.expressionEnabled ? 1 : 0);
  if (p.keys && p.keys.length) o.push(p.keys);
  if (p.children && p.children.length) o.push(p.children.map(propTree));
  return o;
}
function fingerprint(env) {
  const comps = env.comps.map(c => ({
    n: c.name, w: c.width, h: c.height, d: c.duration, f: c.frameRate, bg: c.bgColor,
    L: c._layers.map(L => ({ n: L.name, k: L.kindName, t: [L._startTime, L._in, L._out], sw: [L.enabled, L.blendingMode, L.adjustmentLayer, L.trackMatteType, L.label, L.shy, L.guideLayer, L.timeRemapEnabledFlag],
      par: L._parent ? c._layers.indexOf(L._parent) : -1, src: L.source ? (L.source.kind === 'solid' ? ['solid', L.source.color, L.source.width, L.source.height] : L.source.name) : null,
      p: L.children.map(propTree) })),
  }));
  const s = env.stats;
  return { comps: s.comps, layers: s.layers, exprs: s.exprs, animators: s.animators, effects: Object.values(s.effects).reduce((a, b) => a + b, 0),
    // numbers to 9 significant digits: the last bits of Math.* can differ between CPUs (arm64 / x86_64), the output of the engine does not
    hash: crypto.createHash('sha1').update(JSON.stringify(comps, (k, v) => (typeof v === 'number' ? +v.toPrecision(9) : v))).digest('hex') };
}

// ---------------------------------------------------------------- plans: every style x 3 seeds (the same set as dev/ae_test.js)
const LYRICS = '夜明けの色を/覚えてる\nほどけた声が遠くで鳴った\nねえ、まだ間に合うかな\n*透明*なままじゃ終われない!\n\n朝焼けのまま|asayake\nきっと届くよ\nGood night, またね';
function makePlan(JZ, style, seed, extra, wa) {
  const o = { lyrics: LYRICS, title: 'テスト', artist: 'me', style, seed, fx: { motion: 0.8, glitch: 0.7, chroma: 0.7, decor: 0.8, density: 0.6, texture: 0.6, bgSwitch: 0.5, onTwos: true, flash: true, hud: true },
    width: 1920, height: 1080, fps: 24, bpm: 0, starts: null, enabled: JZ.jzMoodEnabled(null, seed), offset: 0.4, lineScale: 1, duration: null, extra, wa };
  const plan = JZ.jzMakePlan(o); plan.hud = true;
  return plan;
}
const CASES = [[1, false, true], [7, true, true], [42, true, false]];
function buildAll() {
  const { JZ: J0 } = load(), out = {};
  for (const style of J0.JZ_DATA.styleOrder) for (const [seed, extra, wa] of CASES) {
    const { env, JZ } = load(), label = `${style}/${seed}${extra ? '+' : ''}${wa ? '' : '-wa'}`;
    try { JZ.jzBuild(makePlan(JZ, style, seed, extra, wa), {}); out[label] = fingerprint(env); }
    catch (e) { out[label] = { error: e.message }; }
  }
  return out;
}

if (process.argv.includes('--baseline')) {
  const out = buildAll();
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 1) + '\n');
  console.log('wrote', path.relative(ROOT, BASELINE), Object.keys(out).length, 'builds');
  process.exit(0);
}

// ---------------------------------------------------------------- T-1 / T-4c: the engine builds exactly what it built before (plans without cut.ov)
{
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')), now = buildAll(), diff = [];
  for (const k of Object.keys(base)) if (JSON.stringify(base[k]) !== JSON.stringify(now[k])) diff.push(k + ' ' + JSON.stringify(base[k]) + ' -> ' + JSON.stringify(now[k]));
  if (Object.keys(now).length !== Object.keys(base).length) diff.push('build count ' + Object.keys(base).length + ' -> ' + Object.keys(now).length);
  check('T-1/T-4c 回帰（ov なしの plan で出力が同一）', !diff.length, `${Object.keys(base).length} builds` + (diff.length ? '\n  ' + diff.slice(0, 5).join('\n  ') : ''));
}

// ---------------------------------------------------------------- the browser engine + cep/cutedit.js's plan logic (no CEP → only J.cutEdit's plan functions)
function loadBrowser() {
  const noop = () => {};
  const ctx2d = new Proxy({}, { get: (t, k) => k === 'measureText' ? (() => ({ width: 100, actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 10 }))
    : (k === 'getImageData' || k === 'createImageData') ? (() => ({ data: new Uint8ClampedArray(4) })) : (typeof k === 'string' && /^create/.test(k)) ? (() => ({ addColorStop: noop })) : noop, set: () => true });
  const el = () => ({ getContext: () => ctx2d, style: {}, width: 0, height: 0, appendChild: noop, addEventListener: noop, setAttribute: noop, classList: { add: noop, remove: noop, toggle: noop } });
  const g = { console, setTimeout, clearTimeout, performance, Uint8ClampedArray, Float32Array, Uint8Array, Map, Set, Promise, JSON, Math };
  g.window = g; g.self = g;
  g.document = { createElement: el, getElementById: () => null, querySelectorAll: () => [], head: { appendChild: noop }, fonts: { load: async () => [], ready: Promise.resolve() }, addEventListener: noop, readyState: 'complete' };
  g.localStorage = { getItem: () => null, setItem: noop };
  g.OffscreenCanvas = function () { return el(); }; g.Path2D = function () { return new Proxy({}, { get: () => noop }); };
  g.DOMMatrix = function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }; g.requestAnimationFrame = noop;
  vm.createContext(g);
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js') && f !== '12_ui.js').sort()) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), g, { filename: f });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'cep', 'cutedit.js'), 'utf8'), g, { filename: 'cutedit.js' });
  return g.J;
}
const J = loadBrowser(), CE = J.cutEdit;
const plain = o => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// a plan with cuts that have a transition and adjacent cuts that do not (for T-5)
let bproject, bplan;
for (let seed = 5; seed < 80; seed++) {
  bproject = Object.assign(J.defaultProject(), { title: 'テスト', seed, extra: true });
  bplan = J.plan(bproject, null);
  if (bplan.cuts.some((c, i) => i > 0 && c.trans) && bplan.cuts.some((c, i) => i > 0 && !c.trans && J.cutEdit.transOk(bplan.cuts[i - 1], c))) break;
}
const P = { W: bplan.W, H: bplan.H, style: bplan.style };
const header0 = { plan: plain(Object.assign({}, bplan, { cuts: undefined, events: undefined })), project: CE.packProject(bproject), cuts: [] };
const listOf = pl => pl.cuts.map(c => ({ base: plain(c), edit: {}, ev: plain(pl.events.filter(e => e.t >= c.start - 0.7 && e.t <= c.end)) }));

// ---------------------------------------------------------------- T-4: apply(base, edit)
{
  const errs = [], cuts = bplan.cuts.filter(c => c.layout !== 'title' && c.layout !== 'interlude'), base = plain(cuts[2]);
  if (!same(CE.apply(base, {}, P), base)) errs.push('empty edit != base');
  for (const [g, pk] of [['layout', 'params'], ['treat', 'treatP'], ['bg', 'bgP'], ['cam', 'camP']]) {
    const k = J.order(g).find(x => x !== base[g] && J.registry(g)[x] && !J.registry(g)[x].special && x !== 'title' && x !== 'interlude');
    const a = CE.apply(base, { [g]: k }, P), b = CE.apply(base, { [g]: k }, P);
    if (a[g] !== k) errs.push(g + ': key not set');
    if (!same(a, b)) errs.push(g + ': same key twice gave different params');
    for (const o of ['params', 'treatP', 'bgP', 'camP', 'transP']) if (o !== pk && !same(a[o], base[o])) errs.push(g + ': ' + o + ' changed');
    for (const o of ['layout', 'enter', 'hold', 'exit', 'treat', 'bg', 'cam', 'trans', 'decor', 'text']) if (o !== g && !same(a[o], base[o])) errs.push(g + ': ' + o + ' changed');
    const back = CE.apply(base, { [g]: base[g] }, P);
    if (!same(back, base)) errs.push(g + ': back to the original key != base');
  }
  const r1 = CE.apply(base, { roll: 1 }, P), r2 = CE.apply(base, { roll: 2 }, P);
  if (r1.layout !== base.layout || same(r1.params, base.params) && same(r2.params, base.params)) errs.push('roll did not re-plan params');
  const d = CE.apply(base, { decor: ['rings', null, 'bars'] }, P);
  if (!same(d.decor.map(x => x.id), ['rings', 'bars'])) errs.push('decor ids ' + JSON.stringify(d.decor.map(x => x.id)));
  const t = CE.apply(base, { text: 'あたらしい言葉' }, P);
  if (t.text !== 'あたらしい言葉' || t.lineText !== t.text || !t.words.length || !same(t.params, base.params)) errs.push('text');
  const ti = bplan.cuts.find(c => c.layout === 'title' || c.layout === 'interlude');
  if (ti && CE.apply(plain(ti), { layout: 'center' }, P).layout !== ti.layout) errs.push('title / interlude layout changed');
  check('T-4 apply: 1 項目だけ変わる・同じキーで同じ params・元の設定に戻せる', !errs.length, errs.join('; '));
}

// ---------------------------------------------------------------- T-5: transitions stay consistent
{
  const errs = [], list = listOf(bplan), H = header0;
  const it = bplan.cuts.findIndex((c, i) => i > 0 && c.trans);
  const iu = bplan.cuts.findIndex((c, i) => i > 0 && !c.trans && CE.transOk(bplan.cuts[i - 1], c));
  if (it < 0 || iu < 0) errs.push('test plan lacks cuts with / without a transition (' + it + ',' + iu + ')');
  else {
    const L1 = plain(list); L1[it].edit = { trans: null };
    const p1 = CE.effectivePlan(H, L1, null).hp;
    if (p1.cuts[it].trans !== null || !same(p1.cuts[it].transP, {}) || p1.cuts[it].transDur !== 0) errs.push('trans off: ' + JSON.stringify([p1.cuts[it].trans, p1.cuts[it].transDur]));
    if (p1.cuts[it].enter !== bplan.cuts[it].enter || p1.cuts[it - 1].exit !== bplan.cuts[it - 1].exit) errs.push('trans off: enter / exit should stay as generated');
    const tk = J.TRANS_ORDER.find(k => J.TRANS[k]);
    const L2 = plain(list); L2[iu].edit = { trans: tk };
    const p2 = CE.effectivePlan(H, L2, null).hp, c2 = p2.cuts[iu], q2 = p2.cuts[iu - 1];
    if (c2.trans !== tk || c2.enter !== 'cut' || c2.inDur !== 0.12 || q2.exit !== 'cut' || q2.outDur !== 0 || !(c2.transDur >= 0.12)) errs.push('trans on: ' + JSON.stringify([c2.trans, c2.enter, c2.inDur, q2.exit, q2.outDur, c2.transDur]));
    const L3 = plain(list); L3[0].edit = { trans: tk };
    if (CE.effectivePlan(H, L3, null).hp.cuts[0].trans) errs.push('first cut got a transition');
    const L4 = plain(list); L4[iu].edit = { enter: 'type' };
    const c4 = CE.effectivePlan(H, L4, null).hp.cuts[iu];
    if (c4.enter !== 'type' || c4.inDur === bplan.cuts[iu].inDur && bplan.cuts[iu].enter !== 'type') errs.push('enter change did not re-time inDur');
  }
  check('T-5 つなぎの整合（付ける・外す・前カットの退場）', !errs.length, errs.join('; '));
}

// ---------------------------------------------------------------- AE side: build a plan from the browser, stamp, read back
function aePlanOf(pl, project) { const p = J.planForAE(pl, project); p.__project = CE.packProject(project); return plain(p); }
function mainComp(env) { return env.comps.find(c => /^JIZURA /.test(c.name) && !c._removed); }
function buildStamped(planAE) {
  const { env, JZ } = load();
  const pl = JZ.jzParseJSON(JSON.stringify(planAE));
  JZ.jzBuild(pl, {});
  const comp = mainComp(env), r = JZ.JZ_CUTEDIT.stamp(comp, pl);
  return { env, JZ, comp, r, pl };
}
const readJ = (JZ, v) => JSON.parse(JZ.JZ_CUTEDIT.json(v));

// ---------------------------------------------------------------- T-2: stamp → header / cuts round trip
{
  const errs = [], planAE = aePlanOf(bplan, bproject), { env, JZ, comp, r } = buildStamped(planAE);
  if (!r.ok) errs.push('stamp: ' + r.error);
  const h = readJ(JZ, JZ.JZ_CUTEDIT.header(comp.id)), cs = readJ(JZ, JZ.JZ_CUTEDIT.cuts(comp.id));
  if (h.ok && cs.ok) cs.cuts = h.h.cuts.map(u => cs.cuts.find(x => x.uid === u));          // layer order → plan order
  if (cs.ok && cs.cuts.some(x => { const L = comp._layers.find(l => l.id === x.layerId); return !L || /^JZ Trans /.test(L.name); })) errs.push('cutRead returned a transition copy instead of the wrapper layer');
  if (!comp._layers.some(L => /^JZ Trans /.test(L.name) && L.source && /"k":"cut"/.test(L.source.comment || ''))) errs.push('(test plan has no transition copies of a wrapper)');
  if (!h.ok || !cs.ok) errs.push('read: ' + (h.error || cs.error));
  else {
    if (!/^JZ1 \{"jz":1,"k":"main"/.test(comp.comment)) errs.push('main comment does not start with JZ1');
    if (h.h.cuts.length !== planAE.cuts.length || cs.cuts.length !== planAE.cuts.length) errs.push(`cuts ${h.h.cuts.length} / ${cs.cuts.length} / plan ${planAE.cuts.length}`);
    for (const k of ['style', 'fx', 'title', 'seed', 'duration', 'width', 'height']) if (!same(h.h.plan[k], planAE[k])) errs.push('header.' + k);
    if (!same(h.h.project, planAE.__project)) errs.push('header.project');
    cs.cuts.forEach((x, i) => { const want = Object.assign({}, planAE.cuts[i]); want.dur = want.end - want.start; if (!same(Object.keys(x.cut.base).sort().map(k => [k, x.cut.base[k]]), Object.keys(want).sort().map(k => [k, want[k]]))) errs.push('cut ' + i + ' base'); });
    const evs = new Set(); cs.cuts.forEach(x => x.cut.ev.forEach(e => evs.add(JSON.stringify(e))));
    const lost = planAE.events.filter(e => !evs.has(JSON.stringify(e)));
    if (lost.length) errs.push(lost.length + ' / ' + planAE.events.length + ' events not in any cut comment');
    // the plan rebuilt from what was read equals the plan built
    const list = cs.cuts.map(x => ({ base: x.cut.base, edit: x.cut.edit, ev: x.cut.ev }));
    const back = CE.buildPlan(h.h, list, null);
    const strip = c => { const o = Object.assign({}, c); o.dur = o.end - o.start; return o; };
    if (!same(back.cuts.map(strip).map(c => JSON.stringify(Object.keys(c).sort().map(k => [k, c[k]]))), planAE.cuts.map(strip).map(c => JSON.stringify(Object.keys(c).sort().map(k => [k, c[k]]))))) errs.push('rebuilt cuts differ');
    if (!same(back.events, planAE.events)) errs.push('rebuilt events differ');
    const ln = l => JSON.stringify(Object.keys(l).filter(k => k !== 'chunks').sort().map(k => [k, l[k]]));
    if (!same(back.lines.map(ln), planAE.lines.map(ln))) errs.push('rebuilt lines differ');
    if (!same(back.style, planAE.style) || !same(back.fonts, planAE.fonts)) errs.push('rebuilt style / fonts differ');
    const bytes = Math.max(...env.comps.map(c => c.comment.length));
    console.log(`     header ${r.bytes} B (${r.chunks} 枠), 最大の comment ${bytes} B`);
  }
  check('T-2 stamp → cutHeader / cutRead の往復で plan が戻る', !errs.length, errs.join('; '));
}

// ---------------------------------------------------------------- T-3: header split over the cuts folder
{
  const errs = [], lines = []; for (let i = 0; i < 100; i++) lines.push(['夜明けの色を覚えてる', 'ほどけた声が遠くで鳴った', 'ねえまだ間に合うかな', '透明なままじゃ終われない'][i % 4] + (i + 1));
  const pj = Object.assign(J.defaultProject(), { title: '長い歌', seed: 9, lyrics: lines.join('\n') }), pl = J.plan(pj, null);
  const planAE = aePlanOf(pl, pj), { JZ, comp, r } = buildStamped(planAE);
  if (!r.ok) errs.push('stamp: ' + r.error);
  else {
    if (r.chunks !== 2) errs.push('100 lines: ' + r.chunks + ' chunk(s), ' + r.bytes + ' B');
    const f = comp._layers.map(L => L.source).find(s => s && s.parentFolder).parentFolder;
    if (!/^JZ1 \{"jz":1,"k":"main2"/.test(f.comment)) errs.push('folder comment');
    if (comp.comment.length > 14000 || f.comment.length > 14000 + 200) errs.push('comment too long ' + comp.comment.length + ' / ' + f.comment.length);
    const h = readJ(JZ, JZ.JZ_CUTEDIT.header(comp.id));
    if (!h.ok || !same(h.h.project, planAE.__project) || h.h.cuts.length !== planAE.cuts.length) errs.push('read back after split');
    // exactly at the limit: one comment; one byte over: two
    for (const d of [0, -1]) {
      JZ.JZ_CUTEDIT.limit(100000); const r0 = JZ.JZ_CUTEDIT.stamp(comp, JZ.jzParseJSON(JSON.stringify(planAE)));
      JZ.JZ_CUTEDIT.limit(r0.bytes + d); const r1 = JZ.JZ_CUTEDIT.stamp(comp, JZ.jzParseJSON(JSON.stringify(planAE)));
      if (r1.bytes === r0.bytes && r1.chunks !== (d === 0 ? 1 : 2)) errs.push(`limit ${r0.bytes + d}: ${r1.chunks} chunk(s) for ${r1.bytes} B`);
      const h2 = readJ(JZ, JZ.JZ_CUTEDIT.header(comp.id)); if (!h2.ok || h2.h.uid !== r1.uid) errs.push('read after restamp');
    }
    JZ.JZ_CUTEDIT.limit(14000);
  }
  check('T-3 ヘッダの分割（100 行 → main + main2、上限ちょうど / 1 バイト超え）', !errs.length, errs.join('; ') + (r.ok ? ` — ${pl.cuts.length} カット, header ${r.bytes} B` : ''));
}

// ---------------------------------------------------------------- T-4b: per-cut fonts / colours / strengths
{
  const errs = [], cuts = bplan.cuts, i3 = cuts.findIndex((c, i) => i >= 2 && c.layout !== 'title' && c.layout !== 'interlude');
  const base = plain(cuts[i3]);
  // fonts: ov + params keys of that role only
  const a = CE.apply(base, { fonts: { display: 'dela' } }, P);
  if (!a.ov || a.ov.fonts.display !== 'dela') errs.push('ov.fonts');
  const dsp = P.style.fonts.display || [];
  for (const k of ['font', 'fontBig', 'fontSmall', 'fontC', 'fontB', 'tileFont']) if (typeof base.params[k] === 'string') {
    const want = dsp.includes(base.params[k]) ? 'dela' : base.params[k];
    if (a.params[k] !== want) errs.push(`params.${k} ${base.params[k]} -> ${a.params[k]} (want ${want})`);
  }
  // colours: jzCutCtx on scheme 0 = the browser's resolveStyle for the same colours
  const { JZ } = load();
  const colors = { enabled: true, bg: '#101820', fg: '#FAFAFA', sub: '#8899AA', accentOn: true, accent: '#FF3366', ghostA: '#00E5FF', ghostB: '#FFEA00' };
  for (const sk of ['noir', 'paper', 'crimson']) {
    const st = plain(J.resolveStyle({ style: sk })), want = J.resolveStyle({ style: sk, colors }).schemes[0];
    const got = JZ.jzCutCtx({ ov: { colors } }, JZ.jzParseJSON(JSON.stringify(st)), { motion: 0.7, glitch: 0.5, decor: 0.5, texture: 0.6, chroma: 0.7 }, JZ.jzParseJSON(JSON.stringify(st.schemes[0]))).sc;
    for (const k of Object.keys(want)) if (String(JSON.stringify(want[k])).toUpperCase() !== String(JSON.stringify(got[k])).toUpperCase()) errs.push(`${sk}.${k} ${JSON.stringify(want[k])} vs ${JSON.stringify(got[k])}`);
    const key = JZ.jzKeyStyle(JZ.jzParseJSON(JSON.stringify(st)));
    if (JZ.jzCutCtx({ ov: { colors } }, key, {}, key.schemes[0]).sc !== key.schemes[0]) errs.push(sk + ': keyBg style took the colours');
  }
  // strengths: motion 1.0 on one cut changes only that cut's comps, and its content's expressions carry M=1
  const plA = plain(bplan), plB = plain(bplan);
  const lst = listOf(plA); lst[i3].edit = { fx: { motion: 1 } };
  const eff = CE.buildPlan(header0, lst, null);
  const x = load(), y = load();
  x.JZ.jzBuild(x.JZ.jzParseJSON(JSON.stringify(aePlanOf(plB, bproject))), {});
  y.JZ.jzBuild(y.JZ.jzParseJSON(JSON.stringify(eff)), {});
  const byName = env => Object.fromEntries(env.comps.map(c => [c.name, JSON.stringify(c._layers.map(L => L.children.map(propTree)))]));
  const X = byName(x.env), Y = byName(y.env), pre = String(i3 + 1).padStart(3, '0') + ' ';
  const diff = Object.keys(X).filter(n => X[n] !== Y[n]);
  if (!diff.length || diff.some(n => !n.startsWith(pre))) errs.push('motion changed comps: ' + diff.join(', '));
  const txt = y.env.comps.find(c => c.name.startsWith(pre) && / text$/.test(c.name));
  if (!txt || !/,M=1,/.test(JSON.stringify(txt._layers.map(L => L.children.map(propTree))))) errs.push('content has no M=1');
  check('T-4b カット単位の書体・色・強さ（ov / params / jzCutCtx / 隣のカットは不変 / 合成用の背景）', !errs.length, errs.join('; '));
}

// ---------------------------------------------------------------- T-7: what the selection points at
{
  const errs = [], { env, JZ, comp } = buildStamped(aePlanOf(bplan, bproject)), app = env.app, CEd = JZ.JZ_CUTEDIT;
  const sel = () => readJ(JZ, CEd.sel());
  const W = comp._layers.filter(L => L.source && L.source.comment && /"k":"cut"/.test(L.source.comment));
  const w3 = W.find(L => /^003 /.test(L.name)), uid3 = JSON.parse(w3.source.comment.slice(4)).uid;
  app.project.activeItem = null; if (sel().why !== 'nocomp') errs.push('nocomp');
  app.project.activeItem = comp; comp.selectedLayers = [];
  let r = sel(); if (r.why !== 'noselect' || r.compId !== comp.id) errs.push('noselect ' + JSON.stringify(r));
  comp.selectedLayers = [w3]; r = sel(); if (!r.ok || r.uid !== uid3 || r.why !== 'layer' || r.layerId !== w3.id || r.cut.base.text !== w3.source.name.slice(4) && !String(r.cut.base.text).startsWith(w3.source.name.slice(4))) errs.push('layer ' + JSON.stringify([r.ok, r.why, r.uid === uid3]));
  const bgL = comp._layers.find(L => L.name === 'JZ Background'); comp.selectedLayers = [bgL]; if (sel().why !== 'notcut') errs.push('notcut');
  const fxL = comp._layers.find(L => /^JZ (FX|Trans) /.test(L.name));
  if (fxL) { comp.selectedLayers = [fxL]; r = sel(); if (!r.ok || r.why !== 'fxlayer') errs.push('fxlayer ' + JSON.stringify([r.ok, r.why])); }
  app.project.activeItem = w3.source; r = sel(); if (!r.ok || r.why !== 'inside' || r.uid !== uid3 || r.compId !== comp.id) errs.push('inside wrapper');
  const content = w3.source._layers.find(L => L.name === 'content').source;
  app.project.activeItem = content; r = sel(); if (!r.ok || r.uid !== uid3) errs.push('inside content');
  const other = app.project.items.addComp('Other', 100, 100, 1, 1, 24); app.project.activeItem = other; if (sel().why !== 'notjizura') errs.push('notjizura');
  // renamed / moved / duplicated layers
  app.project.activeItem = comp; w3.name = 'renamed'; w3.moveToBeginning(); comp.selectedLayers = [w3]; r = sel(); if (r.uid !== uid3) errs.push('rename + reorder');
  const dup = w3.duplicate(); comp.selectedLayers = [dup]; r = sel(); if (r.uid !== uid3 || r.layerId !== dup.id) errs.push('duplicate');
  // cutSelectLayer: selects the layer and moves the time
  const w5 = W.find(L => /^005 /.test(L.name)), uid5 = JSON.parse(w5.source.comment.slice(4)).uid;
  r = readJ(JZ, CEd.selectLayer(comp.id, uid5)); if (!r.ok || comp.selectedLayers.length !== 1 || comp.selectedLayers[0] !== w5 || Math.abs(comp.time - w5.inPoint) > 1e-9) errs.push('selectLayer');
  // writeEdit keeps the edit in the wrapper comment
  r = readJ(JZ, CEd.writeEdit(comp.id, uid5, JSON.stringify({ layout: 'vcols' })));
  if (!r.ok || JSON.parse(w5.source.comment.slice(4)).edit.layout !== 'vcols') errs.push('writeEdit');
  // a user's note before the JIZURA line stays
  comp.comment = 'my note\n' + comp.comment; CEd.writeEdit(comp.id, uid5, '{}');
  if (!readJ(JZ, CEd.header(comp.id)).ok) errs.push('header with a note before it');
  check('T-7 選択の解決（メイン / wrapper 内 / content 内 / 非 JIZURA、名前変更・並べ替え・複製）', !errs.length, errs.join('; '));
}

// ---------------------------------------------------------------- T-8: ES3 syntax of the new ExtendScript files
{
  const errs = [];
  for (const f of ['ae/52_cutedit.jsx', 'cep/host_cutedit.jsx']) { try { require('acorn').parse(fs.readFileSync(path.join(ROOT, f), 'utf8'), { ecmaVersion: 3 }); } catch (e) { errs.push(f + ': ' + e.message); } }
  check('T-8 ES3 構文（52_cutedit.jsx / host_cutedit.jsx）', !errs.length, errs.join('; '));
}

// ---------------------------------------------------------------- T-9a: the panel's host calls end to end (host.jsx + host_cutedit.jsx + jizura_core.jsx)
{
  const errs = [], ext = path.join(ROOT, 'build', 'com.852wa.jizura', 'jsx');
  if (!fs.existsSync(path.join(ext, 'host_cutedit.jsx'))) errs.push('build/com.852wa.jizura がありません（python3 build_cep.py を先に）');
  else {
    const env = AEOM.makeEnv({ fonts: () => true }), G = env.ctx, vfs = {};
    for (const k of ['JSON', 'Math', 'Date', 'String', 'Number', 'Array', 'Object', 'RegExp', 'Error', 'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'encodeURIComponent', 'decodeURIComponent']) delete G[k];   // the engine's own realm (like load())
    const fileOf = p => ({ fsName: p, name: p.split('/').pop(), get exists() { return p in vfs; }, get parent() { return fileOf(p.replace(/\/[^\/]*$/, '')); }, encoding: '', open() { return true; }, read() { return vfs[p]; }, close() {}, remove() { delete vfs[p]; return true; } });
    for (const f of ['host.jsx', 'host_cutedit.jsx', 'jizura_core.jsx']) vfs['/ext/jsx/' + f] = fs.readFileSync(path.join(ext, f), 'utf8');
    vfs['/ext/jsx/host.jsx'] = vfs['/ext/jsx/host.jsx'].replace(/^var JZCEP = /m, 'G.JZCEP = ');
    G.File = p => fileOf(String(p)); G.G = G;
    vm.createContext(G);
    G.$ = { global: G, fileName: '/ext/jsx/host.jsx', evalFile(f) { return vm.runInContext(vfs[f.fsName], G, { filename: f.name }); }, writeln() {}, sleep() {} };
    const call = code => JSON.parse(vm.runInContext(code, G));
    G.$.evalFile(G.File('/ext/jsx/host.jsx')); G.$.evalFile(G.File('/ext/jsx/host_cutedit.jsx'));
    if (!call('JZCEP.init("/ext")').ok) errs.push('init');
    // build like the panel (with the project for 読み戻し), plus the song in the comp
    const planAE = aePlanOf(bplan, bproject);
    const ft = env.app.project._addFootage({ name: 'song.wav', path: '/fake/song.wav', duration: 60 });
    let r = call('JZCEP.buildFromString(' + JSON.stringify(encodeURIComponent(JSON.stringify(planAE))) + ',' + ft.id + ')');
    if (!r.ok) errs.push('build ' + r.error);
    const old = env.comps.find(c => /^JIZURA /.test(c.name)), oldName = old.name;
    const au = old._layers.find(L => L.source === ft); if (au) au.startTime = 0.25;
    // read the selection, change cut 3, rebuild
    env.app.project.activeItem = old;
    const w3 = old._layers.find(L => /^003 /.test(L.name)); old.selectedLayers = [w3];
    const s = call('JZCEP.cutSel()'), h = call('JZCEP.cutHeader(' + s.compId + ')'), cs = call('JZCEP.cutRead(' + s.compId + ')');
    if (!s.ok || !h.ok || !cs.ok) errs.push('read ' + JSON.stringify([s.why, h.error, cs.error]));
    const list = h.h.cuts.map(u => cs.cuts.find(x => x.uid === u)).map(x => ({ base: x.cut.base, edit: x.uid === s.uid ? { layout: 'vcols', decor: ['rings', null, null] } : {}, ev: x.cut.ev }));
    const plan2 = CE.buildPlan(h.h, list, null);
    vfs['/tmp/p.json'] = JSON.stringify(plan2);
    r = call('JZCEP.rebuildStartFromFile("/tmp/p.json",' + s.compId + ',"%7B%7D")');
    let guard = 0; while (r.ok && !r.done && guard++ < 500) r = call('JZCEP.rebuildStep(50)');
    if (!r.ok || !r.done || r.cancelled) errs.push('rebuild ' + JSON.stringify(r).slice(0, 200));
    else {
      const items = env.app.project._items(), mains = items.filter(i => /^JIZURA /.test(i.name) && i instanceof AEOM.Comp);
      if (mains.length !== 1 || mains[0].name !== oldName || mains[0] === old || !old._removed) errs.push('old comp not replaced: ' + mains.map(m => m.name).join(', '));
      const nw = mains[0], nw3 = nw && nw._layers.find(L => /^003 /.test(L.name));
      if (!nw3 || !/"layout":"vcols"/.test(nw3.source.comment) || !/"edit":\{"layout":"vcols"/.test(nw3.source.comment)) errs.push('cut 3 layout / edit');
      const nau = nw && nw._layers.find(L => L.source === ft);
      if (!nau || Math.abs(nau.startTime - 0.25) > 1e-9) errs.push('song layer not moved over');
      const reach = new Set(), todo = [nw]; while (todo.length) { const c = todo.pop(); if (reach.has(c)) continue; reach.add(c); c._layers.forEach(L => { if (L.source instanceof AEOM.Comp) todo.push(L.source); }); }
      const orphans = items.filter(i => i instanceof AEOM.Comp && !reach.has(i));
      if (orphans.length) errs.push(orphans.length + ' comps of the old build left: ' + orphans.slice(0, 3).map(c => c.name).join(', '));
      if (items.filter(i => i instanceof AEOM.Folder).length !== 1) errs.push('folders: ' + items.filter(i => i instanceof AEOM.Folder).map(f => f.name).join(', '));
      if (r.compId !== nw.id || r.replaced !== true) errs.push('result ' + JSON.stringify([r.compId, nw.id, r.replaced]));
      // cancel: the old comp stays, the half-built one goes
      vfs['/tmp/p2.json'] = JSON.stringify(plan2);
      r = call('JZCEP.rebuildStartFromFile("/tmp/p2.json",' + nw.id + ',"%7B%7D")');
      call('JZCEP.rebuildStep(1)'); call('JZCEP.rebuildCancel()');
      guard = 0; do { r = call('JZCEP.rebuildStep(50)'); } while (r.ok && !r.done && guard++ < 500);
      const mains2 = env.app.project._items().filter(i => i instanceof AEOM.Comp && /^JIZURA /.test(i.name));
      if (!r.cancelled || mains2.length !== 1 || mains2[0] !== nw) errs.push('cancel ' + JSON.stringify(r).slice(0, 120) + ' mains ' + mains2.length);
      if (env.app.project._items().filter(i => i instanceof AEOM.Folder).length !== 1) errs.push('cancel left a folder');
      // keep the old comp: renamed "(old)"
      vfs['/tmp/p3.json'] = JSON.stringify(plan2);
      r = call('JZCEP.rebuildStartFromFile("/tmp/p3.json",' + nw.id + ',' + JSON.stringify(encodeURIComponent('{"keepOld":true}')) + ')');
      guard = 0; while (r.ok && !r.done && guard++ < 500) r = call('JZCEP.rebuildStep(50)');
      const names = env.app.project._items().filter(i => i instanceof AEOM.Comp && /^JIZURA /.test(i.name)).map(c => c.name);
      if (!r.keptOld || !names.includes(oldName) || !names.includes(oldName + ' (old)')) errs.push('keepOld ' + names.join(', '));
    }
  }
  check('T-9a host の作り直し（選択 → 読み出し → 編集 → rebuildStart/Step → 旧コンポ置換・曲の引き継ぎ・中止・残す）', !errs.length, errs.join('; '));
}

console.log(`\n${results.length - failed} / ${results.length} passed`);
process.exit(failed ? 1 : 0);
