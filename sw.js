/*
 * sw.js - Voice Shot Counter PWA の Service Worker
 *
 * 要件 15-4 / 15-6 / 15-8 / 15-9、要件 16-1 / 16-2 に対応する。
 * クラシックスクリプトとして評価されるため、モジュール構文（読み込み文・公開文）を用いない。
 * テストハーネス配下のファイルは成果物 7 ファイルに含まれず、PRECACHE にも列挙しない。
 */

'use strict';

/** 現行キャッシュのバージョン文字列。これ以外のキャッシュは activate で全件削除する。 */
var CACHE_NAME = 'vsc-cache-v1';

/** 成果物 7 ファイル（`./` はナビゲーション用の入口）。相対パスのみを用いる。 */
var PRECACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon-180.png'
];

/** ナビゲーション要求のネットワーク試行上限（要件 15-9）。 */
var NAV_TIMEOUT_MS = 3000;

/** ナビゲーションのフォールバック先（要件 15-9）。 */
var NAV_FALLBACK = './index.html';

/*
 * install: PRECACHE の全資産の格納が完了した場合にのみ install を完了とする（要件 15-4）。
 * cache.addAll は 1 件でも取得に失敗すると reject するため、部分キャッシュのまま
 * install が成功扱いになることがない。ここで失敗を握り潰さないことが重要で、
 * reject させることで不完全なバージョンが activate されない。
 */
self.addEventListener('install', function (event) {
  // 意図的に self.skipWaiting() を呼ばない。
  // 新しいバージョンは既存のタブがすべて閉じられてから有効化される。
  // 理由: 練習セッション中に app.js とキャッシュ済み資産が入れ替わると、
  // 実行中のコードと配信される資産のバージョンが混在しうる。計測の継続性を
  // 優先し、設計の「オフライン・キャッシュ更新の確認手順」が前提とする
  // 「リロード → タブを閉じて再度開く」で切り替わる挙動に合わせる。
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

/*
 * activate: CACHE_NAME 以外のキャッシュを全件削除する（要件 15-6）。
 */
self.addEventListener('activate', function (event) {
  // 意図的に self.clients.claim() を呼ばない。
  // skipWaiting を使わない方針と対になっており、既に開かれているページは
  // そのページを制御していた世代の Service Worker に従い続ける。
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          return key === CACHE_NAME ? undefined : caches.delete(key);
        })
      );
    })
  );
});

/**
 * ナビゲーション要求か判定する。mode を持たない古い実装向けに destination も見る。
 * @param {Request} request
 * @returns {boolean}
 */
function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

/**
 * 同一オリジンの要求か判定する。
 * @param {URL} url
 * @returns {boolean}
 */
function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

/**
 * ナビゲーション: network-first（3 秒タイムアウト）→ キャッシュ済み index.html（要件 15-9）。
 * @param {Request} request
 * @returns {Promise<Response>}
 */
function handleNavigation(request) {
  var timerId = null;
  // ネットワーク失敗（オフライン等）はタイムアウトを待たず null に確定させる。
  var network = fetch(request).catch(function () {
    return null;
  });
  var timer = new Promise(function (resolve) {
    timerId = setTimeout(function () {
      resolve(null);
    }, NAV_TIMEOUT_MS);
  });

  return Promise.race([network, timer]).then(function (winner) {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    if (winner) {
      return winner;
    }
    // 3 秒以内に応答が無い、またはネットワークが失敗した場合。
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(NAV_FALLBACK).then(function (cached) {
        if (cached) {
          return cached;
        }
        return cache.match('./');
      });
    }).then(function (cached) {
      if (cached) {
        return cached;
      }
      // キャッシュが無い場合は、遅れて届くネットワーク応答を最後の手段として待つ。
      return network.then(function (late) {
        if (late) {
          return late;
        }
        return new Response(
          'オフラインのため表示できません。オンラインで一度読み込んでください。',
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          }
        );
      });
    });
  });
}

/**
 * 同一オリジンのナビゲーション以外: cache-first、取得時にキャッシュへ格納（要件 15-8）。
 * @param {Request} request
 * @returns {Promise<Response>}
 */
function handleAsset(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(request).then(function (response) {
        // 200 かつ同一オリジン（basic）の応答のみキャッシュへ格納する。
        // 206 Partial Content などは Cache API が拒否するため対象外。
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          cache.put(request, copy).catch(function () {
            // 容量超過等で格納できなくても応答自体は返す。
          });
        }
        return response;
      });
    });
  });
}

/*
 * fetch: ナビゲーション / 同一オリジンのその他 / 他オリジン の 3 分岐。
 * 他オリジンには介入せず、respondWith を呼ばずブラウザ既定の処理に委ねる。
 */
self.addEventListener('fetch', function (event) {
  var request = event.request;

  // GET 以外はキャッシュ対象にならないため介入しない。
  if (request.method !== 'GET') {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // 他オリジンは介入しない。
  if (!isSameOrigin(url)) {
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Range 要求はキャッシュ経路に乗せず素通しする。
  if (request.headers.has('range')) {
    return;
  }

  event.respondWith(handleAsset(request));
});
