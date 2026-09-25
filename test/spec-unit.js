/*
 * voice-shot-counter-pwa — test/spec-unit.js
 *
 * 例示テスト・境界値テスト（設計「単体テスト（例示・境界値）の対象と観点」）。
 * プロパティテストが「任意の入力での普遍的性質」を担い、本ファイルは
 * 単一分岐と有限集合の全列挙を担う。
 *
 * 要件 16-4: クラシックスクリプト（`import` / `export` を含まない）。
 * 読み込まれた時点で自身のテストを実行し、結果を pbt.results に積む。
 *
 * 本ファイルはタスクごとに追記される。現時点の内容はタスク 4.1 の範囲
 * （コマンド語彙・除外語・正規化の例示・再開待機時間）のみである。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  var REQUIRED = ['normalizeText', 'selectCommand', 'restartDelay', 'COMMAND_TABLE',
    'deserializeSession', 'serializeSession', 'SCHEMA_VERSION', 'SESSION_FIELDS'];
  var missing = [];
  for (var r = 0; r < REQUIRED.length; r++) {
    if (!hook || !hook[REQUIRED[r]]) { missing.push(REQUIRED[r]); }
  }
  if (missing.length > 0) {
    pbt.test('spec-unit.js: window.__VSC_TEST__ の前提', function () {
      assert.fail('公開フックに ' + missing.join(' / ') + ' が無い（タスク 21.1 が公開する）');
    });
    return;
  }

  var normalizeText = hook.normalizeText;
  var selectCommand = hook.selectCommand;
  var restartDelay = hook.restartDelay;
  var COMMAND_TABLE = hook.COMMAND_TABLE;
  var deserializeSession = hook.deserializeSession;
  var serializeSession = hook.serializeSession;
  var SCHEMA_VERSION = hook.SCHEMA_VERSION;
  var SESSION_FIELDS = hook.SESSION_FIELDS;

  /* ======================================================================
   * 正規化の例示（要件 3-9）
   * ==================================================================== */

  pbt.test('normalizeText: 各変換の例示（要件 3-9）', function () {
    var cases = [
      // 半角カナ → 全角カナ → ひらがな（濁点・半濁点の合成を含む）
      ['ｲﾝ', 'いん'],
      ['ｱｳﾄ', 'あうと'],
      ['ﾊﾞﾝｸ', 'ばんく'],
      ['ﾊﾟｽ', 'ぱす'],
      ['ｳﾞ', 'ゔ'],
      // 全角英数字 → 半角 → 小文字
      ['ＩＮ', 'in'],
      ['ＡＢｃ１２３', 'abc123'],
      // カタカナ → ひらがな（長音符は変換しない）
      ['リセット', 'りせっと'],
      ['ボール', 'ぼーる'],
      // 空白文字と区切り記号の除去
      ['イン 、。！？\u3000\t\n・，．', 'いん'],
      // ASCII のカンマ・ピリオドは除去対象に含まれない
      ['a,b.c', 'a,b.c'],
      // 空文字・非文字列
      ['', ''],
      [undefined, ''],
      [null, ''],
      [123, '']
    ];
    for (var i = 0; i < cases.length; i++) {
      var actual = normalizeText(cases[i][0]);
      assert.ok(actual === cases[i][1],
        assert.format(cases[i][0]) + ' -> ' + assert.format(actual) +
        '（期待 ' + assert.format(cases[i][1]) + '）');
    }
    return true;
  });

  pbt.test('normalizeText: 200 文字への切り詰めとサロゲートペアの非分割（要件 3-9）', function () {
    var long = normalizeText(new Array(501).join('あ'));
    assert.ok(long.length === 200, '500 文字の入力が 200 文字に切り詰められない: ' + long.length);

    // 切り詰めはコードポイント境界で行う（UTF-16 長も 200 以下に収める）。
    var emoji = '';
    for (var i = 0; i < 300; i++) { emoji += '🏀'; }
    var cut = normalizeText(emoji);
    assert.ok(cut.length <= 200, 'UTF-16 長が 200 を超えた: ' + cut.length);
    assert.ok(Array.from(cut).length === 100, 'コードポイント数が想定と異なる: ' + Array.from(cut).length);
    assert.ok(cut.indexOf('\uFFFD') === -1 && /^(?:\uD83C\uDFC0)+$/.test(cut),
      'サロゲートペアが分割された');
    return true;
  });

  /* ======================================================================
   * コマンド語彙の全列挙（要件 3-1〜3-5）
   * ==================================================================== */

  pbt.test('selectCommand: 5 種別の全コマンド語が正しい種別を返す（要件 3-1〜3-5）', function () {
    var expected = {
      // 要件 3-1 の 5 語 + 実機の聞き取りやすさのために足した 4 語（app.js 1-5 参照）
      MAKE: ['イン', '入った', 'はいった', 'マル', 'まる', '○', 'ナイス', '成功', '決まった'],
      MISS: ['アウト', '外れた', 'はずれた', 'バツ', 'ばつ', '×'],
      NEXT: ['次', 'つぎ'],
      PREV: ['戻る', 'もどる', '前'],
      UNDO: ['リセット', 'やり直し', 'やりなおし']
    };

    // COMMAND_TABLE が上記の語彙と完全に一致することを併せて確認する。
    var types = [];
    for (var t = 0; t < COMMAND_TABLE.length; t++) {
      types.push(COMMAND_TABLE[t].type);
      assert.deepEqualOk(COMMAND_TABLE[t].words.slice(), expected[COMMAND_TABLE[t].type],
        COMMAND_TABLE[t].type + ' の語彙が要件と一致しない');
      assert.ok(COMMAND_TABLE[t].priority === t,
        COMMAND_TABLE[t].type + ' の priority が配列順と一致しない');
    }
    assert.deepEqualOk(types, ['MAKE', 'MISS', 'NEXT', 'PREV', 'UNDO'],
      '既定優先順（成功 → 失敗 → 次種目 → 前種目 → 取り消し）と一致しない');

    // 要件 3-1〜3-5 が名指しする語がすべて語彙に含まれていること（追加は許容、欠落は不可）
    var required = {
      MAKE: ['イン', '入った', 'マル', 'まる', '○'],
      MISS: ['アウト', '外れた', 'はずれた', 'バツ', 'ばつ', '×'],
      NEXT: ['次', 'つぎ'],
      PREV: ['戻る', 'もどる', '前'],
      UNDO: ['リセット', 'やり直し', 'やりなおし']
    };
    var requiredTypes = Object.keys(required);
    for (var rt = 0; rt < requiredTypes.length; rt++) {
      var words = expected[requiredTypes[rt]];
      for (var rw = 0; rw < required[requiredTypes[rt]].length; rw++) {
        assert.ok(words.indexOf(required[requiredTypes[rt]][rw]) !== -1,
          requiredTypes[rt] + ' の語彙に要件が定める ' +
          assert.format(required[requiredTypes[rt]][rw]) + ' が無い');
      }
    }

    // 各語を単独のテキストとして与えると、その種別のコマンドが 1 個返る。
    var keys = Object.keys(expected);
    for (var k = 0; k < keys.length; k++) {
      var type = keys[k];
      for (var w = 0; w < expected[type].length; w++) {
        var word = expected[type][w];
        var result = selectCommand(word);
        assert.ok(result !== null, assert.format(word) + ' でコマンドが返らない');
        assert.ok(result.type === type,
          assert.format(word) + ' の種別が ' + result.type + '（期待 ' + type + '）');
        assert.ok(result.index === 0, assert.format(word) + ' の index が 0 でない');
        assert.ok(result.word === normalizeText(word),
          assert.format(word) + ' の word が正規化済みの語と一致しない');
        assert.ok(result.length === normalizeText(word).length,
          assert.format(word) + ' の length が一致しない');
      }
    }
    return true;
  });

  pbt.test('selectCommand: 優先順規則の例示（要件 3-6）', function () {
    // 開始位置が最小のものを選ぶ（「次」が先にあるので NEXT）。
    assert.ok(selectCommand('次はイン').type === 'NEXT', '開始位置最小の規則');
    // 同一開始位置では文字数が最大のものを選ぶ。
    var longer = selectCommand('やりなおし');
    assert.ok(longer.type === 'UNDO' && longer.word === 'やりなおし', '文字数最大の規則');
    // 同一開始位置・同一文字数では既定優先順（MAKE が MISS より先）。
    var tie = selectCommand('ぷあ', [
      { type: 'MISS', priority: 1, words: ['ぷあ'] },
      { type: 'MAKE', priority: 0, words: ['ぷあ'] }
    ], []);
    assert.ok(tie.type === 'MAKE', '種別優先順の規則（priority 昇順）');
    // どのコマンド語も含まないテキストは null（要件 3-8）。
    assert.ok(selectCommand('こんばんは') === null, 'コマンド語を含まないテキスト');
    assert.ok(selectCommand('') === null, '空文字');
    return true;
  });

  /* ======================================================================
   * 除外語（要件 3-10）
   * ==================================================================== */

  pbt.test('selectCommand: 要件 3-10 が名指しする 7 語の単独テキストが null を返す', function () {
    var words = ['ライン', 'インサイド', 'インステップ', 'サイン', 'アウトサイド', '前半', '手前'];
    for (var i = 0; i < words.length; i++) {
      var result = selectCommand(words[i]);
      assert.ok(result === null,
        assert.format(words[i]) + ' で ' + assert.format(result) + ' を発行した');
    }
    // 除外語の範囲外にあるコマンド語は発行される（マスクが過剰に働かない）。
    var afterExclusion = selectCommand('ラインぎわでイン');
    assert.ok(afterExclusion !== null && afterExclusion.type === 'MAKE',
      '除外語の後ろのコマンド語が発行されない');
    return true;
  });

  /* ======================================================================
   * 自動再開の待機時間（要件 2-6, 2-11）
   * ==================================================================== */

  pbt.test('restartDelay: 結果受信ありは 300ms、連続回数は 0 に戻る（要件 2-6）', function () {
    var r = restartDelay(true, 0, 0);
    assert.deepEqualOk(r, { delayMs: 300, stop: false, consecutiveEmpty: 0 }, '初回の結果受信あり');
    // 直前まで空結果が続いていても、結果を受信すれば 300ms に戻る。
    assert.deepEqualOk(restartDelay(true, 4, 4800),
      { delayMs: 300, stop: false, consecutiveEmpty: 0 }, '空結果からの復帰');
    return true;
  });

  pbt.test('restartDelay: 空結果の連続で倍々になる（要件 2-6）', function () {
    var expectedDelays = [600, 1200, 2400, 4800];
    var previous = 300;
    var empty = 0;
    for (var i = 0; i < expectedDelays.length; i++) {
      var r = restartDelay(false, empty, previous);
      assert.ok(r.stop === false, (i + 1) + ' 回目で中止された');
      assert.ok(r.delayMs === expectedDelays[i],
        (i + 1) + ' 回目の待機時間が ' + r.delayMs + '（期待 ' + expectedDelays[i] + '）');
      assert.ok(r.consecutiveEmpty === i + 1, '連続回数が ' + r.consecutiveEmpty);
      previous = r.delayMs;
      empty = r.consecutiveEmpty;
    }
    return true;
  });

  pbt.test('restartDelay: 上限 5000ms で飽和する（要件 2-6）', function () {
    assert.ok(restartDelay(false, 1, 2500).delayMs === 5000, '2500ms の 2 倍は 5000ms で飽和');
    assert.ok(restartDelay(false, 1, 4800).delayMs === 5000, '4800ms の 2 倍は 5000ms で飽和');
    assert.ok(restartDelay(false, 2, 5000).delayMs === 5000, '5000ms からは 5000ms を維持');
    assert.ok(restartDelay(false, 3, 999999).delayMs === 5000, '巨大な直前値でも 5000ms');
    return true;
  });

  pbt.test('restartDelay: 空結果 5 回連続で自動再開を中止する（要件 2-11）', function () {
    var r = restartDelay(false, 4, 4800);
    assert.deepEqualOk(r, { delayMs: 0, stop: true, consecutiveEmpty: 5 }, '5 回目の終了');
    // 5 回目以降も中止のまま（利用者の再有効化まで再開しない）。
    assert.ok(restartDelay(false, 5, 5000).stop === true, '6 回目も中止');
    // 不正な引数でも例外を送出せず、初回相当の値に落ち着く。
    var loose = assert.throwsNot(function () { return restartDelay(false, NaN, NaN); },
      'restartDelay は例外を送出しない');
    assert.deepEqualOk(loose, { delayMs: 600, stop: false, consecutiveEmpty: 1 }, '不正引数の扱い');
    return true;
  });
})();


/* ==========================================================================
 * タスク 6.4: reindexAfterMenuChange の単体テスト（要件 17-14）
 * --------------------------------------------------------------------------
 * 種目数が変化した後のアクティブ種目の再決定は、削除位置とアクティブ位置の
 * 前後関係で 3 分岐する。プロパティテスト（Property 10 / 11）はこの関数を
 * 対象に含まないため、ここで全分岐を例示で押さえる。
 *
 * 上の IIFE とは別の IIFE にしているのは、必要な公開フックが異なる
 * （上は 4.1 の関数群、ここは 6.1 の関数）ためである。片方のフックが
 * 欠けていても他方のテストは登録される。
 * ========================================================================== */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  if (!hook || !hook.reindexAfterMenuChange) {
    pbt.test('spec-unit.js: reindexAfterMenuChange の前提', function () {
      assert.fail('公開フックに reindexAfterMenuChange が無い（タスク 21.1 が公開する）');
    });
    return;
  }

  var reindex = hook.reindexAfterMenuChange;

  /** 期待値との比較を 1 行で書くための補助。 */
  function expect(label, args, expected) {
    var actual = assert.throwsNot(function () {
      return reindex(args[0], args[1], args[2], args[3]);
    }, 'reindexAfterMenuChange は例外を送出しない');
    assert.ok(actual === expected,
      label + ': reindex(' + args.join(', ') + ') = ' + assert.format(actual) +
      '（期待 ' + expected + '）');
    return true;
  }

  pbt.test('reindexAfterMenuChange: 削除位置がアクティブ種目より前（要件 17-14）', function () {
    // [0,1,2,3,4] の添字 1 を削除 → アクティブだった添字 3 の種目は添字 2 へ移る。
    expect('アクティブ 3 / 削除 1', [3, 5, 4, 1], 2);
    expect('アクティブ 4 / 削除 0', [4, 5, 4, 0], 3);
    expect('アクティブ 1 / 削除 0', [1, 5, 4, 0], 0);
    return true;
  });

  pbt.test('reindexAfterMenuChange: 削除位置がアクティブ種目と一致（要件 17-14）', function () {
    /* 「変化後の配列において当該位置以降の先頭の種目」= 同じ添字の要素。
     * 削除された種目の次の種目が同じ添字へ繰り上がっている。 */
    expect('アクティブ 2 / 削除 2', [2, 5, 4, 2], 2);
    expect('アクティブ 0 / 削除 0', [0, 5, 4, 0], 0);
    return true;
  });

  pbt.test('reindexAfterMenuChange: 削除位置がアクティブ種目より後（要件 17-14）', function () {
    expect('アクティブ 1 / 削除 3', [1, 5, 4, 3], 1);
    expect('アクティブ 0 / 削除 4', [0, 5, 4, 4], 0);
    expect('アクティブ 3 / 削除 4', [3, 5, 4, 4], 3);
    return true;
  });

  pbt.test('reindexAfterMenuChange: 末尾削除（当該位置が末尾を超える場合は最終種目）（要件 17-14）', function () {
    // アクティブだった末尾（添字 4）を削除 → 以降の種目が無いため最終種目（添字 3）。
    expect('アクティブ 4 / 削除 4（末尾）', [4, 5, 4, 4], 3);
    expect('アクティブ 1 / 削除 1（2 件の末尾）', [1, 2, 1, 1], 0);
    return true;
  });

  pbt.test('reindexAfterMenuChange: 種目 1 件（要件 17-14）', function () {
    // 変化後が 1 件なら、どの分岐を通っても添字 0 に収まる。
    expect('2 件 → 1 件 / 前を削除', [1, 2, 1, 0], 0);
    expect('2 件 → 1 件 / 後を削除', [0, 2, 1, 1], 0);
    // 1 件のメニューに 1 件追加（削除位置なし）→ アクティブ種目は動かない。
    expect('1 件 → 2 件 / 追加', [0, 1, 2, null], 0);
    // 1 件のまま（変化なし）。
    expect('1 件のまま', [0, 1, 1, null], 0);
    return true;
  });

  pbt.test('reindexAfterMenuChange: 追加はアクティブ種目を変えない（要件 17-13, 17-14）', function () {
    expect('3 件 → 4 件 / アクティブ 2', [2, 3, 4, null], 2);
    expect('3 件 → 4 件 / removedIndex に -1', [2, 3, 4, -1], 2);
    // 削除位置が与えられても種目数が減っていなければ削除として扱わない。
    expect('種目数が減っていない', [2, 3, 3, 0], 2);
    return true;
  });

  pbt.test('reindexAfterMenuChange: 不正な引数でも値域内の整数を返す（全域性）', function () {
    expect('newLength が 0', [3, 5, 0, 1], 0);
    expect('newLength が非数', [3, 5, NaN, 1], 0);
    expect('prevIndex が非整数', [1.5, 5, 4, null], 0);
    expect('prevIndex が範囲外（過大）', [99, 5, 4, null], 3);
    expect('prevIndex が負', [-3, 5, 4, null], 0);
    expect('prevLength が不正', [2, NaN, 4, null], 2);
    expect('すべて不正', [undefined, undefined, undefined, undefined], 0);
    return true;
  });
})();


/*
 * ============================================================================
 * タスク 7.9: schemaVersion の各分岐（要件 13-8, 13-9, 13-10）
 * ============================================================================
 * 現行スキーマバージョン値は 1 なので、採るべき分岐は次の 3 種類である。
 *   欠落 / 非整数 / 2（現行値より大きい） → どのフィールドも復元せず初期状態
 *   0（現行値より小さい）                 → 欠落フィールドを既定値で補完
 *   1（現行値）                           → 値域検証を通れば全フィールドを復元
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  if (!hook || !hook.deserializeSession || !hook.SCHEMA_VERSION) { return; }

  var deserializeSession = hook.deserializeSession;
  var SCHEMA_VERSION = hook.SCHEMA_VERSION;

  var MENU = {
    id: 'm-test',
    name: 'テストメニュー',
    drills: [
      { id: 1, section: '近距離', name: 'ゴール下', targetMake: 10 },
      { id: 3, section: '', name: 'エルボー', targetMake: 5 }
    ]
  };

  var INITIAL = {
    schemaVersion: SCHEMA_VERSION,
    startedAt: null,
    elapsedSec: 0,
    menuId: 'm-test',
    activeIndex: 0,
    counts: [{ id: 1, make: 0, attempt: 0 }, { id: 3, make: 0, attempt: 0 }],
    operations: [],
    ended: false
  };

  /** 現行スキーマで妥当な保存データの素。schemaVersion は呼び出し側が差し替える。 */
  function payload(version) {
    return {
      schemaVersion: version,
      startedAt: '2026-09-25T06:00:00.000Z',
      elapsedSec: 1234,
      menuId: 'm-test',
      activeIndex: 1,
      counts: [{ id: 1, make: 4, attempt: 7 }, { id: 3, make: 2, attempt: 2 }],
      operations: [{ drillId: 1, type: 'MAKE' }, { drillId: 3, type: 'MISS' }],
      ended: false
    };
  }

  pbt.test('deserializeSession: schemaVersion の 5 ケースが採る分岐（要件 13-8, 13-9, 13-10）', function () {
    var full = payload(SCHEMA_VERSION);

    /* --- 欠落 → 初期状態（要件 13-8）--- */
    var noVersion = JSON.parse(JSON.stringify(full));
    delete noVersion.schemaVersion;
    var a = deserializeSession(JSON.stringify(noVersion), MENU);
    assert.deepEqualOk(a.state, INITIAL, '欠落で初期状態が返らない', { name: 'state' });
    assert.ok(a.issues.length >= 1, '欠落で issues が空である');
    assert.ok(a.issues[0].code === 'SCHEMA_UNSUPPORTED',
      '欠落の違反コードが SCHEMA_UNSUPPORTED でない: ' + a.issues[0].code);

    /* --- 非整数 → 初期状態（要件 13-8）--- */
    var nonInt = payload('1');
    var b = deserializeSession(JSON.stringify(nonInt), MENU);
    assert.deepEqualOk(b.state, INITIAL, '非整数で初期状態が返らない', { name: 'state' });
    assert.ok(b.issues[0].code === 'SCHEMA_UNSUPPORTED',
      '非整数の違反コードが SCHEMA_UNSUPPORTED でない: ' + b.issues[0].code);

    var nonInt2 = payload(1.5);
    var b2 = deserializeSession(JSON.stringify(nonInt2), MENU);
    assert.deepEqualOk(b2.state, INITIAL, '小数で初期状態が返らない', { name: 'state' });

    /* --- 0（現行値より小さい）→ 欠落分を補完しつつ既存値を保持（要件 13-9）--- */
    var legacy = payload(0);
    delete legacy.operations;
    delete legacy.ended;
    var c = deserializeSession(JSON.stringify(legacy), MENU);
    assert.ok(c.state.schemaVersion === SCHEMA_VERSION,
      '旧版の復元後に schemaVersion が現行値にならない');
    assert.ok(c.state.elapsedSec === 1234, '旧版で既存の経過時間が保持されない');
    assert.ok(c.state.activeIndex === 1, '旧版で既存のアクティブ種目が保持されない');
    assert.deepEqualOk(c.state.counts, legacy.counts, '旧版で既存のカウントが保持されない',
      { name: 'counts' });
    assert.deepEqualOk(c.state.operations, [], '旧版で欠落した操作履歴が 0 件に補完されない',
      { name: 'operations' });
    assert.ok(c.state.ended === false, '旧版で欠落した終了区分が false に補完されない');

    /* --- 1（現行値）→ 値域検証を通って全フィールドを復元（要件 13-5, 13-10）--- */
    var d = deserializeSession(JSON.stringify(full), MENU);
    assert.ok(d.issues.length === 0, '現行値で issues が空でない: ' + assert.format(d.issues));
    assert.deepEqualOk(d.state, full, '現行値で全フィールドが復元されない', { name: 'state' });

    /* --- 2（現行値より大きい）→ 初期状態（要件 13-8）--- */
    var future = payload(SCHEMA_VERSION + 1);
    var e = deserializeSession(JSON.stringify(future), MENU);
    assert.deepEqualOk(e.state, INITIAL, '現行値より大きいバージョンで初期状態が返らない',
      { name: 'state' });
    assert.ok(e.issues[0].code === 'SCHEMA_UNSUPPORTED',
      '未来バージョンの違反コードが SCHEMA_UNSUPPORTED でない: ' + e.issues[0].code);
    return true;
  });

  pbt.test('deserializeSession: 非文字列・空文字でも例外を送出せず初期状態を返す（全域性）', function () {
    var inputs = [undefined, null, 0, 1, true, {}, [], '', 'null', '[]', '"文字列"', '{'];
    for (var i = 0; i < inputs.length; i++) {
      var r = assert.throwsNot(function () {
        return deserializeSession(inputs[i], MENU);
      }, assert.format(inputs[i]) + ' の復元が例外を送出した');
      assert.deepEqualOk(r.state, INITIAL,
        assert.format(inputs[i]) + ' で初期状態が返らない', { name: 'state' });
      assert.ok(r.issues.length >= 1, assert.format(inputs[i]) + ' で issues が空である');
    }
    return true;
  });

  pbt.test('deserializeSession: メニューの種目 id 集合を正として整合させる（要件 1-10, 6-10, 6-11）', function () {
    // 余剰 id（9）のカウントは破棄し、欠落 id（3）は 0 で補完し、
    // 破棄した id を対象とする操作履歴要素も除去する。
    var raw = {
      schemaVersion: SCHEMA_VERSION,
      startedAt: null,
      elapsedSec: 60,
      menuId: 'm-test',
      activeIndex: 0,
      counts: [{ id: 1, make: 3, attempt: 5 }, { id: 9, make: 1, attempt: 1 }],
      operations: [{ drillId: 1, type: 'MAKE' }, { drillId: 9, type: 'MISS' }],
      ended: false
    };
    var r = deserializeSession(JSON.stringify(raw), MENU);
    assert.deepEqualOk(r.state.counts,
      [{ id: 1, make: 3, attempt: 5 }, { id: 3, make: 0, attempt: 0 }],
      'カウントがメニューの id 集合に整合しない', { name: 'counts' });
    assert.deepEqualOk(r.state.operations, [{ drillId: 1, type: 'MAKE' }],
      '破棄した種目の操作履歴が残っている', { name: 'operations' });
    assert.ok(r.state.elapsedSec === 60, '整合処理で他のフィールドが失われている');

    var codes = [];
    for (var i = 0; i < r.issues.length; i++) { codes.push(r.issues[i].code); }
    assert.ok(codes.indexOf('COUNTS_MISSING_ID') !== -1, '欠落 id の補完が issues に無い: ' + codes);
    assert.ok(codes.indexOf('COUNTS_EXTRA_ID') !== -1, '余剰 id の破棄が issues に無い: ' + codes);
    assert.ok(codes.indexOf('OPERATIONS_DROPPED') !== -1, '操作履歴の除去が issues に無い: ' + codes);
    return true;
  });
})();


/*
 * ============================================================================
 * タスク 10.5: Command_Dispatcher の分岐（要件 7-4, 7-7, 12-11, 11-2, 11-6）
 * ============================================================================
 * 検証対象は `window.__VSC_TEST__.shell` 経由で公開される副作用シェルの
 * ファクトリ（Count_Manager / Cursor_Manager / Command_Dispatcher）である。
 * いずれも DOM と localStorage に触れないため、モックは「時刻を引数で渡す」
 * ことと「コールバックを記録する」ことだけで足りる。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;
  var shell = hook ? hook.shell : null;

  if (!shell || !shell.createCommandDispatcher) {
    pbt.test('spec-unit.js: __VSC_TEST__.shell の前提（タスク 10.5）', function () {
      assert.fail('副作用シェルのファクトリが公開されていない（tests.html / run-node.js 経由で実行する）');
    });
    return;
  }

  var MENU = {
    id: 'm-test',
    name: 'テストメニュー',
    drills: [
      { id: 1, section: '近距離', name: 'ゴール下', targetMake: 2 },
      { id: 2, section: '近距離', name: 'ショートミドル', targetMake: 2 },
      { id: 3, section: 'エルボー', name: 'エルボー', targetMake: 2 }
    ]
  };

  /**
   * ディスパッチャと依存を 1 組作る。
   * `conflicted` を後から差し替えられるようにして他タブ競合を再現する。
   */
  function makeRig(options) {
    var counts = shell.createCountManager();
    var cursor = shell.createCursorManager();
    counts.initFromMenu(MENU);
    cursor.setMenu(MENU);

    var rig = {
      counts: counts,
      cursor: cursor,
      conflicted: false,
      messages: [],
      dirty: [],
      saves: 0,
      goals: [],
      completions: [],
      timerStarts: []
    };

    rig.dispatcher = shell.createCommandDispatcher({
      counts: counts,
      cursor: cursor,
      timer: {
        ensureStarted: function (atMs) { rig.timerStarts.push(atMs); }
      },
      getMenu: function () { return MENU; },
      showMessage: function (kind, text, holdMs, reasonKey) {
        rig.messages.push({ kind: kind, text: text, holdMs: holdMs, reasonKey: reasonKey });
      },
      markDirty: function (region) { rig.dirty.push(region); },
      scheduleSave: function () { rig.saves++; },
      onGoalReached: function (made, target) { rig.goals.push({ made: made, target: target }); },
      onDrillCompleted: function (completed, next) {
        rig.completions.push({
          completed: completed ? completed.name : null,
          next: next ? next.name : null
        });
      },
      autoAdvanceOnComplete: (options && options.autoAdvance === false) ? false : true,
      isConflicted: function () { return rig.conflicted; }
    });
    return rig;
  }

  function snapshot(rig) {
    return {
      counts: rig.counts.getCountsList(),
      history: rig.counts.getHistory(),
      index: rig.cursor.getIndex()
    };
  }

  pbt.test('Command_Dispatcher: 他タブ競合下では計数系を受け付けず拒否メッセージを出す（要件 12-11）', function () {
    var rig = makeRig();
    // 競合前に 1 件だけ記録しておき、拒否時に状態が不変であることを確かめる
    rig.dispatcher.dispatch('MAKE', 'voice', 1000);
    var before = snapshot(rig);
    var savesBefore = rig.saves;

    rig.conflicted = true;
    rig.messages = [];

    var results = [
      rig.dispatcher.dispatch('MAKE', 'voice', 2000),
      rig.dispatcher.dispatch('MISS', 'voice', 3000),
      rig.dispatcher.dispatch('UNDO', 'voice', 4000)
    ];
    for (var i = 0; i < results.length; i++) {
      assert.ok(results[i].ok === false, i + ' 番目の計数系コマンドが受け付けられた');
      assert.ok(results[i].reason === 'CONFLICT',
        i + ' 番目の拒否理由が CONFLICT でない: ' + results[i].reason);
    }
    assert.deepEqualOk(snapshot(rig), before, '競合下で状態が変化した', { name: 'state' });
    assert.ok(rig.saves === savesBefore, '競合下で保存がスケジュールされた');
    assert.ok(rig.messages.length >= 1, '競合の拒否メッセージが出ていない');
    for (var m = 0; m < rig.messages.length; m++) {
      assert.ok(rig.messages[m].reasonKey === 'CONFLICT',
        '拒否メッセージの reasonKey が CONFLICT でない: ' + rig.messages[m].reasonKey);
    }

    // カーソル移動は計数系ではないため競合下でも受け付ける
    var moved = rig.dispatcher.dispatch('NEXT', 'touch', 5000);
    assert.ok(moved.ok === true, '競合下でカーソル移動が拒否された');
    return true;
  });

  pbt.test('Command_Dispatcher: 同一ボタンの 300ms 以内の連打を破棄する（要件 7-7）', function () {
    var rig = makeRig();

    assert.ok(rig.dispatcher.dispatch('MAKE', 'touch', 1000).ok === true, '1 回目が受け付けられない');
    var after1 = snapshot(rig);

    // 299ms 後 → 破棄
    var second = rig.dispatcher.dispatch('MAKE', 'touch', 1299);
    assert.ok(second.ok === false && second.reason === 'DEBOUNCED',
      '299ms 後の連打が破棄されない: ' + assert.format(second));
    assert.deepEqualOk(snapshot(rig), after1, '破棄されたタップで状態が変化した', { name: 'state' });

    // ちょうど 300ms 後 → 受け付ける
    assert.ok(rig.dispatcher.dispatch('MAKE', 'touch', 1300).ok === true,
      '300ms 後のタップが受け付けられない');

    // 別のボタンは独立に判定する（要件 7-7 は「同一の操作ボタン」が対象）
    assert.ok(rig.dispatcher.dispatch('MISS', 'touch', 1301).ok === true,
      '別ボタンのタップが連打として破棄された');

    // 音声由来には 300ms 抑止を適用しない（800ms 抑止は Speech_Recognizer の責務）
    assert.ok(rig.dispatcher.dispatch('MISS', 'voice', 1302).ok === true,
      '音声由来に 300ms 抑止が二重適用された');
    return true;
  });

  pbt.test('Command_Dispatcher: タッチと音声で結果状態と操作履歴が一致する（要件 7-4）', function () {
    var sequence = ['MAKE', 'MISS', 'NEXT', 'MAKE', 'UNDO', 'MAKE', 'PREV', 'MISS'];

    var touchRig = makeRig();
    var voiceRig = makeRig();
    for (var i = 0; i < sequence.length; i++) {
      // タッチ側は連打破棄に掛からないよう 1 秒ずつ進める
      touchRig.dispatcher.dispatch(sequence[i], 'touch', 1000 + i * 1000);
      voiceRig.dispatcher.dispatch(sequence[i], 'voice', 1000 + i * 1000);
    }

    var t = snapshot(touchRig);
    var v = snapshot(voiceRig);
    assert.deepEqualOk(t.counts, v.counts, 'タッチと音声で counts が一致しない', { name: 'counts' });
    assert.deepEqualOk(t.history, v.history, 'タッチと音声で操作履歴が一致しない', { name: 'history' });
    assert.ok(t.index === v.index,
      'タッチと音声でアクティブ種目が一致しない: ' + t.index + ' / ' + v.index);

    // 操作履歴の形式は音声由来と同一（{drillId, type} の 2 フィールド）
    for (var h = 0; h < t.history.length; h++) {
      assert.deepEqualOk(Object.keys(t.history[h]).slice().sort(), ['drillId', 'type'],
        '操作履歴の形式が {drillId, type} でない', { name: 'entry' });
    }
    return true;
  });

  pbt.test('Command_Dispatcher: 計数コマンドでタイマーを開始し目標達成を 1 回だけ通知する（要件 11-2, 11-6）', function () {
    var rig = makeRig();

    rig.dispatcher.dispatch('NEXT', 'voice', 500);
    assert.ok(rig.timerStarts.length === 0, 'カーソル移動でタイマー開始が要求された');

    rig.dispatcher.dispatch('MAKE', 'voice', 1000);
    assert.ok(rig.timerStarts.length === 1 && rig.timerStarts[0] === 1000,
      '計数コマンドでタイマー開始が要求されない: ' + assert.format(rig.timerStarts));

    // 目標合計は 2 + 2 + 2 = 6。到達するまで MAKE を積む
    var t = 2000;
    while (rig.counts.getTotals().make < 6) {
      rig.dispatcher.dispatch('MAKE', 'voice', t);
      t += 1000;
      if (t > 60000) { assert.fail('目標合計に到達しない'); }
    }
    assert.ok(rig.goals.length === 1,
      '目標達成の通知回数が 1 回でない: ' + rig.goals.length);
    assert.ok(rig.goals[0].target === 6, '通知された目標合計が 6 でない: ' + rig.goals[0].target);

    // 超過しても再通知しない（要件 11-6）
    rig.dispatcher.dispatch('MAKE', 'voice', t);
    assert.ok(rig.goals.length === 1, '目標超過で再通知された');

    // 新規セッション開始時は再武装する
    rig.dispatcher.resetGoalNotice();
    rig.dispatcher.dispatch('MAKE', 'voice', t + 1000);
    assert.ok(rig.goals.length === 2, 'resetGoalNotice 後に再通知されない');
    return true;
  });

  pbt.test('Command_Dispatcher: 目標成功数に達したら次の種目へ自動遷移する（要件 6-9）', function () {
    // MENU は 3 種目、targetMake はいずれも 2
    var rig = makeRig();
    var t = 1000;
    function make() { var r = rig.dispatcher.dispatch('MAKE', 'voice', t); t += 1000; return r; }
    function miss() { var r = rig.dispatcher.dispatch('MISS', 'voice', t); t += 1000; return r; }

    assert.ok(rig.cursor.getIndex() === 0, '初期のアクティブ種目が先頭でない');

    // 1 本目: 目標未達なので遷移しない
    var first = make();
    assert.ok(first.advancedTo === null, '目標未達で遷移した');
    assert.ok(rig.cursor.getIndex() === 0, '目標未達でアクティブ種目が動いた');
    assert.ok(rig.completions.length === 0, '目標未達で完了通知が出た');

    // 失敗は遷移の契機にならない
    miss();
    assert.ok(rig.cursor.getIndex() === 0, '失敗でアクティブ種目が動いた');

    // 2 本目: 目標到達 → 次の種目へ自動遷移
    var second = make();
    assert.ok(second.ok === true, '目標到達の成功コマンドが拒否された');
    assert.ok(second.advancedTo !== null && second.advancedTo.id === 2,
      '目標到達で次の種目へ遷移しない: ' + assert.format(second.advancedTo));
    assert.ok(rig.cursor.getIndex() === 1, 'アクティブ種目が 2 番目にならない');
    assert.deepEqualOk(rig.completions, [{ completed: 'ゴール下', next: 'ショートミドル' }],
      '完了通知の内容が期待と異なる', { name: 'completions' });

    // 遷移後の加算は新しい種目に入る
    make();
    var counts = rig.counts.getCountsList();
    assert.deepEqualOk(counts[0], { id: 1, make: 2, attempt: 3 },
      '1 種目目のカウントが変化した', { name: 'drill1' });
    assert.deepEqualOk(counts[1], { id: 2, make: 1, attempt: 1 },
      '2 種目目に加算されていない', { name: 'drill2' });

    // 2 種目目も完了 → 3 種目目へ
    make();
    assert.ok(rig.cursor.getIndex() === 2, '2 種目目の完了で 3 番目に遷移しない');

    // 最終種目の完了では移動先が無いので留まる（循環しない。要件 6-5）
    make();
    var last = make();
    assert.ok(last.ok === true, '最終種目の完了で成功コマンドが拒否された');
    assert.ok(last.advancedTo === null, '最終種目から遷移した');
    assert.ok(rig.cursor.getIndex() === 2, '最終種目の完了で先頭へ循環した');
    var lastCompletion = rig.completions[rig.completions.length - 1];
    assert.ok(lastCompletion.next === null,
      '最終種目の完了通知に次の種目が載っている: ' + assert.format(lastCompletion));

    // targetMake を超える加算では遷移しない（要件 4-11 との両立）
    var over = make();
    assert.ok(over.advancedTo === null, '目標超過の加算で遷移した');
    return true;
  });

  pbt.test('Command_Dispatcher: 完了済みの種目に戻って加算しても遷移しない（要件 4-11, 6-9）', function () {
    var rig = makeRig();
    var t = 1000;
    function make() { var r = rig.dispatcher.dispatch('MAKE', 'voice', t); t += 1000; return r; }

    make();
    make();                                   // 1 種目目が完了 → 2 番目へ
    assert.ok(rig.cursor.getIndex() === 1, '完了で 2 番目に遷移しない');

    rig.dispatcher.dispatch('PREV', 'voice', t); t += 1000;
    assert.ok(rig.cursor.getIndex() === 0, '「戻る」で 1 番目に戻らない');

    // 加算前の Make が既に targetMake 以上なので自動遷移は起きない
    var extra = make();
    assert.ok(extra.advancedTo === null, '完了済みの種目で再び遷移した');
    assert.ok(rig.cursor.getIndex() === 0, '完了済みの種目に留まらない');
    assert.ok(rig.counts.getCountsList()[0].make === 3,
      'targetMake を超える加算が保持されない: ' + rig.counts.getCountsList()[0].make);
    return true;
  });

  pbt.test('Command_Dispatcher: 自動遷移を無効にすると「次へ」だけでカーソルが動く（要件 6-3）', function () {
    var rig = makeRig({ autoAdvance: false });
    var t = 1000;
    rig.dispatcher.dispatch('MAKE', 'voice', t); t += 1000;
    rig.dispatcher.dispatch('MAKE', 'voice', t); t += 1000;
    assert.ok(rig.cursor.getIndex() === 0, '無効化しても自動遷移した');
    assert.ok(rig.completions.length === 0, '無効化しても完了通知が出た');
    rig.dispatcher.dispatch('NEXT', 'voice', t);
    assert.ok(rig.cursor.getIndex() === 1, '「次へ」でカーソルが動かない');
    return true;
  });

  pbt.test('Command_Dispatcher: 拒否理由が reasonKey 付きのメッセージになる（要件 4-13, 5-5, 6-5, 6-6）', function () {
    var rig = makeRig();

    // 履歴 0 件での取り消し（要件 5-5）
    rig.messages = [];
    var undone = rig.dispatcher.dispatch('UNDO', 'voice', 1000);
    assert.ok(undone.reason === 'EMPTY_HISTORY', '空履歴の拒否理由が EMPTY_HISTORY でない');
    assert.ok(rig.messages.length === 1 && rig.messages[0].reasonKey === 'EMPTY_HISTORY',
      '空履歴のメッセージが出ていない');

    // 先頭種目での PREV（要件 6-6）
    rig.messages = [];
    var first = rig.dispatcher.dispatch('PREV', 'voice', 2000);
    assert.ok(first.reason === 'AT_FIRST', '先頭種目の拒否理由が AT_FIRST でない');
    assert.ok(rig.messages[0].reasonKey === 'AT_FIRST' && rig.messages[0].holdMs === 3000,
      'AT_FIRST のメッセージが 3 秒継続指定になっていない');

    // 最終種目での NEXT（要件 6-5）
    rig.dispatcher.dispatch('NEXT', 'voice', 3000);
    rig.dispatcher.dispatch('NEXT', 'voice', 4000);
    rig.messages = [];
    var last = rig.dispatcher.dispatch('NEXT', 'voice', 5000);
    assert.ok(last.reason === 'AT_LAST', '最終種目の拒否理由が AT_LAST でない');
    assert.ok(rig.messages[0].reasonKey === 'AT_LAST' && rig.messages[0].holdMs === 3000,
      'AT_LAST のメッセージが 3 秒継続指定になっていない');

    // 未知のコマンド（全域性）
    rig.messages = [];
    var unknown = rig.dispatcher.dispatch('RESET_ALL', 'voice', 6000);
    assert.ok(unknown.ok === false && unknown.reason === 'UNKNOWN_COMMAND',
      '未知のコマンドが受け付けられた: ' + assert.format(unknown));
    return true;
  });

  pbt.test('Count_Manager / Cursor_Manager: 種目編集に伴う追従（要件 17-3, 17-12, 17-13, 17-14）', function () {
    var counts = shell.createCountManager();
    var cursor = shell.createCursorManager();
    counts.initFromMenu(MENU);
    cursor.setMenu(MENU);

    counts.apply('MAKE', 1);
    counts.apply('MISS', 2);
    counts.apply('MAKE', 3);
    cursor.selectIndex(1);

    // 種目 2 の削除 → カウントと操作履歴の破棄、アクティブ種目の再決定
    var purged = counts.purgeDrill(2);
    assert.ok(purged.removed !== null && purged.removed.id === 2, '種目 2 のカウントが破棄されない');
    assert.ok(purged.removedOperations === 1, '種目 2 の操作履歴が除去されない');
    assert.deepEqualOk(counts.getCountsList(),
      [{ id: 1, make: 1, attempt: 1 }, { id: 3, make: 1, attempt: 1 }],
      '他種目のカウントが変化した', { name: 'counts' });
    assert.deepEqualOk(counts.getHistory(),
      [{ drillId: 1, type: 'MAKE' }, { drillId: 3, type: 'MAKE' }],
      '操作履歴が期待と異なる', { name: 'history' });

    var nextIndex = cursor.reindexAfterMenuChange(1, 3, 2, 1);
    assert.ok(nextIndex === 1, 'アクティブ種目の再決定が期待と異なる: ' + nextIndex);

    // 高水位: 最大 id（3）を削除した直後の追加でも id 3 を再利用しない
    counts.purgeDrill(3);
    assert.ok(counts.getReservedIdHigh() >= 3,
      '種目 id の高水位が下がった: ' + counts.getReservedIdHigh());

    // 並べ替え: 値は変わらず順序だけが変わる
    counts.initFromMenu(MENU);
    counts.apply('MAKE', 3);
    counts.reorder([3, 1, 2]);
    assert.deepEqualOk(counts.getCountsList(),
      [{ id: 3, make: 1, attempt: 1 }, { id: 1, make: 0, attempt: 0 }, { id: 2, make: 0, attempt: 0 }],
      '並べ替えで値が変化した', { name: 'counts' });

    // 追加種目は 0 / 0
    counts.addDrill(9);
    var list = counts.getCountsList();
    assert.deepEqualOk(list[list.length - 1], { id: 9, make: 0, attempt: 0 },
      '追加種目のカウントが 0 / 0 でない', { name: 'added' });
    return true;
  });

  pbt.test('Menu_Manager: メニュー数と名称の制約、最後の削除の拒否（要件 18-3, 18-4, 18-6, 18-7, 18-8）', function () {
    var persisted = [];
    var mm = shell.createMenuManager({
      persist: function (menus, activeId) { persisted.push({ count: menus.length, activeId: activeId }); },
      now: function () { return 1758000000000; },
      random: function () { return 0.5; }
    });

    // 初期状態は既定メニュー 1 件（要件 18-5）
    assert.ok(mm.listMenus().length === 1, '初期メニュー数が 1 でない');
    assert.ok(mm.getActiveMenu().id === 'm-default', '既定メニューが選択中でない');

    // 最後の 1 件は削除できない（要件 18-7）
    var del = mm.deleteMenu('m-default');
    assert.ok(del.ok === false && del.violations[0].code === 'MENU_COUNT_RANGE',
      '最後のメニュー削除が拒否されない: ' + assert.format(del));
    assert.ok(mm.listMenus().length === 1, '拒否後にメニュー数が変化した');

    // 名称の制約（要件 18-3, 18-4）
    assert.ok(mm.createMenu('').ok === false, '空のメニュー名が受け付けられた');
    assert.ok(mm.createMenu('朝練125本IN').ok === false, '重複するメニュー名が受け付けられた');
    var longName = new Array(32).join('あ');
    assert.ok(mm.createMenu(longName).ok === false, '31 文字のメニュー名が受け付けられた');
    assert.ok(mm.listMenus().length === 1, '拒否された作成でメニューが増えた');

    // 正常な作成と切り替え
    var created = mm.createMenu('夕練');
    assert.ok(created.ok === true, 'メニュー作成が失敗した: ' + assert.format(created.violations));
    assert.ok(mm.listMenus().length === 2, 'メニュー数が 2 にならない');
    var newId = created.menu.id;
    assert.ok(mm.switchMenu(newId).ok === true, '切り替えが失敗した');
    assert.ok(mm.getActiveMenuId() === newId, '選択中メニューが切り替わらない');

    // 選択中メニューを削除すると残るメニューが選ばれる（要件 18-8）
    assert.ok(mm.deleteMenu(newId).ok === true, '選択中メニューの削除が失敗した');
    assert.ok(mm.getActiveMenuId() === 'm-default', '削除後に残るメニューが選択されない');

    // 変更が確定するたびに persist が呼ばれる
    assert.ok(persisted.length >= 3, 'persist の呼び出し回数が少ない: ' + persisted.length);
    return true;
  });

  pbt.test('Menu_Manager: 種目編集の検証と反映（要件 17-1, 17-4, 17-7, 17-16）', function () {
    var mm = shell.createMenuManager({});
    var drills = mm.getActiveMenu().drills;
    var firstId = drills[0].id;

    // 値域違反は反映しない（要件 17-7）
    var bad = mm.updateDrill(firstId, { targetMake: 0 });
    assert.ok(bad.ok === false, 'targetMake 0 が受け付けられた');
    assert.ok(bad.violations[0].code === 'TARGET_MAKE_RANGE',
      '違反コードが TARGET_MAKE_RANGE でない: ' + bad.violations[0].code);
    assert.ok(mm.getActiveMenu().drills[0].targetMake === drills[0].targetMake,
      '拒否された編集が反映された');

    // section は空欄も自由文字列も受け付ける（要件 17-5）
    assert.ok(mm.updateDrill(firstId, { section: '' }).ok === true, '空の section が拒否された');
    assert.ok(mm.updateDrill(firstId, { section: '自由な区分🏀' }).ok === true,
      '自由文字列の section が拒否された');
    assert.ok(mm.getActiveMenu().drills[0].section === '自由な区分🏀',
      'section の編集が反映されない');

    // 種目名の編集は id を変えない（要件 17-2）
    assert.ok(mm.updateDrill(firstId, { name: '改名した種目' }).ok === true, '種目名の編集が拒否された');
    assert.ok(mm.getActiveMenu().drills[0].id === firstId, '編集で種目 id が変化した');

    // 並べ替えは id を保存する（要件 17-2, 17-3）
    var ids = [];
    var all = mm.getActiveMenu().drills;
    for (var i = all.length - 1; i >= 0; i--) { ids.push(all[i].id); }
    assert.ok(mm.reorderDrills(ids).ok === true, '並べ替えが拒否された');
    var reordered = mm.getActiveMenu().drills;
    for (var k = 0; k < ids.length; k++) {
      assert.ok(reordered[k].id === ids[k], '並べ替え後の id 列が指定と異なる');
    }

    // リセットは DRILL_MENU と同一内容に戻す（要件 17-16）
    assert.ok(mm.resetActiveMenuToDefault().ok === true, 'リセットが拒否された');
    assert.deepEqualOk(mm.getActiveMenu().drills, hook.DRILL_MENU,
      'リセット後の種目配列が DRILL_MENU と一致しない', { name: 'drills' });

    // 種目が 1 件のときは削除しない（要件 17-4 の下限 1）
    var single = shell.createMenuManager({});
    var singleDrills = single.getActiveMenu().drills;
    for (var d = 0; d < singleDrills.length - 1; d++) {
      single.removeDrill(singleDrills[d].id);
    }
    assert.ok(single.getActiveMenu().drills.length === 1, '種目が 1 件に減らない');
    var lastDrill = single.getActiveMenu().drills[0];
    var rejected = single.removeDrill(lastDrill.id);
    assert.ok(rejected.ok === false && rejected.violations[0].code === 'LAST_DRILL',
      '最後の種目の削除が拒否されない: ' + assert.format(rejected));
    return true;
  });
})();


/*
 * ============================================================================
 * タスク 11.5 / 11.6: Storage_Adapter の失敗経路
 * （要件 12-2, 12-3, 12-6, 12-7, 12-9, 12-11）
 * ============================================================================
 * 実際の localStorage には触れず、偽 storage を注入して検証する。
 * 非同期テストは tests.html / run-node.js の `__VSC_DEFERRED__` 規約に載せる。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;
  var shell = hook ? hook.shell : null;

  if (!shell || !shell.createStorageAdapter) {
    pbt.test('spec-unit.js: __VSC_TEST__.shell.createStorageAdapter の前提（タスク 11.5）', function () {
      assert.fail('Storage_Adapter のファクトリが公開されていない');
    });
    return;
  }

  var createStorageAdapter = shell.createStorageAdapter;
  var createPersistenceCoordinator = shell.createPersistenceCoordinator;
  var KEYS = shell.STORAGE_KEYS;

  /* ----------------------------------------------------------------- 偽 storage */

  function QuotaError() {
    this.name = 'QuotaExceededError';
    this.message = 'quota exceeded';
  }
  QuotaError.prototype = new Error();

  /**
   * 偽 storage。
   *   opts.failSetItem(key, value, store) が true を返すと QuotaExceededError を投げる。
   *   opts.corruptOnRead で「書き込んだ値と異なる値を読み返す」状況を作る。
   *   opts.unavailable で getItem / setItem が例外を投げる状況を作る。
   */
  function makeFakeStorage(opts) {
    var o = opts || {};
    var store = Object.create(null);
    var log = [];
    return {
      store: store,
      log: log,
      getItem: function (key) {
        log.push(['get', key]);
        if (o.unavailable) { throw new Error('unavailable'); }
        if (o.corruptOnRead === key) { return 'corrupted'; }
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem: function (key, value) {
        log.push(['set', key]);
        if (o.unavailable) { throw new Error('unavailable'); }
        if (typeof o.failSetItem === 'function' && o.failSetItem(key, value, store)) {
          throw new QuotaError();
        }
        store[key] = String(value);
      },
      removeItem: function (key) {
        log.push(['remove', key]);
        if (o.unavailable) { throw new Error('unavailable'); }
        delete store[key];
      }
    };
  }

  function historyRecord(id, endedAt) {
    return {
      schemaVersion: 1,
      id: id,
      endedAt: endedAt,
      completionSec: 600,
      menuId: 'm-test',
      menuName: 'テストメニュー',
      targetTotal: 10,
      totalMake: 8,
      totalAttempt: 12,
      totalRate: 66.7,
      achieved: false,
      drills: [{ name: '種目', targetMake: 10, make: 8, attempt: 12, rate: 66.7 }]
    };
  }

  /** 履歴を n 件だけ書き込んだ偽 storage を作る（成功経路のみを使う）。 */
  function seedHistory(adapter, count) {
    var chain = Promise.resolve();
    for (var i = 0; i < count; i++) {
      (function (k) {
        chain = chain.then(function () {
          var day = 1 + (k % 28);
          var iso = '2026-09-' + (day < 10 ? '0' + day : day) + 'T07:00:00+09:00';
          return adapter.appendHistory(historyRecord('h-' + (1000 + k), iso));
        });
      })(i);
    }
    return chain;
  }

  /* --------------------------------------------------- 非同期テストの登録規約 */

  if (!Array.isArray(G.__VSC_DEFERRED__)) { G.__VSC_DEFERRED__ = []; }

  function deferredTest(name, fn) {
    G.__VSC_DEFERRED__.push(function () {
      return Promise.resolve().then(fn).then(function () {
        pbt.test(name, function () { return true; });
      }, function (e) {
        var text = (e && e.message) ? String(e.message) : String(e);
        pbt.test(name, function () { assert.fail(text); });
      });
    });
  }

  /* ------------------------------------------------------------------ 11.5 */

  deferredTest('Storage_Adapter: 容量超過時に最古 1 件を削除して再試行する（要件 12-6）', function () {
    // 履歴 3 件を先に入れ、以後の書き込みは「履歴鍵が 3 個以上あると失敗」させる。
    // 退避が進んで 2 件になった時点で保存が成功するはず。
    var fail = false;
    var fake = makeFakeStorage({
      failSetItem: function (key, value, store) {
        if (!fail) { return false; }
        if (key.indexOf('vsc:hist:') !== 0 || key === 'vsc:hist:index') { return false; }
        var n = 0;
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].indexOf('vsc:hist:') === 0 && keys[i] !== 'vsc:hist:index') { n++; }
        }
        return n >= 3;
      }
    });
    var adapter = createStorageAdapter({ storage: fake });

    return seedHistory(adapter, 3).then(function () {
      fail = true;
      return adapter.appendHistory(historyRecord('h-new', '2026-09-30T07:00:00+09:00'));
    }).then(function (result) {
      assert.ok(result.evicted === 1,
        '退避件数が 1 でない: ' + result.evicted);
      return adapter.listHistory();
    }).then(function (list) {
      assert.ok(list.length === 3, '保存後の履歴件数が 3 でない: ' + list.length);
      var ids = [];
      for (var i = 0; i < list.length; i++) { ids.push(list[i].id); }
      assert.ok(ids.indexOf('h-new') !== -1, '新しいレコードが保存されていない: ' + ids.join(','));
      assert.ok(ids.indexOf('h-1000') === -1,
        '最古のレコード（h-1000）が削除されていない: ' + ids.join(','));
    });
  });

  deferredTest('Storage_Adapter: 履歴 0 件でも容量超過なら内容を維持して拒否する（要件 12-9）', function () {
    var fake = makeFakeStorage({
      failSetItem: function (key) {
        return key.indexOf('vsc:hist:') === 0 && key !== 'vsc:hist:index';
      }
    });
    var adapter = createStorageAdapter({ storage: fake });
    return adapter.appendHistory(historyRecord('h-1', '2026-09-25T07:00:00+09:00')).then(function () {
      assert.fail('容量超過なのに解決した');
    }, function (reason) {
      assert.ok(reason.code === 'QUOTA_EXCEEDED',
        '拒否理由が QUOTA_EXCEEDED でない: ' + assert.format(reason));
      // 履歴 0 件から始めたので退避は起きず、内容は試行前のまま
      assert.ok(Object.prototype.hasOwnProperty.call(fake.store, 'vsc:hist:h-1') === false,
        '書きかけのレコード鍵が残っている');
      var index = fake.store['vsc:hist:index'];
      assert.ok(index === undefined || index === '[]',
        'インデックスが試行前の内容と異なる: ' + index);
      return adapter.listHistory();
    }).then(function (list) {
      assert.ok(list.length === 0, '拒否後に履歴が増えている: ' + list.length);
    });
  });

  deferredTest('Storage_Adapter: 履歴 100 件で最古 1 件を削除してから保存する（要件 14-5, 14-6）', function () {
    var fake = makeFakeStorage({});
    var adapter = createStorageAdapter({ storage: fake });
    var MAX = hook.LIMITS.HISTORY_MAX;

    // endedAt を単調増加させて最古が一意に決まるようにする
    var chain = Promise.resolve();
    for (var i = 0; i < MAX; i++) {
      (function (k) {
        chain = chain.then(function () {
          var mins = k;
          var hh = 1 + Math.floor(mins / 60);
          var mm = mins % 60;
          var iso = '2026-09-01T' + (hh < 10 ? '0' + hh : hh) + ':' +
            (mm < 10 ? '0' + mm : mm) + ':00+09:00';
          return adapter.appendHistory(historyRecord('h-' + (10000 + k), iso));
        });
      })(i);
    }

    return chain.then(function () {
      return adapter.listHistory();
    }).then(function (list) {
      assert.ok(list.length === MAX, MAX + ' 件にならない: ' + list.length);
      return adapter.appendHistory(historyRecord('h-99999', '2026-09-02T00:00:00+09:00'));
    }).then(function () {
      return adapter.listHistory();
    }).then(function (list) {
      assert.ok(list.length === MAX, '上限を超えた: ' + list.length);
      var ids = [];
      for (var i = 0; i < list.length; i++) { ids.push(list[i].id); }
      assert.ok(ids[0] === 'h-99999', '最新が先頭に来ていない: ' + ids[0]);
      assert.ok(ids.indexOf('h-10000') === -1, '最古が削除されていない');
      assert.ok(Object.prototype.hasOwnProperty.call(fake.store, 'vsc:hist:h-10000') === false,
        '最古のレコード鍵が残っている');
    });
  });

  /* ------------------------------------------------------------------ 11.6 */

  deferredTest('Storage_Adapter: UNAVAILABLE / VERIFY_MISMATCH / TIMEOUT の拒否値（要件 12-2, 12-7）', function () {
    var unavailable = createStorageAdapter({ storage: makeFakeStorage({ unavailable: true }) });
    var mismatch = createStorageAdapter({
      storage: makeFakeStorage({ corruptOnRead: 'vsc:session' })
    });
    // 締切が先に到来した状況（将来の非同期バックエンド相当）。タイマーを
    // 同期発火させることで、要件 12-2 の「1000ms 以内に拒否する」分岐を通す。
    var timedOut = createStorageAdapter({
      storage: {
        getItem: function () { return null; },
        setItem: function () {},
        removeItem: function () {}
      },
      timeoutMs: 1,
      setTimer: function (fn) { fn(); return null; },
      clearTimer: function () {}
    });

    return unavailable.saveSession({ counts: [] }).then(function () {
      assert.fail('利用不能な storage で解決した');
    }, function (reason) {
      assert.ok(reason.code === 'UNAVAILABLE', '拒否理由が UNAVAILABLE でない: ' + reason.code);
      assert.ok(reason.key === KEYS.SESSION, '拒否値の key が session でない: ' + reason.key);
      return mismatch.saveSession({ counts: [] });
    }).then(function () {
      assert.fail('読み返し不一致で解決した');
    }, function (reason) {
      assert.ok(reason.code === 'VERIFY_MISMATCH',
        '拒否理由が VERIFY_MISMATCH でない: ' + reason.code);
      return timedOut.saveSession({ counts: [] });
    }).then(function () {
      assert.fail('締切を越えた保存が解決した');
    }, function (reason) {
      assert.ok(reason.code === 'TIMEOUT', '拒否理由が TIMEOUT でない: ' + reason.code);
      assert.ok(reason.key === KEYS.SESSION, 'TIMEOUT の key が session でない: ' + reason.key);
    });
  });

  deferredTest('Storage_Adapter: 接頭辞 vsc: を持たない鍵を操作しない（要件 12-3）', function () {
    var fake = makeFakeStorage({});
    fake.store['other:key'] = 'foreign';
    var adapter = createStorageAdapter({ storage: fake });

    return adapter.saveSettings({ powerSave: true }).then(function () {
      return adapter.loadSettings();
    }).then(function (settings) {
      assert.ok(settings.powerSave === true, '設定が保存・復元されない');
      // 触れた鍵はすべて vsc: 接頭辞
      for (var i = 0; i < fake.log.length; i++) {
        var key = fake.log[i][1];
        assert.ok(String(key).indexOf('vsc:') === 0,
          '接頭辞を持たない鍵を操作した: ' + fake.log[i][0] + ' ' + key);
      }
      assert.ok(fake.store['other:key'] === 'foreign', '他の鍵が変更された');
      // vsc:probe は検証後に必ず削除される
      return adapter.probe();
    }).then(function () {
      assert.ok(Object.prototype.hasOwnProperty.call(fake.store, 'vsc:probe') === false,
        'vsc:probe が残っている');
    });
  });

  deferredTest('Persistence_Coordinator: 300ms デバウンスと同一原因メッセージの重複抑止（要件 12-4, 12-7）', function () {
    var saved = [];
    var messages = [];
    var clock = 0;
    var pending = [];

    var fakeStorage = {
      saveSession: function (state) {
        saved.push(state);
        return Promise.resolve();
      }
    };

    var coordinator = createPersistenceCoordinator({
      storage: fakeStorage,
      getSessionState: function () { return { counts: [], marker: saved.length }; },
      showMessage: function (kind, text, holdMs, reasonKey) {
        messages.push({ kind: kind, reasonKey: reasonKey });
      },
      now: function () { return clock; },
      setTimer: function (fn, ms) {
        var entry = { fn: fn, at: clock + ms };
        pending.push(entry);
        return entry;
      },
      clearTimer: function (handle) {
        var at = pending.indexOf(handle);
        if (at !== -1) { pending.splice(at, 1); }
      }
    });

    function advance(to) {
      clock = to;
      var due = [];
      for (var i = pending.length - 1; i >= 0; i--) {
        if (pending[i].at <= clock) {
          due.unshift(pending[i]);
          pending.splice(i, 1);
        }
      }
      var chain = Promise.resolve();
      for (var k = 0; k < due.length; k++) {
        (function (entry) {
          chain = chain.then(function () { return entry.fn(); });
        })(due[k]);
      }
      return chain;
    }

    // 0ms / 100ms / 200ms の 3 回の変化は 1 回の保存にまとまる
    coordinator.scheduleSave();
    clock = 100;
    coordinator.scheduleSave();
    clock = 200;
    coordinator.scheduleSave();
    assert.ok(saved.length === 0, 'デバウンス前に保存された');

    return advance(500).then(function () {
      assert.ok(saved.length === 1, '3 回の変化が 1 回の保存にまとまらない: ' + saved.length);

      // 締切: 最初の変化から 1000ms を越えて待たない
      coordinator.scheduleSave();          // clock=500 → deadline 1500
      clock = 900;
      coordinator.scheduleSave();
      clock = 1400;
      coordinator.scheduleSave();          // 1400 + 300 > 1500 → 1500 で発火
      var latest = pending[pending.length - 1];
      assert.ok(latest.at <= 1500,
        '締切 1500ms を越えて保存が遅延した: ' + latest.at);
      return advance(1500);
    }).then(function () {
      assert.ok(saved.length === 2, '締切で保存されない: ' + saved.length);

      // 失敗時は同一 code のメッセージを 1 回だけ出す（要件 12-7）
      var failing = createPersistenceCoordinator({
        storage: {
          saveSession: function () {
            return Promise.reject({ code: 'QUOTA_EXCEEDED', key: 'vsc:session', message: 'full.' });
          }
        },
        getSessionState: function () { return { counts: [] }; },
        showMessage: function (kind, text, holdMs, reasonKey) {
          messages.push({ kind: kind, reasonKey: reasonKey });
        }
      });
      return failing.flush().then(function () { return failing.flush(); })
        .then(function () { return failing.flush(); });
    }).then(function () {
      var quota = 0;
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].reasonKey === 'QUOTA_EXCEEDED') { quota++; }
      }
      assert.ok(quota === 1, '同一原因のメッセージが重複表示された: ' + quota + ' 回');
    });
  });

  pbt.test('Persistence_Coordinator: 他タブの vsc:session 変化で保存を停止する（要件 12-11）', function () {
    var messages = [];
    var conflicts = 0;
    var coordinator = createPersistenceCoordinator({
      storage: { saveSession: function () { return Promise.resolve(); } },
      getSessionState: function () { return { counts: [] }; },
      showMessage: function (kind, text, holdMs, reasonKey) {
        messages.push({ kind: kind, reasonKey: reasonKey });
      },
      onConflict: function () { conflicts++; }
    });

    assert.ok(coordinator.isConflicted() === false, '初期状態で競合になっている');

    // 他の鍵の変化は無視する
    assert.ok(coordinator.handleStorageEvent({ key: 'vsc:settings' }) === false,
      '関係ない鍵の変化を競合として扱った');
    assert.ok(coordinator.isConflicted() === false, '関係ない鍵で競合になった');

    assert.ok(coordinator.handleStorageEvent({ key: 'vsc:session' }) === true,
      'vsc:session の変化を検知しない');
    assert.ok(coordinator.isConflicted() === true, '競合フラグが立たない');
    assert.ok(conflicts === 1, 'onConflict が呼ばれていない');
    assert.ok(messages.length === 1 && messages[0].reasonKey === 'CONFLICT',
      '競合メッセージが出ていない: ' + assert.format(messages));

    // 2 回目の検知では重複してメッセージを出さない
    coordinator.handleStorageEvent({ key: 'vsc:session' });
    assert.ok(messages.length === 1, '競合メッセージが重複表示された');
    assert.ok(conflicts === 1, 'onConflict が重複して呼ばれた');
    return true;
  });
})();


/*
 * ============================================================================
 * タスク 12.7: レイアウト切替境界（要件 8-9, 8-10, 8-11）
 * ============================================================================
 * 表示形式の決定は純粋関数 `layoutModeFor(width, height)` に閉じているため、
 * DOM を用意せずに境界（567 / 568 / 569）を直接確認できる。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  if (!hook || !hook.layoutModeFor) {
    pbt.test('spec-unit.js: layoutModeFor の前提（タスク 12.7）', function () {
      assert.fail('公開フックに layoutModeFor が無い');
    });
    return;
  }

  var layoutModeFor = hook.layoutModeFor;

  pbt.test('layoutModeFor: 長辺 567 / 568 / 569 で集約表示と一覧表示が切り替わる（要件 8-10）', function () {
    var cases = [
      // [幅, 高さ, 期待]
      [320, 567, 'aggregate'],
      [320, 568, 'list'],
      [320, 569, 'list'],
      [375, 812, 'list'],
      // 正方形は縦向き扱い（高さ ≥ 幅）。長辺 = 567 なので集約表示
      [567, 567, 'aggregate'],
      [568, 568, 'list'],
      // 幅 > 高さ（横向き）は常に一覧表示（要件 8-11）
      [812, 375, 'list'],
      [569, 320, 'list'],
      [400, 300, 'list'],
      // 全域性: 不正な寸法でも 'list' / 'aggregate' のいずれかを返す
      [0, 0, 'aggregate'],
      [NaN, NaN, 'aggregate'],
      [undefined, undefined, 'aggregate']
    ];
    for (var i = 0; i < cases.length; i++) {
      var actual = layoutModeFor(cases[i][0], cases[i][1]);
      assert.ok(actual === cases[i][2],
        cases[i][0] + '×' + cases[i][1] + ' -> ' + actual + '（期待 ' + cases[i][2] + '）');
    }
    return true;
  });
})();


/*
 * ============================================================================
 * タスク 14.3 / 15.2 / 17.3: 音声認識・Wake Lock・タイマーの状態遷移
 * （要件 2-6, 2-8, 2-11, 3-7, 9-1, 9-6, 9-8, 11-6, 11-7, 11-8, 15-7）
 * ============================================================================
 * ブラウザ API は偽オブジェクトを注入する。時刻とタイマーも注入するため、
 * 実時間の待機を伴わずに分岐を確認できる。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;
  var shell = hook ? hook.shell : null;

  if (!shell || !shell.createSpeechRecognizer) {
    pbt.test('spec-unit.js: 音声認識 / Wake Lock / タイマーのファクトリの前提', function () {
      assert.fail('createSpeechRecognizer / createWakeLockManager / createSessionTimer が公開されていない');
    });
    return;
  }

  /* ------------------------------------------------- 偽の認識オブジェクト */

  function makeFakeRecognition(log) {
    function Fake() {
      this.lang = null;
      this.continuous = null;
      this.interimResults = null;
      this.onresult = null;
      this.onend = null;
      this.onerror = null;
      log.instances.push(this);
    }
    Fake.prototype.start = function () { log.starts++; };
    Fake.prototype.stop = function () { log.stops++; };
    Fake.prototype.abort = function () { log.aborts++; };
    return Fake;
  }

  function makeRig(options) {
    var o = options || {};
    var log = { instances: [], starts: 0, stops: 0, aborts: 0 };
    var rig = {
      log: log,
      clock: 0,
      timers: [],
      commands: [],
      feedback: [],
      statuses: [],
      fatals: []
    };
    rig.recognizer = shell.createSpeechRecognizer({
      factory: makeFakeRecognition(log),
      window: { navigator: { onLine: (o.onLine === false) ? false : true } },
      now: function () { return rig.clock; },
      setTimer: function (fn, ms) {
        var entry = { fn: fn, at: rig.clock + ms, ms: ms };
        rig.timers.push(entry);
        return entry;
      },
      clearTimer: function (handle) {
        var at = rig.timers.indexOf(handle);
        if (at !== -1) { rig.timers.splice(at, 1); }
      },
      onCommand: function (type, at) { rig.commands.push({ type: type, at: at }); },
      onFeedback: function (payload) { rig.feedback.push(payload); },
      onStatus: function (status) { rig.statuses.push(status); },
      onFatal: function (info) { rig.fatals.push(info); }
    });
    rig.runTimers = function () {
      var due = rig.timers.slice();
      rig.timers.length = 0;
      for (var i = 0; i < due.length; i++) { due[i].fn(); }
      return due;
    };
    return rig;
  }

  function finalResult(textValue) {
    return {
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: textValue } } }
    };
  }

  /** 候補（alternatives）を複数持つ確定結果。第 1 候補が transcripts[0]。 */
  function finalWithAlternatives(transcripts) {
    var item = { isFinal: true, length: transcripts.length };
    for (var i = 0; i < transcripts.length; i++) { item[i] = { transcript: transcripts[i] }; }
    return { resultIndex: 0, results: { length: 1, 0: item } };
  }

  function interimResult(textValue) {
    return {
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: false, 0: { transcript: textValue } } }
    };
  }

  /* ------------------------------------------------------------------ 14.3 */

  pbt.test('Speech_Recognizer: 日本語・連続認識・暫定結果ありで開始する（要件 2-2）', function () {
    var rig = makeRig();
    assert.ok(rig.recognizer.isSupported() === true, '対応判定が false になった');
    assert.ok(rig.recognizer.getStatus() === 'stopped', '初期状態が停止中でない');

    assert.ok(rig.recognizer.enable() === true, '有効化に失敗した');
    assert.ok(rig.log.starts === 1, 'start が呼ばれない: ' + rig.log.starts);
    var instance = rig.log.instances[0];
    assert.ok(instance.lang === 'ja-JP', '認識言語が ja-JP でない: ' + instance.lang);
    assert.ok(instance.continuous === true, '連続認識が有効でない');
    assert.ok(instance.interimResults === true, '暫定結果の取得が有効でない');
    assert.ok(rig.recognizer.getStatus() === 'recognizing', '状態が認識中にならない');

    // 要件 2-3: 無効化で停止し、以後の自動再開を行わない
    rig.recognizer.disable();
    assert.ok(rig.log.stops === 1, 'stop が呼ばれない');
    assert.ok(rig.recognizer.getStatus() === 'stopped', '状態が停止中にならない');
    assert.ok(rig.timers.length === 0, '無効化後に再開タイマーが残っている');
    return true;
  });

  pbt.test('Speech_Recognizer: 暫定結果はコマンドを発行せず表示のみ（要件 2-9, 2-10, 3-11）', function () {
    var rig = makeRig();
    rig.recognizer.enable();

    rig.recognizer.__test.handleResult(interimResult('いん'));
    assert.ok(rig.commands.length === 0, '暫定結果でコマンドが発行された');
    assert.ok(rig.feedback.length === 1 && rig.feedback[0].interim === 'いん',
      '暫定テキストが表示に渡らない: ' + assert.format(rig.feedback));

    rig.recognizer.__test.handleResult(finalResult('イン'));
    assert.ok(rig.commands.length === 1 && rig.commands[0].type === 'MAKE',
      '確定結果で成功コマンドが発行されない: ' + assert.format(rig.commands));
    assert.ok(rig.feedback[1].final === 'イン', '確定テキストが表示に渡らない');

    // 要件 3-8: コマンド語を含まない確定結果は表示のみ
    rig.clock = 10000;
    rig.recognizer.__test.handleResult(finalResult('こんにちは'));
    assert.ok(rig.commands.length === 1, 'コマンド語を含まない結果でコマンドが発行された');
    assert.ok(rig.feedback[2].final === 'こんにちは', '非コマンドの確定テキストが表示されない');
    return true;
  });

  pbt.test('Speech_Recognizer: 第 2 候補以降からもコマンドを拾う（短い「イン」の取りこぼし対策）', function () {
    var rig = makeRig();
    rig.recognizer.enable();
    var instance = rig.log.instances[0];
    assert.ok(instance.maxAlternatives >= 2,
      'maxAlternatives が 2 以上でない: ' + instance.maxAlternatives);

    // 第 1 候補が「印」（コマンド語を含まない同音語）でも第 2 候補の「イン」を拾う
    rig.clock = 1000;
    rig.recognizer.__test.handleResult(finalWithAlternatives(['印', 'イン', '員']));
    assert.ok(rig.commands.length === 1 && rig.commands[0].type === 'MAKE',
      '第 2 候補からコマンドを拾えない: ' + assert.format(rig.commands));

    // 表示は第 1 候補を出しつつ、命中した候補を matched で伝える
    var last = rig.feedback[rig.feedback.length - 1];
    assert.ok(last.final === '印', '確定表示が第 1 候補でない: ' + last.final);
    assert.ok(last.matched === 'イン',
      '命中した候補が matched に載らない: ' + assert.format(last.matched));

    // 第 1 候補が除外語に覆われる場合（「ポイント」は「いん」を含むがマスクされる）
    rig.clock = 5000;
    rig.recognizer.__test.handleResult(finalWithAlternatives(['ポイント', 'イン']));
    assert.ok(rig.commands.length === 2,
      '除外語に覆われた第 1 候補の次の候補を拾えない: ' + assert.format(rig.commands));

    // 第 1 候補で命中する場合は matched を立てない（余計な併記をしない）
    rig.clock = 9000;
    rig.recognizer.__test.handleResult(finalWithAlternatives(['イン', '印']));
    var hit = rig.feedback[rig.feedback.length - 1];
    assert.ok(hit.final === 'イン' && hit.matched === null,
      '第 1 候補で命中したのに matched が立っている: ' + assert.format(hit));

    // どの候補にもコマンド語が無ければ発行しない（要件 3-8）
    rig.clock = 13000;
    var before = rig.commands.length;
    rig.recognizer.__test.handleResult(finalWithAlternatives(['印', '員', '陰']));
    assert.ok(rig.commands.length === before,
      'コマンド語を含まない候補群でコマンドが発行された');
    assert.ok(rig.feedback[rig.feedback.length - 1].final === '印',
      '非コマンドの確定テキストが表示されない');
    return true;
  });

  pbt.test('Speech_Recognizer: 候補を持たない結果でも従来どおり動く（後方互換）', function () {
    var rig = makeRig();
    rig.recognizer.enable();
    // length を持たない（= 候補 1 個だけの）結果要素
    rig.recognizer.__test.handleResult({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, 0: { transcript: 'アウト' } } }
    });
    assert.ok(rig.commands.length === 1 && rig.commands[0].type === 'MISS',
      '候補数を持たない結果からコマンドを拾えない: ' + assert.format(rig.commands));
    return true;
  });

  pbt.test('Speech_Recognizer: 同一種別 800ms 抑止の起点は直前の発行時刻から動かない（要件 3-7）', function () {
    var rig = makeRig();
    rig.recognizer.enable();

    rig.clock = 1000;
    rig.recognizer.__test.handleResult(finalResult('イン'));
    assert.ok(rig.commands.length === 1, '1 回目が発行されない');

    // 799ms 後は破棄（かつ起点は 1000 のまま）
    rig.clock = 1799;
    rig.recognizer.__test.handleResult(finalResult('イン'));
    assert.ok(rig.commands.length === 1, '799ms 後の同一種別が発行された');

    // 起点が 1799 に動いていれば 1800 でも破棄されるが、1000 起点なので発行される
    rig.clock = 1800;
    rig.recognizer.__test.handleResult(finalResult('イン'));
    assert.ok(rig.commands.length === 2,
      '抑止の起点が直前の発行時刻から動いた（1800ms で発行されない）');
    assert.ok(rig.commands[1].at === 1800, '2 回目の発行時刻が 1800 でない');

    // 別種別は独立に判定する
    rig.clock = 1801;
    rig.recognizer.__test.handleResult(finalResult('アウト'));
    assert.ok(rig.commands.length === 3 && rig.commands[2].type === 'MISS',
      '別種別のコマンドが抑止された');
    return true;
  });

  pbt.test('Speech_Recognizer: 自動再開の 300ms / 倍々 / 5000ms 飽和 / 5 回目中止（要件 2-6, 2-11）', function () {
    var rig = makeRig();
    rig.recognizer.enable();

    // 結果を受信して終了 → 300ms
    rig.recognizer.__test.handleResult(finalResult('イン'));
    rig.recognizer.__test.handleEnd();
    assert.ok(rig.timers.length === 1 && rig.timers[0].ms === 300,
      '結果受信後の待機が 300ms でない: ' + assert.format(rig.timers));
    assert.ok(rig.recognizer.getStatus() === 'restarting', '状態が再開待機中にならない');
    rig.runTimers();
    assert.ok(rig.log.starts === 2, '再開で start が呼ばれない');

    // 以後は結果なしで終了 → 600 / 1200 / 2400 → 5 回目で中止
    var expected = [600, 1200, 2400];
    for (var i = 0; i < expected.length; i++) {
      rig.recognizer.__test.handleEnd();
      assert.ok(rig.timers.length === 1 && rig.timers[0].ms === expected[i],
        (i + 1) + ' 回目の空結果の待機が ' + expected[i] + 'ms でない: ' +
        assert.format(rig.timers));
      rig.runTimers();
    }

    // 4 回目の空結果で連続 4 回、5 回目で中止（要件 2-11）
    rig.recognizer.__test.handleEnd();
    assert.ok(rig.timers.length === 1 && rig.timers[0].ms === 4800,
      '4 回目の空結果の待機が 4800ms でない: ' + assert.format(rig.timers));
    rig.runTimers();

    rig.recognizer.__test.handleEnd();
    assert.ok(rig.timers.length === 0, '5 回目の空結果で再開タイマーが作られた');
    assert.ok(rig.recognizer.isEnabled() === false, '中止後もトグルが有効のまま');
    assert.ok(rig.recognizer.getStatus() === 'stopped', '中止後の状態が停止中でない');
    assert.ok(rig.fatals.length === 1 && rig.fatals[0].reasonKey === 'SPEECH_ABORTED',
      '中止のメッセージが出ていない: ' + assert.format(rig.fatals));

    // 再有効化でカウンタが 0 に戻る（次の空結果終了は 600ms ではなく 600ms 未満側から）
    rig.recognizer.enable();
    rig.recognizer.__test.handleEnd();
    assert.ok(rig.timers.length === 1 && rig.timers[0].ms === 600,
      '再有効化後の 1 回目の空結果の待機が 600ms でない: ' + assert.format(rig.timers));
    return true;
  });

  pbt.test('Speech_Recognizer: 5000ms で飽和する（要件 2-6）', function () {
    // 飽和の確認は restartDelay の単体テストが担うが、認識器側の持ち回しでも
    // 5000ms を超えないことを確認する（連続回数の上限 5 と干渉しない形で検証）。
    var restartDelay = hook.restartDelay;
    var delay = 0;
    var empty = 0;
    for (var i = 0; i < 4; i++) {
      var plan = restartDelay(false, empty, delay);
      empty = plan.consecutiveEmpty;
      if (plan.stop) { break; }
      delay = plan.delayMs;
      assert.ok(delay <= 5000, '待機時間が 5000ms を超えた: ' + delay);
    }
    // 上限に達した状態から再度計算しても 5000ms を超えない
    var saturated = restartDelay(false, 1, 5000);
    assert.ok(saturated.delayMs === 5000, '飽和後の待機が 5000ms でない: ' + saturated.delayMs);
    return true;
  });

  pbt.test('Speech_Recognizer: マイク拒否 / network / オフラインで自動再開しない（要件 2-8, 15-7）', function () {
    var denied = makeRig();
    denied.recognizer.enable();
    denied.recognizer.__test.handleError({ error: 'not-allowed' });
    assert.ok(denied.recognizer.isEnabled() === false, 'マイク拒否後もトグルが有効のまま');
    assert.ok(denied.timers.length === 0, 'マイク拒否後に再開タイマーが作られた');
    assert.ok(denied.fatals[0].reasonKey === 'MIC_DENIED',
      'マイク拒否のメッセージが出ていない: ' + assert.format(denied.fatals));

    var network = makeRig();
    network.recognizer.enable();
    network.recognizer.__test.handleError({ error: 'network' });
    assert.ok(network.recognizer.isEnabled() === false, 'network エラー後もトグルが有効のまま');
    assert.ok(network.fatals[0].reasonKey === 'SPEECH_NETWORK',
      'network エラーのメッセージが出ていない');

    var offline = makeRig({ onLine: false });
    assert.ok(offline.recognizer.enable() === false, 'オフラインで開始してしまった');
    assert.ok(offline.log.starts === 0, 'オフラインで start が呼ばれた');
    assert.ok(offline.fatals[0].reasonKey === 'SPEECH_OFFLINE',
      'オフラインのメッセージが出ていない: ' + assert.format(offline.fatals));

    // 非対応端末
    var unsupported = shell.createSpeechRecognizer({
      window: { navigator: {} },
      onFatal: function (info) { unsupported.__fatal = info; }
    });
    assert.ok(unsupported.isSupported() === false, '非対応判定にならない');
    assert.ok(unsupported.enable() === false, '非対応で有効化できてしまった');
    return true;
  });

  /* ------------------------------------------------------------------ 15.2 */

  function makeWakeRig(behavior) {
    var rig = {
      states: [],
      messages: [],
      released: 0,
      listeners: {}
    };
    var sentinel = {
      addEventListener: function (name, fn) { rig.listeners[name] = fn; },
      release: function () { rig.released++; return Promise.resolve(); }
    };
    rig.sentinel = sentinel;
    rig.manager = shell.createWakeLockManager({
      wakeLock: {
        request: function (type) {
          rig.lastType = type;
          if (behavior === 'fail') { return Promise.reject(new Error('denied')); }
          return Promise.resolve(sentinel);
        }
      },
      document: null,
      onStateChange: function (held) { rig.states.push(held); },
      onMessage: function (kind, text, holdMs, reasonKey) {
        rig.messages.push({ kind: kind, reasonKey: reasonKey });
      }
    });
    return rig;
  }

  G.__VSC_DEFERRED__ = Array.isArray(G.__VSC_DEFERRED__) ? G.__VSC_DEFERRED__ : [];

  function deferred(name, fn) {
    G.__VSC_DEFERRED__.push(function () {
      return Promise.resolve().then(fn).then(function () {
        pbt.test(name, function () { return true; });
      }, function (e) {
        var msg = (e && e.message) ? String(e.message) : String(e);
        pbt.test(name, function () { assert.fail(msg); });
      });
    });
  }

  deferred('Wake_Lock_Manager: 取得成功 / 解放 / 意図しない解放 / 可視復帰再要求（要件 9-1, 9-7, 9-8, 9-4）', function () {
    var rig = makeWakeRig('ok');
    rig.manager.setSessionActive(true);

    return rig.manager.request().then(function (held) {
      assert.ok(held === true, '取得に成功しない');
      assert.ok(rig.lastType === 'screen', '要求した種別が screen でない: ' + rig.lastType);
      assert.ok(rig.manager.isHeld() === true, '取得状態にならない');
      assert.deepEqualOk(rig.states, [true], '状態変化の通知が期待と異なる', { name: 'states' });

      // 要件 9-7: セッション終了で解放する
      return rig.manager.release();
    }).then(function () {
      assert.ok(rig.manager.isHeld() === false, '解放後も取得状態のまま');
      assert.ok(rig.released === 1, 'sentinel.release が呼ばれない');

      // 要件 9-4: 可視復帰かつ未取得かつ進行中なら再要求する
      return rig.manager.handleVisibilityChange(true);
    }).then(function (result) {
      assert.ok(result === true, '可視復帰で再要求されない');
      assert.ok(rig.manager.isHeld() === true, '再要求後に取得状態にならない');

      // 要件 9-8: 意図しない解放では未取得に更新し、同一可視状態で再要求しない
      rig.listeners.release();
      assert.ok(rig.manager.isHeld() === false, '意図しない解放で未取得にならない');
      assert.ok(rig.manager.isBlocked() === true, '同一可視状態の抑止が立たない');
      return rig.manager.handleVisibilityChange(false);
    }).then(function (result) {
      assert.ok(result === false, '非可視で再要求された');
    });
  });

  deferred('Wake_Lock_Manager: 要求失敗と非対応（要件 9-5, 9-6）', function () {
    var failing = makeWakeRig('fail');
    failing.manager.setSessionActive(true);

    return failing.manager.request().then(function (held) {
      assert.ok(held === false, '失敗したのに取得成功になった');
      assert.ok(failing.manager.isHeld() === false, '失敗後に取得状態になった');
      assert.ok(failing.manager.isBlocked() === true, '失敗後に同一可視状態の抑止が立たない');
      assert.ok(failing.messages.length === 1 &&
        failing.messages[0].reasonKey === 'WAKELOCK_FAILED',
        '失敗のメッセージが出ていない: ' + assert.format(failing.messages));

      // 非対応端末では要求を発行せず、メッセージだけを出す（要件 9-5）
      var messages = [];
      var unsupported = shell.createWakeLockManager({
        wakeLock: null,
        document: null,
        onMessage: function (kind, text, holdMs, reasonKey) {
          messages.push({ kind: kind, reasonKey: reasonKey });
        }
      });
      assert.ok(unsupported.isSupported() === false, '非対応判定にならない');
      return unsupported.request().then(function (held) {
        assert.ok(held === false, '非対応で取得成功になった');
        assert.ok(messages.length === 1 && messages[0].reasonKey === 'WAKELOCK_UNSUPPORTED',
          '非対応のメッセージが出ていない: ' + assert.format(messages));
        // 同一メッセージを重複表示しない
        return unsupported.request();
      }).then(function () {
        assert.ok(messages.length === 1, '非対応のメッセージが重複表示された');
      });
    });
  });

  /* ------------------------------------------------------------------ 17.3 */

  pbt.test('Session_Timer: 開始 / 一時停止 / 再開 / 確定（要件 11-1, 11-4, 11-5, 11-6, 11-7）', function () {
    var clock = 1000000;
    var timer = shell.createSessionTimer({ now: function () { return clock; } });

    assert.ok(timer.isStarted() === false, '初期状態で開始済みになっている');
    assert.ok(timer.elapsedSec(clock) === 0, '未開始の経過秒が 0 でない');

    timer.start(clock);
    assert.ok(timer.isStarted() === true, '開始されない');
    assert.ok(timer.elapsedSec(clock) === 0, '開始直後の経過秒が 0 でない');
    assert.ok(timer.elapsedSec(clock + 10000) === 10, '10 秒後の経過秒が 10 でない');

    // 一時停止中は増加しない（要件 11-4）
    timer.pause(clock + 10000);
    assert.ok(timer.isPaused() === true, '一時停止にならない');
    assert.ok(timer.elapsedSec(clock + 30000) === 10, '一時停止中に経過秒が増えた');

    // 再開は一時停止時点を起点に加算を続ける（要件 11-5）
    timer.resume(clock + 30000);
    assert.ok(timer.isPaused() === false, '再開されない');
    assert.ok(timer.elapsedSec(clock + 35000) === 15,
      '再開後の経過秒が 15 でない: ' + timer.elapsedSec(clock + 35000));

    // 確定後は増加せず、再開もしない（要件 11-6, 11-7）
    var frozen = timer.freeze(clock + 40000);
    assert.ok(frozen === 20, '確定した達成時間が 20 でない: ' + frozen);
    assert.ok(timer.isFrozen() === true, '確定状態にならない');
    assert.ok(timer.elapsedSec(clock + 90000) === 20, '確定後に経過秒が増えた');
    timer.resume(clock + 95000);
    assert.ok(timer.elapsedSec(clock + 100000) === 20, '確定後に再開して増加した');
    assert.ok(timer.freeze(clock + 120000) === 20, '確定値が上書きされた');
    return true;
  });

  pbt.test('Session_Timer: ensureStarted と復元（要件 11-2, 11-8）', function () {
    var clock = 2000000;
    var timer = shell.createSessionTimer({ now: function () { return clock; } });

    // 要件 11-2: 計数コマンドでの暗黙の開始
    assert.ok(timer.ensureStarted(clock) === true, 'ensureStarted で開始されない');
    assert.ok(timer.ensureStarted(clock + 5000) === false, '開始済みなのに再度開始された');
    assert.ok(timer.elapsedSec(clock + 5000) === 5, '暗黙の開始後の経過秒が 5 でない');

    var snapshot = timer.snapshot();
    assert.ok(typeof snapshot.startedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(snapshot.startedAt),
      'startedAt が ISO 8601 拡張形式でない: ' + snapshot.startedAt);
    assert.ok(snapshot.elapsedSec === 5, 'snapshot の経過秒が 5 でない');
    assert.ok(snapshot.frozen === false, 'snapshot が確定済みになっている');

    // 復元: 非可視期間があっても保存値を下回らず、以後は現在時刻に追従する
    var later = clock + 600000; // 10 分後に復元
    var restored = shell.createSessionTimer({ now: function () { return later; } });
    assert.ok(restored.restore(snapshot, later) === 5, '復元直後の経過秒が保存値と異ならない');
    assert.ok(restored.elapsedSec(later) === 5, '復元直後の算出値が保存値を下回った');
    assert.ok(restored.elapsedSec(later + 3000) === 8,
      '復元後に現在時刻へ追従しない: ' + restored.elapsedSec(later + 3000));

    // 確定済みの復元は再開しない（要件 11-6）
    var frozenSnapshot = { startedAt: snapshot.startedAt, elapsedSec: 42, frozen: true };
    var frozenTimer = shell.createSessionTimer({ now: function () { return later; } });
    frozenTimer.restore(frozenSnapshot, later);
    assert.ok(frozenTimer.isFrozen() === true, '確定済みとして復元されない');
    assert.ok(frozenTimer.elapsedSec(later + 999999) === 42, '確定済みの復元後に増加した');

    // startedAt が壊れていても経過時間から再構成する（全域性）
    var broken = shell.createSessionTimer({ now: function () { return later; } });
    broken.restore({ startedAt: 'not-a-date', elapsedSec: 7, frozen: false }, later);
    assert.ok(broken.elapsedSec(later) === 7, '壊れた startedAt で経過時間が失われた');
    assert.ok(broken.elapsedSec(later + 2000) === 9, '再構成後に追従しない');

    // 上限 86399 に飽和する（要件 11-9）
    var saturating = shell.createSessionTimer({ now: function () { return later; } });
    saturating.start(later);
    assert.ok(saturating.elapsedSec(later + 999999999) === 86399, '86399 に飽和しない');
    return true;
  });

  /* --------------------------------------------- Theme_Manager（タスク 16.1）*/

  deferred('Theme_Manager: 保存値 > OS 配色 > 既定 の優先順位（要件 10-8, 10-9, 10-10）', function () {
    function makeDoc() {
      var attrs = Object.create(null);
      return {
        documentElement: {
          setAttribute: function (k, v) { attrs[k] = v; },
          removeAttribute: function (k) { delete attrs[k]; },
          getAttribute: function (k) {
            return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
          }
        },
        __attrs: attrs
      };
    }
    function makeWindow(dark) {
      return { matchMedia: function () { return { matches: dark === true }; } };
    }
    function makeStorage(saved) {
      var store = { value: saved };
      return {
        loadSettings: function () {
          return Promise.resolve({ schemaVersion: 1, powerSave: store.value });
        },
        saveSettings: function (settings) {
          store.value = settings.powerSave;
          return Promise.resolve();
        },
        __store: store
      };
    }

    // 保存値 true は OS のライト設定より優先される（要件 10-8）
    var docA = makeDoc();
    var themeA = shell.createThemeManager({
      document: docA, window: makeWindow(false), storage: makeStorage(true)
    });
    return themeA.init().then(function () {
      assert.ok(themeA.isPowerSave() === true, '保存値 true が優先されない');
      assert.ok(docA.__attrs['data-theme'] === 'power', 'data-theme が power にならない');
      assert.ok(themeA.getRenderBudgetMs() === 200, '省電力時の描画バジェットが 200 でない');

      // 未保存 + OS ダーク → 有効（要件 10-9）
      var docB = makeDoc();
      var themeB = shell.createThemeManager({
        document: docB, window: makeWindow(true), storage: makeStorage(null)
      });
      // 同期段（init 呼び出し直後）で既に適用済みであること（要件 10-8 後段）
      var promiseB = themeB.init();
      assert.ok(docB.__attrs['data-theme'] === 'power',
        'init の同期段で OS 配色が適用されていない');
      return promiseB.then(function () {
        assert.ok(themeB.isPowerSave() === true, 'OS ダークで省電力が有効にならない');

        // 未保存 + OS ライト → 無効（要件 10-10）
        var docC = makeDoc();
        var storageC = makeStorage(null);
        var themeC = shell.createThemeManager({
          document: docC, window: makeWindow(false), storage: storageC
        });
        return themeC.init().then(function () {
          assert.ok(themeC.isPowerSave() === false, '既定で省電力が無効にならない');
          assert.ok(docC.__attrs['data-theme'] === undefined,
            '通常モードで data-theme 属性が付いている');
          assert.ok(themeC.getRenderBudgetMs() === 0, '通常時の描画バジェットが 0 でない');

          // 切り替えは属性を同期的に変え、設定値を保存する（要件 10-2, 10-7）
          var toggled = themeC.toggle();
          assert.ok(docC.__attrs['data-theme'] === 'power',
            'toggle の同期段で配色が切り替わらない');
          return toggled.then(function () {
            assert.ok(storageC.__store.value === true, '設定値が保存されない');
          });
        });
      });
    });
  });
})();


/*
 * ============================================================================
 * タスク 18.4 / 19.3: メニュー切替の分岐と履歴の表示・保存
 * （要件 14-3, 14-4, 14-6, 14-9, 18-7, 18-9, 18-10, 18-11）
 * ============================================================================
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;
  var shell = hook ? hook.shell : null;

  if (!shell || !shell.createStorageAdapter) { return; }

  G.__VSC_DEFERRED__ = Array.isArray(G.__VSC_DEFERRED__) ? G.__VSC_DEFERRED__ : [];
  function deferred(name, fn) {
    G.__VSC_DEFERRED__.push(function () {
      return Promise.resolve().then(fn).then(function () {
        pbt.test(name, function () { return true; });
      }, function (e) {
        var msg = (e && e.message) ? String(e.message) : String(e);
        pbt.test(name, function () { assert.fail(msg); });
      });
    });
  }

  function memoryStorage() {
    var store = Object.create(null);
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
      __store: store
    };
  }

  var MENU_A = {
    id: 'm-a',
    name: 'メニューA',
    drills: [
      { id: 1, section: '近距離', name: '種目1', targetMake: 3 },
      { id: 2, section: '近距離', name: '種目2', targetMake: 2 }
    ]
  };
  var MENU_B = {
    id: 'm-b',
    name: 'メニューB',
    drills: [{ id: 1, section: '', name: '種目X', targetMake: 5 }]
  };

  /* ------------------------------------------------------------------ 18.4 */

  deferred('メニュー切替: 全体試投数 0 では履歴を保存しない（要件 18-11, 14-9）', function () {
    var backing = memoryStorage();
    var storage = shell.createStorageAdapter({ storage: backing });
    var counts = shell.createCountManager();
    var cursor = shell.createCursorManager();
    counts.initFromMenu(MENU_A);
    cursor.setMenu(MENU_A);

    var messages = [];
    var view = shell.createHistoryView({
      doc: null,
      storage: storage,
      panel: {
        showMessage: function (kind, text, holdMs, reasonKey) {
          messages.push({ kind: kind, reasonKey: reasonKey });
        }
      }
    });

    // 全体試投数 0 のまま切り替える
    return view.saveSession({
      menu: MENU_A,
      counts: counts.getCountsList(),
      completionSec: 120,
      endedAt: '2026-09-25T07:00:00+09:00'
    }).then(function (result) {
      assert.ok(result.saved === false, '試投 0 で履歴が保存された');
      assert.ok(messages.length === 1 && messages[0].reasonKey === 'HISTORY_NO_ATTEMPT',
        '記録対象がないことのメッセージが出ていない: ' + assert.format(messages));
      return storage.listHistory();
    }).then(function (list) {
      assert.ok(list.length === 0, '履歴件数が 0 でない: ' + list.length);

      // 切替後の初期化内容（要件 18-11 後段）
      counts.initFromMenu(MENU_B);
      cursor.setMenu(MENU_B);
      var after = counts.getCountsList();
      assert.ok(after.length === 1 && after[0].make === 0 && after[0].attempt === 0,
        '切替後のカウントが 0 で初期化されない: ' + assert.format(after));
      assert.ok(counts.getHistory().length === 0, '切替後に操作履歴が残っている');
      assert.ok(cursor.getIndex() === 0, '切替後のアクティブ種目が先頭でない');
    });
  });

  deferred('メニュー切替: 全体試投数 1 以上では履歴を保存してから切り替える（要件 18-10, 14-1）', function () {
    var backing = memoryStorage();
    var storage = shell.createStorageAdapter({ storage: backing });
    var counts = shell.createCountManager();
    counts.initFromMenu(MENU_A);
    counts.apply('MAKE', 1);
    counts.apply('MAKE', 1);
    counts.apply('MISS', 1);
    counts.apply('MAKE', 2);

    var view = shell.createHistoryView({ doc: null, storage: storage, panel: null });

    // 進行中セッションが保存されている状態を作る（要件 12-10 の削除を確認するため）
    return storage.saveSession({
      schemaVersion: hook.SCHEMA_VERSION,
      startedAt: '2026-09-25T06:00:00+09:00',
      elapsedSec: 300,
      menuId: MENU_A.id,
      activeIndex: 0,
      counts: counts.getCountsList(),
      operations: counts.getHistory(),
      ended: false
    }).then(function () {
      assert.ok(backing.__store['vsc:session'] !== undefined, '進行中セッションが保存されない');
      return view.saveSession({
        menu: MENU_A,
        counts: counts.getCountsList(),
        completionSec: 305,
        endedAt: '2026-09-25T07:00:00+09:00'
      });
    }).then(function (result) {
      assert.ok(result.saved === true, '試投 1 以上で履歴が保存されない');
      var record = result.record;
      assert.ok(/^h-[0-9a-z]+-[0-9a-z]{4}$/.test(record.id),
        '履歴識別子の形式が h-{base36}-{4 文字} でない: ' + record.id);
      assert.ok(record.endedAt === '2026-09-25T07:00:00+09:00', '終了日時が一致しない');
      assert.ok(record.completionSec === 305, '達成時間が一致しない');
      assert.ok(record.menuId === 'm-a' && record.menuName === 'メニューA',
        'メニュー識別子 / 名称が一致しない');
      assert.ok(record.targetTotal === 5, '目標合計が 5 でない: ' + record.targetTotal);
      assert.ok(record.totalMake === 3 && record.totalAttempt === 4,
        '全体成功数 / 試投数が一致しない: ' + record.totalMake + '/' + record.totalAttempt);
      assert.ok(record.totalRate === 75, '全体成功率が 75 でない: ' + record.totalRate);
      assert.ok(record.achieved === false, '未達なのに達成になっている');
      assert.ok(record.drills.length === 2, 'スナップショットの種目数が 2 でない');
      assert.deepEqualOk(record.drills[0],
        { name: '種目1', targetMake: 3, make: 2, attempt: 3, rate: 66.7 },
        'スナップショットの内容が一致しない', { name: 'drill' });

      // 要件 12-10: 履歴保存成功で進行中セッションを削除する
      assert.ok(backing.__store['vsc:session'] === undefined,
        '履歴保存後に進行中セッションが削除されていない');
      return storage.listHistory();
    }).then(function (list) {
      assert.ok(list.length === 1, '履歴件数が 1 でない: ' + list.length);
    });
  });

  pbt.test('メニュー切替: 最後のメニュー削除は拒否される（要件 18-7）', function () {
    var mm = shell.createMenuManager({});
    var result = mm.deleteMenu(mm.getActiveMenuId());
    assert.ok(result.ok === false, '最後のメニューが削除された');
    assert.ok(result.violations[0].code === 'MENU_COUNT_RANGE',
      '違反コードが MENU_COUNT_RANGE でない: ' + result.violations[0].code);
    assert.ok(mm.listMenus().length === 1, '拒否後にメニュー数が変化した');
    return true;
  });

  /* ------------------------------------------------------------------ 19.3 */

  deferred('History_View: 一覧の書式と 100 件超過時の最古削除（要件 14-2, 14-3, 14-6）', function () {
    var backing = memoryStorage();
    var storage = shell.createStorageAdapter({ storage: backing });

    function record(id, endedAt, make, attempt, target) {
      return {
        schemaVersion: 1,
        id: id,
        endedAt: endedAt,
        completionSec: 3725,
        menuId: 'm-a',
        menuName: 'メニューA',
        targetTotal: target,
        totalMake: make,
        totalAttempt: attempt,
        totalRate: hook.successRate(make, attempt),
        achieved: make >= target,
        drills: [
          { name: '種目1', targetMake: target, make: make, attempt: attempt,
            rate: hook.successRate(make, attempt) },
          { name: '種目2', targetMake: 2, make: 0, attempt: 0, rate: null }
        ]
      };
    }

    return storage.appendHistory(record('h-1', '2026-09-20T07:00:00+09:00', 3, 5, 5))
      .then(function () {
        return storage.appendHistory(record('h-2', '2026-09-22T19:30:00+09:00', 5, 5, 5));
      }).then(function () {
        // endedAt 同値 → id 降順（要件 14-2）
        return storage.appendHistory(record('h-3', '2026-09-22T19:30:00+09:00', 1, 4, 5));
      }).then(function () {
        return storage.listHistory();
      }).then(function (list) {
        var ids = [];
        for (var i = 0; i < list.length; i++) { ids.push(list[i].id); }
        assert.deepEqualOk(ids, ['h-3', 'h-2', 'h-1'],
          '終了日時降順 → id 降順に並ばない', { name: 'ids' });

        // 要件 14-3 の各表示値（書式は純粋関数で確認できる）
        assert.ok(hook.formatElapsed(3725) === '1:02:05',
          '達成時間の表示が h:mm:ss 形式でない: ' + hook.formatElapsed(3725));
        assert.ok(hook.formatRate(3, 5) === '60.0%',
          '全体成功率の表示が一致しない: ' + hook.formatRate(3, 5));
        // 要件 14-4: Attempt 0 の種目は --%
        assert.ok(hook.formatRate(0, 0) === '--%', '試投 0 の成功率が --% でない');
        assert.ok(list[0].achieved === false && list[1].achieved === true,
          '達成状態が期待と異なる');

        // 要件 14-7: 対象 1 件のみ削除する
        return storage.deleteHistory('h-2');
      }).then(function () {
        return storage.listHistory();
      }).then(function (list) {
        var ids = [];
        for (var i = 0; i < list.length; i++) { ids.push(list[i].id); }
        assert.deepEqualOk(ids, ['h-3', 'h-1'], '削除対象以外が消えた', { name: 'ids' });
        assert.ok(backing.__store['vsc:hist:h-2'] === undefined,
          '削除したレコードの鍵が残っている');
      });
  });

  pbt.test('buildHistoryRecord: 12 フィールドのみを持ち達成状態を算出する（要件 14-1）', function () {
    var record = hook.buildHistoryRecord ? hook.buildHistoryRecord({
      id: 'h-x',
      endedAt: '2026-09-25T07:00:00+09:00',
      completionSec: 600,
      menu: MENU_B,
      counts: [{ id: 1, make: 5, attempt: 6 }]
    }) : null;
    if (record === null) {
      assert.fail('公開フックに buildHistoryRecord が無い');
    }
    var keys = Object.keys(record).slice().sort();
    assert.deepEqualOk(keys, [
      'achieved', 'completionSec', 'drills', 'endedAt', 'id', 'menuId', 'menuName',
      'schemaVersion', 'targetTotal', 'totalAttempt', 'totalMake', 'totalRate'
    ], '履歴レコードのフィールド集合が異なる', { name: 'keys' });
    assert.ok(record.targetTotal === 5, '目標合計が 5 でない');
    assert.ok(record.achieved === true, '目標到達なのに達成になっていない');
    assert.ok(record.totalRate === 83.3, '全体成功率が 83.3 でない: ' + record.totalRate);
    return true;
  });
})();


/*
 * ============================================================================
 * タスク 2.2: 既定メニューの内容とテーマ配色定数
 * （要件 1-3, 1-4, 1-5, 1-6, 18-5, 8-12, 10-6, 7-2, 8-8）
 * ============================================================================
 * 有限集合を全列挙する単体テスト。コントラスト比は THEME.tokens の
 * 「カスケード後の実効値」に対して THEME.contrastPairs を全列挙して算出する。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  if (!hook || !hook.DRILL_MENU || !hook.THEME) {
    pbt.test('spec-unit.js: DRILL_MENU / THEME の前提（タスク 2.2）', function () {
      assert.fail('公開フックに DRILL_MENU / THEME が無い');
    });
    return;
  }

  var DRILL_MENU = hook.DRILL_MENU;
  var THEME = hook.THEME;
  var LIMITS = hook.LIMITS;

  pbt.test('DRILL_MENU: 13 種目・id 1〜13 の重複欠番なし・配列順 = id 昇順（要件 1-1, 1-2, 1-6）', function () {
    assert.ok(DRILL_MENU.length === 13, '種目数が 13 でない: ' + DRILL_MENU.length);
    var seen = Object.create(null);
    for (var i = 0; i < DRILL_MENU.length; i++) {
      var drill = DRILL_MENU[i];
      // 配列順 = id 昇順（要件 1-6）かつ id は 1〜13 の欠番なし
      assert.ok(drill.id === i + 1,
        i + ' 番目の id が ' + (i + 1) + ' でない: ' + drill.id);
      assert.ok(seen[drill.id] === undefined, 'id が重複している: ' + drill.id);
      seen[drill.id] = true;

      // 各種目の値域（要件 1-2, 17-4）
      var nameLength = Array.from(drill.name).length;
      assert.ok(nameLength >= LIMITS.DRILL_NAME_MIN && nameLength <= LIMITS.DRILL_NAME_MAX,
        drill.id + ' 番目の種目名の長さが 1〜40 文字でない: ' + nameLength);
      var sectionLength = Array.from(drill.section).length;
      assert.ok(sectionLength >= LIMITS.DRILL_SECTION_MIN &&
        sectionLength <= LIMITS.DRILL_SECTION_MAX,
        drill.id + ' 番目の section の長さが 0〜20 文字でない: ' + sectionLength);
      assert.ok(drill.targetMake >= LIMITS.TARGET_MAKE_MIN &&
        drill.targetMake <= LIMITS.TARGET_MAKE_MAX &&
        Math.floor(drill.targetMake) === drill.targetMake,
        drill.id + ' 番目の targetMake が 1〜99 の整数でない: ' + drill.targetMake);

      // Drill は 4 フィールドのみ
      assert.deepEqualOk(Object.keys(drill).slice().sort(),
        ['id', 'name', 'section', 'targetMake'],
        drill.id + ' 番目のフィールド集合が異なる', { name: 'keys' });
    }
    return true;
  });

  pbt.test('DRILL_MENU: セクション別合計 20 / 40 / 30 / 35 と総計 125（要件 1-3, 1-4, 1-5）', function () {
    var bySection = Object.create(null);
    var order = [];
    var total = 0;
    for (var i = 0; i < DRILL_MENU.length; i++) {
      var section = DRILL_MENU[i].section;
      if (bySection[section] === undefined) { bySection[section] = 0; order.push(section); }
      bySection[section] += DRILL_MENU[i].targetMake;
      total += DRILL_MENU[i].targetMake;
    }
    // 要件 1-3: section は 4 種類、各種目はそのうち 1 種類にのみ属する
    assert.deepEqualOk(order, ['近距離', 'エルボー', 'ネイル', 'アウトサイド'],
      'section の種類と初出順が期待と異なる', { name: 'sections' });
    // 要件 1-4: セクション別合計
    assert.ok(bySection['近距離'] === 20, '近距離の合計が 20 でない: ' + bySection['近距離']);
    assert.ok(bySection['エルボー'] === 40, 'エルボーの合計が 40 でない: ' + bySection['エルボー']);
    assert.ok(bySection['ネイル'] === 30, 'ネイルの合計が 30 でない: ' + bySection['ネイル']);
    assert.ok(bySection['アウトサイド'] === 35,
      'アウトサイドの合計が 35 でない: ' + bySection['アウトサイド']);
    // 要件 1-5: 総計 125
    assert.ok(total === 125, '総計が 125 でない: ' + total);
    assert.ok(hook.deriveTargetTotal({ drills: DRILL_MENU }) === 125,
      'deriveTargetTotal が 125 を返さない');
    return true;
  });

  pbt.test('既定メニュー: 名称「朝練125本IN」と DRILL_MENU の複製（要件 18-5）', function () {
    var menu = hook.createDefaultMenu();
    assert.ok(menu.id === 'm-default', '既定メニューの id が m-default でない: ' + menu.id);
    assert.ok(menu.name === '朝練125本IN', '既定メニュー名が一致しない: ' + menu.name);
    assert.deepEqualOk(Object.keys(menu).slice().sort(), ['drills', 'id', 'name'],
      'Menu_Record が 3 フィールドでない', { name: 'keys' });
    assert.deepEqualOk(menu.drills, DRILL_MENU,
      '既定メニューの種目配列が DRILL_MENU と一致しない', { name: 'drills' });
    // 複製であり、DRILL_MENU 自身ではない（編集しても定数が変わらない）
    assert.ok(menu.drills !== DRILL_MENU, '種目配列が DRILL_MENU の参照そのものである');
    assert.ok(menu.drills[0] !== DRILL_MENU[0], '種目要素が DRILL_MENU の参照そのものである');
    assert.ok(hook.validateMenu(menu, { menuCount: 1 }).ok === true,
      '既定メニューが validateMenu を通らない');
    return true;
  });

  /* ------------------------------------------------- コントラスト比の全列挙 */

  function srgbToLinear(c) {
    var v = c / 255;
    return (v <= 0.04045) ? (v / 12.92) : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function parseHex(value) {
    var m = /^#([0-9a-fA-F]{6})$/.exec(String(value));
    if (!m) { return null; }
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance(rgb) {
    return 0.2126 * srgbToLinear(rgb[0]) +
      0.7152 * srgbToLinear(rgb[1]) +
      0.0722 * srgbToLinear(rgb[2]);
  }

  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    var hi = (la > lb) ? la : lb;
    var lo = (la > lb) ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  pbt.test('THEME: 通常 / 省電力の両テーマで全ペアがコントラスト基準を満たす（要件 8-12, 10-6, 7-2, 8-8）', function () {
    var themes = [THEME.normal, THEME.power];
    for (var t = 0; t < themes.length; t++) {
      var theme = themes[t];
      var tokens = theme.tokens;

      // 両テーマは同一のキー集合を持つ（カスケード後の実効値を全キー分持つ）
      assert.deepEqualOk(Object.keys(tokens).slice().sort(),
        Object.keys(THEME.normal.tokens).slice().sort(),
        theme.id + ' のトークンのキー集合が normal と一致しない', { name: 'tokens' });

      for (var p = 0; p < THEME.contrastPairs.length; p++) {
        var pair = THEME.contrastPairs[p];
        var fg = parseHex(tokens[pair.fg]);
        var bg = parseHex(tokens[pair.bg]);
        assert.ok(fg !== null, theme.id + ' の ' + pair.fg + ' が 6 桁 HEX でない');
        assert.ok(bg !== null, theme.id + ' の ' + pair.bg + ' が 6 桁 HEX でない');
        var ratio = contrast(fg, bg);
        assert.ok(ratio >= pair.minRatio,
          theme.id + ': ' + pair.fg + ' / ' + pair.bg + ' のコントラスト比が ' +
          pair.minRatio + ':1 未満（実測 ' + ratio.toFixed(2) + ':1、要件 ' +
          pair.requirement + '）');
      }
    }
    return true;
  });

  pbt.test('THEME: 省電力モードの背景は #000000 で前景は無彩色系（要件 10-2）', function () {
    var tokens = THEME.power.tokens;
    assert.ok(tokens['bg'] === '#000000', '省電力の背景が #000000 でない: ' + tokens['bg']);

    // 無彩色系 = R = G = B（前景に使うトークンを全列挙）
    var foreground = ['text', 'text-dim', 'btn-text', 'info', 'warn', 'error',
      'on-indicator', 'off-indicator', 'row-active-text', 'bar-fill'];
    for (var i = 0; i < foreground.length; i++) {
      var rgb = parseHex(tokens[foreground[i]]);
      assert.ok(rgb !== null, foreground[i] + ' が 6 桁 HEX でない');
      assert.ok(rgb[0] === rgb[1] && rgb[1] === rgb[2],
        '省電力の ' + foreground[i] + ' が無彩色系でない: ' + tokens[foreground[i]]);
    }

    // 描画バジェット（要件 10-4）
    assert.ok(THEME.normal.renderBudgetMs === 0, '通常時の描画バジェットが 0 でない');
    assert.ok(THEME.power.renderBudgetMs === 200, '省電力時の描画バジェットが 200 でない');
    assert.ok(THEME.normal.cssAttributeValue === null,
      '通常時に data-theme 属性値が定義されている');
    assert.ok(THEME.power.cssAttributeValue === 'power',
      '省電力時の data-theme 属性値が power でない');
    return true;
  });
})();
