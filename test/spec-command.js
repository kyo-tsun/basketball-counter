/*
 * voice-shot-counter-pwa — test/spec-command.js
 *
 * Property 13（コマンド選択の決定性と優先順規則）と
 * Property 14（正規化の冪等性）のプロパティテスト。
 *
 * 要件 16-4: ビルド工程を持たないため、本ファイルはクラシックスクリプトであり
 * `import` / `export` を含まない。tests.html から読み込まれた時点で自身の
 * テストを実行し、結果を pbt.results に積む。
 *
 * 検証対象は `window.__VSC_TEST__` 経由で公開される純粋関数のみであり、
 * DOM もブラウザ API のモックも用いない。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var pbt = G.pbt;
  var assert = G.assert;
  var hook = G.__VSC_TEST__;

  var REQUIRED = ['normalizeText', 'buildExclusionMask', 'selectCommand',
    'COMMAND_TABLE', 'EXCLUSION_WORDS'];

  var missing = [];
  for (var r = 0; r < REQUIRED.length; r++) {
    if (!hook || !hook[REQUIRED[r]]) { missing.push(REQUIRED[r]); }
  }
  if (missing.length > 0) {
    pbt.test('spec-command.js: window.__VSC_TEST__ の前提', function () {
      assert.fail('公開フックに ' + missing.join(' / ') + ' が無い（タスク 21.1 が公開する）');
    });
    return;
  }

  var normalizeText = hook.normalizeText;
  var buildExclusionMask = hook.buildExclusionMask;
  var selectCommand = hook.selectCommand;
  var COMMAND_TABLE = hook.COMMAND_TABLE;
  var EXCLUSION_WORDS = hook.EXCLUSION_WORDS;

  var gen = pbt.gen;
  var A = pbt.alphabets;

  /* ======================================================================
   * Property 14: 正規化の冪等性
   * ==================================================================== */

  // 除去・変換の結果として残ってはならない文字クラス（要件 3-9）。
  var FORBIDDEN = [
    { name: '空白文字', re: /[ \t\n\r\u3000]/ },
    { name: '区切り記号', re: /[、。，．・!?！？]/ },
    { name: '半角カタカナ', re: /[\uFF61-\uFF9F]/ },
    { name: '全角英数字', re: /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/ },
    { name: '大文字英字', re: /[A-Z]/ },
    // ひらがなへ畳まれるべきカタカナ（U+30A1〜U+30FA と U+30FD / U+30FE）。
    // U+30FC「ー」・U+30A0「゠」・U+30FF「ヿ」は対応するひらがなを持たないため対象外。
    { name: 'カタカナ', re: /[\u30A1-\u30FA\u30FD\u30FE]/ }
  ];

  /** コマンド語・除外語の生の語（正規化の入力として混ぜる）。 */
  var RAW_COMMAND_WORDS = (function () {
    var out = [];
    for (var t = 0; t < COMMAND_TABLE.length; t++) {
      for (var w = 0; w < COMMAND_TABLE[t].words.length; w++) {
        out.push(COMMAND_TABLE[t].words[w]);
      }
    }
    return out;
  })();

  var NAMED_EXCLUSIONS = ['ライン', 'インサイド', 'インステップ', 'サイン',
    'アウトサイド', '前半', '手前'];

  /** 語（コマンド語・除外語・雑音語）を任意個連結した文字列。 */
  var WORDISH_TOKENS = RAW_COMMAND_WORDS
    .concat(NAMED_EXCLUSIONS)
    .concat(['ｲﾝ', 'ｱｳﾄ', 'ＩＮ', 'ＯＵＴ', 'ｶﾞ', 'ﾊﾟ', 'から', 'ですね', '、', '！',
      ' ', '\u3000', '\t', '\n', 'ヷ', 'ｳﾞ', 'ﾞ', '🏀', '\uD800']);

  var wordishGen = gen.map(gen.array(gen.oneOf(WORDISH_TOKENS), 0, 12), function (parts) {
    return parts.join('');
  });

  // 混合分布: 一般の混合 Unicode / 語の連結 / 200 文字を超える長文 /
  // サロゲートペア中心 / 半角カナ中心 / 空文字。
  var textGen = gen.frequency([
    [4, gen.string(A.mixed, 40)],
    [4, wordishGen],
    [2, gen.string(A.mixed, 260, 190)],
    [1, gen.string(A.surrogate, 240, 100)],
    [2, gen.string([].concat(A.hankakuKana, A.zenkakuAlnum, A.symbols), 30)],
    [1, gen.const('')]
  ]);

  // Feature: voice-shot-counter-pwa, Property 14: 正規化の冪等性 — *For any* 文字列 t について `normalizeText(normalizeText(t)) === normalizeText(t)` が成立し、結果は長さ 200 以下で、除去対象の空白文字および区切り記号を含まない。
  // Validates: Requirements 3.9
  pbt.forAll('Property 14: 正規化の冪等性', [textGen], function (text) {
    var once = assert.throwsNot(function () { return normalizeText(text); },
      'normalizeText は例外を送出しない');
    assert.ok(typeof once === 'string', 'normalizeText は文字列を返す');

    var twice = normalizeText(once);
    assert.ok(twice === once, '冪等でない: ' + assert.format(once) + ' -> ' + assert.format(twice));

    // 切り詰めはコードポイント単位で数え、UTF-16 長も同じ上限に収める。
    assert.ok(once.length <= 200, 'UTF-16 長が 200 を超えた: ' + once.length);
    assert.ok(Array.from(once).length <= 200,
      'コードポイント数が 200 を超えた: ' + Array.from(once).length);

    for (var i = 0; i < FORBIDDEN.length; i++) {
      assert.ok(!FORBIDDEN[i].re.test(once),
        '結果に' + FORBIDDEN[i].name + 'が残った: ' + assert.format(once));
    }
    return true;
  }, { runs: 200 });

  // コマンド語表の各語に同じ正規化を適用した値もまた冪等である（要件 3-9 後段）。
  pbt.test('Property 14 付随: コマンド語・除外語の正規化も冪等', function () {
    var words = RAW_COMMAND_WORDS.concat(EXCLUSION_WORDS.slice());
    for (var i = 0; i < words.length; i++) {
      var once = normalizeText(words[i]);
      assert.ok(once !== '', '語が空に正規化された: ' + assert.format(words[i]));
      assert.ok(normalizeText(once) === once, '語の正規化が冪等でない: ' + assert.format(words[i]));
      for (var f = 0; f < FORBIDDEN.length; f++) {
        assert.ok(!FORBIDDEN[f].re.test(once),
          assert.format(words[i]) + ' の正規化結果に' + FORBIDDEN[f].name + 'が残った');
      }
    }
    return true;
  });

  /* ======================================================================
   * Property 13: コマンド選択の決定性と優先順規則
   * ==================================================================== */

  /**
   * 素朴な参照実装（モデル）。
   * 全コマンド語の全出現を列挙し、(index 昇順, length 降順, 種別優先順) で
   * 安定ソートして先頭を採る。マスク判定も本実装とは独立に、位置ごとに
   * 全除外語を総当たりして求める。
   *
   * 除外規則は実装と同じ「出現範囲がマスクに 1 文字でも重なれば選択しない」
   * （要件 3-10 の「当該出現範囲の文字を照合の対象から除外する」の解釈）。
   */
  function referenceMask(text, exclusions) {
    var words = [];
    for (var e = 0; e < exclusions.length; e++) {
      var w = normalizeText(exclusions[e]);
      if (w !== '') { words.push(w); }
    }
    var mask = [];
    for (var i = 0; i < text.length; i++) {
      var masked = false;
      for (var k = 0; k < words.length && !masked; k++) {
        var word = words[k];
        for (var s = Math.max(0, i - word.length + 1); s <= i; s++) {
          if (text.slice(s, s + word.length) === word && s + word.length > i) {
            masked = true;
            break;
          }
        }
      }
      mask.push(masked);
    }
    return mask;
  }

  function referenceSelect(text, table, exclusions) {
    var normalized = normalizeText(text);
    if (normalized === '') { return null; }
    var mask = referenceMask(normalized, exclusions);
    var occurrences = [];
    for (var t = 0; t < table.length; t++) {
      var entry = table[t];
      var priority = (typeof entry.priority === 'number' && isFinite(entry.priority))
        ? entry.priority : t;
      for (var w = 0; w < entry.words.length; w++) {
        var word = normalizeText(entry.words[w]);
        if (word === '') { continue; }
        for (var i = 0; i + word.length <= normalized.length; i++) {
          if (normalized.slice(i, i + word.length) !== word) { continue; }
          var masked = false;
          for (var j = i; j < i + word.length; j++) {
            if (mask[j]) { masked = true; break; }
          }
          if (masked) { continue; }
          occurrences.push({
            type: entry.type, word: word, index: i,
            length: word.length, priority: priority
          });
        }
      }
    }
    if (occurrences.length === 0) { return null; }
    // Array.prototype.sort は安定（ES2019 以降）。完全同値は列挙順＝登録順を保つ。
    occurrences.sort(function (a, b) {
      if (a.index !== b.index) { return a.index - b.index; }
      if (a.length !== b.length) { return b.length - a.length; }
      return a.priority - b.priority;
    });
    var best = occurrences[0];
    return { type: best.type, word: best.word, index: best.index, length: best.length };
  }

  /* 合成コマンド語表。開始位置が同一で長さが異なる組、長さが同一で種別が
   * 異なる組を意図的に作る（すべて正規化済みのひらがななので正規化は恒等）。 */
  var SYNTH_TABLE = [
    { type: 'MAKE', priority: 0, words: ['ぷあ', 'ぷあい'] },
    { type: 'MISS', priority: 1, words: ['ぷあ', 'ぷあいう'] },
    { type: 'NEXT', priority: 2, words: ['ぷあい'] },
    { type: 'PREV', priority: 3, words: ['ぷ'] },
    { type: 'UNDO', priority: 4, words: ['ぷあいう'] }
  ];
  var SYNTH_EXCLUSIONS = ['ぷあいうえ', 'あい'];
  var SYNTH_TOKENS = ['ぷ', 'ぷあ', 'ぷあい', 'ぷあいう', 'ぷあいうえ', 'あい', 'う', 'ん'];

  var VARIANTS = [
    { table: COMMAND_TABLE, exclusions: EXCLUSION_WORDS, tokens: WORDISH_TOKENS },
    { table: SYNTH_TABLE, exclusions: SYNTH_EXCLUSIONS, tokens: SYNTH_TOKENS },
    { table: COMMAND_TABLE, exclusions: EXCLUSION_WORDS, tokens: WORDISH_TOKENS }
  ];

  var partsGen = gen.array(gen.oneOf(WORDISH_TOKENS.concat(SYNTH_TOKENS)), 0, 10);
  var noiseGen = gen.frequency([
    [5, gen.const('')],
    [3, gen.string(A.mixed, 8)],
    [1, gen.string(A.surrogate, 4)]
  ]);
  var variantGen = gen.int(0, 2);

  // Feature: voice-shot-counter-pwa, Property 13: コマンド選択の決定性と優先順規則 — *For any* 認識テキストについて、コマンド選択は常に同一の結果（0 個または 1 個のコマンド）を返し、その選択は「除外語範囲のマスキング後に残った出現のうち、開始位置が最小 → 文字数が最大 → 既定優先順（成功 → 失敗 → 次種目 → 前種目 → 取り消し）」の順で一意に決定される。
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 3.10
  pbt.forAll('Property 13: コマンド選択の決定性と優先順規則',
    [partsGen, noiseGen, variantGen],
    function (parts, noise, variantIndex) {
      var variant = VARIANTS[variantIndex];
      var text = parts.join('') + noise;
      var table = variant.table;
      var exclusions = variant.exclusions;

      var first = assert.throwsNot(function () {
        return selectCommand(text, table, exclusions);
      }, 'selectCommand は例外を送出しない');
      var second = selectCommand(text, table, exclusions);

      // 決定性: 2 回呼んだ結果が一致する。
      assert.deepEqualOk(second, first, '同一入力で結果が異なる');

      var normalized = normalizeText(text);

      // マスクの基本不変条件。
      var mask = assert.throwsNot(function () {
        return buildExclusionMask(normalized, exclusions);
      }, 'buildExclusionMask は例外を送出しない');
      assert.ok(mask.length === normalized.length,
        'マスク長が正規化済みテキスト長と異なる: ' + mask.length + ' !== ' + normalized.length);
      for (var m = 0; m < mask.length; m++) {
        assert.ok(mask[m] === true || mask[m] === false, 'マスク要素が真偽値でない');
      }

      // 結果は null または単一のコマンド（4 フィールドのみ）。
      if (first !== null) {
        assert.ok(first && typeof first === 'object' && !Array.isArray(first),
          '単一のコマンドオブジェクトを返さない');
        var keys = Object.keys(first).sort().join(',');
        assert.ok(keys === 'index,length,type,word', '想定外のフィールド: ' + keys);
        assert.ok(normalized.slice(first.index, first.index + first.length) === first.word,
          'index / length が word と対応しない');
        for (var j = first.index; j < first.index + first.length; j++) {
          assert.ok(mask[j] === false, 'マスク範囲に重なる出現を選択した（添字 ' + j + '）');
        }
      }

      // モデルベース検証: 素朴な参照実装と一致する。
      var expected = referenceSelect(text, table, exclusions);
      assert.deepEqualOk(first, expected, '参照実装と結果が異なる');

      // 除外語 1 語のみからなるテキストは null を返す。
      if (parts.length === 1 && noise === '' &&
          NAMED_EXCLUSIONS.indexOf(parts[0]) !== -1 && variant.exclusions === EXCLUSION_WORDS) {
        assert.ok(first === null, '除外語のみのテキストでコマンドを発行した: ' + parts[0]);
      }
      return true;
    }, { runs: 300 });
})();
