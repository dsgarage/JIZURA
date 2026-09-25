/* ============================================================
   JIZURA — After Effects CEP panel: "カット編集" tab (docs/dsgarage/CUT_EDIT_SPEC.md)
   Select a cut's layer in the AE timeline → its settings show here → change them → rebuild the comp.
   The plan lives in the comments of the built comps (ae/52_cutedit.jsx); this file turns (base cut + edit) into
   the plan to rebuild with. How an edit is applied follows the AviUtl2 edition's bridge.js
   (SakiikaVR/JIZURA-AviUtl2, MIT) with the changes described in the spec (§4).
   The plan logic below has no DOM and is exported as J.cutEdit before the CEP check (dev/cutedit_test.js runs it in Node).
   ============================================================ */
(() => {
'use strict';
const J = window.J;
if (!J) return;

// ---------------------------------------------------------------- plan logic
const PARAMS = { layout: 'params', treat: 'treatP', bg: 'bgP', cam: 'camP', trans: 'transP' };
const PICKS = ['layout', 'enter', 'hold', 'exit', 'treat', 'bg', 'cam', 'trans'];
const ROLES = [['display', '見出し'], ['serif', '明朝枠'], ['body', '小さな文字']];
const PARAM_FONTS = ['font', 'fontBig', 'fontSmall', 'fontC', 'fontB', 'tileFont'];
const CUT_FX = ['motion', 'glitch', 'chroma', 'texture'];
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const sid = s => J.sid(String(s));
const isSpecial = c => c.layout === 'title' || c.layout === 'interlude';
// "same key again → same params": the stream depends on the cut, the group and the key (or on the dice roll)
const rngOf = (seed, group, key) => J.rng(J.h(seed, sid(group), sid(key)));
const rngRoll = (seed, group, roll) => J.rng(J.h(seed, sid('roll'), roll, sid(group)));
// entrance / exit lengths: the planner's rules (src/08_planner.js), for a cut whose entrance / exit changed
function durations(enter, exit, dur, n) {
  let inDur = J.clamp(dur * 0.36, 0.12, 0.6);
  if (enter === 'type') inDur = J.clamp(n * 0.055 + 0.1, 0.15, dur * 0.65);
  if (enter === 'assemble') inDur = J.clamp(dur * 0.45, 0.22, 0.75);
  if (J.ENTER[enter] && J.ENTER[enter].inDur) inDur = J.ENTER[enter].inDur(dur, n);
  if (enter === 'cut') inDur = 0.12;
  let outDur = exit === 'cut' ? 0 : J.clamp(dur * 0.3, 0.14, 0.55);
  if (['explode', 'fall', 'drift'].includes(exit)) outDur = J.clamp(dur * 0.38, 0.25, 0.7);
  if (J.EXIT[exit] && J.EXIT[exit].outDur) outDur = J.EXIT[exit].outDur(dur, n);
  return [inDur, outDur];
}
// the cut to build = the generated cut (base) with the panel's edit on top (§4). P = { W, H, style } of the plan.
function apply(base, edit, P) {
  const c = clone(base);
  edit = edit || {};
  delete c.ov;
  const roll = edit.roll | 0;
  if (edit.time && edit.time.end > edit.time.start) { c.start = +edit.time.start; c.end = +edit.time.end; }
  c.dur = c.end - c.start;
  if (typeof edit.text === 'string' && edit.text.trim()) { c.text = edit.text; c.lineText = edit.text; c.words = J.chunkText(edit.text); }
  for (const g of PICKS) {
    if (!(g in edit)) continue;
    const key = edit[g];
    if (g === 'trans') { if (key === null || (key && J.TRANS[key])) c.trans = key; continue; }
    if (!key || !J.registry(g)[key]) continue;
    if (g === 'layout' && isSpecial(base)) continue;          // title card / interlude keep their own layout
    c[g] = key;
  }
  for (const g of Object.keys(PARAMS)) {
    const key = c[g], changed = key !== base[g];
    if (!changed && !(roll > 0)) continue;
    if (g === 'layout' && isSpecial(c)) continue;
    if (!key) { c[PARAMS[g]] = {}; if (g === 'trans') c.transDur = 0; continue; }
    const def = J.registry(g)[key], rng = changed ? rngOf(c.seed, g, key) : rngRoll(c.seed, g, roll);
    if (g === 'layout') c.params = def.plan ? def.plan(rng, { text: c.text, n: J.glyphCount(c.text), W: P.W, H: P.H, dur: c.dur }, P.style) : {};
    else c[PARAMS[g]] = def.plan ? def.plan(rng, P.style) : {};
    if (g === 'trans' && changed) c.transDur = J.clamp(def.dur || 0.35, 0.12, Math.min(0.6, c.dur * 0.45));
  }
  const enterChanged = c.enter !== base.enter, exitChanged = c.exit !== base.exit;
  if (enterChanged || exitChanged) {
    const d = durations(c.enter, c.exit, c.dur, J.glyphCount(c.text));
    if (enterChanged) c.inDur = d[0];
    if (exitChanged) c.outDur = d[1];
    if (c.inDur + c.outDur > c.dur * 0.92) { const f = c.dur * 0.92 / (c.inDur + c.outDur); c.inDur *= f; c.outDur *= f; }
  }
  // decor: [id | null] x 3 replaces the list (blanks close up); the other params come from the generated decor
  if (Array.isArray(edit.decor)) {
    const ids = edit.decor.filter(id => id && J.DECOR[id]), bd = base.decor || [];
    c.decor = ids.map((id, i) => Object.assign({}, bd[i] || bd[0] || {}, { id, seed: roll > 0 ? J.h(c.seed, sid('roll'), roll, sid('decor'), i) | 0 : (c.seed + i + 1) | 0 }));
  } else if (roll > 0) c.decor = (base.decor || []).map((d, i) => Object.assign({}, d, { seed: J.h(c.seed, sid('roll'), roll, sid('decor'), i) | 0 }));
  // this cut's fonts / colours / strengths → cut.ov (read by jzCutCtx in the AE engine)
  const ov = {};
  const fo = {}; for (const [r] of ROLES) if (edit.fonts && edit.fonts[r] && J.FONTS[edit.fonts[r]]) fo[r] = edit.fonts[r];
  if (Object.keys(fo).length) ov.fonts = fo;
  if (edit.colors && (edit.colors.enabled || edit.colors.accentOn)) ov.colors = clone(edit.colors);
  const fx = {}; for (const k of CUT_FX) if (edit.fx && typeof edit.fx[k] === 'number') fx[k] = edit.fx[k];
  if (Object.keys(fx).length) ov.fx = fx;
  if (Object.keys(ov).length) c.ov = ov;
  // font keys the layout planned from the style's role lists follow the cut's fonts (keys of other roles stay)
  if (ov.fonts && c.params) {
    const swap = v => { for (const [r] of ROLES) if (fo[r] && ((P.style.fonts || {})[r] || []).includes(v)) return fo[r]; return v; };
    for (const k of PARAM_FONTS) if (typeof c.params[k] === 'string') c.params[k] = swap(c.params[k]);
    if (Array.isArray(c.params.fonts)) c.params.fonts = c.params.fonts.map(v => (typeof v === 'string' ? swap(v) : v));
  }
  return c;
}
// can this cut have a transition from the previous one (the planner's rule)
const transOk = (prev, c) => !!(prev && Math.abs(prev.end - c.start) < 0.06 && prev.layout !== 'interlude' && c.end - c.start > 0.5);
// the plan's cuts / events after the edits: header + cuts [{base, edit, ev}] in order + common settings (null: as generated)
function effectivePlan(header, list, common) {
  const hp = clone(header.plan), proj = header.project ? clone(header.project) : null;
  // lines as kept in the comp: text / index left out where a cut has them (ae/52_cutedit.jsx)
  (hp.lines || []).forEach((l, i) => {
    if (l.index === undefined) l.index = i;
    if (l.text === undefined) { const c = list.find(x => x.base.line === i && x.base.layout !== 'interlude'); l.text = c ? c.base.lineText : ''; }
  });
  if (common) {
    hp.fx = Object.assign({}, hp.fx, common.fx || {});
    hp.style = J.resolveStyle({ style: (proj && proj.style) || hp.styleKey, colors: common.colors || {}, fonts: common.fonts || {}, keyBg: hp.keyBg || (proj && proj.keyBg) });
    if (proj) { proj.colors = clone(common.colors || { enabled: false }); proj.fonts = clone(common.fonts || {}); proj.fx = Object.assign({}, proj.fx, common.fx || {}); }
  }
  const P = { W: hp.W, H: hp.H, style: hp.style };
  const cuts = list.map(x => apply(x.base, x.edit, P));
  // transitions: a cut with one enters with a cut and the previous cut leaves with a cut (§6.2)
  cuts.forEach((c, i) => {
    const prev = cuts[i - 1];
    if (c.trans && !transOk(prev, c)) { c.trans = null; c.transP = {}; c.transDur = 0; }
    if (c.trans) { c.enter = 'cut'; c.inDur = 0.12; prev.exit = 'cut'; prev.outDur = 0; }
    c.index = i;
  });
  const seen = new Set(), events = [];
  for (const x of list) for (const e of x.ev || []) { const k = [e.t, e.type, e.amp, e.dur].join('|'); if (!seen.has(k)) { seen.add(k); events.push(e); } }
  events.sort((a, b) => a.t - b.t);
  hp.cuts = cuts; hp.events = events;
  return { hp, proj };
}
// the whole plan for a rebuild (what JZCEP.rebuildStart* builds)
function buildPlan(header, list, common) {
  const { hp, proj } = effectivePlan(header, list, common);
  const pj = proj ? unpackProject(proj) : { aspect: '16:9', res: 1080, extra: hp.extra === true, wa: hp.wa !== false };
  const ae = J.planForAE(hp, pj);
  // the comp keeps its size / range as generated
  for (const k of ['width', 'height', 'extra', 'wa', 'duration', 'audioOffset', 'range']) if (header.plan[k] !== undefined) ae[k] = header.plan[k];
  ae.__project = proj;
  ae.__cutedit = { cuts: list.map(x => ({ base: x.base, edit: x.edit || {} })) };
  return ae;
}
// the project as kept in the comp: the technique on/off map only lists what is off (anything missing counts as on)
function packProject(p) {
  const o = clone(p), en = {};
  for (const g of Object.keys(o.enabled || {})) { const off = {}; for (const k of Object.keys(o.enabled[g])) if (o.enabled[g][k] === false) off[k] = false; if (Object.keys(off).length) en[g] = off; }
  o.enabled = en;
  return o;
}
function unpackProject(p) {           // like the editor's own merge (src/12_ui.js mergeProject)
  const d = J.defaultProject(), o = Object.assign(d, clone(p) || {});
  o.fx = Object.assign(J.defaultProject().fx, (p && p.fx) || {});
  o.timing = Object.assign(J.defaultProject().timing, (p && p.timing) || {});
  const en = J.defaultProject().enabled;
  for (const g of Object.keys(en)) en[g] = Object.assign(en[g], ((p && p.enabled) || {})[g] || {});
  o.enabled = en;
  o.overrides = (p && p.overrides) || {};
  o.colors = Object.assign({ enabled: false }, (p && p.colors) || {});
  o.fonts = (p && p.fonts) || {};
  o.userFonts = (p && p.userFonts) || [];
  for (const uf of o.userFonts) if (!J.FONTS[uf.key] && J.addUserFont) J.addUserFont(uf.key, uf.label, uf.family, uf.weight || 400);
  return o;
}
const isEmptyEdit = e => !e || !Object.keys(e).some(k => e[k] !== undefined);
J.cutEdit = { apply, effectivePlan, buildPlan, packProject, unpackProject, durations, transOk, isEmptyEdit };

// ---------------------------------------------------------------- the tab (only inside the AE panel)
const CEP = window.__adobe_cep__;
if (!CEP) return;
const S = J.ui, UI = J.uiApi || {};
const nodeReq = (window.cep_node && window.cep_node.require) || (typeof window.require === 'function' ? window.require : null);
const fs = nodeReq ? nodeReq('fs') : null, os = nodeReq ? nodeReq('os') : null, pathM = nodeReq ? nodeReq('path') : null;
const ev = code => new Promise(res => { try { CEP.evalScript(code, r => res(r)); } catch (e) { res('EvalScript error.'); } });
const parse = r => { try { const o = JSON.parse(r); return o && typeof o === 'object' ? o : { ok: false, error: String(r) }; } catch (e) { return { ok: false, error: String(r || 'no answer') }; } };
const host = async code => { if (J.cep && J.cep.connect && !(await J.cep.connect())) return { ok: false, error: 'After Effects に接続できませんでした' }; return parse(await ev(code)); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nameOf = (g, k) => { const d = k && J.registry(g)[k]; return d ? d.name : (k || '—'); };
const fontLabel = k => (J.FONTS[k] ? J.FONTS[k].label : k);
const tc = t => { t = Math.max(0, +t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const toColor = v => { const h = String(v || '#000000'); return /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : J.toHex(...J.hex(h)).toLowerCase(); };

// state: the comp being edited (header + its cuts by uid), the selected cut, the common settings
const ST = { compId: null, compName: '', header: null, cuts: new Map(), order: [], sel: null, why: '', parts: null, common: null, commonBase: '', busy: false, lastLite: '', dirty: new Set() };
const WHY = {
  nocomp: 'コンポを開いて、JIZURA のカットのレイヤーを選んでください',
  notjizura: 'このコンポはカット編集に対応していません（このパネルの新しい版で作ったコンポで使えます）',
  notcut: 'カットのレイヤー（「001 …」など）を選んでください',
  orphan: 'このカットを使っているメインのコンポが見つかりません',
  noselect: 'レイヤーが選ばれていません。下の一覧からカットを選べます',
};
const $p = sel => pane && pane.querySelector(sel);
let pane = null, tabBtn = null;

function status(m, bad) { const el = $p('.ce-status'); if (el) { el.textContent = m; el.classList.toggle('bad', !!bad); } }
function visible() { return pane && !pane.hidden; }

// ---- reading from After Effects
async function parts() {
  if (ST.parts) return ST.parts;
  const r = await host('JZCEP.cutParts()');
  ST.parts = r.ok ? r.orders : {};
  return ST.parts;
}
async function loadComp(compId) {
  const h = await host('JZCEP.cutHeader(' + (compId | 0) + ')');
  if (!h.ok) { ST.header = null; ST.compId = null; status(h.error, true); render(); return false; }
  const r = await host('JZCEP.cutRead(' + (compId | 0) + ')');
  if (!r.ok) { status(r.error, true); return false; }
  ST.compId = h.compId; ST.compName = h.compName; ST.header = h.h; ST.cuts = new Map(); ST.dirty = new Set();
  for (const x of r.cuts) if (!ST.cuts.has(x.uid)) ST.cuts.set(x.uid, Object.assign({ layerId: x.layerId, layerIndex: x.layerIndex, timeline: x.timeline }, x.cut));
  const order = (ST.header.cuts || []).filter(u => ST.cuts.has(u));
  for (const u of ST.cuts.keys()) if (!order.includes(u)) order.push(u);
  ST.order = order.sort((a, b) => ST.cuts.get(a).i - ST.cuts.get(b).i);
  ST.missing = (ST.header.cuts || []).filter(u => !ST.cuts.has(u)).length;
  const p = ST.header.project;
  ST.common = { fonts: clone((p && p.fonts) || {}), colors: clone((p && p.colors) || { enabled: false }), fx: clone(p ? p.fx : ST.header.plan.fx) || {} };
  ST.commonBase = JSON.stringify(ST.common);
  for (const x of ST.cuts.values()) if (!isEmptyEdit(x.edit)) ST.dirty.add(x.uid);
  await parts();
  return true;
}
async function readSelection(force) {
  if (ST.busy) return null;
  if (!force) {
    const l = await host('JZCEP.cutSelLite()');
    const key = l.ok ? l.compId + ':' + l.layerId + ':' + l.n : '';
    if (key && key === ST.lastLite) return null;
    ST.lastLite = key;
  }
  const r = await host('JZCEP.cutSel()');
  ST.why = r.ok ? r.why : r.why || '';
  if (!r.ok) {
    if (r.why === 'noselect' || r.why === 'notcut') { if (ST.compId !== r.compId || !ST.header) await loadComp(r.compId); ST.sel = null; render(); status(WHY[r.why]); return r; }
    ST.sel = null; render(); status(WHY[r.why] || r.error || '読めませんでした', !WHY[r.why]); return r;
  }
  if (ST.compId !== r.compId || !ST.header || !ST.cuts.has(r.uid)) { if (!(await loadComp(r.compId))) return r; }
  // the comment is the truth for the cut (it may have been saved from another panel session)
  const x = ST.cuts.get(r.uid);
  if (x && !ST.dirty.has(r.uid)) Object.assign(x, r.cut, { layerId: r.layerId, layerIndex: r.layerIndex, timeline: r.timeline });
  ST.sel = r.uid;
  render();
  status(`「${ST.compName}」 ${String(x.i + 1).padStart(3, '0')} ${x.base.text || ''}（${tc(x.base.start)}–${tc(x.base.end)}）` + (r.why === 'fxlayer' ? ' ／ 効果・つなぎのレイヤーを選んでいたので、その時刻のカットを出しています' : '') + (r.why === 'inside' ? ' ／ カットの中を開いています' : ''));
  return r;
}
async function selectCut(uid) {
  const r = await host('JZCEP.cutSelectLayer(' + (ST.compId | 0) + ',' + JSON.stringify(uid) + ')');
  if (!r.ok) { status(r.error, true); return; }
  ST.lastLite = '';
  await readSelection(true);
}

// ---- editing
let saveTimer = 0;
function editOf(uid) { const x = ST.cuts.get(uid); if (!x.edit || Array.isArray(x.edit)) x.edit = {}; return x.edit; }
function changed(uid) {
  const x = ST.cuts.get(uid);
  if (isEmptyEdit(x.edit)) ST.dirty.delete(uid); else ST.dirty.add(uid);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveEdit(uid), 800);          // kept in the wrapper comp (survives closing the panel)
  render();
}
async function saveEdit(uid) {
  const x = ST.cuts.get(uid); if (!x || !ST.compId) return;
  await host('JZCEP.cutWriteEdit(' + (ST.compId | 0) + ',' + JSON.stringify(uid) + ',' + JSON.stringify(encodeURIComponent(JSON.stringify(x.edit || {}))) + ')');
}
function setEdit(uid, key, value) {
  const e = editOf(uid);
  if (value === undefined || value === '') delete e[key]; else e[key] = value;
  changed(uid);
}
function schemeOfCut(x) { const st = ST.header.plan.style, s = st.schemes; return s[(x.base.scheme || 0) % s.length] || s[0]; }
function effective() {        // the plan the rebuild would use (for the form's "enabled" rules)
  const list = ST.order.map(u => ST.cuts.get(u));
  return effectivePlan(ST.header, list, commonChanged() ? ST.common : null).hp;
}
const commonChanged = () => JSON.stringify(ST.common) !== ST.commonBase;

// ---- rebuild (§6)
let cancelReq = false;
async function rebuild() {
  if (ST.busy || !ST.header) return;
  const list = ST.order.map(u => ST.cuts.get(u));
  const plan = buildPlan(ST.header, list, commonChanged() ? ST.common : null);
  const opts = { keepOld: !!($p('.ce-keep') && $p('.ce-keep').checked) };
  ST.busy = true; cancelReq = false; busyUI(true);
  const selIndex = ST.sel ? ST.cuts.get(ST.sel).i : null;
  try {
    status(`作り直し中…（${plan.cuts.length} カット）。AE の画面が止まることがありますが、そのまま待ってください`);
    await new Promise(r => setTimeout(r, 30));
    const txt = JSON.stringify(plan), o = JSON.stringify(encodeURIComponent(JSON.stringify(opts)));
    let r;
    if (fs && os && pathM) {
      const p = pathM.join(os.tmpdir(), 'jizura_cutedit_' + Date.now() + '.json');
      fs.writeFileSync(p, txt, 'utf8');
      r = await host('JZCEP.rebuildStartFromFile(' + JSON.stringify(p) + ',' + (ST.compId | 0) + ',' + o + ')');
    } else r = await host('JZCEP.rebuildStartFromString(' + JSON.stringify(encodeURIComponent(txt)) + ',' + (ST.compId | 0) + ',' + o + ')');
    const t0 = performance.now();
    // timings: stepMs = time inside the script, the rest of a call's round trip is After Effects busy elsewhere (redraws …)
    const T = ST.timings = [];
    while (r.ok && !r.done) {
      if (cancelReq) { await ev('JZCEP.rebuildCancel()'); cancelReq = false; }
      const c0 = performance.now();
      r = await host('JZCEP.rebuildStep(1200)');
      T.push({ phase: r.phase, cuts: r.cuts, stepMs: r.stepMs, callMs: Math.round(performance.now() - c0) });
      if (!r.ok || r.done) break;
      const k = r.phase === 'cuts' ? r.cuts / Math.max(1, r.total) * 0.9 : 0.9 + 0.1 * (r.eventsDone || 0) / Math.max(1, r.events || 1);
      const el = (performance.now() - t0) / 1000, left = k > 0.03 ? el / k - el : null;
      status(`作り直し中… ${Math.round(k * 100)}%（${r.phase === 'cuts' ? `${r.cuts} / ${r.total} カット` : r.phase === 'stamp' ? '仕上げ中' : '効果を追加中'}${left != null ? `・残り約 ${Math.max(1, Math.round(left))} 秒` : ''}）`);
      await new Promise(res => setTimeout(res, 40));
    }
    if (!r.ok) { status('作り直せませんでした: ' + r.error, true); return; }
    if (r.cancelled) { status('作り直しを中止しました（元のコンポはそのままです）'); return; }
    ST.lastLite = ''; ST.busy = false;          // done in AE: read the new comp back (readSelection skips while busy)
    await loadComp(r.compId);
    if (selIndex != null) { const u = ST.order.find(v => ST.cuts.get(v).i === selIndex); if (u) await selectCut(u); }
    let m = `作り直しました（${r.cuts} カット・${(+r.secs).toFixed(1)} 秒${r.audio ? '・曲入り' : ''}${r.keptOld ? '・前のコンポは「(old)」として残しました' : ''}）。取り消すには AE で Cmd+Z（Windows は Ctrl+Z）。取り消したときは「選択を読む」で読み直してください`;
    if (r.notesTotal > 0) m += ` / 注意 ${r.notesTotal} 件`;
    if (r.missingFonts && r.missingFonts.length) m += ` / この PC に無い書体（${r.missingFonts.join('・')}）は近い書体で作りました`;
    status(m);
    if (r.notes && r.notes.length) console.warn('JIZURA cut edit notes', r.notes);
    console.info('JIZURA rebuild steps (ms)', JSON.stringify(T));
  } catch (e) { status('作り直せませんでした: ' + (e && e.message ? e.message : e), true); }
  finally { ST.busy = false; busyUI(false); }
}
// stage 2 (§7): only the selected cut is rebuilt; what was changed by hand in the other cuts stays
async function replaceCut() {
  if (ST.busy || !ST.header || !ST.sel) return;
  const list = ST.order.map(u => ST.cuts.get(u)), ci = ST.order.indexOf(ST.sel), x = ST.cuts.get(ST.sel);
  const plan = buildPlan(ST.header, list, null);           // common settings go with a whole rebuild
  const d = { compId: ST.compId, plan, ci, uids: ST.order, layerId: x.layerId, layerIndex: x.layerIndex };
  ST.busy = true; busyUI(true);
  try {
    status(`このカットを差し替え中…（${String(x.i + 1).padStart(3, '0')}）`);
    await new Promise(r => setTimeout(r, 30));
    const txt = JSON.stringify(d);
    let r;
    if (fs && os && pathM) { const p = pathM.join(os.tmpdir(), 'jizura_cutedit_' + Date.now() + '.json'); fs.writeFileSync(p, txt, 'utf8'); r = await host('JZCEP.replaceCutFromFile(' + JSON.stringify(p) + ')'); }
    else r = await host('JZCEP.replaceCutFromString(' + JSON.stringify(encodeURIComponent(txt)) + ')');
    if (!r.ok) { status('差し替えられませんでした: ' + r.error, true); return; }
    ST.lastLite = ''; ST.busy = false;
    await loadComp(ST.compId);
    await selectCut(r.uid);
    let m = `このカットを差し替えました（${(+r.secs).toFixed(1)} 秒）。ほかのカットはそのままです。取り消すには AE で Cmd+Z（Windows は Ctrl+Z）`;
    if (commonChanged()) m += ' / 共通設定の変更は「作り直す（コンポ全体）」で反映されます';
    if (r.notes && r.notes.length) { m += ` / 注意 ${r.notes.length} 件`; console.warn('JIZURA cut replace notes', r.notes); }
    status(m);
  } catch (e) { status('差し替えられませんでした: ' + (e && e.message ? e.message : e), true); }
  finally { ST.busy = false; busyUI(false); render(); }
}
function busyUI(b) {
  document.querySelectorAll('.ae-build, .ce-act').forEach(el => { el.disabled = b; });
  const c = $p('.ce-cancel'); if (c) c.hidden = !b;
}
// 読み戻し (§5.6): the comp's project → the editor, so the existing tabs can change what this tab cannot (timing, cut count…)
function readBack() {
  const p = ST.header && ST.header.project;
  if (!p) return;
  const o = unpackProject(p);
  if (commonChanged()) { o.colors = clone(ST.common.colors); o.fonts = clone(ST.common.fonts); o.fx = Object.assign(o.fx, ST.common.fx); }
  for (const k of Object.keys(S.project)) delete S.project[k];
  Object.assign(S.project, o);
  UI.syncUI && UI.syncUI(); UI.replan && UI.replan(); UI.flushSave && UI.flushSave();
  status('このコンポの歌詞・スタイル・演出をパネルに読み戻しました。' + (S.audio ? '' : '曲を読み込むと、同じカットの区切りになります'));
  UI.toast && UI.toast('コンポの構成を読み戻しました');
}

// ---- the form
function selectHTML(g, x, eff) {
  const cur = (x.edit || {})[g], base = x.base[g], list = (J.order(g) || []).filter(k => J.registry(g)[k] && !J.registry(g)[k].special && (!ST.parts || !ST.parts[g] || ST.parts[g].includes(k)));
  let h = `<option value="">元の設定（${esc(g === 'trans' && !base ? 'なし' : nameOf(g, base))}）</option>`;
  if (g === 'trans') h += `<option value="__none" ${cur === null ? 'selected' : ''}>なし</option>`;
  for (const k of list) if (!(g === 'layout' && (k === 'title' || k === 'interlude'))) h += `<option value="${esc(k)}" ${cur === k ? 'selected' : ''}>${esc(nameOf(g, k))}</option>`;
  return `<select data-g="${g}" aria-label="${g}">${h}</select>`;
}
function decorHTML(x) {
  const cur = Array.isArray((x.edit || {}).decor) ? x.edit.decor : null, base = (x.base.decor || []).map(d => d.id);
  const list = (J.order('decor') || []).filter(k => J.DECOR[k] && (!ST.parts || !ST.parts.decor || ST.parts.decor.includes(k)));
  let out = '';
  for (let i = 0; i < 3; i++) {
    const v = cur ? cur[i] : undefined;
    let h = `<option value="">元の設定（${esc(base[i] ? nameOf('decor', base[i]) : 'なし')}）</option><option value="__none" ${cur && !v ? 'selected' : ''}>なし</option>`;
    for (const k of list) h += `<option value="${esc(k)}" ${v === k ? 'selected' : ''}>${esc(nameOf('decor', k))}</option>`;
    out += `<select data-decor="${i}" aria-label="装飾${i + 1}">${h}</select>`;
  }
  return out;
}
function fontSel(role, cur, fallback, attr) {
  let h = `<option value="">${esc(fallback)}</option>`;
  for (const [k, f] of Object.entries(J.FONTS)) h += `<option value="${esc(k)}" ${cur === k ? 'selected' : ''}>${esc(f.label)}</option>`;
  return `<select ${attr}="${role}">${h}</select>`;
}
function colorRows(c, sc, prefix) {
  const row = (flag, keys, label) => `<label class="row" style="gap:6px;margin-top:6px"><input type="checkbox" data-${prefix}flag="${flag}" ${c[flag] ? 'checked' : ''}> ${label}</label><div class="color-row">` +
    keys.map(([k, l]) => `<label>${l}<input type="color" data-${prefix}color="${k}" data-flag="${flag}" value="${toColor(c[k] || sc[k])}"></label>`).join('') + '</div>';
  return row('enabled', [['bg', '背景'], ['fg', '文字'], ['sub', '補助']], '背景・文字色を指定') + row('accentOn', [['accent', 'アクセント'], ['ghostA', 'ズレ色A'], ['ghostB', 'ズレ色B']], 'アクセント色を指定');
}
function sliders(vals, marks, keys, prefix) {
  const L = { motion: '動きの強さ', glitch: 'グリッチ', chroma: '色ズレ', texture: '質感', decor: '装飾の量', density: 'カットの細かさ', bgSwitch: '背景の切替' };
  return keys.map(k => `<div class="slider"><label>${L[k]}${marks && marks[k] ? ' ●' : ''}</label><input type="range" min="0" max="1" step="0.01" data-${prefix}fx="${k}" value="${vals[k] ?? 0.5}"><output>${Math.round((vals[k] ?? 0.5) * 100)}</output></div>`).join('');
}
function render() {
  if (!pane) return;
  const body = $p('.ce-body'); if (!body) return;
  const n = ST.dirty.size, cc = commonChanged();
  $p('.ce-summary').textContent = ST.header ? `変更あり: ${n} カット${cc ? ' / 共通設定' : ''}　　最終生成: ${ST.order.length} カット${ST.missing ? `（削除されたカット ${ST.missing} は除きます）` : ''}` : '';
  $p('.ce-rebuild').disabled = ST.busy || !ST.header;
  $p('.ce-replace').disabled = ST.busy || !ST.header || !ST.sel;
  $p('.ce-readback').disabled = !(ST.header && ST.header.project);
  if (!ST.header) { body.innerHTML = '<p class="note">After Effects で JIZURA のコンポを開き、カットのレイヤーを選んでから「選択を読む」を押してください。</p>'; return; }
  const x = ST.sel ? ST.cuts.get(ST.sel) : null;
  let h = '', binder = null;
  if (!x) {
    h += '<h3>カット一覧</h3><div class="ce-list">' + ST.order.map(u => { const c = ST.cuts.get(u); return `<button class="ghost small ce-pick" data-uid="${esc(u)}">${String(c.i + 1).padStart(3, '0')} ${esc((c.edit && c.edit.text) || c.base.text || c.base.layout)} <span class="muted mono">${tc(c.base.start)}</span>${ST.dirty.has(u) ? ' ●' : ''}</button>`; }).join('') + '</div>';
  } else {
    let eff = null; try { eff = effective(); } catch (e) { console.warn(e); }
    const idx = ST.order.indexOf(ST.sel), ec = eff ? eff.cuts[idx] : x.base, prev = eff ? eff.cuts[idx - 1] : null, e = x.edit || {};
    const LD = J.LAYOUTS[ec.layout], sc = schemeOfCut(x), special = isSpecial(x.base), key = !!ST.header.plan.keyBg;
    const fits = LD && LD.fits ? LD.fits(J.glyphCount(ec.text)) : true;
    const tl = x.timeline || {}, t0 = e.time ? e.time.start : x.base.start, t1 = e.time ? e.time.end : x.base.end;     // the times the rebuild uses
    const off = tl.startTime != null && (Math.abs(tl.startTime - t0) > 1e-3 || Math.abs(tl.inPoint - t0) > 1e-3 || tl.outPoint < t1 - 1e-3);
    h += `<div class="fields ce-fields">
      <label class="field field-wide">カット文字<input type="text" class="ce-text" value="${esc(e.text || '')}" placeholder="${esc(x.base.text || '')}"></label>
      <label class="field">レイアウト${selectHTML('layout', x)}</label>
      <label class="field">登場${selectHTML('enter', x)}</label><label class="field">保持${selectHTML('hold', x)}</label><label class="field">退場${selectHTML('exit', x)}</label>
      <label class="field">加工${selectHTML('treat', x)}</label><label class="field">背景${selectHTML('bg', x)}</label><label class="field">カメラ${selectHTML('cam', x)}</label>
      <label class="field">つなぎ${selectHTML('trans', x)}</label></div>
      <div class="field" style="margin-top:8px">装飾<div class="row ce-decor" style="gap:6px">${decorHTML(x)}</div></div>`;
    const notes = [];
    if (!fits) notes.push('この文字数はレイアウトの想定外です（はみ出すことがあります）');
    if (special) notes.push(x.base.layout === 'title' ? 'タイトルカードはレイアウトを変えられません' : '間奏はレイアウトを変えられません');
    if (ec.trans) notes.push('つなぎがあるので登場は「カット」になります（つなぎを「なし」にすると選べます）');
    if (eff && eff.cuts[idx + 1] && eff.cuts[idx + 1].trans) notes.push('次のカットにつなぎがあるので退場は「カット」になります');
    if (off) notes.push(`タイムラインの位置が構成と違います（レイヤー ${tc(tl.inPoint)}–${tc(tl.outPoint)} / 構成 ${tc(t0)}–${tc(t1)}）。作り直しでは構成の時刻を使います`);
    if (notes.length) h += '<p class="note">' + notes.map(esc).join('<br>') + '</p>' + (off ? '<button class="small ce-adopt">タイムラインの位置を採用</button>' : '');
    const cf = ST.common.fonts || {}, sf = ST.header.plan.style.fonts || {};
    h += '<h3>書体（このカット）</h3>' + ROLES.map(([r, l]) => `<div class="font-row"><span class="muted">${l}${e.fonts && e.fonts[r] ? ' ●' : ''}</span>${fontSel(r, e.fonts && e.fonts[r], `共通の設定（${fontLabel(cf[r] || (sf[r] || [])[0] || '—')}）`, 'data-cfont')}</div>`).join('');
    h += '<h3>色（このカット）</h3>' + colorRows(e.colors || {}, sc, 'c') + (key ? '<p class="note">合成用の背景では色の指定は使われません</p>' : '<p class="note">このカットの配色に効きます。前後に隙間があると、元の背景色が見えます</p>');
    const cfx = Object.assign({}, ST.header.plan.fx, ST.common.fx);
    h += '<h3>強さ（このカット）</h3>' + sliders(Object.assign({}, cfx, e.fx || {}), e.fx, CUT_FX, 'c') + '<p class="note">質感はこのカットの紙のテクスチャだけに効きます（粒子・ブルーム・周辺減光はコンポ全体で 1 つです）</p>';
    h += `<div class="row" style="gap:6px;margin-top:8px"><button class="small ce-roll">🎲 このカットを振り直す${e.roll ? `（${e.roll}）` : ''}</button><button class="small ce-reset">このカットの編集を元に戻す</button><button class="small ghost ce-back">カット一覧</button></div>`;
    h = `<p class="muted">${String(x.i + 1).padStart(3, '0')}　${esc(x.base.text || x.base.layout)}　${tc(x.base.start)}–${tc(x.base.end)}${ST.dirty.has(x.uid) ? '　● 変更あり' : ''}</p>` + h;
    binder = () => bindCut(x, key, special, eff, idx);
  }
  // common settings
  const c = ST.common, sc0 = ST.header.plan.style.schemes[0], sf0 = ST.header.plan.style.fonts || {};
  h += `<details class="tgroup ce-common" ${ST.commonOpen ? 'open' : ''}><summary><span class="tg-name">共通設定（コンポ全体。カット側で変えた項目はそちらが優先）${commonChanged() ? ' ●' : ''}</span></summary>
    ${ST.header.project ? '' : '<p class="note">このコンポには元のプロジェクト設定が無いため、書体・色の共通設定はスタイルの既定から作ります</p>'}
    ${ROLES.map(([r, l]) => `<div class="font-row"><span class="muted">${l}</span>${fontSel(r, c.fonts[r], `スタイルの既定（${fontLabel((sf0[r] || [])[0] || '—')}）`, 'data-gfont')}</div>`).join('')}
    ${colorRows(c.colors || {}, sc0, 'g')}
    ${sliders(Object.assign({}, ST.header.plan.fx, c.fx), null, ['motion', 'glitch', 'chroma', 'decor', 'texture'], 'g')}
    ${sliders(Object.assign({}, ST.header.plan.fx, c.fx), null, ['density', 'bgSwitch'], 'g')}
    <label class="row" style="gap:6px"><input type="checkbox" class="ce-flash" ${c.fx.flash !== false ? 'checked' : ''}> フラッシュ</label>
    <p class="note">カットの細かさ・背景の切替・フラッシュ・装飾の量は構成を作るときに効く設定です。変えるときは「読み戻す」で演出タブに移してから、通常の生成をしてください</p></details>`;
  body.innerHTML = h;
  if (binder) binder();
  bindCommon();
  body.querySelectorAll('.ce-pick').forEach(b => b.addEventListener('click', () => selectCut(b.dataset.uid)));
}
function bindCut(x, key, special, eff, idx) {
  const u = x.uid, body = $p('.ce-body');
  if (!body) return;
  const txt = body.querySelector('.ce-text');
  txt && txt.addEventListener('change', () => setEdit(u, 'text', txt.value.trim() || undefined));
  body.querySelectorAll('select[data-g]').forEach(s => {
    const g = s.dataset.g;
    if (g === 'layout' && special) s.disabled = true;
    if (g === 'enter' && eff && eff.cuts[idx] && eff.cuts[idx].trans) s.disabled = true;
    if (g === 'treat' && J.LAYOUTS[(eff ? eff.cuts[idx] : x.base).layout] && J.LAYOUTS[(eff ? eff.cuts[idx] : x.base).layout].treat === false) s.disabled = true;
    if (g === 'bg' && key) s.disabled = true;
    if (g === 'trans' && !(eff && transOk(eff.cuts[idx - 1], eff.cuts[idx]))) s.disabled = true;
    s.addEventListener('change', () => setEdit(u, g, s.value === '__none' ? null : (s.value || undefined)));
  });
  body.querySelectorAll('select[data-decor]').forEach(s => s.addEventListener('change', () => {
    const vals = [...body.querySelectorAll('select[data-decor]')].map(o => o.value);
    if (vals.every(v => !v)) setEdit(u, 'decor', undefined);
    else { const base = (x.base.decor || []).map(d => d.id); setEdit(u, 'decor', vals.map((v, i) => (v === '__none' ? null : v || base[i] || null))); }
  }));
  body.querySelectorAll('select[data-cfont]').forEach(s => s.addEventListener('change', () => { const e = editOf(u), f = Object.assign({}, e.fonts); if (s.value) f[s.dataset.cfont] = s.value; else delete f[s.dataset.cfont]; setEdit(u, 'fonts', Object.keys(f).length ? f : undefined); }));
  const colors = () => { const e = editOf(u); return Object.assign({}, e.colors || {}); };
  body.querySelectorAll('input[data-cflag]').forEach(cb => cb.addEventListener('change', () => { const c = colors(); c[cb.dataset.cflag] = cb.checked; if (!c.enabled && !c.accentOn) setEdit(u, 'colors', undefined); else { fillColors(c, cb.dataset.cflag, 'c'); setEdit(u, 'colors', c); } }));
  body.querySelectorAll('input[data-ccolor]').forEach(ci => ci.addEventListener('change', () => { const c = colors(); fillColors(c, ci.dataset.flag, 'c'); c[ci.dataset.ccolor] = ci.value.toUpperCase(); c[ci.dataset.flag] = true; setEdit(u, 'colors', c); }));
  body.querySelectorAll('input[data-cfx]').forEach(r => {
    r.addEventListener('input', () => { r.nextElementSibling.textContent = Math.round(r.value * 100); });
    r.addEventListener('change', () => { const e = editOf(u), f = Object.assign({}, e.fx); f[r.dataset.cfx] = +r.value; setEdit(u, 'fx', f); });
  });
  const on = (sel, fn) => { const b = body.querySelector(sel); b && b.addEventListener('click', fn); };
  on('.ce-roll', () => setEdit(u, 'roll', ((x.edit || {}).roll | 0) + 1));
  on('.ce-reset', () => { x.edit = {}; changed(u); });
  on('.ce-back', () => { ST.sel = null; render(); });
  on('.ce-adopt', () => {
    const tl = x.timeline, shift = tl.startTime - x.base.start, start = tl.inPoint, end = tl.outPoint < x.base.end + shift - 1e-3 ? tl.outPoint : x.base.end + shift;
    const i = ST.order.indexOf(u), a = ST.cuts.get(ST.order[i - 1]), b = ST.cuts.get(ST.order[i + 1]);
    setEdit(u, 'time', { start, end });
    if ((a && start < a.base.end - 1e-3) || (b && end > b.base.start + 1e-3)) status('採用しました。隣のカットと時間が重なっています', true);
  });
}
// ticking a colour group fills in the colours shown (the scheme's) so what you see is what gets built
function fillColors(c, flag, prefix) {
  const keys = flag === 'enabled' ? ['bg', 'fg', 'sub'] : ['accent', 'ghostA', 'ghostB'];
  for (const k of keys) { const inp = $p(`input[data-${prefix}color="${k}"]`); if (inp && !c[k]) c[k] = inp.value.toUpperCase(); }
}
function bindCommon() {
  const d = $p('.ce-common'); if (!d) return;
  d.addEventListener('toggle', () => { ST.commonOpen = d.open; });
  const c = ST.common, done = () => render();
  d.querySelectorAll('select[data-gfont]').forEach(s => s.addEventListener('change', () => { if (s.value) c.fonts[s.dataset.gfont] = s.value; else delete c.fonts[s.dataset.gfont]; done(); }));
  d.querySelectorAll('input[data-gflag]').forEach(cb => cb.addEventListener('change', () => { c.colors[cb.dataset.gflag] = cb.checked; if (cb.checked) fillColors(c.colors, cb.dataset.gflag, 'g'); done(); }));
  d.querySelectorAll('input[data-gcolor]').forEach(ci => ci.addEventListener('change', () => { fillColors(c.colors, ci.dataset.flag, 'g'); c.colors[ci.dataset.gcolor] = ci.value.toUpperCase(); c.colors[ci.dataset.flag] = true; done(); }));
  d.querySelectorAll('input[data-gfx]').forEach(r => {
    r.addEventListener('input', () => { r.nextElementSibling.textContent = Math.round(r.value * 100); });
    r.addEventListener('change', () => { c.fx[r.dataset.gfx] = +r.value; done(); });
  });
  const fl = d.querySelector('.ce-flash'); fl && fl.addEventListener('change', () => { c.fx.flash = fl.checked; done(); });
}

// ---- tab + polling
let pollTimer = 0;
function setPoll(on) {
  try { localStorage.setItem('jizura.cutPoll', on ? '1' : '0'); } catch (e) {}
  clearInterval(pollTimer);
  if (on) pollTimer = setInterval(() => { if (visible() && !ST.busy && !document.hidden) readSelection(false); }, 1500);
}
function inject() {
  const tabs = document.querySelector('.tabs');
  if (!tabs || document.querySelector('[data-pane="cut"]')) return;
  tabBtn = document.createElement('button');
  tabBtn.setAttribute('role', 'tab'); tabBtn.dataset.tab = 'cut'; tabBtn.setAttribute('aria-selected', 'false'); tabBtn.textContent = 'カット編集';
  tabs.appendChild(tabBtn);
  pane = document.createElement('div'); pane.className = 'tabpane'; pane.dataset.pane = 'cut'; pane.hidden = true;
  let poll = false; try { poll = localStorage.getItem('jizura.cutPoll') === '1'; } catch (e) {}
  pane.innerHTML = `<div class="row wrap" style="gap:6px"><button class="small ce-read">選択を読む</button>
      <label class="row" style="gap:6px" title="パネルをクリックしたとき・パネルに戻ったときに AE の選択を読みます"><input type="checkbox" class="ce-auto" checked> 自動（パネルに戻ったとき）</label>
      <label class="row" style="gap:6px" title="1.5 秒ごとに AE の選択を確かめます。大きいプロジェクトでは AE が重くなることがあります"><input type="checkbox" class="ce-poll" ${poll ? 'checked' : ''}> 選択を追いかける（重くなることがあります）</label></div>
    <p class="note ce-status">—</p>
    <div class="ce-body"></div>
    <div class="outbtns" style="margin-top:12px"><button class="primary ce-act ce-replace" title="選んでいるカットだけを作り直します。ほかのカットに AE で加えた手直しは残ります">このカットだけ差し替える</button><button class="ce-act ce-rebuild">作り直す（コンポ全体）</button><button class="small ce-cancel" hidden>中止</button></div>
    <label class="row" style="gap:6px;margin-top:6px"><input type="checkbox" class="ce-keep"> 前のコンポを残す（「(old)」の名前で残します）</label>
    <p class="note ce-hint">「作り直す（コンポ全体）」では、ほかのカットに AE で加えた手直し（キーフレーム・エフェクトなど）は失われます。直したのが 1 カットなら「このカットだけ差し替える」を使うと手直しが残ります。取り消すには AE で Cmd+Z</p>
    <div class="row" style="gap:6px;margin-top:6px"><button class="small ce-act ce-readback">このコンポの構成をパネルに読み戻す</button><button class="small ce-act ce-resetall">すべての編集を元に戻す</button></div>
    <p class="muted mono ce-summary"></p>`;
  const panes = document.querySelectorAll('.tabpane');
  panes[panes.length - 1].after(pane);
  // the editor binds its tab buttons once, at start-up: this one switches itself (the others already hide every .tabpane)
  tabBtn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b === tabBtn)));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.dataset.pane !== 'cut'; });
    readSelection(true);
  });
  $p('.ce-read').addEventListener('click', () => { ST.lastLite = ''; readSelection(true); });
  $p('.ce-poll').addEventListener('change', e => setPoll(e.target.checked));
  $p('.ce-rebuild').addEventListener('click', rebuild);
  $p('.ce-replace').addEventListener('click', replaceCut);
  $p('.ce-cancel').addEventListener('click', () => { if (ST.busy) { cancelReq = true; status('中止しています…（元のコンポは残します）'); } });
  $p('.ce-readback').addEventListener('click', readBack);
  $p('.ce-resetall').addEventListener('click', () => {
    for (const x of ST.cuts.values()) if (!isEmptyEdit(x.edit)) { x.edit = {}; saveEdit(x.uid); }
    ST.dirty.clear(); if (ST.commonBase) ST.common = JSON.parse(ST.commonBase); render();
  });
  const auto = () => $p('.ce-auto') && $p('.ce-auto').checked && visible() && !ST.busy;
  window.addEventListener('focus', () => { if (auto()) readSelection(false); });
  pane.addEventListener('pointerdown', e => { if (auto() && !e.target.closest('select, input, button')) readSelection(false); });
  const style = document.createElement('style');
  style.textContent = '.ce-list{display:flex;flex-direction:column;gap:4px;align-items:stretch}.ce-list button{text-align:left}.ce-decor select{flex:1;min-width:0}.ce-status.bad{color:#ff8a80;border-left-color:#ff8a80}.ce-body h3{margin:12px 0 6px}.ce-common{margin-top:12px}';
  document.head.appendChild(style);
  if (poll) setPoll(true);
  render();
}
const start = () => inject();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0)); else setTimeout(start, 0);
Object.assign(J.cutEdit, { state: ST, readSelection: () => readSelection(true), loadComp, selectCut, setEdit, rebuild, replaceCut, readBack, effective, render });
})();
