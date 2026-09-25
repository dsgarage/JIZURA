"""T-9 (docs/dsgarage/CUT_EDIT_SPEC.md §9.1): the CEP panel's "カット編集" tab in a browser. The built panel page runs with a mocked
CEP bridge whose evalScript executes host.jsx + host_cutedit.jsx + jizura_core.jsx on the emulated AE object model (dev/aeom.js),
like dev/cep_test.py (without the renderer).
usage: python3 build.py && python3 build_cep.py && (cd dev && npm ci) && python3 dev/cutedit_ui_test.py [outdir]
needs: pip install playwright && python3 -m playwright install chromium"""
import asyncio, functools, http.server, os, shutil, sys, tempfile, threading
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), 'jizura_cutedit_ui')
os.makedirs(OUT, exist_ok=True)

# a web root: the built extension + the mock's scripts
WWW = tempfile.mkdtemp(prefix='jizura_cutedit_www_')
shutil.copytree(os.path.join(ROOT, 'build', 'com.852wa.jizura'), os.path.join(WWW, 'cepx'))
shutil.copy(os.path.join(ROOT, 'dev', 'aeom.js'), WWW)
shutil.copy(os.path.join(ROOT, 'dev', 'node_modules', 'acorn', 'dist', 'acorn.js'), WWW)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(type('Q', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None}), directory=WWW))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'

MOCK = r"""
(function () {
  if (!/^http/.test(location.protocol)) return;          // only the panel page (not about:blank)
  window.__H = { vfs: {}, log: [], errors: [] };
  const H = window.__H;
  let env = null, G = null, run = null;
  const ready = (async () => {
    await new Promise(r => { if (document.readyState !== 'loading') r(); else document.addEventListener('DOMContentLoaded', r); });
    for (const u of ['/acorn.js', '/aeom.js']) { const t = await (await fetch(u)).text(); (0, eval)(t); }
    H.vfs['/fake/ext/jsx/host.jsx'] = (await (await fetch('/cepx/jsx/host.jsx')).text()).replace(/^var JZCEP = /m, 'G.JZCEP = ');
    H.vfs['/fake/ext/jsx/host_cutedit.jsx'] = await (await fetch('/cepx/jsx/host_cutedit.jsx')).text();
    H.vfs['/fake/ext/jsx/jizura_core.jsx'] = await (await fetch('/cepx/jsx/jizura_core.jsx')).text();
    env = AEOM.makeEnv({ fonts: () => true });
    G = env.ctx; G.G = G; H.env = env;
    const fileOf = p => ({ fsName: p, name: p.split('/').pop(), get exists() { return p in H.vfs; }, get parent() { return fileOf(p.replace(/\/[^\/]*$/, '')); },
      encoding: '', open() { return true; }, read() { const v = H.vfs[p]; return typeof v === 'string' ? v : new TextDecoder().decode(v); }, close() {}, remove() { delete H.vfs[p]; return true; } });
    G.File = function (p) { return fileOf(String(p)); };
    G.$ = { global: G, fileName: '/fake/ext/jsx/host.jsx', evalFile(f) { return run(G, H.vfs[f.fsName]); }, writeln() {}, sleep() {} };
    run = new Function('G', 'code', 'with (G) { return eval(code); }');
  })();
  window.__adobe_cep__ = {
    getSystemPath: k => 'file:///fake/ext',
    evalScript(code, cb) {
      ready.then(() => {
        let r;
        try { r = run(G, code); r = r === undefined ? 'undefined' : String(r); }
        catch (e) { H.errors.push(code.slice(0, 80) + ' :: ' + e.message); r = 'EvalScript error.'; }
        H.log.push(code.slice(0, 70)); cb && cb(r);
      });
    },
  };
  window.cep_node = {
    require: n => ({ fs: { writeFileSync: (p, d) => { H.vfs[p] = d; }, readFileSync: p => { const v = H.vfs[p]; if (!v) throw new Error('ENOENT ' + p); return v; } },
                     os: { tmpdir: () => '/tmp' }, path: { join: (...a) => a.join('/').replace(/\/+/g, '/') } })[n],
    Buffer: { from: u => u },
  };
  window.cep = { fs: { showSaveDialogEx: () => ({ data: '', err: 0 }) }, util: { openURLInDefaultBrowser() {} } };
})();
"""

results = []
def check(name, ok, detail=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (' — ' + str(detail) if detail else ''))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        await ctx.add_init_script("try{localStorage.setItem('jizura.mode','pro')}catch(e){}")
        await ctx.add_init_script(MOCK)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/cepx/index.html')
        await pg.wait_for_function("() => [...document.querySelectorAll('.ae-status')].some(e => e.textContent.includes('接続しました'))", timeout=90000)
        check('カット編集タブが出る', await pg.evaluate("() => !!document.querySelector('.tabs button[data-tab=cut]') && !!document.querySelector('[data-pane=cut]')"))
        await pg.click('.tabs button[data-tab=out]')
        await pg.click('#aeBuild')
        await pg.wait_for_function("() => [...document.querySelectorAll('.ae-status')].some(e => e.textContent.includes('作成しました'))", timeout=240000)
        # select cut 3's layer in the (mock) timeline, open the tab
        info = await pg.evaluate("""() => { const env = __H.env, c = env.comps.find(c => /^JIZURA /.test(c.name)); env.app.project.activeItem = c;
            const L = c._layers.find(L => /^003 /.test(L.name)); c.selectedLayers = [L];
            return { comp: c.name, id: c.id, stamped: /^JZ1 /.test(c.comment), base: JSON.parse(L.source.comment.slice(4)).base }; }""")
        check('生成したコンポに構成が保存される（JZ1）', info['stamped'], info['comp'])
        await pg.click('.tabs button[data-tab=cut]')
        await pg.wait_for_selector('[data-pane=cut] select[data-g=layout]', timeout=30000)
        st = await pg.evaluate("() => ({ status: document.querySelector('.ce-status').textContent, opt: document.querySelector('[data-pane=cut] select[data-g=layout] option').textContent, sel: J.cutEdit.state.sel })")
        want = '元の設定（' + (await pg.evaluate("n => J.registry('layout')[n].name", info['base']['layout'])) + '）'
        check('選択を読む → フォームに base の値が出る', '003' in st['status'] and st['opt'] == want, f"{st['status'][:60]} / {st['opt']}")
        await pg.screenshot(path=f'{OUT}/cut_form.png')
        # change the layout and decor 2, rebuild the comp
        await pg.select_option('[data-pane=cut] select[data-g=layout]', 'vcols')
        await pg.select_option('[data-pane=cut] select[data-decor="1"]', 'rings')
        await pg.click('.ce-rebuild')
        await pg.wait_for_function("() => /作り直しました|作り直せませんでした/.test(document.querySelector('.ce-status').textContent)", timeout=240000)
        done = await pg.evaluate("""() => { const env = __H.env, items = env.app.project._items(), mains = items.filter(i => i instanceof AEOM.Comp && /^JIZURA /.test(i.name));
            const m = mains[0], L = m && m._layers.find(L => /^003 /.test(L.name)), rec = L && JSON.parse(L.source.comment.slice(4));
            return { status: document.querySelector('.ce-status').textContent, mains: mains.length, name: m && m.name, layout: rec && rec.base.layout, edit: rec && rec.edit,
                     calls: __H.log.filter(s => /rebuild/.test(s)).length, sel: J.cutEdit.state.sel && J.cutEdit.state.cuts.get(J.cutEdit.state.sel) ? J.cutEdit.state.cuts.get(J.cutEdit.state.sel).i : null, herr: __H.errors.slice(0, 3) }; }""")
        check('レイアウトを変えて作り直す → rebuild が呼ばれ、コンポが置き換わる', done['mains'] == 1 and done['name'] == info['comp'] and done['edit'].get('layout') == 'vcols' and done['calls'] > 0 and '作り直しました' in done['status'],
              f"{done['status'][:200]} {done['herr']} / mains {done['mains']} / edit {done['edit']}")
        check('作り直し後も同じカットを選んでいる', done['sel'] == 2, done['sel'])
        await pg.screenshot(path=f'{OUT}/cut_rebuilt.png')
        # no selection: the cut list, and picking from it selects the layer in AE
        await pg.evaluate("() => { const c = __H.env.app.project.activeItem; c.selectedLayers = []; }")
        await pg.click('.ce-read')
        await pg.wait_for_selector('.ce-pick', timeout=20000)
        n = await pg.evaluate("() => document.querySelectorAll('.ce-pick').length")
        await pg.click('.ce-pick >> nth=4')
        await pg.wait_for_function("() => J.cutEdit.state.sel && J.cutEdit.state.cuts.get(J.cutEdit.state.sel).i === 4", timeout=20000)
        picked = await pg.evaluate("() => { const c = __H.env.app.project.activeItem; return c.selectedLayers.map(L => L.name); }")
        check('選択なし → カット一覧、クリックで AE のレイヤーを選ぶ', n > 5 and len(picked) == 1 and picked[0].startswith('005'), f'{n} cuts, AE selection {picked}')
        # 読み戻し
        await pg.evaluate("() => { J.ui.project.title = 'ちがう題'; }")
        await pg.click('.ce-readback')
        t = await pg.evaluate("() => J.ui.project.title")
        check('読み戻す → パネルのプロジェクトがコンポの構成になる', t != 'ちがう題', t)
        herr = await pg.evaluate('() => __H.errors')
        check('host / page のエラーが無い', not herr and not errs, (herr[:3], errs[:3]))
        await b.close()
    srv.shutdown()
    print(f'{sum(results)} / {len(results)} passed; screenshots: {OUT}')
    sys.exit(0 if all(results) else 1)
asyncio.run(main())
