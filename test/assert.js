/*
 * voice-shot-counter-pwa — test/assert.js
 *
 * 等価比較とアサーション（設計「Testing Strategy」の `assert.js`）。
 *
 * 要件 16-4: ビルド工程・トランスパイル・バンドル・パッケージマネージャを経ない。
 * したがって本ファイルはクラシックスクリプトであり、`import` / `export` を含まない。
 * API は `globalThis.assert` に載せるため、ブラウザ（tests.html からの
 * `<script src="./assert.js">`）でも `node test/assert.js` 相当の読み込みでも動作する。
 *
 * ============================================================================
 * 呼び出し規約（重要 / 混在させない）
 * ============================================================================
 *   assert.deepEqual(a, b, options)
 *       例外を送出せず、必ず結果オブジェクトを返す **非送出型**。
 *         成功: { equal: true,  path: null, message: '',  reason: null, ... }
 *         失敗: { equal: false, path: '<最初の不一致の経路>', message: '<可読な差分>',
 *                 reason: '<不一致の種類>', actual: <a 側の値>, expected: <b 側の値> }
 *       プロパティテストは反例を人間に報告するため、`message` をそのまま出力できる
 *       形式（例: `counts[3].make: 5 !== 4`）にしている。
 *
 *   assert.deepEqualOk(a, b, message, options)
 *       上記の送出型ラッパ。不一致のとき AssertionError を送出する。
 *
 *   assert.ok(cond, message)          偽値なら AssertionError を送出。真値なら true。
 *   assert.throwsNot(fn, message)     fn() が例外を送出しないことを主張し、戻り値を返す。
 *   assert.fail(message, detail)      無条件に AssertionError を送出。
 *   assert.format(value, maxLen)      反例報告用の短い可読表現（循環安全・長さ制限あり）。
 *   assert.AssertionError             上記が送出するエラー型。
 *
 * ============================================================================
 * deepEqual の等価判定仕様（決定事項）
 * ============================================================================
 *   第 1 引数 a を「実測値 (actual)」、第 2 引数 b を「期待値 (expected)」として
 *   メッセージを組み立てる。判定そのものは対称である。
 *
 *   - 配列: 要素数と **要素順が有意**。順序が違えば不一致（Property 5 / 8 / 11 /
 *     17 が配列順を含む深い等価を要求する）。
 *   - プレーンオブジェクト: 自身の列挙可能な文字列キーの集合が一致し、各値が深く等価。
 *     キーの **挿入順は無視**（列挙順の違いは不一致にしない）。報告経路を決定的に
 *     するため、キーはソートして走査する。
 *   - 値が undefined のキーと、キーそのものの欠落は **区別する**（既定）。
 *     JSON 経由で消えるキーを許容したい場合は `options.ignoreUndefinedProps: true`。
 *   - `null` と `undefined` は区別する。`null` と `{}` も区別する（型不一致）。
 *   - `NaN` は `NaN` と等価（SameValueZero 相当）。
 *   - `-0` と `+0` は **既定で等価**とする。丸め経路（progressRatio / successRate /
 *     formatRate）が `-0` を返し得る一方、期待値は `0` と書かれるため、既定を
 *     SameValueZero にしておかないと意味のない反例が出る。符号を区別したい
 *     テストは `options.distinguishNegativeZero: true` を渡す（Object.is 相当）。
 *   - Date は時刻値（Invalid Date 同士は等価）、RegExp は `source` + `flags` で比較。
 *   - 関数・Symbol・その他の組み込みオブジェクト（Map / Set 等）は参照同一性
 *     （Object.is）で比較する。本アプリの検査対象はプレーンな JSON 値のみのため、
 *     これ以上の対応は持たない。
 *   - 循環参照: 比較中の (a, b) の対を経路上に積み、同じ対に再到達したら等価とみなす
 *     （余帰納的解釈）。片側のみが再帰していれば `CYCLE_MISMATCH` で不一致。
 *     無限再帰は起こらない。加えて深さ上限 200 を設け、超過時は `DEPTH_LIMIT` を返す
 *     （スタック溢れによるハーネス自体の破綻を防ぐ）。
 */

(function () {
  'use strict';

  /** 比較の深さ上限。超過は不一致（reason: 'DEPTH_LIMIT'）として報告する。 */
  var MAX_DEPTH = 200;
  /** format() が返す文字列の既定長上限。 */
  var DEFAULT_FORMAT_LEN = 80;

  /* ========================================================================
   * AssertionError
   * ====================================================================== */

  function AssertionError(message, detail) {
    var err = Error.call(this, message);
    this.name = 'AssertionError';
    this.message = message;
    if (detail !== undefined) {
      this.detail = detail;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AssertionError);
    } else if (err.stack) {
      this.stack = err.stack;
    }
  }
  AssertionError.prototype = Object.create(Error.prototype);
  AssertionError.prototype.constructor = AssertionError;

  /* ========================================================================
   * 値の分類
   * ====================================================================== */

  function typeTag(value) {
    if (value === null) { return 'null'; }
    var t = typeof value;
    if (t !== 'object' && t !== 'function') { return t; }
    if (t === 'function') { return 'function'; }
    if (Array.isArray(value)) { return 'array'; }
    if (value instanceof Date) { return 'date'; }
    if (value instanceof RegExp) { return 'regexp'; }
    return 'object';
  }

  function isContainer(tag) {
    return tag === 'array' || tag === 'object';
  }

  /* ========================================================================
   * 経路の組み立て
   * ====================================================================== */

  var IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  function pathIndex(base, index) {
    return base + '[' + index + ']';
  }

  function pathKey(base, key) {
    if (IDENT_RE.test(key)) { return base + '.' + key; }
    return base + '[' + quote(key) + ']';
  }

  function quote(str) {
    // JSON.stringify は制御文字とサロゲートも安全に扱える。
    return JSON.stringify(String(str));
  }

  /* ========================================================================
   * format — 反例報告用の短い可読表現
   * ====================================================================== */

  function formatPrimitive(value) {
    var t = typeof value;
    if (value === null) { return 'null'; }
    if (value === undefined) { return 'undefined'; }
    if (t === 'string') { return quote(value); }
    if (t === 'number') {
      if (Number.isNaN(value)) { return 'NaN'; }
      if (value === 0 && 1 / value === -Infinity) { return '-0'; }
      return String(value);
    }
    if (t === 'bigint') { return String(value) + 'n'; }
    if (t === 'symbol') { return String(value); }
    if (t === 'boolean') { return String(value); }
    if (t === 'function') { return 'function ' + (value.name || '(anonymous)'); }
    return null;
  }

  function formatValue(value, depth, seen) {
    var prim = formatPrimitive(value);
    if (prim !== null) { return prim; }

    var tag = typeTag(value);
    if (tag === 'date') {
      var time = value.getTime();
      return 'Date(' + (Number.isNaN(time) ? 'Invalid Date' : value.toISOString()) + ')';
    }
    if (tag === 'regexp') { return String(value); }

    if (seen.indexOf(value) !== -1) { return '[Circular]'; }
    if (depth <= 0) { return tag === 'array' ? '[…]' : '{…}'; }

    seen.push(value);
    try {
      if (tag === 'array') {
        var items = [];
        var shown = Math.min(value.length, 6);
        for (var i = 0; i < shown; i++) {
          items.push(formatValue(value[i], depth - 1, seen));
        }
        if (value.length > shown) { items.push('… +' + (value.length - shown)); }
        return '[' + items.join(', ') + ']';
      }
      var keys = Object.keys(value);
      var parts = [];
      var shownKeys = Math.min(keys.length, 6);
      for (var j = 0; j < shownKeys; j++) {
        var k = keys[j];
        var label = IDENT_RE.test(k) ? k : quote(k);
        parts.push(label + ': ' + formatValue(value[k], depth - 1, seen));
      }
      if (keys.length > shownKeys) { parts.push('… +' + (keys.length - shownKeys)); }
      var name = '';
      var ctor = value.constructor;
      if (typeof ctor === 'function' && ctor.name && ctor.name !== 'Object') {
        name = ctor.name + ' ';
      }
      return name + '{' + parts.join(', ') + '}';
    } finally {
      seen.pop();
    }
  }

  function truncate(str, maxLen) {
    if (typeof maxLen !== 'number' || !(maxLen > 0)) { return str; }
    if (str.length <= maxLen) { return str; }
    return str.slice(0, maxLen - 1) + '…';
  }

  /**
   * 値を 1 行の可読表現へ変換する。循環参照でも停止し、既定で 80 文字へ切り詰める。
   * maxLen に 0 以下 / 非数を渡すと切り詰めを行わない。
   */
  function format(value, maxLen) {
    var text = formatValue(value, 3, []);
    return truncate(text, maxLen === undefined ? DEFAULT_FORMAT_LEN : maxLen);
  }

  /* ========================================================================
   * deepEqual
   * ====================================================================== */

  function sortedKeys(obj) {
    return Object.keys(obj).sort();
  }

  function definedKeys(obj, keys) {
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] !== undefined) { out.push(keys[i]); }
    }
    return out;
  }

  /**
   * 深い等価比較。例外を送出せず、必ず結果オブジェクトを返す。
   *
   * @param {*} a 実測値
   * @param {*} b 期待値
   * @param {{name?: string, distinguishNegativeZero?: boolean,
   *          ignoreUndefinedProps?: boolean, maxValueLen?: number}} [options]
   *        name                  … 経路の根の表示名（既定 'value'。例: 'counts'）
   *        distinguishNegativeZero … true で -0 と +0 を区別（既定 false）
   *        ignoreUndefinedProps  … true で値が undefined の自前キーを無視（既定 false）
   *        maxValueLen           … メッセージ内の値表現の長さ上限（既定 80）
   * @returns {{equal: boolean, path: (string|null), message: string,
   *            reason: (string|null), actual: *, expected: *}}
   */
  function deepEqual(a, b, options) {
    var opts = options || {};
    var root = typeof opts.name === 'string' && opts.name.length > 0 ? opts.name : 'value';
    var strictZero = opts.distinguishNegativeZero === true;
    var ignoreUndefined = opts.ignoreUndefinedProps === true;
    var maxValueLen = opts.maxValueLen === undefined ? DEFAULT_FORMAT_LEN : opts.maxValueLen;

    var stackA = [];
    var stackB = [];
    var failure = null;

    function fail(path, reason, actual, expected, note) {
      var message = path + ': ' + format(actual, maxValueLen) + ' !== ' + format(expected, maxValueLen);
      if (note) { message += ' (' + note + ')'; }
      failure = {
        equal: false,
        path: path,
        message: message,
        reason: reason,
        actual: actual,
        expected: expected
      };
      return false;
    }

    function samePrimitive(x, y) {
      if (typeof x === 'number' && typeof y === 'number') {
        if (Number.isNaN(x) && Number.isNaN(y)) { return true; }
        if (x === 0 && y === 0) { return strictZero ? Object.is(x, y) : true; }
        return x === y;
      }
      return Object.is(x, y);
    }

    function walk(x, y, path, depth) {
      var tx = typeTag(x);
      var ty = typeTag(y);
      if (tx !== ty) {
        return fail(path, 'TYPE_MISMATCH', x, y, tx + ' vs ' + ty);
      }

      if (tx === 'date') {
        var tmx = x.getTime();
        var tmy = y.getTime();
        if (tmx === tmy || (Number.isNaN(tmx) && Number.isNaN(tmy))) { return true; }
        return fail(path, 'DATE_MISMATCH', x, y, null);
      }
      if (tx === 'regexp') {
        if (x.source === y.source && x.flags === y.flags) { return true; }
        return fail(path, 'REGEXP_MISMATCH', x, y, null);
      }
      if (!isContainer(tx)) {
        // プリミティブ・関数・Symbol・その他の組み込みオブジェクトはここで確定する。
        if (samePrimitive(x, y)) { return true; }
        return fail(path, 'VALUE_MISMATCH', x, y, null);
      }
      if (x === y) { return true; }

      // 循環参照の検出: 経路上に同じ対があれば等価とみなす。
      for (var s = 0; s < stackA.length; s++) {
        var hitA = stackA[s] === x;
        var hitB = stackB[s] === y;
        if (hitA && hitB) { return true; }
        if (hitA || hitB) {
          return fail(path, 'CYCLE_MISMATCH', x, y, '循環構造の形が異なる');
        }
      }
      if (depth >= MAX_DEPTH) {
        return fail(path, 'DEPTH_LIMIT', x, y, '深さ上限 ' + MAX_DEPTH + ' を超過');
      }

      stackA.push(x);
      stackB.push(y);
      try {
        if (tx === 'array') {
          if (x.length !== y.length) {
            return fail(path, 'LENGTH_MISMATCH', x, y, 'length ' + x.length + ' !== ' + y.length);
          }
          for (var i = 0; i < x.length; i++) {
            if (!walk(x[i], y[i], pathIndex(path, i), depth + 1)) { return false; }
          }
          return true;
        }

        var keysX = sortedKeys(x);
        var keysY = sortedKeys(y);
        if (ignoreUndefined) {
          keysX = definedKeys(x, keysX);
          keysY = definedKeys(y, keysY);
        }
        var setY = Object.create(null);
        for (var m = 0; m < keysY.length; m++) { setY[keysY[m]] = true; }
        var setX = Object.create(null);
        for (var n = 0; n < keysX.length; n++) { setX[keysX[n]] = true; }

        for (var p = 0; p < keysX.length; p++) {
          if (!setY[keysX[p]]) {
            return fail(pathKey(path, keysX[p]), 'MISSING_KEY', x[keysX[p]], undefined,
              'キー ' + quote(keysX[p]) + ' が期待値側に存在しない');
          }
        }
        for (var q = 0; q < keysY.length; q++) {
          if (!setX[keysY[q]]) {
            return fail(pathKey(path, keysY[q]), 'MISSING_KEY', undefined, y[keysY[q]],
              'キー ' + quote(keysY[q]) + ' が実測値側に存在しない');
          }
        }
        for (var r = 0; r < keysX.length; r++) {
          var key = keysX[r];
          if (!walk(x[key], y[key], pathKey(path, key), depth + 1)) { return false; }
        }
        return true;
      } finally {
        stackA.pop();
        stackB.pop();
      }
    }

    var equal = walk(a, b, root, 0);
    if (equal) {
      return { equal: true, path: null, message: '', reason: null, actual: a, expected: b };
    }
    return failure;
  }

  /* ========================================================================
   * 送出型アサーション
   * ====================================================================== */

  function fail(message, detail) {
    throw new AssertionError(message || 'assertion failed', detail);
  }

  /**
   * 条件が真値であることを主張する。偽値なら AssertionError を送出する。
   */
  function ok(cond, message) {
    if (!cond) {
      var text = message ? String(message) : 'expected a truthy value';
      throw new AssertionError(text + ' (got ' + format(cond) + ')', { actual: cond });
    }
    return true;
  }

  /**
   * deepEqual の送出型ラッパ。不一致なら可読な差分を持つ AssertionError を送出する。
   */
  function deepEqualOk(a, b, message, options) {
    var result = deepEqual(a, b, options);
    if (!result.equal) {
      var prefix = message ? String(message) + ': ' : '';
      throw new AssertionError(prefix + result.message, result);
    }
    return true;
  }

  /**
   * fn が例外を送出せずに完了することを主張し、その戻り値を返す。
   * 例外を送出した場合は AssertionError（detail.cause に元の例外）を送出する。
   *
   * 設計上、純粋関数コアは例外を送出しない（Property 7: 復元の全域性）ため、
   * その主張を直接書けるようにしている。
   */
  function throwsNot(fn, message) {
    if (typeof fn !== 'function') {
      throw new AssertionError('throwsNot expects a function (got ' + format(fn) + ')', { actual: fn });
    }
    try {
      return fn();
    } catch (e) {
      var prefix = message ? String(message) + ': ' : '';
      var desc;
      if (e && typeof e === 'object' && 'message' in e) {
        desc = (e.name || 'Error') + ': ' + e.message;
      } else {
        desc = format(e);
      }
      throw new AssertionError(prefix + 'expected no exception, but got ' + desc, { cause: e });
    }
  }

  /* ========================================================================
   * 公開
   * ====================================================================== */

  var api = {
    AssertionError: AssertionError,
    deepEqual: deepEqual,
    deepEqualOk: deepEqualOk,
    ok: ok,
    throwsNot: throwsNot,
    fail: fail,
    format: format,
    MAX_DEPTH: MAX_DEPTH
  };

  globalThis.assert = api;
})();
