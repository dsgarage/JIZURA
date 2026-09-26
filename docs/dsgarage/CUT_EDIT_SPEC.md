# JIZURA CEP パネル「カット編集」仕様書

- 版: 0.2（段階 1 の実装に合わせて更新。行番号は upstream 4f9dab6 ＋本実装の `ae/50_build.jsx`）
- 作成日: 2026-09-25（0.1）／更新 2026-09-25（0.2）
- 対象: fork `dsgarage/JIZURA`（`develop` = upstream `852wa/JIZURA` 4f9dab6 に追従済み）、After Effects 2026 (26.5) / CEP 12、manifest の対応範囲は AE 22.0 以上
- 関連 Issue: dsgarage/JIZURA#1（段階 1: コンポ全体の作り直し）、dsgarage/JIZURA#2（段階 2: カット単位の差し替え）
- 参考実装: SakiikaVR/JIZURA-AviUtl2（MIT）の `src/lib.rs`（カットごとの設定項目）と `bridge.js`（Web 側で編集内容を plan に反映する処理）

本書は「確認できた事実」と「決定」と「未確認・未決」を分けて書く。事実には根拠のファイル位置を添える。未確認のものは **未確認** と明記し、段階 1 の最初の検証項目に回す。

---

## 0. 前提として確認した事実（根拠つき）

### 0.1 生成構造（`ae/50_build.jsx`）

- upstream 4f9dab6 で生成は **段階実行のジョブ** になった。`jzBuild(plan, opt)` は `jzBuildStart(plan, opt)` を最後まで回すだけのラッパー（`ae/50_build.jsx:20`）。`jzBuildStart` はメインコンポ `JIZURA <title>`（`:29`）とフォルダ `JIZURA <title> cuts`（`:32`）を作り、`job.step(ms)` で `buildCut(ci)` → `finishTrans()` → `buildEvent(ei)` → `finish()` の順に少しずつ進む（`:188-201`、`job.phase` = cuts / trans / events / done、`job.cancelled` で残りを飛ばして仕上げる）。CEP パネルは `JZCEP.start*` / `JZCEP.step(ms)` / `JZCEP.cancel()` でこのジョブを回す（`cep/host.jsx:60-97`、`cep/cep.js` の `buildInAE`）
- カットごとに、クロージャ `buildCut(ci)`（`:49-121`）が次を作る
  - content プリコンポ `NNN <text> text`（`:58`、レイアウトと装飾）
  - wrapper プリコンポ `NNN <text>`（`:67`。JZ BG / JZ Paper / 背景グラフィック / content / ghost B / ghost A / `JZ Camera` ヌル）
  - ゴースト用のコピー `NNN <text> ghost`（`jzNoGhost` レイヤーがあるときだけ、`:90`）
  - メインコンポ上の wrapper レイヤー `WL`（`startTime = cut.start`、`inPoint = cut.start`、`outPoint = cut.end`、名前 `NNN <text>` 24 文字まで、`:117-119`）
- つなぎ（trans）は `finishTrans()`（`:122-131`）が隣接する wrapper レイヤーの組に対してメインコンポ上で作る。前のカットの `outPoint` を `B.cut.start + td` まで延ばし（`:128`）、`JZ_REG.trans[tk].build(tctx)` が **新しいカットの wrapper レイヤー `t.B` にエフェクトを足す**（例 `ae/p_trans.jsx:14` の `ADBE Linear Wipe` 'JZ Trans Wipe'）ほか、`JZ Trans …` という名前のシェイプ/平面/調整レイヤーをメインコンポに足す（`ae/p_trans.jsx:18,77,95,…`）。HUD と `JZ FX` 調整レイヤーも `finishTrans()` の後半で作る
- 効果イベント（`plan.events`）は 2 系統
  - builtin（chroma/shake/slice/zoom/invert/flash）: `JZ FX` 調整レイヤーと `JZ Flash` 平面のエクスプレッションに **全イベントの配列を埋め込む**（`jzEventsArr`、`:137-166`）。chroma は各 wrapper 内のゴーストの Position エクスプレッションに、そのカットの時間範囲分だけ埋め込む（`:104`）
  - それ以外: `buildEvent(ei)`（`:157-162`）がメインコンポに `JZ FX <name>` の調整/シェイプ/平面レイヤーを 1 イベント 1 組で作る（`ae/45_core.jsx:45-57`、`ae/p_fx1.jsx`/`p_fx2.jsx`）
- `jzTidyTree` が最後に **非表示レイヤーを削除する**（`finish()` の `:182`、`:245-281`）。「非表示レイヤーに plan を隠す」方式はこの関数と衝突する
- plan はどこにも保存されない（本実装の前）。`cep/host.jsx` は `lastComp` / `lastPlan` をセッション内のメモリに持つだけ（`cep/host.jsx:5,81`）
- ファイル名の意味: `Layer.comment` は `JZ_NOGHOST` の印にすでに使っている（`ae/10_helpers.jsx:396-397`）。コメントを使うときはこの印を壊さないこと

### 0.2 plan の cut の実際のフィールド（`src/08_planner.js:338-339, 378-382` と `ae/15_plan.jsx:326-328`）

```
index, text, lineText, note, line, start, end, dur,
layout, enter, exit, hold, inDur, outDur, stagger,
params (layout の plan() の出力), decor[] ({id, seed, n, right, low, accent, corner, big, mode, from, to, v, r}),
scheme, seed, emph, recap, words[],
treat, treatP, bg, bgP, cam, camP, trans, transP, transDur
```

タイトルカードは `layout:'title'`、間奏は `layout:'interlude'`（`params.variant` など）。`makeCut` の既定値は `hold:'still', treat:'none', bg:'none', cam:'push'`（`src/08_planner.js:379`）。

### 0.3 plan JSON のサイズ（実測、AE 側プランナ `jzMakePlan` で noir・1920x1080・追加分あり）

| 歌詞の行数 | カット数 | plan 全体 | cuts 部分 | 1 カット最大 | events 部分 | style 部分 |
|---|---|---|---|---|---|---|
| 4 | 12 | 15,065 B | 11,148 B | 1,053 B | 2,251 B | 846 B |
| 12 | 36 | 42,464 B | 33,678 B | 1,204 B | 5,974 B | 846 B |
| 30 | 90 | 106,198 B | 84,987 B | 1,377 B | 15,538 B | 846 B |

ブラウザ版から渡す plan（`J.planForAE`、`src/11_export.js:194-209`）はこれに `fonts` / `fontTable`（23 書体 + ユーザー書体、数 KB）が加わる。

### 0.4 After Effects スクリプティングの上限（公式ドキュメント ae-scripting.docsforadobe.dev）

| 場所 | 型 | 上限 | 出典 |
|---|---|---|---|
| `Item.comment`（コンポ・フォルダ・フッテージ） | 文字列 | **15,999 バイト**（「after encoding conversion」）。見た目・挙動に影響しない | Item object |
| `Layer.comment` | 文字列 | **記載なし（未確認）** | Layer object |
| `app.settings` | 文字列 | 1,999 バイトを超えると `getSetting` が例外（AE 15.0.1 で確認と記載）。アプリ単位でプロジェクトに付随しない | Settings object |
| `Project.xmpPacket` | 文字列（RDF/XML） | 記載なし。プロジェクト単位 | Project object |
| `Layer.id` | 整数 | AE 22.0 以降、セッションをまたいで不変（他プロジェクトに読み込むと変わる） | Layer object |
| `Item.id` | 整数 | セッションをまたいで不変（他プロジェクトに読み込むと変わる） | Item object |
| `AVItem.usedIn` | CompItem の配列（読み取り専用、取得時にコピー） | そのアイテムを使っている全コンポ。旧コンポ削除の可否判定（§6.2、§7.2）に使う | AVItem object |

### 0.5 CEP から AE の選択を知る方法

- CEP 12 Cookbook の標準イベント表（documentAfterActivate / applicationActivate など）の対応列は PS/ID/AI/AN/PR/PL/AU で、**After Effects の列が無い**。AE は選択変更どころか文書イベントも発行しない
- Adobe コミュニティ（after-effects-discussions 13899040）の回答: 「選択変更のイベントは無い」「200 ms の evalScript ポーリングは大きいプロジェクトで AEGP の連鎖を起こしクラッシュする」「推奨はパネルがフォーカスを得たときの更新か、明示の更新ボタン」
- `cep/cep.js` は CSInterface.js を使わず `window.__adobe_cep__.evalScript` を直接呼んでいる（`cep/cep.js:9,20`）。選択の取得は既存の `JZCEP.info()`（`cep/host.jsx:81-90`）と同じく `activeItem.selectedLayers[0]` を読む

### 0.6 AviUtl2 版の項目と反映のしかた

- 項目（`src/lib.rs` 88-97 行付近）: `カット文字`、`時間オフセット`、`背景透過`、選択 11 種 `CUT_SELECT_ITEMS`（レイアウト/登場/保持/退場/装飾/装飾2/装飾3/加工/背景/カメラ/つなぎ。先頭「元の設定」、装飾とつなぎは「なし」あり）、書体 3 役割 `FONT_ITEMS`（先頭「スタイルの既定」）、色 6 種 `COLOR_ITEMS` と「背景・文字色を指定」「アクセント色を指定」、強さ 7 種 `FX_ITEMS`、`フラッシュ`、`共通BPM`
- 反映（`bridge.js` 103-175 行付近）: 元の cut を複製し、指定された group だけキーを差し替える。キーが変わったときだけ `def.plan(J.rng(sourceCut.seed), …)` で `params` / `<group>P` を作り直す。`text` を変えたら `text` / `lineText` / `words` を更新（params は作り直さない）。装飾は名前列を `{...元の decor[i], id, seed:(seed+i+1)|0}` に置き換える
- **fx / colors / fonts はカット単位の上書きと共通設定の 2 層**。`bridge.js` 103-107 行は `snap.nativeCut` と `snap.nativeEdit` があるとき、`edit.fx`（`density` を除く）、`edit.colors`、`edit.fonts` を **そのカットを描くときだけ** project に上書きし、上書き後の project で plan を作り直して該当カットを描く。`lib.rs` の `cut_edit_values` も fx/colors/fonts をカットごとの `nativeEdit` に入れる。別に `native_apply_button` → `aviLoadAndApply(snapshot, common)` があり、こちらは選択カットの値を **共通設定** としてプロジェクト全体に適用し全カットを作り直す（そのとき各カットの個別編集は新しい plan の値で上書きされる）
- 「元の設定」= その項目を指定しない = 自動生成された plan の値をそのまま使う

---

## 1. 目的・スコープ・非スコープ

### 1.1 目的

AE 上で JIZURA が生成したコンポについて、タイムラインでカットの wrapper レイヤーを選ぶと、CEP パネルの「カット編集」タブにそのカットの設定が出て、プルダウン等で変えて作り直せるようにする。編集できる項目は AviUtl2 版と同等にする。

### 1.2 スコープ

| 段階 | Issue | 内容 |
|---|---|---|
| 段階 1 | #1 | plan をコンポに保存する / 選択レイヤーからカットを特定する / タブで編集する / 編集後の plan から **コンポ全体を作り直す**（古いコンポは置き換える） |
| 段階 2 | #2 | **選んだカットだけを差し替える**。ほかのカットに AE で加えた手直し（キーフレーム、エフェクト、レイヤー追加など）を残す |

### 1.3 非スコープ

- タイミング編集（カットの開始/終了、行の開始時刻、BPM、カット数）。これらはプランナ（`J.plan`）の入力で、カット境界とイベントが全部変わる。「読み戻し」で復元したプロジェクトをブラウザ側の既存 UI（行リスト・演出タブ）で変えて通常生成する道を案内する（§5.6）
- ScriptUI 版パネル（`JIZURA_AE.jsx`）への同機能の追加
- ブラウザ版（パネル外）の UI 変更
- 段階 2 での効果イベント（`plan.events`）の作り直し。イベントはカット境界の時刻と強調フラグから決まり、編集項目（レイアウト等）では変わらないため据え置く（§7.5）
- AE 上でユーザーが加えた手直しを plan に「逆輸入」すること

---

## 2. plan の保存方式

### 2.1 候補の比較

要件: (a) 12 カット 15KB 〜 90 カット 106KB が入る、(b) プロジェクトの保存/再オープンで残る、(c) コンポの複製・別プロジェクトへの読み込みに耐える、(d) `jzTidyTree` と衝突しない、(e) upstream のファイル変更が最小、(f) ES3 で読み書きできる。

| 候補 | 容量 | 保存 | 複製・読み込み | 衝突/その他 | 判定 |
|---|---|---|---|---|---|
| A. メインコンポの `Item.comment` に plan 全体 | 15,999 B。12 カットでもう一杯 | 残る | コンポ複製でコメントも複製される | 生成物に一切影響しない | 容量不足。単独では不可 |
| B. **分散コメント**: メインコンポ = ヘッダ、各 wrapper コンポ = その cut と近傍イベント、フォルダ = ヘッダの続き | 1 wrapper あたり最大 1.4KB × 2（base + edit）＋イベント ≈ 3KB ≪ 15,999。ヘッダは §2.3 の圧縮で 100 行の歌詞まで 1 枠に収まる見込み | 残る | wrapper レイヤーの `source` を辿るので、レイヤー名・順番・複製に無関係。コンポを別プロジェクトに読み込んでも `comment` は残る | `jzTidyTree` は comment を見ない。upstream のコード変更なし（生成後に書き足す） | **採用** |
| C. メインコンポ内の非表示テキストレイヤーの sourceText | 上限未確認 | 残る | 複製で残る | `jzTidyTree` が非表示レイヤーを削除する（`:229`）。タイムラインに見えて邪魔。100KB のテキストのレイアウト計算が重い | 不可 |
| D. マーカーのコメント | 上限未確認 | 残る | 残る | パネルの `markers()` がコンポマーカーを行頭として読む（`cep/host.jsx:100-110`）ので衝突する | 不可 |
| E. `Project.xmpPacket` | 上限記載なし | 残る | **コンポ単位ではない**。コンポを別プロジェクトに読み込むと失われる。id で紐づけるが `Item.id` は読み込みで変わる | XML の生成/解析が ES3 で必要 | 補助用途にも不要。不採用 |
| F. 外部ファイル（`~/.ae-mcp` 等） | 無制限 | プロジェクトと別管理。別マシン・別パスで失われる | 不可 | パス・id の対応表が要る | 不採用 |
| G. `app.settings` | 1,999 B | アプリ単位 | 不可 | — | 不採用 |

### 2.2 決定: B「分散コメント」

- **メインコンポの `comment`**: ヘッダ（plan から `cuts` と `events` を除いたもの ＋ 復元用の `project`）。§2.3 の形式
- **cuts フォルダの `comment`**: ヘッダが 1 枠（安全側 14,000 バイト）に収まらないときの続き（チャンク 2）。それでも収まらなければ生成時にエラーで止め、理由を表示する（§11 未決 1）
- **各 wrapper コンポの `comment`**: その cut の `base`（生成時の値）、`edit`（編集の上書き）、`ev`（`start - 0.7` 〜 `end` の範囲のイベント。段階 2 の再生成では使わないが読み戻しの復元に使う）
- **content コンポ・ghost コンポの `comment`**: `{"jz":1,"k":"content"|"ghost","cut":"<uid>"}` だけ。ユーザーが content の中を選んでいるときの逆引き用
- wrapper レイヤー（メインコンポ上）そのものには何も書かない。`source` を辿れば足りる。`JZ_NOGHOST` 用の `Layer.comment` とも衝突しない

書き込みのタイミング（実装）: ジョブ方式になったので、`cep/host.jsx` の `result()`（ジョブが終わってパネルに結果を返す関数、`cep/host.jsx:76-83`）の先頭で `C.cutEdit.stamp(comp, jobPlan)` を呼ぶ（**`host.jsx` に 1 行追加**。専用の Undo グループ 'JIZURA'、失敗しても生成は成功扱いにして `notes` に理由を入れる）。中止したジョブも、作れたカットの分だけ stamp する。エンジン `jzBuildStart` 側は変更しない。`stamp` は wrapper を名前ではなく、**メインコンポのレイヤーのうち `content` レイヤーを持つプリコンポ**（`jzCEWrappers0`）から探し、plan の `cuts[i]` に「コンポ名の先頭が `jzPad(i+1,3)+' '` かつ `startTime` が `cut.start` と 1e-4 以内」で対応づける（`cut.end > cut.start` でないカットは作られないので、対応が見つからないカットは飛ばす）。

### 2.3 コメントの形式

先頭 4 文字を `JZ1 ` とし、以降は 1 行の JSON。JSON を読めるのは `jzParseJSON`（`ae/00_core.jsx:22`）で、AE 側では `JSON.parse` が無い環境（`eval`）も想定されているため、コメントに書く JSON は ExtendScript 側では **`str()`（`cep/host.jsx:19-28`）で書き、`jzParseJSON` で読む**。

```jsonc
// メインコンポ
JZ1 {"jz":1,"k":"main","uid":"m-<hash>","v":1,"chunks":2,
     "plan":{ /* plan から cuts, events, fontTable, beats, energy を除いたもの。lines[].chunks も除く */ },
     "project":{ /* ブラウザ版の project（S.project）。CEP 経由の生成時だけ入る */ },
     "cuts":["c-<hash>", ...],            // plan.cuts の順の uid（順序と欠落検出用）
     "engine":{"ae":"26.5x89","core":2,"panel":"2.0"}}
// cuts フォルダ（ヘッダが 14,000 バイトを超えたときの続き）
JZ1 {"jz":1,"k":"main2","uid":"m-<hash>","seq":2,"tail":"<ヘッダ JSON 文字列の残り>"}
// wrapper コンポ
JZ1 {"jz":1,"k":"cut","uid":"c-<hash>","main":"m-<hash>","i":7,
     "base":{ /* 生成時の cut そのもの */ },
     "edit":{ /* §4 の上書き。空なら {} */
       "text":"…", "layout":"vcols", "enter":…, "hold":…, "exit":…, "decor":[id|null ×3], "treat":…, "bg":…, "cam":…, "trans":null|key,
       "roll":0,
       "fonts":{"display":"dela"},                                   // role → 書体キー（指定した役割だけ）
       "colors":{"enabled":true,"bg":"#101010","fg":"#FFFFFF","sub":"#BBBBBB","accentOn":false,"accent":…,"ghostA":…,"ghostB":…},
       "fx":{"motion":0.9,"glitch":0.2,"chroma":0.7,"texture":0.6,"decor":0.5} },   // decor は保存のみ（§4.1）
     "ev":[ /* plan.events のうち t が [start-0.7, end] のもの */ ],
     "sc":{ /* 生成時の scheme（メインコンポのヘッダを失っても段階 2 が動くための冗長データ、§3.2） */ }}
```

`edit.fonts/colors/fx` は §4.4 の規則で実効 cut の `cut.ov` に変換されて AE に渡る。コメントには `base`（ov 無し）と `edit` を保存し、`ov` は保存しない（作り直しのたびに `apply` で作る）。

- `uid` は `'m-' + jzHash(plan.seed, plan.title, 生成時刻ミリ秒, Math.random())`（`ae/00_core.jsx:49`）を 36 進数にした短い文字列（同じミリ秒に 2 回作っても重ならないよう乱数を足した）。cut の uid は `'c-' + jzHash(main uid, plan 内の位置 i, cut.start)`
- サイズ見積り: ヘッダ = `style` 846B ＋ `lines`（1 行 ≈ 130B）＋ `project`（歌詞本文 ＋ overrides ≈ 歌詞の 2 倍）＋ その他 ≈ 1.5KB。100 行の歌詞でおよそ 13KB ＋ 歌詞本文 ×2。14,000 バイトを超えたらチャンク 2 へ
- 書き込み前に UTF-8 バイト数を数える（`str()` は非 ASCII を `\uXXXX` に逃がすので、実際は ASCII のみになり 1 文字 = 1 バイト。日本語 1 文字が 6 バイトになる点に注意して見積る。上の実測値は `JSON.stringify` の UTF-8 バイト数なので、`\uXXXX` 化後は日本語部分が約 2 倍になる。**歌詞本文を含む `project` と `lines` は日本語の割合が高い**。安全側で `project.lyrics` は `encodeURIComponent` ではなく `\uXXXX` のまま入れ、超過時はチャンク 2 に回す）

#### 2.3.1 実装で確定した形式（0.2 で追記）

- 分割: ヘッダ（`jzCEStr(H)`、ASCII）が `JZ_CE_LIMIT`（14,000）以下ならメインコンポに `JZ1 ` ＋ 1 行の JSON。超えたら、メインコンポに `JZ1 {"jz":1,"k":"main","uid":…,"chunks":2}` ＋ 改行 ＋ ヘッダ文字列の前半（`LIMIT - 100` 文字）、cuts フォルダに `JZ1 {"jz":1,"k":"main2","uid":…,"seq":2}` ＋ 改行 ＋ 後半。ヘッダは ASCII で改行を含まないので、改行を区切りに使える。読むときは 1 行目が `chunks > 1` ならフォルダ（wrapper コンポの `parentFolder`）の続きを uid を確かめてつなぐ
- 2 枠（28,000）を超えたら §11-1 の決定どおり `project` を落として再試行し、それでも超えたら stamp を失敗にする（生成は成功扱い、notes に理由）
- **lines の圧縮**: 実測で 100 行の歌詞は `lines` だけで約 24 KB（1 行 ≈ 240 B。`text` と `emph` が `\uXXXX` で膨らむ）あり、§2.3 の見積り（1 行 ≈ 130 B）より大きかった。ヘッダの `lines[i]` は `chunks` を除き、`index === i` なら `index` を、同じ本文を持つカット（`cut.line === i` かつ間奏でない最初のカットの `lineText`）があれば `text` を省く。パネルの `effectivePlan` が `base.line` / `base.lineText` から戻す。100 行・347 カットでヘッダ 27,185 B（project 込み、2 枠）
- **project の圧縮**: `project.enabled`（全部品の ON/OFF 表、約 7 KB）は OFF の項目だけを残す（`J.cutEdit.packProject`。`J.plan` は無い項目を ON と扱う）。読み戻しで `unpackProject` が既定値と合わせる
- 印（タグ）の読み取り: 先頭 200 文字を `/^\{"jz":1,"k":"(\w+)","uid":"([^"]*)"(?:,"main":"([^"]*)")?/` で読む（ヘッダ全体を parse しない）。そのため JSON のキー順は `jz, k, uid, main, …` に固定する。content / ghost コンポは `{"jz":1,"k":"content"|"ghost","uid":"<cut の uid>"}`（§2.2 の `"cut"` キーは `uid` に統一）
- ユーザーのメモ: `JZ1 ` が先頭でなければ `\nJZ1 ` を探し、その前の文字列は書き直しても残す（§11-11）
- `base` は生成時の cut から `ov` を除いたもの（作り直しでは `plan.__cutedit.cuts[i].base`）。`edit` は `plan.__cutedit.cuts[i].edit`（生成直後は `{}`）

### 2.4 実機で最初に確認すること（段階 1 の検証項目 V-0）

| # | 確認 | 期待 | 未確認の理由 |
|---|---|---|---|
| V-0-1 | `CompItem.comment` と `FolderItem.comment` に 15,900 バイトの ASCII を書き、読み戻す。プロジェクトを保存 → 閉じる → 開き直して再読 | 一致する | 上限 15,999 は公式記載だが、AE 2026 で同じかは未確認。「バイト」の数え方も未確認 |
| V-0-2 | 同じく 16,100 バイトを書く | 例外か切り詰めか、どちらかを記録する | 超過時の挙動が未記載 |
| V-0-3 | `\uXXXX` を含まない日本語（UTF-8 で 12,000 バイト）を書き、読み戻す | 一致する | 「encoding conversion」の意味が未確認 |
| V-0-4 | コメント付きコンポを Cmd+D で複製、プリコンポーズ、別プロジェクトに「読み込み」 | いずれも comment が残る | 複製で残ることは AE の一般挙動だが未検証 |
| V-0-5 | `Layer.comment` に 4,000 バイトを書き、読み戻す | 一致する（使わない前提だが、将来の逃げ道として上限を知る） | 上限未記載 |
| V-0-6 | `evalScript` の戻り文字列 120KB | 欠けずに返る。欠けるなら ae-mcp と同じ 100KB チャンク読み出し（ae-mcp `docs/SPEC.md` §3.4）にする | ae-mcp が 100KB でチャンク化しているが上限の根拠は未確認 |

V-0-1〜3 の結果で「安全側の上限」定数（初期値 14,000）を決める。

---

## 3. カットとレイヤーの対応付け

### 3.1 選択 → カット

`JZCEP.cutSel()`（新規、`cep/host_cutedit.jsx`）が次の順で解決し、JSON を返す。

1. `app.project.activeItem` が CompItem でなければ `{ok:false, why:'nocomp'}`
2. `activeItem.comment` が `k:"main"` なら「メインコンポを開いている」。`selectedLayers[0]` があれば
   - `L.source` が CompItem で、その `comment` が `k:"cut"` → そのカット（wrapper レイヤー）
   - `L.name` が `JZ Trans ` / `JZ FX ` で始まる → `L.inPoint` を含むカットを `WL` の範囲から探して返し、`why:'fxlayer'` を添える（編集は可能、選択中のレイヤーは差し替え対象ではない旨を表示）
   - それ以外（`JZ Background`、`JZ FX`、HUD、音声など）→ `{ok:false, why:'notcut'}`
   - `selectedLayers` が空 → `{ok:false, why:'noselect', main:<uid>}`（タブは「カット一覧」だけ出す。§5.3）
3. `activeItem.comment` が `k:"cut"` なら「wrapper の中を開いている」→ そのカット（`why:'inside'`）
4. `k:"content"|"ghost"` なら `cut` uid で wrapper を探して返す（`why:'inside'`）
5. どれでもなければ `{ok:false, why:'notjizura'}`

戻り値には `compId`（メインコンポの `Item.id`）、`layerId`（`Layer.id`。AE 22+）、`layerIndex`、`uid`、`base`、`edit`、`ev`、`timeline:{startTime,inPoint,outPoint}` を入れる。ヘッダは別呼び出し `JZCEP.cutHeader(compId)` で 1 回だけ取り、パネル側で `compId` をキーにキャッシュする（メインコンポの comment は最大 16KB なので毎回は読まない）。

### 3.2 ユーザーがレイヤーを変えたとき

| 操作 | 影響 | 扱い |
|---|---|---|
| レイヤー名を変えた | なし（`source.comment` で引く） | そのまま |
| レイヤーの順番を変えた | なし。段階 2 の差し替えは `layerId` で元の位置（`index`）を取り、新レイヤーを `moveBefore(旧)` で同じ位置に入れる | そのまま |
| レイヤーを時間方向に動かした（`startTime` 変更） | plan の `start` とずれる。wrapper 内部は相対時間なので動画としては壊れない | パネルに「タイムラインの位置が構成と違います」を表示。段階 1 の作り直しでは **plan の値を正**とし、ずれを採用するボタン（`base.start/end` を `startTime` と `outPoint - inPoint` から書き換え、隣接カットとの重なりを警告）を用意する（§11 未決 3） |
| `inPoint`/`outPoint` をトリムした | 同上 | 同上 |
| レイヤーを複製した（Cmd+D） | 2 枚のレイヤーが同じ wrapper コンポ（同じ uid）を指す | 選択中の **レイヤー** を対象にする。段階 2 の差し替えは新しい wrapper コンポを作って選択レイヤーだけ差し替え、もう一方は旧コンポのまま残す。段階 1 の作り直しでは複製は失われる旨を表示 |
| レイヤーを削除した | `cuts[]` の uid が見つからない | 段階 1 の読み戻しでは、そのカットを `base` のまま再生成するか除くかを選ばせる（既定: 除く＝タイムライン優先） |
| wrapper コンポをプロジェクトパネルで複製し別のレイヤーに使った | uid 重複 | 同上（レイヤー単位で扱う） |
| 別プロジェクトに読み込んだ | `Item.id` / `Layer.id` が変わるが uid は comment 内なので有効 | ヘッダは `compId` ではなく uid でキャッシュし直す |
| メインコンポの comment を消した | ヘッダ喪失 | `k:"cut"` のコメントだけで cut は復元できるが style/lines が無い → 「このコンポは作り直せません（構成情報が消えています）」。段階 2（1 カット差し替え）は `base` に必要な `st`/`fx` が無いと動かないので、**wrapper の comment にも `sc`（そのカットの scheme）と `fx` の値を冗長に入れておく**（1 スキーム ≈ 200B） |

---

## 4. 編集項目

### 4.1 AviUtl2 との対応表

「plan の書き先」は wrapper コメントの `edit` オブジェクトのキー。実効値 = `base` に `edit` を重ねたもの。「元の設定」は `edit` からキーを消すこと（AviUtl2 と同じ意味: 自動生成の値をそのまま使う）。

| AviUtl2 の項目 | 種類 | plan の書き先 | 選択肢の出どころ | 備考 |
|---|---|---|---|---|
| カット文字 | テキスト | `edit.text` → 実効 `cut.text`, `cut.lineText`, `cut.words = J.chunkText(text)` | — | 空なら元の設定。`J.LAYOUTS[layout].fits(n)` を満たさないとき警告（params は作り直さない。AviUtl2 と同じ） |
| 時間オフセット | 数値 | **対象外** | — | AviUtl2 のオブジェクト内時間の補正。AE ではレイヤーを動かせばよい |
| 背景透過 | チェック | **対象外** | — | AviUtl2 の描画オプション。AE では `keyBg`（プロジェクト設定）で代替 |
| レイアウト | 選択 | `edit.layout` | `J.order('layout')` のうち AE 側 `JZ_REG.layout` にあるもの（§4.3） | `title` / `interlude` は特殊レイアウトなので候補から外す。間奏カットとタイトルカードはレイアウト変更不可（他の項目は可） |
| 登場 | 選択 | `edit.enter` | 同 `enter` | つなぎがあるカットは生成時に `enter='cut'` に固定されている（`src/08_planner.js:334`）。つなぎを「なし」にしたときだけ有効 |
| 保持 | 選択 | `edit.hold` | 同 `hold` | |
| 退場 | 選択 | `edit.exit` | 同 `exit` | 次のカットにつなぎがあると生成時に `exit='cut'`（`:335`）。次カットのつなぎを変えたら再評価 |
| 装飾 / 装飾2 / 装飾3 | 選択 ×3 | `edit.decor` = `[id|null, id|null, id|null]`（配列があれば丸ごと置換、無ければ元の設定） | 同 `decor` ＋「なし」 | AviUtl2 と同じく `{...base.decor[i] || base.decor[0] || {}, id, seed:(seed+i+1)|0}`。空欄は詰める |
| 加工 | 選択 | `edit.treat` | 同 `treat`（`none` は「なし」として先頭） | `LM.treat === false` のレイアウトでは無効表示 |
| 背景 | 選択 | `edit.bg` | 同 `bg`（`none` は「なし」） | `keyBg` 使用時は無効（`KEY` のとき背景は作られない `:71`） |
| カメラ | 選択 | `edit.cam` | 同 `cam` | |
| つなぎ | 選択 | `edit.trans`（`null` = なし） | 同 `trans` ＋「なし」 | 前カットと連続（`|prev.end - start| < 0.06`）で `dur > 0.5` のときだけ有効（`:327`）。`transDur` は `J.clamp(TD.dur||0.35, 0.12, min(0.6, dur*0.45))` で再計算 |
| 見出し/明朝枠/小さな文字フォント | 選択 ×3 | **カット単位** `edit.fonts[role]`（display/serif/body）＋ 共通 `common.fonts[role]` | `J.FONTS`（＋ユーザー書体）、先頭「スタイルの既定」 | AviUtl2 と同じ 2 層。カット単位の反映は §4.4。共通は `style.fonts[role]=[key]`（`J.resolveStyle`、`src/04_styles.js:173-174`）→ `planForAE` が label に直す |
| 背景・文字色を指定 / 背景色・文字色・補助色 | チェック + 色 ×3 | **カット単位** `edit.colors.enabled/bg/fg/sub` ＋ 共通 `common.colors.…` | — | カット単位は **そのカットの scheme** に適用（§4.4）。共通は `J.resolveStyle` と同じく `schemes[0]` だけ置換（`:159`） |
| アクセント色を指定 / アクセント・ズレ色A・B | チェック + 色 ×3 | **カット単位** `edit.colors.accentOn/accent/ghostA/ghostB` ＋ 共通 `common.colors.…` | — | どちらも `fitContrast` 込み（`:161-170`、AE 側は `jzFitContrast` `ae/16_omakase.jsx:27`） |
| 動きの強さ/グリッチ/色ズレ/質感 | 0..1 ×4 | **カット単位** `edit.fx.motion/glitch/chroma/texture` ＋ 共通 `common.fx.…` | — | 生成時に効く値（`FXV`、`ae/50_build.jsx:31`）。カット単位の反映は §4.4。質感のうちグレイン/ブルーム/周辺減光はメインコンポの `JZ FX` で全体に 1 つなので **カット単位では紙のテクスチャだけ**が変わる（注記を出す） |
| 装飾の量 | 0..1 | 共通 `common.fx.decor`（カット単位は保存のみ `edit.fx.decor`） | — | 生成時に `fx.decor` を読む部品は無い（`ae/*.jsx` で読むのはプランナ `15_plan.jsx` と `50_build.jsx:31` の `FXV` 代入だけ）。装飾の数はプランナの `pickDecor` で決まるので、カット単位に効かせるには再プランが要る。装飾を増減したいときは装飾 1〜3 の選択で行う（未決 4） |
| カットの細かさ/背景の切替 | 0..1 ×2 | 共通 `common.fx.density/bgSwitch` | — | **プランナ時にしか効かない**（カット数・scheme）。タブでは表示するが「構成の作り直しが必要」と注記し、§5.6 の読み戻し → 通常生成に誘導（§11 未決 4）。AviUtl2 でも `density` はカット単位から除外している（`bridge.js:105`） |
| フラッシュ | チェック | 共通 `common.fx.flash` | — | プランナ時（`flash` イベントの有無 `:351`）。同上 |
| 共通BPM | 数値 | **対象外** | — | タイミングは非スコープ |

2 層の意味: 共通設定はヘッダの `plan.fx` / `project.colors` / `project.fonts` に書き、作り直し時に `plan.fx` の置換と `plan.style = J.resolveStyle({style: styleKey, colors, fonts, keyBg})` で全カットに効く（`J.resolveStyle` は project 全体でなく `{style, colors, fonts, keyBg}` だけを見る）。カット単位の `edit.fonts/colors/fx` は共通設定の **上に** 重なり、そのカットにだけ効く。UI では「共通設定」の値を初期表示にし、カット単位で変えた項目に印を付ける。

### 4.4 AE でカット単位に書体・色・強さを上書きする方法

`jzBuildStart` は `st`（style）、`FXV`（強さ）、`ghostAmt`、`roles` をコンポ全体で 1 つ持ち、カットごとには `sc = schemeOf(cut)` だけを選んでいる（`ae/50_build.jsx:26-27,35,53`）。`buildCut` 内で `st`/`FXV`/`ghostAmt`/`sc` を参照するのは次の 7 箇所: `sc`（`:53`）、`ctx`（`:60` の `sc/st/fx`）、紙テクスチャ（`:71` の `FXV.texture`）、`bctx`（`:79` の `sc/st/fx`）、ゴーストの有無と量（`:84,105` の `ghostAmt`）、カメラ（`:114` の `fx`）。`wraps` に入る `sc`（`:120`）は `buildCut` のローカル変数なので、そこを差し替えればつなぎ（`finishTrans` の `:129` の `sc`/`scPrev`）にも自動で伝わる。（行番号はフック追加後）

**決定: カット単位の値は plan の cut に `cut.ov = {fonts, colors, fx}` として持たせ、AE 側は 1 つの関数 `jzCutCtx(cut, st, FXV, sc)` が `{st, fx, sc, ghostAmt}` を返す。** 段階 1 で `50_build.jsx` の `buildCut(ci)` 先頭に **フック 1 箇所（2 行）** を入れ、上の 7 箇所の参照を差し替える。

実装（4f9dab6 ＋本実装の行番号）: `buildCut` の `:54-55` に `var CX = jzCutCtx(cut, st, FXV, sc); sc = CX.sc;`。差し替えた参照は `:60`（ctx の `st/fx`）、`:71`（`CX.fx.texture`）、`:79`（bctx の `st/fx`）、`:84` と `:105`（`CX.ghostAmt`）、`:114`（カメラの `fx`）。`ov` が無いとき `jzCutCtx` は `st` / `FXV` / `sc` を同じオブジェクトのまま返し、`ghostAmt` は `:27` と同じ式（`FXV.chroma` は `fx.chroma` の既定値込みと同値）なので、出力は変わらない（T-1/T-4c で 72 ビルドの出力全体の sha1 が一致）。合成用の背景は `st.key`（`jzKeyStyle` が付ける印）で判定する。

```
// buildCut 先頭に追加する行のイメージ（0.1 時点の案。実装は上の段落）
var CX = jzCutCtx(cut, st, FXV, sc);          // ov が無ければ {st, fx: FXV, sc, ghostAmt} をそのまま返す
sc = CX.sc;                                    // 以降 :54 / :73 / :114 / :123 は sc をそのまま使う
// :54, :73, :108 の st / fx は CX.st / CX.fx、:65 は CX.fx.texture、:78, :99 は CX.ghostAmt に置き換える
```

- 段階 2 の切り出し（§7.1）はこのループ本体をそのまま `jzBuildCut` に移すので、フックも一緒に移る。段階 1 で入れておいても段階 2 の作業量は変わらない。upstream との衝突箇所も §7.1 と同じ 1 箇所に収まる
- `jzCutCtx` の本体は新規 `ae/52_cutedit.jsx` に置く。`build_ae.py` は全ファイルを 1 つの関数スコープに連結するので、`50_build.jsx` より後のファイルの関数宣言でも巻き上げで呼べる（`dev/ae_check.js` の重複名検査に掛からない名前にする）
- `roles`（AE の書体名: `app.settings` の `font_display` 等、`cep/host.jsx:41-44`）は **上書きしない**。書体キー → AE 書体の解決は `jzFont(key, roles)`（`ae/10_helpers.jsx:119-134`）が担い、`roles` は候補が無いときの逃げ先。カット単位の書体はキーで指定するので `roles` を触る必要がない

各値の作り方（`jzCutCtx`。ブラウザ側 `apply(base, edit, plan)` も同じ規則で `cut.ov` を作る）:

| 値 | 作り方 | 効く範囲 |
|---|---|---|
| `st` | `ov.fonts` があれば `st` の浅いコピーに `fonts` の複製を持たせ、`fonts[role] = [key]` に置換（role は display/serif/body。mono は対象外）。さらに `cut.params` の書体キー（`font`, `fontBig`, `fontSmall`, `fontC`, `fontB`, `tileFont`, `fonts[]`）のうち **`base` の `style.fonts[role]` に含まれるもの** を同じ role のキーに置換する（ブラウザ側 `apply` で行い `params` に書く）。生成時に `st.fonts` から選ぶ部品（`jzFontsOf`、`ae/p_layouts*.jsx` に約 130 箇所）は `st` 側、`params` に書体キーを持つ部品（`src/11p_layouts*.js` の `plan()` に `font:` が 634 箇所）は `params` 側でそれぞれ効く | そのカットの content と装飾 |
| `sc` | `ov.colors.enabled` なら `bg/fg/sub` を **そのカットの scheme のコピー** に置換。`ov.colors.accentOn` なら `accent = jzFitContrast(accent, sc.bg, 2.4)`（`ink === accent` なら `ink` も）、`ghostA/B = jzFitContrast(…, sc.bg, 1.35)`、`grad` があれば `[accent, jzMixHex(accent,'#000',0.7)]`。`J.resolveStyle`（`src/04_styles.js:159-170`）と同じ計算を AE 側で行う（`jzStyleWithPalette` `ae/16_omakase.jsx:62` と同じ式）。`keyBg` 使用時は色の上書きを無視する（`jzKeyStyle` の白黒を保つ） | wrapper の `JZ BG` / 紙 / 背景グラフィック / ゴースト色、content の文字色、前後のつなぎ（`sc`/`scPrev`） |
| `fx` | `FXV` のコピーに `ov.fx` の `motion/glitch/chroma/texture` を重ねる | content の登場/保持/退場の `M`/`G`（`ae/20_motion.jsx` の `jzHead`）、カメラ、紙テクスチャ（`texture`）、装飾の一部 |
| `ghostAmt` | `fx.chroma * (st.ghost == null ? 1 : st.ghost)`（`:23` と同じ式を per-cut の `fx` で） | そのカットのゴーストの量と有無 |

AviUtl2 との差: AviUtl2 の `bg/fg/sub` は `resolveStyle` で `schemes[0]` だけを置換するため、`scheme ≠ 0` のカットで「背景・文字色を指定」しても背景が変わらない。AE 版は「そのカットの scheme」に適用する（ユーザーの意図に近い側に倒す。付録 B に記載）。

scheme（背景色）とゴースト色がほかと絡む箇所:

| 箇所 | 参照している scheme | カット単位の色上書きの影響 |
|---|---|---|
| wrapper 内の `JZ BG`、紙、背景グラフィック、ゴースト色（`:69-105`） | `sc` | 上書きが効く |
| メインコンポの `JZ Background`（`:44`）と `comp.bgColor`（`:31`） | `schemes[0]` 固定 | 影響なし。カットの隙間（カット間に空きがある、レイヤーをトリムした）では元の背景色が見える。上書きした背景色と違うと隙間で色が飛ぶ → 上書き時に「前後に隙間があると元の背景色が見えます」と注記 |
| つなぎ（`:129` の `sc`/`scPrev`） | `wraps[].sc` | `wraps` に per-cut の `sc` が入るので、つなぎの色（`jzTAcc(t) = t.sc.accent` など）は新しいカット側の上書きに追従する。ワイプで下に残る前カットは前カットの色 |
| `JZ Flash`（`:165`）と HUD（`:134`） | `schemes[0]` | 影響なし（全体に 1 つ） |
| 効果イベント `JZ FX <name>`（`:160` の `schemeOf(jzCutAtTime(...))`） | plan の scheme（上書き前） | **段階 1 では上書きされない**。イベントレイヤーの色（例: 単色フラッシュ系）が元の scheme のまま。§11-12（決定: (a) 段階 1 はそのまま） |
| `jzBgLift` の明暗判定（`:208` の `jzLum(sc.bg)`）、ゴーストの乗算判定（`:102`） | `sc` | 上書きした `bg` の明るさで自動的に切り替わる |

段階の割り当て: **段階 1 に含める**。理由は (a) フックが 1 箇所 2 行で済む、(b) 段階 2 の切り出しで同じ行がそのまま関数に移るので手戻りがない、(c) 段階 1 の作り直しは全カット再生成なので、`cut.ov` を plan に入れるだけで通常の `C.start` / `step` 経路に乗る。段階 2 では `jzBuildCut` が `jzCutCtx` を呼ぶ形になり、追加作業は無い。

### 4.2 部品を変えたときの params の作り直し（seed の扱い）

AviUtl2 版 `bridge.js` の規則をそのまま採用し、次の点だけ決める。

- `params` / `treatP` / `bgP` / `camP` / `transP` は **キーが `base` の値から変わったときだけ** 作り直す。元の設定に戻せば `base` の値に戻る
- 乱数は `J.rng(J.h(cut.seed, group, key))`。AviUtl2 は `J.rng(cut.seed)` だが、同じ seed を group をまたいで使うと、レイアウトと背景の乱数列が同じになる。group と key を混ぜることで「同じキーに戻せば同じ params」が保たれ、かつ group ごとに違う列になる
- レイアウトの plan の引数は `{text: 実効 text, n: J.glyphCount(text), W: plan.W, H: plan.H, dur: cut.dur}` と `plan.style`（`src/08_planner.js:316` と同じ）
- **サイコロ**（このカットを振り直す）: `edit.roll = (edit.roll|0) + 1`。`roll > 0` のとき、指定されていない group の乱数を `J.rng(J.h(cut.seed, 'roll', roll, group))` にして params だけ作り直す（キーは変えない。キーも振り直したいときは元の設定に戻してから、ブラウザ側の行のサイコロを使う）。装飾の seed も同様に `J.h(cut.seed, 'roll', roll, 'decor', i)`
- 文字を変えたとき params は作り直さない（AviUtl2 と同じ）。`fits` を満たさない場合は警告のみ
- 実効 cut の組み立て（`J.cutEdit.apply(base, edit, plan)`）はブラウザ側 JS（新規 `cep/cutedit.js`）で行う。AE 側で作り直さない理由: AE の `JZ_REG.*.plan` はブラウザの `plan()` の移植で、通常の生成フローもブラウザの params を AE が消費している（`ae/05_reg.jsx:3-4`）。ブラウザで作れば通常フローと同じ経路になる

### 4.3 選択肢の出どころ

- 候補キーは `JZCEP.cutParts()`（新規）が AE 側 `jzOrder(g)`（`ae/05_reg.jsx:26`）を返し、パネルは `J.order(g)` との積集合を表示する。AE に実装が無い部品は `jzFallback` が黙って近い表現に置き換える（`:35-41`）ので **候補に出さない**
- 表示名は `J.registry(g)[k].name`（ブラウザ）。`ae/data.json` の `names` と同じ元データ
- 「元の設定」の行には `base` の値の名前を添える（例: `元の設定（中央）`）

---

## 5. パネル UI

### 5.1 タブの追加方法

`app/body.html` の `<nav class="tabs">`（`app/body.html:157-162`）と切替コード（`src/12_ui.js:899-904`）は変えない。`cep/cep.js` の `inject()` と同じやり方で、新規 `cep/cutedit.js` が起動時に `<button role="tab" data-tab="cut">カット編集</button>` と `<div class="tabpane" data-pane="cut" hidden>` を DOM に足す。既存の切替コードはクリックのリスナを初期化時に **その時点の** `.tabs button` にだけ張る（`querySelectorAll(...).forEach(addEventListener)`）ので、後から足したボタンには効かない。`cutedit.js` は自分のボタンに同じ処理（全ボタンの `aria-selected` を更新し、`.tabpane` の `hidden` を `dataset.pane !== 'cut'` で切り替える）を張る。既存ボタンを押したときは既存コードが `data-pane="cut"` の pane も `hidden` にするので、戻る側は追加不要。足すのは `12_ui.js` の初期化の後（`cep.js` の `start` と同じ `setTimeout(…, 0)` のタイミング）。

`build_cep.py` が `cep/cep.js` を `</body>` の前に埋め込んでいる（`build_cep.py` 「1) panel page」）。同じ箇所で `cep/cutedit.js` も続けて埋め込む（1 行追加）。英語版の `localize_cep` は当面 `cutedit.js` に適用しない（日本語のまま。§11 未決 6）。

### 5.2 タブの構成

```
[選択を読む]  [自動: パネルにフォーカスしたとき更新 ☑]   状態: 「JIZURA 夜明け」 007 ほどけた声が  (0:03.20–0:04.85)
──────────────────────────────────────────────
プレビュー（このカットだけ。スクラブバー。AE の見た目とは細部が違う旨の注記）
──────────────────────────────────────────────
カット文字      [ ほどけた声が               ]
レイアウト      [元の設定（中央）      ▾]     登場 [元の設定（ブラー） ▾]
保持            [元の設定（静止）      ▾]     退場 [元の設定（カット） ▾]
装飾            [元の設定 ▾] [元の設定 ▾] [元の設定 ▾]
加工 [▾]   背景 [▾]   カメラ [▾]   つなぎ [▾]（前カットと連続のときだけ有効）
書体（このカット）: 見出し [共通の設定（Dela Gothic One）▾] 明朝枠 [▾] 小さな文字 [▾]
☐ 背景・文字色を指定  背景 [■] 文字 [■] 補助 [■]        ← このカットの scheme に効く
☐ アクセント色を指定  アクセント [■] ズレ色A [■] ズレ色B [■]
動きの強さ ─●─  グリッチ ─●─  色ズレ ─●─  質感 ─●─        ← このカットだけ。質感は紙のみ（注記）
[🎲 このカットを振り直す]  [このカットの編集を元に戻す]
──────────────────────────────────────────────
▸ 共通設定（コンポ全体に効きます。カット側で変えた項目はそちらが優先）
  書体: 見出し [▾] 明朝枠 [▾] 小さな文字 [▾]
  ☐ 背景・文字色を指定  背景 [■] 文字 [■] 補助 [■]
  ☐ アクセント色を指定  アクセント [■] ズレ色A [■] ズレ色B [■]
  動きの強さ ─●─  グリッチ ─●─  色ズレ ─●─  装飾の量 ─●─  質感 ─●─
  カットの細かさ ─●─  背景の切替 ─●─  ☑ フラッシュ    （※構成の作り直しが必要）
──────────────────────────────────────────────
[作り直す（コンポ全体）]   [このカットだけ差し替える]（段階 2 まで非表示）
[このコンポの構成をパネルに読み戻す]
変更あり: 3 カット / 共通設定    最終生成: 12 カット・9.1 秒
```

- 選択肢は `<select>`。色は `<input type="color">`。0..1 は既存の演出タブと同じ `range`
- カット側の書体・色・強さは、未指定のとき共通設定の値を薄く表示し（`共通の設定（…）`）、変えると印が付く。「このカットの編集を元に戻す」で `edit` ごと消える。AviUtl2 の `cutNativeEdits`（`bridge.js:283-289`）が各カットの初期値に project の値を入れているのと同じ見え方
- 変更のあるカットには一覧（§5.3）で印を付け、「作り直す」で全部反映する
- タップ領域はデスクトップなので 44pt 規則の対象外だが、既存パネルの `.small` ボタンの寸法に合わせる

### 5.3 選択が無いとき

メインコンポを開いていてレイヤー未選択のときは、ヘッダの `cuts[]` から **カット一覧**（番号・文字・時間・編集済み印）を出し、クリックで `JZCEP.cutSelectLayer(compId, uid)`（AE 側で該当レイヤーを選択して `comp.time` を `start` に移す）を呼ぶ。これで AE 側の選択とパネルが双方向に揃う。

### 5.4 選択の追従（決定）

- **既定はイベント駆動ではなく「明示 + フォーカス時」**: `[選択を読む]` ボタン、パネルの `window` の `focus` と `pointerdown`（パネル内をクリックしたとき）で `JZCEP.cutSel()` を 1 回呼ぶ。根拠は §0.5
- 補助として **軽いポーリング**をオプション（既定 OFF、`localStorage` に保存）で用意する。間隔 1,500 ms、カット編集タブが表示中かつ生成中でないときだけ動かし、AE 側スクリプトは `activeItem.id` / `selectedLayers[0].id` / `selectedLayers.length` の 3 値だけを返す軽量版 `JZCEP.cutSelLite()` にする。値が前回と変わったときだけ `cutSel()` を呼ぶ。大きいプロジェクトで AE が重くなる報告（§0.5）があるので、既定 OFF と注記は必須
- CEP の `applicationActivate` 等は AE が発行しないので使わない

### 5.5 「作り直す」「元に戻す」

- **作り直す（段階 1）**: §6 のフロー。実行中はパネルの `.ae-build` を無効化し、`.ae-status` に「作り直し中…（N カット、前回 9.1 秒）」を出す（`cep/cep.js:55-62` と同じ作法）
- **このカットの編集を元に戻す**: `edit = {}` にしてプレビューを更新（AE には触らない）
- **すべての編集を元に戻す**: 全 wrapper の `edit = {}`、共通設定をヘッダの値に戻す
- AE 上の取り消し: 作り直しは 1 つの Undo グループなので Cmd+Z で前のコンポに戻る。パネルの状態は AE の Undo と同期しないため、「AE で取り消したときは『選択を読む』で読み直してください」を状態欄に出す

### 5.6 読み戻し

`[このコンポの構成をパネルに読み戻す]` はヘッダの `project` を `S.project` に入れ、`UI.replan()`（`J.uiApi`、`src/12_ui.js:1097`）を呼ぶ。これでスタイル/演出/手法/書き出しの既存タブがそのコンポの状態になり、タイミングやカット数など非スコープの変更は既存 UI で行って通常生成できる。`project` が無い（ScriptUI 版で作った、または古いコンポ）ときはボタンを無効にする。注意点: `S.plan` は `J.plan(S.project, audioLike())` で再計算されるので、音声を読み込んでいないと拍スナップが外れカット境界が変わりうる。読み戻し時に「曲を読み込むと同じ境界になります」と表示する。

### 5.7 プレビュー

**段階 1・2 には入れていない**（§11-10 の決定どおり段階 1.5。以下は段階 1.5 の設計）。

AviUtl2 版 `bridge.js` の `nativeCut` 描画（`aviRender` 内 146-183 行付近）と同じ方法でブラウザエンジンだけで描ける。

- ヘッダの plan ＋ 実効 cut から「そのカットだけの plan」を作る: `cuts = [prev(つなぎがあるとき、start=-prevDur), cut(start=0, end=dur)]`、`events` は `[origin-0.8, origin+dur]` を平行移動、`hud:false`、`beats`/`energy` は無し
- `new J.Renderer().frame(ctx, miniPlan, t, {scale, noHud:true})`。`Math.random` は `J.rng(plan.seed)` に差し替えて呼び、終わったら戻す（AviUtl2 と同じ）
- 書体は `J.ensureFonts(text, J.fontsOfPlan(miniPlan))` を先に待つ
- 1 フレームの描画コストはブラウザ版と同じ。スクラブ時は `requestAnimationFrame` で間引く
- 注記: AE の生成物はブラウザ描画の移植で細部が違う（`ae/05_reg.jsx` 冒頭）。プレビューは「どの部品か」を確かめる用途

---

## 6. 段階 1 の処理フロー

### 6.1 生成時（既存フローへの追加）

1. `J.cep.buildInAE()`（`cep/cep.js`）が `J.planForAE(S.plan, S.project, range)` に **`plan.__project = J.cutEdit.packProject(S.project)`** を足して JSON にし、`JZCEP.startFromFile` → `JZCEP.step` を回す（`cep/cep.js` に 1 行追加。`jzBuildStart` と `C.parse` は未知のキーを無視する）
2. ジョブが終わったとき、`cep/host.jsx` の `result()` が `C.cutEdit.stamp(comp, jobPlan)` を呼ぶ（§2.2）
3. `cep/cep.js` の `connect()` は `host.jsx` の後に `host_cutedit.jsx` を `$.evalFile` する（manifest の `ScriptPath` は 1 ファイルしか指せないため。1 行追加）

### 6.2 編集 → 作り直し

1. パネルが `JZCEP.cutHeader(compId)` と `JZCEP.cutRead(compId)`（全 wrapper の `k:"cut"` コメントをまとめて返す。V-0-6 の結果でチャンク読み出しは不要と判断した場合は 1 回）で読み、`ST.order` をヘッダの `cuts[]` の順（無いものは除く）にする
2. `J.cutEdit.buildPlan(header, list, common)`（`cep/cutedit.js`）が plan を作る
   - `effectivePlan`: 共通設定が変わっていれば `plan.fx` を上書きし `plan.style = J.resolveStyle({style, colors, fonts, keyBg})`、`project.colors/fonts/fx` も更新。各 cut を `apply(base, edit, {W,H,style})`。つなぎの整合（`transOk(prev, c)` を満たさないつなぎは外す。つなぎがあれば `enter='cut', inDur=0.12`、前カット `exit='cut', outDur=0`。外したときは `base` の値のまま＝§11-5 (c)）。`lines` の本文を戻す（§2.3.1）。`events` は各 cut の `ev` を `t|type|amp|dur` で重複除去してソート
   - `J.planForAE(hp, unpackProject(project))` で `fonts` / `fontTable` を作り直し、`width/height/extra/wa/duration/audioOffset/range` はヘッダの値に戻す。`__project`（共通設定反映済み）と `__cutedit = {cuts:[{base, edit}]}` を付ける
3. パネルが一時ファイルに書いて `JZCEP.rebuildStartFromFile(path, oldCompId, optsJson)`（Node が無いときは `rebuildStartFromString`）→ `JZCEP.rebuildStep(1200)` を `done` まで回す（進捗・残り時間の表示は `buildInAE` と同じ作法）。中止ボタンは `JZCEP.rebuildCancel()`。AE 側（`cep/host_cutedit.jsx`）:
   1. 旧メインコンポから音声レイヤー（`hasAudio && source.file`）を探し、`audioItem` と `startTime` を控える（`JZ_CUTEDIT.audioOf`）
   2. `C.start(plan, {roles, audioItem, audioStart})` でジョブを始める（Undo グループ 'JIZURA カット編集: 作り直し'）。以降 `rebuildStep` ごとに同名の Undo グループ
   3. 終わったら（同じ名前の Undo グループで）`stamp`。旧コンポは `JZ_CUTEDIT.removeTree(old)`: 旧メインコンポが他のコンポに使われていなければ削除し、そこから辿れるコンポのうち `usedIn` が空になったものを繰り返し削除、空になった cuts フォルダも削除。使われていれば（または「前のコンポを残す」）削除せず ` (old)`（重なれば ` (old 2)` …）に改名。新コンポの名前を旧コンポの名前にする
   4. 中止・失敗: 作りかけの新コンポを `removeTree` で消し、旧コンポはそのまま（`{cancelled:true}` / `{ok:false}`）
4. パネルは結果を状態欄に出し、`compId` を新しい値にして読み直し、作り直し前に選んでいたカット番号のレイヤーを選び直す

注意（実装で分かったこと）: ジョブ方式のため Undo グループは step ごとに分かれる。Cmd+Z 1 回で戻るのは最後の「stamp と旧コンポの削除」まで（旧コンポが戻る）。新コンポまで消すには何回か取り消す必要がある。§5.5 の「Undo 1 手」はこの形に読み替える。

### 6.3 古いコンポ・フォルダの扱い（決定）

- 既定: **置き換え**（旧を削除）。理由: JIZURA コンポが溜まるとプロジェクトが重くなる（実測、12 カットで生成 9 秒）
- オプション `☐ 前のコンポを残す`（既定 OFF）。ON のとき旧コンポを ` (old N)` に改名して残す
- 作り直しは Undo 1 手なので、失敗に気づいたら Cmd+Z で戻れる

### 6.4 作り直し中の案内

- パネル: 「作り直し中…（N カット・前回 X 秒）。AE の画面が止まりますがそのまま待ってください」。`evalScript` 中は CEP のイベントループも止まる（ae-mcp `docs/SPEC.md` §3.2 の知見）ので、進捗バーは出せない。開始前に `setTimeout(…, 30)` で文言を描かせてから呼ぶ（`cep/cep.js:62` と同じ）
- 完了: 「作り直しました（N カット・X 秒）。取り消すには AE で Cmd+Z」

---

## 7. 段階 2 の設計（カット 1 つ分の差し替え）

### 7.1 `jzBuild` からの切り出し（既存ファイルの変更範囲）

upstream 4f9dab6 で `jzBuildStart` の中はすでにクロージャ `buildCut(ci)` / `finishTrans()` / `buildEvent(ei)` / `finish()` に分かれている（§0.1）。段階 2 ではこれを次のトップレベル関数に出す。**関数本体はクロージャの本体をそのまま移す**（改行・変数名を変えない）ことで、upstream がこの部分を変えたときの 3-way マージを最小にする。

```
jzBuild(plan, opt)            … 変更なし（jzBuildStart を最後まで回す）
jzBuildStart(plan, opt)
  ├─ B = jzBuildEnv(plan, opt)   … 現在の :22-48 の前処理。{comp, folder, W,H,u,fps,D, st, fx, FXV, roles, ghostAmt, schemes, schemeOf, paperAmt, KEY, lagA, lagB, wraps, plan, opt, cuts} を返す（新規、内容は既存行の移動）
  ├─ buildCut(ci)  → jzBuildCut(B, cut, ci)       … 現在の :49-121 の本体をそのまま。戻り値 {cut, layer, comp, sc}（wraps への push は呼び出し側）
  ├─ finishTrans() → 先頭のループを jzBuildTrans(B, A, Bw) に出す（:124-131 の 1 組分）。HUD / JZ FX は finishTrans に残す
  └─ buildEvent / finish / job.step は変更なし（B の値を参照）
jzBuildEnvFor(comp, folder, plan, opt)  … 段階 2 の差し替え用。既存のメインコンポ・フォルダで B を作る（jzBuildEnv の内側で comp / folder を引数で受ける）
```

- 変更行数の目安: 関数ヘッダ ＋ `B.xxx` への置換。式は変えない。段階 1 のフック（§4.4）は `jzBuildCut` の中にそのまま移る
- `jzBuildCut` は `label`（`jzPad(ci+1,3) + ' ' + text`）を `ci` から作るので、差し替え時は **元のカット番号** を渡す
- `dev/cutedit_test.js` の T-1（72 ビルドの出力全体の sha1）が回帰テストになる
- upstream への還元はしない（§11-7 の決定: fork のみで管理）。upstream に追従するときの衝突は T-1 / T-4c（出力全体の sha1）で担保する

### 7.2 差し替え手順 `JZ_CUTEDIT.replace(mainComp, layerId, cut, prevCut, nextCut, opt)`

1. `app.beginUndoGroup('JIZURA カット編集: カット差し替え')`
2. ヘッダから `B = jzBuildEnv(plan, opt)` 相当を **既存のメインコンポで** 作る（`comp` を新規に作らない版 `jzBuildEnvFor(comp, folder, plan, opt)`。`jzBuildEnv` の内側で `comp`/`folder` を引数で受けられるようにしておく）
3. 旧レイヤー `WL0` を `layerId` で探す。`index`、`startTime`、`inPoint`、`outPoint`、`parent`、`label`（色）、`enabled`/`solo`/`shy` を控える
4. `jzBuildCut(B, cut, ci)` で新 wrapper コンポとレイヤー `WL1` を作る（ループ本体はメインコンポの末尾に `comp.layers.add(wc)` するので、`WL1.moveBefore(WL0)` で同じ位置へ）。`startTime`/`inPoint`/`outPoint` は plan の値。控えた `label`/`shy` を写す
5. つなぎの作り直し（§7.3）
6. 旧 wrapper レイヤー `WL0` を `remove()`。旧 wrapper コンポとその content/ghost コンポは、**ほかから使われていなければ**（`usedIn.length === 0`）削除。使われていれば残す
7. 新 wrapper コンポに `stamp`（`base` = 差し替え時点の実効 cut、`edit = {}` … §11 未決 8）。メインコンポのヘッダ `cuts[]` の uid を差し替える
8. `jzTidyComp(新 wrapper)` と content/ghost に対してだけ `jzTidyTree` 相当を掛ける（メインコンポ全体には掛けない: ユーザーが非表示にしたレイヤーを消してしまうため）
9. `app.endUndoGroup()`

### 7.3 前後のつなぎの作り直し

つなぎは「前カットの outPoint 延長」＋「新カットの wrapper レイヤーへのエフェクト」＋「メインコンポ上の `JZ Trans …` レイヤー」でできている（§0.1）。差し替え対象カット `i` について:

- 境界 (i-1, i): 旧 `WL0` が消えるので、`t.B` に付いたエフェクトも消える。`JZ Trans ` で始まる名前で `inPoint` が `cut.start ± 0.06` にあるレイヤーを削除。前カットレイヤーの `outPoint` を `prev.end` に戻す。新しい `cut.trans` があれば `jzBuildTrans(B, wrapPrev, wrapNew)` を実行。`wrapPrev` は `{cut: prevCut(実効), layer: 前のレイヤー, comp: その source, sc}` を組み立てて渡す
- 境界 (i, i+1): 次カットの wrapper レイヤー `WLn` に付いている `JZ Trans` エフェクト（`property('ADBE Effect Parade')` の名前が `JZ Trans` で始まるもの）を削除し、`JZ Trans ` レイヤーで `inPoint` が `next.start ± 0.06` のものを削除。`next.trans` があれば `jzBuildTrans(B, wrapNew, wrapNext)`
- 前後のレイヤーがユーザーに削除されている・見つからないときは、その境界のつなぎは作らない（警告）

### 7.4 手直しを残す範囲（定義）

| 残る | 残らない（作り直される） |
|---|---|
| ほかのカットの wrapper / content / ghost コンポの中身 | 差し替えたカットの wrapper / content / ghost の中身 |
| メインコンポ上の他レイヤー（`JZ Background`、HUD、`JZ FX`、`JZ Flash`、`JZ Vignette`、音声、ユーザー追加レイヤー）と、それらへの編集 | 差し替えたカットの wrapper レイヤー（位置・キーフレーム・エフェクト）。前後カットの wrapper レイヤーに付いた `JZ Trans*` エフェクトと `outPoint` |
| 差し替えたカットの wrapper レイヤーの `label`（色）、`shy`、レイヤーの位置（スタック順） | 差し替え境界の `JZ Trans …` レイヤー |
| 効果イベント（`JZ FX <name>` レイヤーと `JZ FX` の埋め込み配列） | — |

### 7.5 効果イベントは据え置く理由

イベントはプランナがカット境界の時刻と `emph` から乱数で決めており（`src/08_planner.js:344-361`）、編集項目（レイアウト等）には依存しない。差し替えで `cut.start/end` は変わらないので、`JZ FX` レイヤーの埋め込み配列も `JZ FX <name>` レイヤーも正しいまま。ゴーストの Position エクスプレッションに埋まる chroma イベント（`:98`）は `jzBuildCut` が `B.plan.events` から作るので、`B.plan.events` にはヘッダ再構成時の全 events を渡す。

---

## 8. ブラウザ版（パネル外）への影響

- なし。新規コードは `cep/cutedit.js`（CEP でしか読み込まれない、`window.__adobe_cep__` が無ければ `return`）と `ae/52_cutedit.jsx` / `cep/host_cutedit.jsx`（AE 側）に閉じる
- `src/*.js` は変更しない。使うのは公開 API だけ。存在は upstream の現行ソースで確認済み: `J.plan`（`src/08_planner.js:200`）、`J.chunkText`（`:114`）、`J.resolveStyle`（`src/04_styles.js:155`）、`J.planForAE`（`src/11_export.js:194`）、`J.order` / `J.registry`（`src/05b_registry.js:54-55`）、`J.rng` / `J.h`（`src/01_util.js:38,56`）、`J.glyphCount`（`src/06_layouts.js:123`）、`J.Renderer` / `J.cutAt`（`src/09_render.js:465,10`）、`J.ensureFonts` / `J.fontsOfPlan`（`src/02_fonts.js:74,85`）、`J.uiApi` / `J.ui`（`src/12_ui.js:1095-1097`）。これらの名前が upstream で変わったら `dev/cutedit_test.js`（T-2〜T-5）と `dev/cutedit_ui_test.py`（T-9）で検出される
- `build.py`（ブラウザ版）は変更しない。`index.html` に影響しない

---

## 9. テスト

### 9.1 自動テスト（`dev/ae_test.js` のモックで回す）

新規 `dev/cutedit_test.js`。`dev/ae_test.js` と同じ読み込み方（ES3 realm、`dev/aeom.js`）で `JIZURA_AE.jsx` と `build/com.852wa.jizura/jsx/jizura_core.jsx` を読む。

| # | テスト | 合格条件 |
|---|---|---|
| T-1 | 切り出しの回帰: `jzBuild` の出力（コンポ数・レイヤー数・エクスプレッション数・エフェクト集計、`env.stats`）が切り出し前後で全スタイル × 3 seed で同一 | 差分ゼロ。切り出し前の値は最初の実装 PR で `dev/cutedit_baseline.json` に固定する |
| T-2 | `stamp` → `cutRead`/`cutHeader` の往復で plan が復元される（`cuts`/`events`/`style`/`lines`/`fx` の深い比較。除外した `fontTable`/`beats` を除く） | 一致 |
| T-3 | ヘッダのチャンク分割: 100 行の歌詞で `main` + `main2` に分かれ、復元できる。14,000 バイトを 1 バイトでも超えると分割される | 一致 |
| T-4 | `apply(base, edit)`: 各 group を 1 つ変えたとき、その `<group>P`/`params` だけ変わり、他は `base` のまま。元の設定に戻すと `base` と一致。同じ key を 2 回選ぶと同じ params | 一致 |
| T-4b | カット単位の書体・色・強さ: `edit.fonts.display='dela'` で、`ov.fonts` と `params.font` の置換が §4.4 の通り（`base` の `style.fonts.display` に無いキーは触らない）。`edit.colors` で `jzCutCtx` の `sc` が `J.resolveStyle` と同じ値（`fitContrast` 込み）。`edit.fx.motion` で content の Scale/Position エクスプレッション内の `M=` 定数だけが変わり、隣のカットは変わらない。`keyBg` ありでは色が無視される | 一致 |
| T-4c | フックの無害性: `ov` の無い plan で `jzBuild` の出力（`env.stats`）がフック前と同一（T-1 と同じベースライン） | 差分ゼロ |
| T-5 | つなぎの整合: `trans` を付ける/外すで `enter`/`inDur`/前カットの `exit`/`outDur` が §6.2-1 の通り | 一致 |
| T-6 | `replace`（段階 2）: 12 カットのコンポで 5 番目を差し替え、他の wrapper コンポの `id` と中身（レイヤー数・エクスプレッション）が変わらない。`JZ Trans` レイヤーの数が前後で一致。`JZ FX <name>` レイヤーが変わらない | 一致 |
| T-7 | `cutSel` の解決: メインコンポ/ wrapper 内/ content 内/ 非 JIZURA の 4 通りと、レイヤー名変更・複製・並べ替え後 | 期待どおりの `uid`/`why` |
| T-8 | ES3 構文: `ae/52_cutedit.jsx` と `cep/host_cutedit.jsx` を `acorn` の `ecmaVersion:3` で解析 | エラーなし（`dev/ae_test.js` と同じ検査） |
| T-9 | パネル JS: `dev/cutedit_ui_test.py`（Playwright、CEP モック）で「カット編集タブが出る」「選択を読む→フォームに base の値が出る」「レイアウトを変えて作り直す→`rebuildStart*`/`rebuildStep` が呼ばれ、モック上のコンポが置き換わる」「選択なし→カット一覧→クリックで AE 側の選択」「読み戻し」。既存の `dev/cep_test.py` はリポジトリに無い `aerender.js`（AE モックの描画器）と `dev/www/` を前提にしていて、このリポジトリだけでは実行できない。そのため T-9 は同じモック方式（描画なし）の別ファイルで行い、本物の CEP パネルでの確認は実機の V-2〜V-8（デバッグ版パネルを CDP で操作）で代替する | 通る |
| T-9a | host の作り直しを Node で: `host.jsx` ＋ `host_cutedit.jsx` ＋ `jizura_core.jsx` をモック上で読み、生成 → 選択 → 読み出し → 編集 → `rebuildStartFromFile`/`rebuildStep` → 旧コンポ置換・曲レイヤーの引き継ぎ・古いコンポの取り残しなし、中止で旧コンポが残る、「残す」で ` (old)` | 通る |

モックの拡張（`dev/aeom.js`、既存ファイルの小変更）: `Comp` と `FolderItem`（`Folder` クラスにした）に `comment`（既定 `''`）、`Comp.usedIn` / `remove()` / `time`、`Folder.numItems` / `item()` / `remove()`、`Layer.selected` と `CompItem.selectedLayers`（AE と同じく `selected` から決まる getter）、`openInViewer()` でアクティブアイテムになる、`app.project.rootFolder`。`Layer.id` は既存の `Prop.id` を流用。

### 9.2 実機の受け入れ条件（ae-mcp を使う）

前提: `ae-mcp` の `jizura_load_engine` / `jizura_build` / `jizura_diagnose` / `jizura_panel_*`（`ae-mcp/docs/SPEC.md` §5）と `ae_eval`。パネルは `build_cep.py --debug` で `.debug` 付き。

| # | 手順 | 合格 |
|---|---|---|
| V-0 | §2.4 の V-0-1〜6 | 上限を確認し、定数を決める |
| V-1 | `jizura_panel_build_via_ui` で 4 行の歌詞から生成 → `ae_eval` でメインコンポ・フォルダ・各 wrapper の `comment` を読む | `JZ1 ` で始まり `jzParseJSON` で読める。`cuts[]` の数 = wrapper 数 |
| V-2 | AE でカット 3 の wrapper レイヤーを選ぶ → `jizura_panel_eval("J.cutEdit.readSelection()")` | フォームに `base` の値。`uid` が一致 |
| V-3 | レイアウトを `vcols`、装飾 2 を `rings` に変えて「作り直す」 → `jizura_diagnose` | `errors: 0`。新コンポのカット 3 の content に vcols 由来のレイヤー。旧コンポが無い。音声レイヤーが引き継がれている |
| V-3b | カット 3 の書体を `dela`、背景・文字色を指定して黒地白文字、動きの強さ 1.0 に変えて「作り直す」 → `ae_render_frame` 相当でカット 3 とカット 4 の中間フレームを取る | カット 3 だけ書体・背景色が変わり、カット 4 は元のまま。カット 3 の content のエクスプレッションに `M=1` が入る。`jizura_diagnose` `errors: 0` |
| V-4 | Cmd+Z（`ae_eval('app.executeCommand(16)')` 等） | 旧コンポが戻る。パネルの「選択を読む」で再同期できる |
| V-5 | プロジェクトを保存 → AE 再起動 → 開く → レイヤー選択 → 読む | 編集前と同じフォーム。「読み戻す」で歌詞・スタイルが復元される |
| V-6 | 100 行の歌詞で生成 | ヘッダが `main2` に分かれ、V-5 と同じく復元できる |
| V-7（段階 2） | 12 カット。カット 7 の content に手でキーフレームを足す。カット 5 を差し替え | カット 7 のキーフレームが残る。`jizura_diagnose` `errors: 0`。カット 4-5、5-6 のつなぎが plan どおり |
| V-8（段階 2） | つなぎ付きのカットを差し替え、つなぎを「なし」に | `JZ Trans` レイヤーとエフェクトが消え、前カットの `outPoint` が `prev.end` |
| V-9 | 生成時間 | 段階 1 の作り直しは通常生成 + 1 秒以内。段階 2 は 12 カットで 3 秒以内（目安、未確認） |
| V-10 | ポーリング ON で 90 カットのプロジェクトを 5 分放置 | AE が固まらない。CPU が目視で増えない（未確認。悪ければ既定 OFF のまま、間隔を延ばす） |

### 9.3 CI（GitHub Actions、新規 `.github/workflows/test.yml`、ジョブ名 `test`）

現状リポジトリに `.github/` は無い。`push`/`pull_request` で:

```
- setup-python 3.x, setup-node 20
- python3 build.py
- python3 build_ae.py
- python3 build_cep.py            # build/com.852wa.jizura/ ができる
- cd dev && npm ci               # acorn
- node dev/ae_test.js
- node dev/cutedit_test.js       # 新規（T-1〜T-8）
```

T-9 の `dev/cutedit_ui_test.py`（Playwright）は Chromium の導入が重いので `test` とは別の任意ジョブ `cep-ui`（`continue-on-error`、必須にしない）にする。fork のブランチ保護（`~/.claude/rules/git-flow.md`）の必須チェックは `test` だけ。CI は PR #4（develop ff903ac）の 4 段ビルド ＋ `git diff --exit-code` のあとに `dev/ae_test.js` と `dev/cutedit_test.js` を足した形にしている（fork 固有）。

---

## 10. 実装の段階分けと変更ファイル一覧

### 10.1 段階 0（検証。Issue #1 の最初のタスク）

| ファイル | 新規/既存 | 概要 |
|---|---|---|
| `dev/probe_comment.jsx`（scratchpad でも可） | 新規 | §2.4 V-0 を AE で実行し結果をパネル/ae-mcp で読む |

### 10.2 段階 1（Issue #1）

| ファイル | 新規/既存 | 概要 |
|---|---|---|
| `ae/52_cutedit.jsx` | 新規 | `JZ_CUTEDIT = { stamp, sel, selLite, header, cuts, parts, selectLayer, writeEdit, audioOf, removeTree, mainById, tag, json, headerText, limit }` と `jzCutCtx`（§4.4）。コメントの書き読み、選択の解決、作り直しの旧コンポ処理。`jzBuild` は呼ばない |
| `ae/50_build.jsx` | 既存（1 箇所、2 行 + 参照 7 箇所） | §4.4 のフック: `buildCut` 先頭で `jzCutCtx` を呼び、`sc`/`st`/`fx`/`ghostAmt` の参照を per-cut の値に差し替える。式は変えない |
| `cep/host_cutedit.jsx` | 新規 | `JZCEP.cutSel/cutSelLite/cutHeader/cutRead/cutParts/cutSelectLayer/cutWriteEdit/rebuildStartFromFile/rebuildStartFromString/rebuildStep/rebuildCancel` を `JZCEP` に後付け。JSON 化はエンジンの `JZ_CUTEDIT.json`（`__jzRaw` でコメントの JSON をそのまま通す）を使うので `str()` の複製は不要になった。`roles()` と一時ファイルの読み込みは `host.jsx` の非公開関数なので複製（約 10 行） |
| `cep/cutedit.js` | 新規 | タブの注入、フォーム、`apply(base, edit)`、プレビュー、作り直し、読み戻し。`J.cutEdit` として公開（ae-mcp の `jizura_panel_eval` から呼べるように） |
| `build_ae.py` | 既存（2 行） | `parts` に `'52_cutedit'`（`'50_build'` の後）。`--core` の api に `cutEdit: JZ_CUTEDIT` |
| `build_cep.py` | 既存（2 行） | `cep/cutedit.js` を `cep.js` の後に埋め込む（英語版も日本語のまま、§11-6）。`cep/host_cutedit.jsx` を `jsx/` にコピー（`es_escape`） |
| `cep/host.jsx` | 既存（1 行） | ジョブ完了時の `result()` で `C.cutEdit.stamp(comp, jobPlan)`（Undo グループ・try/catch）。`__project` は `C.parse` をそのまま通る |
| `cep/cep.js` | 既存（3 行） | `connect()` で `host.jsx` の後に `host_cutedit.jsx` を `$.evalFile`（manifest の `ScriptPath` は 1 ファイルしか指せないため）。`buildInAE` で `plan.__project` を付ける |
| `dev/aeom.js` | 既存（小） | §9.1 のモック拡張 |
| `dev/cutedit_test.js` | 新規 | T-1/T-4c（段階 1 で前倒し）、T-2〜T-5, T-7, T-8, T-9a |
| `dev/cutedit_baseline.json` | 新規 | T-1 の固定値（変更前のエンジン 4f9dab6 で 72 ビルドの統計と出力全体の sha1。段階 1 で前倒し） |
| `dev/cutedit_ui_test.py` | 新規 | T-9 |
| `JIZURA_AE.jsx` / `JIZURA_AE_en.jsx` | 生成物 | `52_cutedit.jsx` を含めて再生成（ScriptUI 版でも `jzCutCtx` が要るため） |
| `.github/workflows/test.yml` | 新規 | §9.3 |
| `docs/dsgarage/CUT_EDIT_SPEC.md` | 本書 | 実装で決まった定数・結果を追記 |

### 10.3 段階 2（Issue #2）

| ファイル | 新規/既存 | 概要 |
|---|---|---|
| `ae/50_build.jsx` | 既存（構造変更） | §7.1 の切り出し（`jzBuildEnv` / `jzBuildCut` / `jzBuildTrans`）。本体の式は変えない。段階 1 のフックはそのまま `jzBuildCut` に移る |
| `ae/52_cutedit.jsx` | 既存（追加） | `JZ_CUTEDIT.replace`（§7.2）、つなぎの掃除（§7.3） |
| `cep/host_cutedit.jsx` | 既存（追加） | `JZCEP.replaceCut(compId, layerId, cutJson, prevJson, nextJson)` |
| `cep/cutedit.js` | 既存（追加） | 「このカットだけ差し替える」ボタンと結果表示 |
| `dev/cutedit_test.js` | 既存（追加） | T-1（ベースライン）、T-6 |
| `dev/cutedit_baseline.json` | 新規 | T-1 の固定値 |

### 10.4 upstream 追従の方針

- 新規ファイルに寄せる。既存ファイルの変更は上表の行数に抑え、それぞれ 1 箇所の挿入にする（`git rebase` で衝突しても手で解消できる粒度）
- `ae/50_build.jsx` は段階 1 で `buildCut` 先頭のフック（1 箇所）、段階 2 で切り出し（同じ箇所）。upstream への PR は送らない（§11-7）
- `cep/host.jsx` の `str()` を使い回したくなるが、`host.jsx` を触る範囲を広げないため `host_cutedit.jsx` に複製する

---

## 11. 決定事項（0.1 の未決事項。2026-09-25 ユーザー承認で **すべて推奨案に決定**。#7 だけは「fork のみで管理」に決定）

| # | 事項 | 選択肢 | 決定（推奨案） |
|---|---|---|---|
| 1 | ヘッダが 2 枠（約 28,000 バイト）にも収まらないとき | (a) 生成時エラー (b) 3 枠目以降を wrapper コンポの `hdr` フィールドに分散 (c) `project` を落として plan だけ保存 | **(c)**。作り直しに `project` は不要（読み戻しだけ効かなくなる）。V-0 の結果で 1 枠の実容量が 15,999 と分かれば、歌詞 300 行程度まで (c) すら不要 |
| 2 | 段階 1 の作り直しで、ユーザーが他のカットに加えた手直しが失われる | (a) 警告して続行 (b) 段階 2 までは作り直しを「編集したカットが 1 つのときは段階 2 を使う」に自動切替 | **(a)**。段階 2 ができたら「編集が 1 カットなら差し替えを提案」する |
| 3 | レイヤーを時間方向に動かしたときの `start/end` | (a) plan を正とし、ずれは表示だけ (b) タイムラインを正とし自動採用 (c) ボタンで採用 | **(c)**。自動採用は隣接カットと重なる事故が起きる |
| 4 | `density` / `bgSwitch` / `flash`（プランナ時の項目）と、カット単位の `decor`（装飾の量。AviUtl2 では再プランで効くが AE の生成時には読まれない）をタブでどう扱うか | (a) 表示しない (b) 表示して「読み戻し → 演出タブで変更 → 生成」に誘導 (c) タブ内で `J.plan` を再実行（per-cut 編集は破棄） (d) カット単位の `decor` だけ、`base.decor` の個数を `round(len × edit/共通)` で増減して近似 | **(b)**。AviUtl2 と同等の項目は見せつつ、破壊的な再プランは既存 UI に任せる。カット単位の装飾の量は装飾 1〜3 の選択で代替できるので (d) はやらない |
| 5 | つなぎを外したとき、`base.enter` が `'cut'` に固定されている場合の登場 | (a) `'blur'` 固定 (b) `pickEnter` をブラウザ側で呼ぶ（`src/08_planner.js` の非公開関数なので不可） (c) ユーザーに登場を選ばせる（元の設定を「カット」と表示） | **(c)**。誤魔化さない。UI の「元の設定（カット）」で分かる |
| 6 | 英語版 CEP（`build_cep.py --lang en`）での文言 | (a) 日本語のまま (b) `localize_cep` に辞書を足す | **(a)** で始め、動いてから (b) |
| 7 | `ae/50_build.jsx` の切り出し（と §4.4 のフック）を upstream に PR するか | (a) fork だけ (b) upstream に PR（テスト T-1 付き） | **決定: (a) fork のみで管理（upstream への PR は送らない）**（2026-09-25 ユーザー指示で変更）。切り出しは段階 2 で fork に入れ、upstream に追従するときの衝突は T-1 / T-4c で担保する |
| 8 | 段階 2 で差し替えた wrapper の `base` | (a) 差し替え時点の実効 cut を新しい `base` にし `edit={}` (b) 元の `base` と `edit` を保つ | **(b)**。「元の設定」が生成時の値を指し続け、AviUtl2 の意味と揃う |
| 9 | 選択のポーリング既定 | OFF / ON | **OFF**（§0.5 のクラッシュ報告）。V-10 で問題なければ ON を検討 |
| 10 | プレビューを段階 1 に含めるか | 含める / 段階 1.5 | **段階 1.5**（タブと作り直しが動いてから）。フォーム・保存・作り直しが本体で、プレビューは独立に足せる |
| 11 | メインコンポの comment にユーザーが自分のメモを書いていた場合 | 上書き / 末尾に追記 | `JZ1 ` の前に既存文字列を残す（`<既存メモ>\nJZ1 {…}`）。読むときは `JZ1 ` 以降を取る |
| 12 | カット単位で色を上書きしたとき、効果イベント `JZ FX <name>` の色（`ae/50_build.jsx:154` の `schemeOf(jzCutAtTime(...))`）が元の scheme のまま | (a) 段階 1 はそのまま（注記） (b) `:154` にも `jzCutCtx` を通す（フック 2 箇所目） | **(a)**。イベントは数フレームで、色が違って見える部品は限られる。実機 V-3b で目立てば (b) |

---

## 12. 0.1 の仕様から外れた点（実装で決めたこと）

| # | 0.1 の仕様 | 実装 | 理由 |
|---|---|---|---|
| 1 | ヘッダの `lines` は `chunks` を除くだけ（1 行 ≈ 130 B の見積り） | `index`、および同じ本文を持つカットがある行の `text` も省き、パネルが `base.line` / `base.lineText` から戻す（§2.3.1） | 実測で 1 行 ≈ 240 B あり、100 行の歌詞では `project` を落としても 2 枠（28,000 B）を超えた。圧縮後は 100 行・347 カットで 27 KB（project 込み） |
| 2 | 作り直しは Undo 1 手（§5.5、§6.3） | upstream 4f9dab6 の段階実行に合わせ、作り直しもジョブ（`rebuildStart*` / `rebuildStep` / `rebuildCancel`）。Undo グループは step ごとに分かれ、Cmd+Z 1 回で戻るのは最後の「stamp と旧コンポの削除」まで（旧コンポが戻る）。新コンポまで消すには何回か取り消す（§6.2 の注意） | AE を止めないための upstream の方式に合わせた。1 つの Undo グループにまとめると step の間に AE へ制御を返せない |
| 3 | プレビュー（§5.7） | 入れていない（段階 1.5） | §11-10 の決定どおり |
| 4 | T-9 は `dev/cep_test.py` に追加 | 新規 `dev/cutedit_ui_test.py`。本物のパネルでの確認は V-* で代替 | §9.1 の T-9 の行 |
| 5 | host の JSON 化は `str()` の複製 | エンジンの `JZ_CUTEDIT.json` を使う（複製なし） | §10.2 |

補足: PR #4（develop ff903ac）で入った行ごとのカット手法の差し替え（`project.overrides[行].cutTech`）はブラウザで plan に反映されてから AE に渡るので、カット編集の `base` はその反映後の plan になる。

## 付録 A. 新規 host API（`JZCEP.*`）一覧

| 名前 | 引数 | 戻り値（JSON） | 段階 |
|---|---|---|---|
| `cutSel()` | — | §3.1 | 1 |
| `cutSelLite()` | — | `{ok, compId, layerId, n}` | 1 |
| `cutHeader(compId)` | メインコンポ id | `{ok, uid, plan, project, cuts[], engine}` | 1 |
| `cutRead(compId)` | 同 | `{ok, compId, cuts:[{uid, layerId, layerIndex, timeline, cut:{…wrapper の comment…}}]}`（レイヤー順） | 1 |
| `cutParts()` | — | `{ok, orders:{layout:[…], …}}` | 1 |
| `cutSelectLayer(compId, uid)` | — | `{ok}` | 1 |
| `cutWriteEdit(compId, uid, editJson)` | — | `{ok}`（編集の途中保存。作り直し前に AE 側へ保存しておくと、パネルを閉じても残る） | 1 |
| `rebuildStartFromFile(path, oldCompId, optsEnc)` / `rebuildStartFromString(planEnc, oldCompId, optsEnc)` | plan（一時ファイル / URI エンコード）、opts `{keepOld}` | `{ok, name, total, events}` | 1 |
| `rebuildStep(ms)` | — | 途中 `{ok, done:false, phase, cuts, total, eventsDone, events}`、完了 `{ok, done:true, cancelled, name, compId, replaced, keptOld, cuts, total, secs, notes, audio, stamped, missingFonts}` | 1 |
| `rebuildCancel()` | — | `{ok}`（次の `rebuildStep` で中止処理） | 1 |
| `replaceCut(compId, layerId, path)` | 一時ファイルに `{cut, prev, next, common}` | `{ok, secs, notes, uid}` | 2 |

## 付録 B. AviUtl2 版との違い（ユーザー向け説明に使う）

| AviUtl2 | AE 版 | 理由 |
|---|---|---|
| カットごとに「編集データ」（plan 全体のスナップショット）を持ち、描画のたびにプラグイン内で描く | plan はコンポのコメントに分散保存し、AE のレイヤーとして生成する | AE はレイヤー生成方式（`ae/*.jsx`） |
| 編集は即時プレビュー、『適用』で全カット再生成 | 編集はパネル内プレビュー（段階 1.5）、『作り直す』で全体、『差し替える』で 1 カット（段階 2） | AE の生成は秒単位で重い |
| 時間オフセット・背景透過 | 無し | AE のレイヤー操作・`keyBg` で代替 |
| 書体・色・強さはカット単位の上書き（`nativeEdit`）＋共通設定（`common`）の 2 層 | 同じ 2 層（`edit.fonts/colors/fx` ＋ 共通設定） | 同等 |
| カット単位の「背景・文字色を指定」は `schemes[0]` だけを置換（`resolveStyle`） | そのカットの scheme に適用 | `scheme ≠ 0` のカットでも背景が変わるように。ユーザーの意図に近い側に倒した |
| カット単位の「装飾の量」は再プランで装飾の数が変わる | 共通設定のみ（カット単位は保存だけ） | AE の生成時に `fx.decor` を読む部品が無く、数はプランナが決める。装飾 1〜3 の選択で代替 |
| カット単位の「質感」は紙・粒子・周辺減光すべて | 紙のテクスチャだけ | 粒子・ブルーム・周辺減光はメインコンポの `JZ FX` で全体に 1 つ |
| 共通 BPM | 無し（読み戻し → 既存 UI） | タイミングは非スコープ |
