// ================================================================ cut editor (CEP panel "カット編集" tab)
// docs/dsgarage/CUT_EDIT_SPEC.md. The plan of a built comp is kept in the comments of the items it made, so the panel can
// read a cut back from the layer selected in the timeline, edit it and rebuild:
//   main comp     'JZ1 ' + header {jz, k:'main', uid, chunks, plan (no cuts / events), project, cuts:[uid…], engine}
//                 (a header over JZ_CE_LIMIT bytes goes on in the cuts folder: 'JZ1 {…"k":"main2"…}\n' + the rest)
//   wrapper comp  'JZ1 ' + {jz, k:'cut', uid, main, i, base (the cut as generated), edit (the panel's overrides), ev (nearby events), sc, fx}
//   content / ghost comps  'JZ1 ' + {jz, k:'content' | 'ghost', uid (the cut's)}
// Text a user wrote in a comment before the 'JZ1 ' line is kept. Everything written is ASCII (\uXXXX escapes).
var JZ_CE_LIMIT = 14000;           // bytes per comment we allow ourselves (After Effects: 15,999)
var JZ_CE_MARK = 'JZ1 ';

// per-cut overrides of the style / strengths / scheme (cut.ov = {fonts, colors, fx}, made by the panel from the cut's edit).
// No cut.ov: the same objects come back, so a plain plan builds exactly as before.
function jzCutCtx(cut, st, FXV, sc) {
    var ov = cut && cut.ov, o = { st: st, fx: FXV, sc: sc }, i, k, c, s;
    if (ov && ov.fonts) {
        var roles = ['display', 'serif', 'body'], f = null;
        for (i = 0; i < roles.length; i++) if (ov.fonts[roles[i]]) { if (!f) { o.st = jzCopy(st); f = o.st.fonts = jzCopy(st.fonts); } f[roles[i]] = [String(ov.fonts[roles[i]])]; }
    }
    if (ov && ov.fx) {
        var ks = ['motion', 'glitch', 'chroma', 'texture'];
        for (i = 0; i < ks.length; i++) { k = ks[i]; if (typeof ov.fx[k] === 'number') { if (o.fx === FXV) o.fx = jzCopy(FXV); o.fx[k] = jzClamp(ov.fx[k], 0, 1); } }
    }
    // colours: this cut's scheme, the same rules as the browser's resolveStyle (bg / fg / sub first, then accent + ghosts fitted to the new bg).
    // 合成用の背景 keeps its white-on-black.
    c = ov && ov.colors;
    if (c && !st.key && (c.enabled || c.accentOn)) {
        s = jzCopy(sc);
        if (c.enabled) { var bk = ['bg', 'fg', 'sub']; for (i = 0; i < bk.length; i++) if (jzCleanHex(c[bk[i]])) s[bk[i]] = jzCleanHex(c[bk[i]]); }
        if (c.accentOn) {
            var acc = jzCleanHex(c.accent), gA = jzCleanHex(c.ghostA), gB = jzCleanHex(c.ghostB);
            if (acc) { s.accent = jzFitContrast(acc, s.bg, 2.4); if (sc.ink === sc.accent) s.ink = s.accent; if (sc.grad) s.grad = [jzFitContrast(acc, s.bg, 2.4), jzMixHex(acc, '#000000', 0.7)]; }
            if (gA) s.ghostA = jzFitContrast(gA, s.bg, 1.35);
            if (gB) s.ghostB = jzFitContrast(gB, s.bg, 1.35);
        }
        o.sc = s;
    }
    o.ghostAmt = o.fx.chroma * (o.st.ghost == null ? 1 : o.st.ghost);
    return o;
}

// ---------------------------------------------------------------- JSON writer (ExtendScript has no JSON object)
// {__jzRaw: '…'} is written as-is (JSON text read from a comment, passed through without parsing)
function jzCEQuote(s) {
    s = String(s); var out = '"', i, c, ch;
    for (i = 0; i < s.length; i++) {
        ch = s.charAt(i); c = s.charCodeAt(i);
        if (ch === '"' || ch === '\\') out += '\\' + ch;
        else if (c < 32 || c > 126) out += '\\u' + ('0000' + c.toString(16)).slice(-4);
        else out += ch;
    }
    return out + '"';
}
function jzCEStr(v) {
    var t = typeof v, a, i, k;
    if (v === null || v === undefined) return 'null';
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return jzCEQuote(v);
    if (t === 'function') return 'null';
    if (v.__jzRaw !== undefined) return String(v.__jzRaw);
    if (v instanceof Array) { a = []; for (i = 0; i < v.length; i++) a.push(jzCEStr(v[i])); return '[' + a.join(',') + ']'; }
    a = []; for (k in v) if (v.hasOwnProperty(k) && v[k] !== undefined) a.push(jzCEQuote(k) + ':' + jzCEStr(v[k]));
    return '{' + a.join(',') + '}';
}

// ---------------------------------------------------------------- comments
// the JIZURA part of a comment: {pre: user's text before it, body: after 'JZ1 '} or null
function jzCEPart(item) {
    var s = ''; try { s = String(item.comment || ''); } catch (e) { return null; }
    var i = s.indexOf(JZ_CE_MARK) === 0 ? 0 : s.indexOf('\n' + JZ_CE_MARK);
    if (i < 0) return null;
    if (i > 0) i++;
    return { pre: s.substr(0, i), body: s.substr(i + JZ_CE_MARK.length) };
}
// kind / uid / main uid from the start of the JSON (no parse; the header can be 14 KB)
function jzCETag(item) {
    var p = jzCEPart(item); if (!p) return null;
    var m = /^\{"jz":1,"k":"([a-z0-9]+)","uid":"([^"]*)"(?:,"main":"([^"]*)")?/.exec(p.body.substr(0, 200));
    return m ? { k: m[1], uid: m[2], main: m[3] || null } : null;
}
function jzCEWrite(item, body) {
    var p = jzCEPart(item), pre = '';
    if (p) pre = p.pre;
    else { try { pre = String(item.comment || ''); } catch (e) { pre = ''; } if (pre) pre += '\n'; }
    item.comment = pre + JZ_CE_MARK + body;
}
function jzCEIsComp(it) { try { return it instanceof CompItem; } catch (e) { return false; } }
function jzCEFindItem(id) { for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it.id === id) return it; } return null; }
function jzCEHash36(a, b, c, d) { return jzHash(a, b, c, d).toString(36); }

// wrapper layers of a main comp that carry a cut comment, in layer order: [{L, comp, tag}]
function jzCEWrappers(comp) {
    var out = [], i, L, t;
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        try { if (!L.source || !jzCEIsComp(L.source)) continue; } catch (e) { continue; }
        t = jzCETag(L.source);
        if (t && t.k === 'cut') out.push({ L: L, comp: L.source, tag: t });
    }
    return out;
}
// the full header JSON text of a main comp (joins the cuts folder's continuation), or null
function jzCEHeaderText(comp) {
    var p = jzCEPart(comp); if (!p) return null;
    var nl = p.body.indexOf('\n');
    if (nl < 0) return p.body;
    var head = jzParseJSON(p.body.substr(0, nl)), rest = p.body.substr(nl + 1);
    if (!(head.chunks > 1)) return rest;
    var W = jzCEWrappers(comp), f = null, q, qn;
    for (var i = 0; i < W.length && !f; i++) { try { f = W[i].comp.parentFolder; } catch (e) { f = null; } }
    q = f ? jzCEPart(f) : null;
    if (!q) return null;
    qn = q.body.indexOf('\n');
    if (qn < 0 || jzParseJSON(q.body.substr(0, qn)).uid !== head.uid) return null;
    return rest + q.body.substr(qn + 1);
}

// ---------------------------------------------------------------- stamp: write the plan into a freshly built comp
// plan.__project = the browser project (optional), plan.__cutedit = {cuts: [{base, edit}]} parallel to plan.cuts (a rebuild).
function jzCEStamp(comp, plan, extra) {
    extra = extra || {};
    var notes = [], cuts = plan.cuts || [], ce = plan.__cutedit || null, i, k;
    var uid = 'm-' + jzCEHash36(plan.seed, plan.title, new Date().getTime(), Math.random());
    var st = plan.style, schemes = st.schemes, fx = plan.fx || {};
    // wrapper layers of this build, matched to the plan's cuts by number (the layer name / comp name start with it) and start time
    var W = jzCEWrappers0(comp), byCut = [], folder = null, uids = [];
    for (i = 0; i < cuts.length; i++) {
        var pre = jzPad(i + 1, 3) + ' ', w = null;
        for (k = 0; k < W.length; k++) if (!W[k].used && W[k].comp.name.substr(0, 4) === pre && Math.abs(W[k].L.startTime - cuts[i].start) < 1e-4) { w = W[k]; w.used = true; break; }
        byCut.push(w);
    }
    for (i = 0; i < cuts.length; i++) {
        var w2 = byCut[i]; if (!w2) continue;
        var cut = cuts[i], cuid = 'c-' + jzCEHash36(uid, i, cut.start), base = ce && ce.cuts && ce.cuts[i] ? ce.cuts[i].base : cut, edit = ce && ce.cuts && ce.cuts[i] ? (ce.cuts[i].edit || {}) : {};
        var ev = [], evs = plan.events || [];
        for (k = 0; k < evs.length; k++) if (evs[k].t >= cut.start - 0.7 && evs[k].t <= cut.end) ev.push(evs[k]);
        var bcopy = jzCopy(base); delete bcopy.ov;
        var rec = { jz: 1, k: 'cut', uid: cuid, main: uid, i: i, base: bcopy, edit: edit, ev: ev, sc: schemes[(base.scheme || 0) % schemes.length] || schemes[0], fx: fx };
        var body = jzCEStr(rec);
        if (body.length > JZ_CE_LIMIT) { rec.ev = []; body = jzCEStr(rec); notes.push('cut ' + (i + 1) + ': 効果イベントを保存できませんでした（大きすぎます）'); }
        if (body.length > JZ_CE_LIMIT) { notes.push('cut ' + (i + 1) + ': 構成が大きすぎて保存できません'); continue; }
        jzCEWrite(w2.comp, body);
        var tagC = jzCEStr({ jz: 1, k: 'content', uid: cuid }), tagG = jzCEStr({ jz: 1, k: 'ghost', uid: cuid });
        for (k = 1; k <= w2.comp.numLayers; k++) {
            var L = w2.comp.layer(k), S = null;
            try { S = L.source && jzCEIsComp(L.source) ? L.source : null; } catch (e) { S = null; }
            if (!S) continue;
            if (L.name === 'content') jzCEWrite(S, tagC);
            else if (/ ghost$/.test(S.name) && !jzCETag(S)) jzCEWrite(S, tagG);
        }
        if (!folder) { try { folder = w2.comp.parentFolder; } catch (ef) { folder = null; } }
        uids.push(cuid);
    }
    // header: the plan without cuts / events / what the panel rebuilds anyway
    var hp = {};
    for (k in plan) if (plan.hasOwnProperty(k) && !/^(cuts|events|fontTable|fonts|beats|energy|energyRate|__project|__cutedit)$/.test(k)) hp[k] = plan[k];
    // lines: no chunks; a line's text / index are left out when a cut carries the same text (cut.lineText, cut.line) — the panel puts them back
    if (plan.lines) {
        var lt = {}; for (i = 0; i < cuts.length; i++) if (cuts[i].layout !== 'interlude' && cuts[i].line != null && !lt.hasOwnProperty('l' + cuts[i].line)) lt['l' + cuts[i].line] = cuts[i].lineText;
        hp.lines = [];
        for (i = 0; i < plan.lines.length; i++) {
            var l2 = jzCopy(plan.lines[i]); delete l2.chunks;
            if (l2.index === i) delete l2.index;
            if (lt.hasOwnProperty('l' + i) && lt['l' + i] === l2.text) delete l2.text;
            hp.lines.push(l2);
        }
    }
    var engine = { ae: String(app.version), core: 3, panel: typeof JZ_PANEL_VERSION === 'string' ? JZ_PANEL_VERSION : '' };
    var H = { jz: 1, k: 'main', uid: uid, v: 1, plan: hp, project: plan.__project || null, cuts: uids, engine: engine };
    var text = jzCEStr(H);
    if (text.length > JZ_CE_LIMIT * 2 && H.project) { H.project = null; text = jzCEStr(H); notes.push('歌詞が長いため、パネルへの読み戻し用の設定は保存しませんでした（作り直しはできます）'); }
    if (text.length > JZ_CE_LIMIT * 2) return { ok: false, error: '構成が大きすぎて保存できません（' + text.length + ' バイト）', notes: notes };
    if (text.length <= JZ_CE_LIMIT) jzCEWrite(comp, text);
    else {
        if (!folder) return { ok: false, error: '構成の続きを書く cuts フォルダが見つかりません', notes: notes };
        var cut1 = JZ_CE_LIMIT - 100;
        jzCEWrite(comp, jzCEStr({ jz: 1, k: 'main', uid: uid, chunks: 2 }) + '\n' + text.substr(0, cut1));
        jzCEWrite(folder, jzCEStr({ jz: 1, k: 'main2', uid: uid, seq: 2 }) + '\n' + text.substr(cut1));
    }
    return { ok: true, uid: uid, cuts: uids.length, of: cuts.length, bytes: text.length, chunks: text.length <= JZ_CE_LIMIT ? 1 : 2, notes: notes };
}
// wrapper layers of a just-built main comp (no comments yet): precomp layers whose comp contains a 'content' layer
function jzCEWrappers0(comp) {
    var out = [], i, L;
    for (i = 1; i <= comp.numLayers; i++) {
        L = comp.layer(i);
        try { if (!L.source || !jzCEIsComp(L.source)) continue; } catch (e) { continue; }
        var has = false; for (var j = 1; j <= L.source.numLayers && !has; j++) if (L.source.layer(j).name === 'content') has = true;
        if (has) out.push({ L: L, comp: L.source });
    }
    return out;
}

// ---------------------------------------------------------------- reading back
function jzCEMainOf(item, mainUid) {       // the main comp that uses this wrapper comp
    var u = [], i; try { u = item.usedIn; } catch (e) { u = []; }
    for (i = 0; i < u.length; i++) { var t = jzCETag(u[i]); if (t && t.k === 'main' && (!mainUid || t.uid === mainUid)) return u[i]; }
    for (i = 0; i < u.length; i++) { var t2 = jzCETag(u[i]); if (t2 && t2.k === 'main') return u[i]; }
    return null;
}
function jzCELayerOf(main, wc) { for (var i = 1; i <= main.numLayers; i++) { try { if (main.layer(i).source === wc) return main.layer(i); } catch (e) {} } return null; }
function jzCECutInfo(main, L, wc, why) {
    var p = jzCEPart(wc), t = jzCETag(wc), lid = null;
    try { lid = L.id; } catch (e) { lid = null; }
    return { ok: true, why: why, compId: main.id, compName: main.name, uid: t.uid, main: t.main, layerId: lid, layerIndex: L.index,
        timeline: { startTime: L.startTime, inPoint: L.inPoint, outPoint: L.outPoint }, cut: { __jzRaw: p.body } };
}
// §3.1: what the selection in After Effects points at
function jzCESel() {
    var c = app.project.activeItem;
    if (!c || !jzCEIsComp(c)) return { ok: false, why: 'nocomp' };
    var t = jzCETag(c), i;
    if (t && t.k === 'main') {
        var sel = c.selectedLayers;
        if (!sel.length) return { ok: false, why: 'noselect', compId: c.id, compName: c.name, main: t.uid };
        var L = sel[0], S = null;
        try { S = L.source && jzCEIsComp(L.source) ? L.source : null; } catch (e) { S = null; }
        var ts = S ? jzCETag(S) : null;
        if (ts && ts.k === 'cut') return jzCECutInfo(c, L, S, 'layer');
        if (/^JZ (Trans|FX) /.test(L.name)) {
            var W = jzCEWrappers(c), t0 = L.inPoint;
            for (i = W.length - 1; i >= 0; i--) if (t0 >= W[i].L.inPoint - 1e-4 && t0 < W[i].L.outPoint) return jzCECutInfo(c, W[i].L, W[i].comp, 'fxlayer');
        }
        return { ok: false, why: 'notcut', compId: c.id, compName: c.name, main: t.uid };
    }
    var wc = null;
    if (t && t.k === 'cut') wc = c;
    else if (t && (t.k === 'content' || t.k === 'ghost')) {
        var u = []; try { u = c.usedIn; } catch (e2) { u = []; }
        for (i = 0; i < u.length && !wc; i++) { var tu = jzCETag(u[i]); if (tu && tu.k === 'cut' && tu.uid === t.uid) wc = u[i]; }
    }
    if (!wc) return { ok: false, why: 'notjizura' };
    var main = jzCEMainOf(wc, jzCETag(wc).main), L2 = main ? jzCELayerOf(main, wc) : null;
    if (!main || !L2) return { ok: false, why: 'orphan' };
    return jzCECutInfo(main, L2, wc, 'inside');
}
function jzCESelLite() {
    var c = app.project.activeItem;
    if (!c || !jzCEIsComp(c)) return { ok: true, compId: 0, layerId: 0, n: 0 };
    var s = c.selectedLayers, lid = 0; try { lid = s.length ? s[0].id : 0; } catch (e) { lid = s.length ? s[0].index : 0; }
    return { ok: true, compId: c.id, layerId: lid, n: s.length };
}
function jzCEMainById(id) { var c = jzCEFindItem(id); if (!c || !jzCEIsComp(c)) return null; var t = jzCETag(c); return t && t.k === 'main' ? c : null; }
function jzCEHeader(id) {
    var c = jzCEMainById(id); if (!c) return { ok: false, error: 'JIZURA のコンポが見つかりません' };
    var h = jzCEHeaderText(c);
    if (h == null) return { ok: false, error: 'このコンポの構成情報が読めません（コメントが消えているか、続きの cuts フォルダがありません）' };
    return { ok: true, compId: c.id, compName: c.name, h: { __jzRaw: h } };
}
function jzCECuts(id) {
    var c = jzCEMainById(id); if (!c) return { ok: false, error: 'JIZURA のコンポが見つかりません' };
    var W = jzCEWrappers(c), out = [];
    for (var i = 0; i < W.length; i++) {
        var lid = null; try { lid = W[i].L.id; } catch (e) { lid = null; }
        out.push({ uid: W[i].tag.uid, layerId: lid, layerIndex: W[i].L.index, timeline: { startTime: W[i].L.startTime, inPoint: W[i].L.inPoint, outPoint: W[i].L.outPoint }, cut: { __jzRaw: jzCEPart(W[i].comp).body } });
    }
    return { ok: true, compId: c.id, cuts: out };
}
function jzCEParts() {
    var g = ['layout', 'enter', 'hold', 'exit', 'decor', 'treat', 'bg', 'cam', 'trans'], o = {};
    for (var i = 0; i < g.length; i++) o[g[i]] = jzOrder(g[i]);
    return { ok: true, orders: o };
}
function jzCESelectLayer(id, uid) {
    var c = jzCEMainById(id); if (!c) return { ok: false, error: 'JIZURA のコンポが見つかりません' };
    var W = jzCEWrappers(c), hit = null, i;
    for (i = 0; i < W.length && !hit; i++) if (W[i].tag.uid === uid) hit = W[i].L;
    if (!hit) return { ok: false, error: 'そのカットのレイヤーが見つかりません' };
    for (i = 1; i <= c.numLayers; i++) c.layer(i).selected = false;
    hit.selected = true;
    try { c.time = hit.inPoint; } catch (e) {}
    try { c.openInViewer(); } catch (e2) {}
    return { ok: true, layerId: hit.id };
}
// keep the panel's overrides of a cut in its wrapper comment (so they survive closing the panel)
function jzCEWriteEdit(id, uid, editJson) {
    var c = jzCEMainById(id); if (!c) return { ok: false, error: 'JIZURA のコンポが見つかりません' };
    var W = jzCEWrappers(c), n = 0;
    for (var i = 0; i < W.length; i++) if (W[i].tag.uid === uid && !W[i].done) {
        var rec = jzParseJSON(jzCEPart(W[i].comp).body);
        rec.edit = jzParseJSON(editJson);
        var body = jzCEStr(rec);
        if (body.length > JZ_CE_LIMIT) return { ok: false, error: '編集内容が大きすぎます' };
        jzCEWrite(W[i].comp, body); n++;
        for (var k = 0; k < W.length; k++) if (W[k].comp === W[i].comp) W[k].done = true;
    }
    return n ? { ok: true } : { ok: false, error: 'そのカットのレイヤーが見つかりません' };
}

// ---------------------------------------------------------------- rebuild helpers
// the song layer of an old main comp (moved over to the new one)
function jzCEAudioOf(comp) {
    for (var i = 1; i <= comp.numLayers; i++) { var L = comp.layer(i); try { if (L.hasAudio && L.source && L.source.file) return { item: L.source, start: L.startTime }; } catch (e) {} }
    return null;
}
// remove a built comp and everything it made that nothing else uses (comps only; the cuts folder once empty).
// Returns false and removes nothing when another comp uses the main comp.
function jzCERemoveTree(comp) {
    var used = []; try { used = comp.usedIn; } catch (e) { used = []; }
    if (used.length) return false;
    var set = [], seen = {}, todo = [comp], C, i, L, folders = [];
    while (todo.length) {
        C = todo.pop(); if (seen[C.id]) continue; seen[C.id] = true; set.push(C);
        for (i = 1; i <= C.numLayers; i++) { L = C.layer(i); try { if (L.source && jzCEIsComp(L.source)) todo.push(L.source); } catch (e1) {} }
    }
    for (i = 1; i < set.length; i++) { try { var f = set[i].parentFolder; if (f && f !== app.project.rootFolder && jzIndexOf(folders, f) < 0) folders.push(f); } catch (e2) {} }
    comp.remove();
    var alive = set.slice(1), changed = true;
    while (changed) {
        changed = false;
        for (i = alive.length - 1; i >= 0; i--) {
            var u = []; try { u = alive[i].usedIn; } catch (e3) { u = null; }
            if (u && u.length === 0) { try { alive[i].remove(); } catch (e4) {} alive.splice(i, 1); changed = true; }
        }
    }
    for (i = 0; i < folders.length; i++) { try { if (folders[i].numItems === 0) folders[i].remove(); } catch (e5) {} }
    return true;
}

var JZ_CUTEDIT = { stamp: jzCEStamp, sel: jzCESel, selLite: jzCESelLite, header: jzCEHeader, cuts: jzCECuts, parts: jzCEParts, selectLayer: jzCESelectLayer,
    writeEdit: jzCEWriteEdit, audioOf: jzCEAudioOf, removeTree: jzCERemoveTree, mainById: jzCEMainById, tag: jzCETag, json: jzCEStr, headerText: jzCEHeaderText, limit: function (n) { if (n > 0) JZ_CE_LIMIT = n; return JZ_CE_LIMIT; } };
