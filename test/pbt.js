/*
 * test/pbt.js
 * Feature: voice-shot-counter-pwa
 *
 * ビルド工程・パッケージマネージャを持たない制約（要件 16-4）のもとで
 * プロパティベーステストを成立させるための自作ハーネス。
 *
 * - クラシックスクリプト（import / export を含まない）。
 * - ブラウザでは window.pbt、Node では globalThis.pbt に API を載せる。
 *   同一ファイルが tests.html からも `node` からも読み込める。
 *
 * 公開 API
 *   pbt.forAll(name, gens, prop, opts)   // opts: {runs: 100, seed: <int>}
 *   pbt.test(name, fn)                   // 例示 / 境界値テストの登録（結果集計を共通化）
 *   pbt.gen.int(lo, hi)                  // 境界値（lo, hi, 0）を高確率で混ぜる
 *   pbt.gen.oneOf([...])  pbt.gen.frequency([[w, gen], ...])
 *   pbt.gen.array(gen, minLen, maxLen)
 *   pbt.gen.string(alphabet, maxLen, minLen)
 *   pbt.gen.record({k: gen, ...})
 *   pbt.gen.bind(gen, fn)                // 依存生成（メニュー → 整合するカウント状態）
 *   pbt.gen.const(v)  pbt.gen.bool()  pbt.gen.map(gen, fn)  pbt.gen.suchThat(gen, pred)
 *   pbt.results  pbt.summary()  pbt.reset()  pbt.setReporter(fn)  pbt.consoleReport()
 *   pbt.baseSeed  pbt.MAX_SHRINK_STEPS
 *
 * 生成器は { generate(rng), shrink(value), covers(value) } の 3 メソッドを持つ
 * プレーンオブジェクトである。shrink は「より単純な候補」を単純な順に返す。
 * covers は frequency / 汎用縮小がその値の縮小方法を判断するために使う。
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- 乱数

  /** mulberry32: 32bit シードの決定的な擬似乱数列を返す。 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 文字列から 32bit ハッシュ（FNV-1a）。プロパティごとのシード導出に使う。 */
  function hashString(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** 実行ごとに 1 回だけ導出する既定シード。失敗時はこれを渡せば再現できる。 */
  var baseSeed = (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;

  function nextInt(rng, lo, hi) {
    if (hi <= lo) return lo;
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  function pick(rng, arr) {
    return arr[nextInt(rng, 0, arr.length - 1)];
  }

  // ---------------------------------------------------------------- 語彙

  function chars(s) {
    return Array.from(s);
  }

  var ALPHABETS = {
    ascii: chars('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
    digits: chars('0123456789'),
    hankakuKana: chars('ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝｦﾞﾟ'),
    zenkakuAlnum: chars('ＡＢＣＩＮＯＵＴａｂｃｉｎｏｕｔ０１２３４５６７８９'),
    katakana: chars('アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワンーガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ'),
    hiragana: chars('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわんーがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ'),
    symbols: chars(' \t\u3000、。，．・「」『』！？：；-_/\\（）()[]{}'),
    surrogate: chars('🏀😀🙌🎯𠀋𩸽'),
    combining: chars('\u0301\u3099\u309A\u200B\uFEFF')
  };

  /** 既定語彙: 半角カナ・全角英数・記号・サロゲートペアを含む混合語彙。 */
  ALPHABETS.mixed = []
    .concat(ALPHABETS.ascii)
    .concat(ALPHABETS.hiragana)
    .concat(ALPHABETS.katakana)
    .concat(ALPHABETS.hankakuKana)
    .concat(ALPHABETS.zenkakuAlnum)
    .concat(ALPHABETS.symbols)
    .concat(ALPHABETS.surrogate)
    .concat(ALPHABETS.combining);

  // ------------------------------------------------------- 汎用ユーティリティ

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function deepEqualValue(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'number') return (a !== a && b !== b) || a === b;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!deepEqualValue(a[i], b[i])) return false;
      return true;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) {
        if (!Object.prototype.hasOwnProperty.call(b, ka[j])) return false;
        if (!deepEqualValue(a[ka[j]], b[ka[j]])) return false;
      }
      return true;
    }
    return false;
  }

  /** 候補列から元の値と等しいものを除き、重複も除く。 */
  function dedupe(candidates, original) {
    var out = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (deepEqualValue(c, original)) continue;
      var dup = false;
      for (var j = 0; j < out.length; j++) {
        if (deepEqualValue(out[j], c)) { dup = true; break; }
      }
      if (!dup) out.push(c);
    }
    return out;
  }

  /** 反例の表示用整形。非 ASCII を \uXXXX へ逃がして端末でも判読できるようにする。 */
  function formatValue(v) {
    var json;
    try {
      json = JSON.stringify(v, function (k, val) {
        if (typeof val === 'number' && !isFinite(val)) return String(val);
        if (typeof val === 'undefined') return '<undefined>';
        if (typeof val === 'function') return '<function>';
        return val;
      });
    } catch (e) {
      json = String(v);
    }
    if (typeof json === 'undefined') json = String(v);
    return json.replace(/[\u007f-\uffff]/g, function (ch) {
      return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function formatValues(values) {
    return '(' + values.map(formatValue).join(', ') + ')';
  }

  // ---------------------------------------------------------------- 縮小器

  var MAX_SHRINK_STEPS = 200;
  var MAX_CANDIDATES = 400;

  /**
   * value から target 方向への二分縮小候補を「単純な順」（target に近い順）で返す。
   * [target, 中点, 3/4 点, 7/8 点, ..., value∓1] の順になるため、
   * 貪欲な縮小と組み合わせると失敗境界へ対数回で収束する。
   */
  function halvingTowards(value, target) {
    if (value === target) return [];
    var out = [target];
    var h = Math.trunc((value - target) / 2);
    var guard = 0;
    while (h !== 0 && guard++ < 64) {
      out.push(value - h);
      h = Math.trunc(h / 2);
    }
    return out;
  }

  /** 整数を 0 方向（値域内へ丸めた target）へ二分縮小した候補列。 */
  function shrinkIntTo(value, lo, hi) {
    if (typeof value !== 'number' || !isFinite(value)) return [];
    var target = 0;
    if (typeof lo === 'number' && target < lo) target = lo;
    if (typeof hi === 'number' && target > hi) target = hi;
    return dedupe(halvingTowards(value, target).filter(function (c) {
      if (typeof lo === 'number' && c < lo) return false;
      if (typeof hi === 'number' && c > hi) return false;
      return true;
    }), value);
  }

  /** 長さ minLen まで二分で縮めた長さ列（単純な順）。 */
  function shrinkLengths(n, minLen) {
    return halvingTowards(n, minLen).filter(function (len) {
      return len >= minLen && len < n;
    });
  }

  /** 配列の縮小: 要素数の二分縮小 → 1 要素削除 → 各要素の縮小。 */
  function shrinkArrayWith(value, elemShrink, minLen) {
    if (!Array.isArray(value)) return [];
    var min = typeof minLen === 'number' ? minLen : 0;
    var n = value.length;
    var cands = [];
    var lens = shrinkLengths(n, min);
    for (var i = 0; i < lens.length; i++) cands.push(value.slice(0, lens[i]));
    if (n > min) {
      for (var k = 0; k < n && cands.length < MAX_CANDIDATES; k++) {
        cands.push(value.slice(0, k).concat(value.slice(k + 1)));
      }
    }
    for (var idx = 0; idx < n && cands.length < MAX_CANDIDATES; idx++) {
      var sub = elemShrink ? elemShrink(value[idx], idx) : [];
      for (var s = 0; s < sub.length && s < 8; s++) {
        var copy = value.slice();
        copy[idx] = sub[s];
        cands.push(copy);
      }
    }
    return dedupe(cands, value);
  }

  function simplestAsciiOf(alphabet) {
    for (var i = 0; i < alphabet.length; i++) {
      var c = alphabet[i];
      if (c.length === 1 && c.charCodeAt(0) >= 0x61 && c.charCodeAt(0) <= 0x7a) return c;
    }
    for (var j = 0; j < alphabet.length; j++) {
      var d = alphabet[j];
      if (d.length === 1 && d.charCodeAt(0) >= 0x20 && d.charCodeAt(0) < 0x7f) return d;
    }
    return alphabet.length ? alphabet[0] : 'a';
  }

  /**
   * 文字列の縮小: 長さの二分縮小 → 1 文字削除 → 文字の単純化（非 ASCII → ASCII）。
   * サロゲートペアを壊さないよう、コードポイント単位で扱う。
   */
  function shrinkStringWith(value, alphabet, minLen) {
    if (typeof value !== 'string') return [];
    var min = typeof minLen === 'number' ? minLen : 0;
    var cps = Array.from(value);
    var n = cps.length;
    var simple = simplestAsciiOf(alphabet && alphabet.length ? alphabet : ALPHABETS.ascii);
    var cands = [];
    var lens = shrinkLengths(n, min);
    for (var i = 0; i < lens.length; i++) cands.push(cps.slice(0, lens[i]).join(''));
    if (n > min) {
      for (var k = 0; k < n && cands.length < MAX_CANDIDATES; k++) {
        cands.push(cps.slice(0, k).concat(cps.slice(k + 1)).join(''));
      }
    }
    for (var idx = 0; idx < n && cands.length < MAX_CANDIDATES; idx++) {
      var ch = cps[idx];
      var isAscii = ch.length === 1 && ch.charCodeAt(0) < 0x80;
      if (ch === simple) continue;
      if (!isAscii || ch !== simple) {
        var copy = cps.slice();
        copy[idx] = simple;
        cands.push(copy.join(''));
      }
    }
    return dedupe(cands, value);
  }

  /** レコードの縮小: フィールドごとに順に縮小する（キー順は保持）。 */
  function shrinkRecordWith(value, fieldShrink) {
    if (!isPlainObject(value)) return [];
    var keys = Object.keys(value);
    var cands = [];
    for (var i = 0; i < keys.length && cands.length < MAX_CANDIDATES; i++) {
      var key = keys[i];
      var sub = fieldShrink(key, value[key]);
      for (var s = 0; s < sub.length && s < 12; s++) {
        var copy = {};
        for (var j = 0; j < keys.length; j++) copy[keys[j]] = value[keys[j]];
        copy[key] = sub[s];
        cands.push(copy);
      }
    }
    return dedupe(cands, value);
  }

  /**
   * 生成器の情報がない値（gen.bind の結果など）に対する型駆動の汎用縮小。
   */
  function genericShrink(value) {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? shrinkIntTo(value) : dedupe([0, Math.trunc(value)], value);
    }
    if (typeof value === 'string') return shrinkStringWith(value, ALPHABETS.ascii, 0);
    if (typeof value === 'boolean') return value ? [false] : [];
    if (Array.isArray(value)) return shrinkArrayWith(value, genericShrink, 0);
    if (isPlainObject(value)) {
      return shrinkRecordWith(value, function (k, v) { return genericShrink(v); });
    }
    return [];
  }

  // ---------------------------------------------------------------- 生成器

  function makeGen(spec) {
    return {
      generate: spec.generate,
      shrink: spec.shrink || function () { return []; },
      covers: spec.covers || function () { return false; }
    };
  }

  var gen = {};

  /** 整数生成。境界値（lo, hi, 0, lo+1, hi-1）を約 30% の確率で混ぜる。 */
  gen.int = function (lo, hi) {
    var low = typeof lo === 'number' ? Math.trunc(lo) : 0;
    var high = typeof hi === 'number' ? Math.trunc(hi) : 100;
    if (high < low) { var t = low; low = high; high = t; }
    var boundaries = [low, high];
    if (low < 0 && high > 0) boundaries.push(0);
    if (low + 1 <= high) boundaries.push(low + 1);
    if (high - 1 >= low) boundaries.push(high - 1);
    return makeGen({
      generate: function (rng) {
        if (rng() < 0.3) return pick(rng, boundaries);
        return nextInt(rng, low, high);
      },
      shrink: function (v) { return shrinkIntTo(v, low, high); },
      covers: function (v) { return Number.isInteger(v) && v >= low && v <= high; }
    });
  };

  /** 有限集合からの選択。縮小は「一覧の先頭側がより単純」とみなす。 */
  gen.oneOf = function (values) {
    var items = values.slice();
    return makeGen({
      generate: function (rng) { return pick(rng, items); },
      shrink: function (v) {
        var idx = -1;
        for (var i = 0; i < items.length; i++) {
          if (deepEqualValue(items[i], v)) { idx = i; break; }
        }
        if (idx <= 0) return [];
        return dedupe(items.slice(0, idx), v);
      },
      covers: function (v) {
        for (var i = 0; i < items.length; i++) if (deepEqualValue(items[i], v)) return true;
        return false;
      }
    });
  };

  /** 重み付き選択。[[weight, gen], ...] */
  gen.frequency = function (pairs) {
    var entries = pairs.map(function (p) {
      return { w: Math.max(0, p[0]), g: p[1] };
    }).filter(function (e) { return e.w > 0; });
    var total = entries.reduce(function (s, e) { return s + e.w; }, 0);
    return makeGen({
      generate: function (rng) {
        var r = rng() * total;
        for (var i = 0; i < entries.length; i++) {
          r -= entries[i].w;
          if (r <= 0) return entries[i].g.generate(rng);
        }
        return entries[entries.length - 1].g.generate(rng);
      },
      shrink: function (v) {
        // その値を「覆う」生成器の縮小のみを使う。覆うものが無ければ汎用縮小。
        var out = [];
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].g.covers(v)) out = out.concat(entries[i].g.shrink(v));
        }
        if (out.length === 0) out = genericShrink(v);
        return dedupe(out, v);
      },
      covers: function (v) {
        for (var i = 0; i < entries.length; i++) if (entries[i].g.covers(v)) return true;
        return false;
      }
    });
  };

  /** 配列生成。長さは minLen〜maxLen で、境界（minLen, maxLen）を混ぜる。 */
  gen.array = function (elemGen, minLen, maxLen) {
    var min = typeof minLen === 'number' ? Math.max(0, Math.trunc(minLen)) : 0;
    var max = typeof maxLen === 'number' ? Math.trunc(maxLen) : min + 10;
    if (max < min) max = min;
    return makeGen({
      generate: function (rng) {
        var n = rng() < 0.2 ? (rng() < 0.5 ? min : max) : nextInt(rng, min, max);
        var out = [];
        for (var i = 0; i < n; i++) out.push(elemGen.generate(rng));
        return out;
      },
      shrink: function (v) {
        return shrinkArrayWith(v, function (e) { return elemGen.shrink(e); }, min);
      },
      covers: function (v) {
        if (!Array.isArray(v) || v.length < min || v.length > max) return false;
        for (var i = 0; i < v.length; i++) if (!elemGen.covers(v[i])) return false;
        return true;
      }
    });
  };

  /**
   * 文字列生成。alphabet は文字列または文字（コードポイント）配列。
   * 既定は半角カナ・全角英数・記号・サロゲートペアを含む混合語彙。
   */
  gen.string = function (alphabet, maxLen, minLen) {
    var abc;
    if (typeof alphabet === 'string') abc = chars(alphabet);
    else if (Array.isArray(alphabet)) abc = alphabet.slice();
    else abc = ALPHABETS.mixed.slice();
    if (abc.length === 0) abc = ALPHABETS.ascii.slice();
    var max = typeof maxLen === 'number' ? Math.max(0, Math.trunc(maxLen)) : 16;
    var min = typeof minLen === 'number' ? Math.max(0, Math.trunc(minLen)) : 0;
    if (max < min) max = min;
    return makeGen({
      generate: function (rng) {
        var n = rng() < 0.2 ? (rng() < 0.5 ? min : max) : nextInt(rng, min, max);
        var out = '';
        for (var i = 0; i < n; i++) out += pick(rng, abc);
        return out;
      },
      shrink: function (v) { return shrinkStringWith(v, abc, min); },
      covers: function (v) {
        if (typeof v !== 'string') return false;
        var cps = Array.from(v);
        if (cps.length < min || cps.length > max) return false;
        for (var i = 0; i < cps.length; i++) if (abc.indexOf(cps[i]) === -1) return false;
        return true;
      }
    });
  };

  /** レコード生成。キー順は shape の宣言順を保持する。 */
  gen.record = function (shape) {
    var keys = Object.keys(shape);
    return makeGen({
      generate: function (rng) {
        var out = {};
        for (var i = 0; i < keys.length; i++) out[keys[i]] = shape[keys[i]].generate(rng);
        return out;
      },
      shrink: function (v) {
        return shrinkRecordWith(v, function (key, fv) {
          return shape[key] ? shape[key].shrink(fv) : genericShrink(fv);
        });
      },
      covers: function (v) {
        if (!isPlainObject(v)) return false;
        var vk = Object.keys(v);
        if (vk.length !== keys.length) return false;
        for (var i = 0; i < keys.length; i++) {
          if (!Object.prototype.hasOwnProperty.call(v, keys[i])) return false;
          if (!shape[keys[i]].covers(v[keys[i]])) return false;
        }
        return true;
      }
    });
  };

  /**
   * 依存生成。fn(value) が生成器を返す（例: メニュー → 整合するカウント状態）。
   * 縮小は第 3 引数 shrinkFn（任意）、無ければ型駆動の汎用縮小を用いる。
   * 整合性を壊したくない場合は gen.suchThat と併用するか shrinkFn を与える。
   */
  gen.bind = function (baseGen, fn, shrinkFn) {
    return makeGen({
      generate: function (rng) {
        var v = baseGen.generate(rng);
        var inner = fn(v);
        return inner.generate(rng);
      },
      shrink: function (v) {
        var out = shrinkFn ? shrinkFn(v) : genericShrink(v);
        return dedupe(out || [], v);
      },
      covers: function () { return false; }
    });
  };

  /** 定数生成器。gen.bind で依存値をそのまま持ち回すために使う。 */
  gen.const = function (value) {
    return makeGen({
      generate: function () { return value; },
      shrink: function () { return []; },
      covers: function (v) { return deepEqualValue(v, value); }
    });
  };

  gen.bool = function () {
    return gen.oneOf([false, true]);
  };

  /** 生成値の写像。縮小は写像前に戻せないため、写像後の値に汎用縮小を適用する。 */
  gen.map = function (baseGen, fn) {
    return makeGen({
      generate: function (rng) { return fn(baseGen.generate(rng)); },
      shrink: function (v) { return genericShrink(v); },
      covers: function () { return false; }
    });
  };

  /** 述語で絞り込む。縮小候補も同じ述語で絞るため不変条件を保てる。 */
  gen.suchThat = function (baseGen, pred, maxTries) {
    var tries = typeof maxTries === 'number' ? maxTries : 100;
    return makeGen({
      generate: function (rng) {
        for (var i = 0; i < tries; i++) {
          var v = baseGen.generate(rng);
          if (pred(v)) return v;
        }
        throw new Error('gen.suchThat: 述語を満たす値を ' + tries + ' 回で生成できなかった');
      },
      shrink: function (v) {
        return baseGen.shrink(v).filter(pred);
      },
      covers: function (v) { return baseGen.covers(v) && pred(v); }
    });
  };

  // ---------------------------------------------------------------- 実行器

  var results = [];
  var reporter = null;

  function describeError(e) {
    if (e && e.message) return String(e.message);
    return String(e);
  }

  /** プロパティを 1 回評価する。false 返却と例外送出の両方を失敗とみなす。 */
  function evaluate(prop, values) {
    try {
      var out = prop.apply(null, values);
      if (out === false) return { ok: false, message: 'プロパティが false を返した' };
      return { ok: true, message: '' };
    } catch (e) {
      return { ok: false, message: describeError(e), error: e };
    }
  }

  /**
   * 貪欲な縮小。失敗が再現し続ける限り縮小を継続し、上限 MAX_SHRINK_STEPS で打ち切る。
   * 各引数について生成器の縮小候補を単純な順に試し、失敗が再現した候補を採用する。
   */
  function shrinkFailure(gens, values, prop) {
    var cap = (typeof pbt !== 'undefined' && pbt && typeof pbt.MAX_SHRINK_STEPS === 'number')
      ? Math.max(0, Math.trunc(pbt.MAX_SHRINK_STEPS))
      : MAX_SHRINK_STEPS;
    var best = values.slice();
    var bestMessage = null;
    var steps = 0;
    var improved = true;
    while (improved && steps < cap) {
      improved = false;
      for (var i = 0; i < gens.length && steps < cap; i++) {
        var cands;
        try {
          cands = gens[i].shrink(best[i]) || [];
        } catch (e) {
          cands = [];
        }
        for (var c = 0; c < cands.length; c++) {
          if (steps >= cap) break;
          steps++;
          var trial = best.slice();
          trial[i] = cands[c];
          var r = evaluate(prop, trial);
          if (!r.ok) {
            best = trial;
            bestMessage = r.message;
            improved = true;
            break;
          }
        }
      }
    }
    return { values: best, steps: steps, cap: cap, message: bestMessage };
  }

  function record(result) {
    results.push(result);
    if (reporter) {
      try { reporter(result); } catch (e) { /* 報告側の失敗はテスト結果に影響させない */ }
    }
    return result;
  }

  /**
   * forAll(name, gens, prop, opts)
   *   gens: 生成器または生成器の配列。prop は生成値を引数として受け取る。
   *   opts: { runs: 100, seed: <int> }
   * 例外は送出せず、結果オブジェクトを返して results に積む（ランナーが集計できる）。
   */
  function forAll(name, gens, prop, opts) {
    var options = opts || {};
    var list = Array.isArray(gens) ? gens.slice() : [gens];
    var runs = typeof options.runs === 'number' ? Math.max(1, Math.trunc(options.runs)) : 100;
    var seed = typeof options.seed === 'number'
      ? (Math.trunc(options.seed) >>> 0)
      : ((baseSeed ^ hashString(String(name))) >>> 0);
    var rng = mulberry32(seed);
    var started = nowMs();
    var executed = 0;
    var failure = null;

    for (var i = 0; i < runs; i++) {
      var values;
      try {
        values = list.map(function (g) { return g.generate(rng); });
      } catch (e) {
        failure = { values: [], message: '入力生成に失敗: ' + describeError(e), generation: true };
        break;
      }
      executed++;
      var r = evaluate(prop, values);
      if (!r.ok) {
        failure = { values: values, message: r.message, generation: false };
        break;
      }
    }

    if (!failure) {
      return record({
        type: 'property',
        name: name,
        ok: true,
        seed: seed,
        runs: runs,
        runsExecuted: executed,
        durationMs: nowMs() - started,
        message: '',
        original: null,
        shrunk: null,
        shrinkSteps: 0,
        failingExample: ''
      });
    }

    var shrunk = failure.generation
      ? { values: failure.values, steps: 0, cap: MAX_SHRINK_STEPS, message: null }
      : shrinkFailure(list, failure.values, prop);

    var text = failure.generation
      ? failure.message
      : [
        '最小反例 (縮小後): ' + formatValues(shrunk.values),
        '縮小前の反例:     ' + formatValues(failure.values),
        '縮小ステップ数:   ' + shrunk.steps + ' / ' + shrunk.cap,
        '乱数シード:       ' + seed + '  （再現: opts {seed: ' + seed + '}）',
        '失敗理由:         ' + (shrunk.message || failure.message)
      ].join('\n');

    return record({
      type: 'property',
      name: name,
      ok: false,
      seed: seed,
      runs: runs,
      runsExecuted: executed,
      durationMs: nowMs() - started,
      message: shrunk.message || failure.message,
      original: failure.values,
      shrunk: shrunk.values,
      shrinkSteps: shrunk.steps,
      failingExample: text
    });
  }

  /** 例示 / 境界値テスト。結果の集計経路を forAll と共通化するための最小の入口。 */
  function test(name, fn) {
    var started = nowMs();
    var r = evaluate(fn, []);
    return record({
      type: 'unit',
      name: name,
      ok: r.ok,
      seed: null,
      runs: 1,
      runsExecuted: 1,
      durationMs: nowMs() - started,
      message: r.message,
      original: null,
      shrunk: null,
      shrinkSteps: 0,
      failingExample: r.ok ? '' : r.message
    });
  }

  function nowMs() {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function summary() {
    var passed = 0, failed = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].ok) passed++; else failed++;
    }
    return {
      total: results.length,
      passed: passed,
      failed: failed,
      baseSeed: baseSeed,
      failures: results.filter(function (r) { return !r.ok; })
    };
  }

  function reset() {
    results.length = 0;
  }

  function setReporter(fn) {
    reporter = typeof fn === 'function' ? fn : null;
  }

  /** Node / DevTools コンソール向けの要約出力。戻り値は失敗件数。 */
  function consoleReport() {
    var s = summary();
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.ok) {
        console.log('PASS  ' + r.name + (r.type === 'property' ? '  (runs=' + r.runsExecuted + ', seed=' + r.seed + ')' : ''));
      } else {
        console.log('FAIL  ' + r.name);
        console.log(String(r.failingExample).replace(/^/gm, '        '));
      }
    }
    console.log('---- ' + s.passed + ' passed, ' + s.failed + ' failed (baseSeed=' + s.baseSeed + ') ----');
    return s.failed;
  }

  // ---------------------------------------------------------------- 公開

  var pbt = {
    forAll: forAll,
    test: test,
    gen: gen,
    alphabets: ALPHABETS,
    mulberry32: mulberry32,
    results: results,
    summary: summary,
    reset: reset,
    setReporter: setReporter,
    consoleReport: consoleReport,
    formatValue: formatValue,
    baseSeed: baseSeed,
    setBaseSeed: function (s) { baseSeed = (Math.trunc(s) >>> 0); pbt.baseSeed = baseSeed; },
    MAX_SHRINK_STEPS: MAX_SHRINK_STEPS,
    _internal: {
      shrinkIntTo: shrinkIntTo,
      shrinkArrayWith: shrinkArrayWith,
      shrinkStringWith: shrinkStringWith,
      shrinkRecordWith: shrinkRecordWith,
      genericShrink: genericShrink,
      deepEqualValue: deepEqualValue
    }
  };

  root.pbt = pbt;
  if (typeof window !== 'undefined') window.pbt = pbt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
