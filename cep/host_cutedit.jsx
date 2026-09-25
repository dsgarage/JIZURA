/*  JIZURA 字面 — host side of the CEP panel's "カット編集" tab (ExtendScript, ES3). Loaded by cep.js after host.jsx;
    adds JZCEP.cut* / JZCEP.rebuild*. The work itself is JZ_CUTEDIT in the engine (ae/52_cutedit.jsx). docs/dsgarage/CUT_EDIT_SPEC.md  */
(function () {
    if (typeof JZCEP !== 'object' || !JZCEP) return;
    function core() {
        var C = $.global.JZ_CORE;
        if (!C || !C.cutEdit) throw new Error('jizura_core.jsx にカット編集がありません（パネルを入れ直してください）');
        return C;
    }
    function out(fn) {
        var C; try { C = core(); } catch (e0) { return '{"ok":false,"error":' + quote(e0.toString()) + '}'; }
        try { return C.cutEdit.json(fn(C)); } catch (e) { return C.cutEdit.json({ ok: false, error: e.toString() + (e.line ? ' (line ' + e.line + ')' : '') }); }
    }
    function quote(s) { return '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/[^\x20-\x7e]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }) + '"'; }
    // fonts: the same settings as host.jsx (ScriptUI panel's フォント tab)
    function setting(k, d) { try { if (app.settings.haveSetting('JIZURA', k)) return decodeURIComponent(app.settings.getSetting('JIZURA', k)); } catch (e) {} return d; }
    function roles(C) {
        var d = C.roleDefault;
        return { display: setting('font_display', d.display), serif: setting('font_serif', d.serif), body: setting('font_body', d.body), mono: setting('font_mono', d.mono), __force: setting('forceFonts', '0') === '1' };
    }
    function readTemp(path) {
        var f = File(path);
        if (!f.exists) return null;
        f.encoding = 'UTF-8'; f.open('r'); var s = f.read(); f.close();
        try { f.remove(); } catch (e) {}
        return s;
    }

    // ---- while rebuilding, the viewer shows a tiny empty comp: After Effects redraws the viewer each time a step hands control back,
    //      and a JIZURA comp full of expressions there can hold it for minutes (V-3). Afterwards the viewer goes back.
    function exists(it) {
        var id; try { id = it.id; } catch (e) { return false; }
        for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).id === id) return true;
        return false;
    }
    function viewerAway() {
        var v = { prev: null, tmp: null };
        try { var a = app.project.activeItem; if (a && a instanceof CompItem) v.prev = a; } catch (e) {}
        try { v.tmp = app.project.items.addComp('JZ rebuild \u4E00\u6642', 16, 16, 1, 1, 24); v.tmp.openInViewer(); } catch (e2) { v.tmp = null; }
        return v;
    }
    // back to what was shown; the old comp (replaced) or nothing → the new comp; a stopped / failed rebuild → the old comp
    function viewerBack(v, old, comp) {
        if (!v) return;
        try { if (v.tmp && exists(v.tmp)) v.tmp.remove(); } catch (e) {}
        var show = v.prev && v.prev !== old && exists(v.prev) ? v.prev : (comp && exists(comp) ? comp : (old && exists(old) ? old : null));
        try { if (show) show.openInViewer(); } catch (e2) {}
    }

    // ---- rebuild the whole comp from an edited plan: a build job like JZCEP.start / step, then the old comp goes
    var rb = null;
    function rebuildStart(C, s, oldId, opts) {
        var plan = C.parse(s), old = C.cutEdit.mainById(oldId);
        if (!plan || !plan.cuts || !plan.style) return { ok: false, error: 'JIZURA の構成データではありません' };
        if (!old) return { ok: false, error: '元のコンポが見つかりません（削除されたか、JIZURA のコンポではありません）' };
        var au = C.cutEdit.audioOf(old), job = null, view = null;
        app.beginUndoGroup('JIZURA カット編集: 作り直し');
        try { view = viewerAway(); job = C.start(plan, { roles: roles(C), audioItem: au ? au.item : null, audioStart: au ? au.start : 0 }); }
        catch (e) { viewerBack(view, old, null); throw e; }
        finally { app.endUndoGroup(); }
        rb = { job: job, plan: plan, old: old, oldName: old.name, opts: opts || {}, t0: new Date().getTime(), audio: !!au, view: view };
        return { ok: true, name: job.comp.name, total: job.total, events: job.events };
    }
    function rebuildStep(C, ms) {
        if (!rb) return { ok: false, error: '作り直し中のコンポがありません' };
        var job = rb.job, r = rb, err = null, t0 = new Date().getTime();
        // the build first (job steps); the stamp / old comp clean-up in a step of its own, so no call holds After Effects long
        if (!job.finished) {
            app.beginUndoGroup('JIZURA カット編集: 作り直し');
            try {
                job.step(ms > 0 ? ms : 1200);
                if (job.finished && rb.view && rb.view.tmp && exists(rb.view.tmp)) rb.view.tmp.openInViewer();     // the build's last step opened the new comp
            } catch (e) { err = e.toString() + (e.line ? ' (line ' + e.line + ')' : ''); }
            finally { app.endUndoGroup(); }
            if (!err) return { ok: true, done: false, phase: job.finished ? 'stamp' : job.phase, cuts: job.done, total: job.total, eventsDone: job.eventsDone, events: job.events, stepMs: new Date().getTime() - t0 };
        }
        rb = null;
        var res = null;
        app.beginUndoGroup('JIZURA カット編集: 作り直し');
        try { res = rebuildEnd(C, r, job, err, t0); }
        finally { viewerBack(r.view, r.old, job.comp); app.endUndoGroup(); }
        return res;
    }
    function rebuildEnd(C, r, job, err, t0) {
        var log = C.log() || [], notes = [], i, comp = job.comp;
        // stopped or failed: the old comp stays, the half-built one goes
        if (err || job.cancelled) {
            try { C.cutEdit.removeTree(comp); } catch (e2) {}
            return err ? { ok: false, error: err } : { ok: true, done: true, cancelled: true, name: r.oldName };
        }
        var ce = C.cutEdit.stamp(comp, r.plan);
        if (!ce.ok) log.push('カット編集: ' + ce.error);
        for (i = 0; i < (ce.notes || []).length; i++) log.push('カット編集: ' + ce.notes[i]);
        var oldAlive = false; try { oldAlive = !!(r.old && r.old.name != null); } catch (e3) { oldAlive = false; }
        var replaced = false;
        if (oldAlive) {
            if (!r.opts.keepOld) { try { replaced = C.cutEdit.removeTree(r.old); } catch (e4) { log.push('前のコンポを削除できませんでした: ' + e4.toString()); } }
            if (!replaced) {
                var n = r.oldName + ' (old)', k = 2;
                while (nameUsed(n)) n = r.oldName + ' (old ' + (k++) + ')';
                r.old.name = n;
            }
        }
        comp.name = r.oldName;
        for (i = 0; i < log.length && i < 20; i++) notes.push(String(log[i]));
        return { ok: true, done: true, cancelled: false, name: comp.name, compId: comp.id, replaced: replaced, keptOld: oldAlive && !replaced, cuts: job.done, total: job.total,
            secs: (new Date().getTime() - r.t0) / 1000, stepMs: new Date().getTime() - t0, fallbacks: C.fallbacks(), notes: notes, notesTotal: log.length, audio: r.audio, stamped: ce.ok,
            missingFonts: C.missingFonts ? C.missingFonts() : [] };
    }
    function nameUsed(n) { for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === n) return true; return false; }

    JZCEP.cutSel = function () { return out(function (C) { return C.cutEdit.sel(); }); };
    JZCEP.cutSelLite = function () { return out(function (C) { return C.cutEdit.selLite(); }); };
    JZCEP.cutHeader = function (compId) { return out(function (C) { return C.cutEdit.header(compId); }); };
    JZCEP.cutRead = function (compId) { return out(function (C) { return C.cutEdit.cuts(compId); }); };
    JZCEP.cutParts = function () { return out(function (C) { return C.cutEdit.parts(); }); };
    JZCEP.cutSelectLayer = function (compId, uid) { return out(function (C) { return C.cutEdit.selectLayer(compId, uid); }); };
    JZCEP.cutWriteEdit = function (compId, uid, enc) {
        return out(function (C) { app.beginUndoGroup('JIZURA カット編集: 編集を保存'); try { return C.cutEdit.writeEdit(compId, uid, decodeURIComponent(enc)); } finally { app.endUndoGroup(); } });
    };
    JZCEP.rebuildStartFromFile = function (path, oldId, enc) {
        return out(function (C) { var s = readTemp(path); if (s == null) return { ok: false, error: '構成データの一時ファイルが見つかりません' }; return rebuildStart(C, s, oldId, C.parse(decodeURIComponent(enc || '%7B%7D'))); });
    };
    JZCEP.rebuildStartFromString = function (encPlan, oldId, enc) {
        return out(function (C) { return rebuildStart(C, decodeURIComponent(encPlan), oldId, C.parse(decodeURIComponent(enc || '%7B%7D'))); });
    };
    JZCEP.rebuildStep = function (ms) { return out(function (C) { return rebuildStep(C, ms); }); };
    JZCEP.rebuildCancel = function () { if (rb) rb.job.cancelled = true; return '{"ok":true}'; };
})();
