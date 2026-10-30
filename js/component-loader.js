/**
 * ========================================================
 * Component Loader (軽量コンポーネントローダー)
 * ========================================================
 * 各パーツの HTML断片 (fetch) と JSファイル (script injection) を
 * 指定したDOMコンテナに動的に読み込み・初期化するためのユーティリティです。
 * 
 * 【file:// プロトコル完全対応】
 * file:// 直開きで CORS により fetch が遮断された場合でも、
 * スクリプト読み込みを継続し、コンポーネント側の自己生成フォールバックを起動します。
 */

(function (window) {
    'use strict';

    // 既に読み込み済みのスクリプトを追跡 (二重ロード防止)
    const loadedScripts = new Set();
    const loadingScripts = new Map();

    /**
     * キャッシュバスターのクエリ文字列を付与する
     * @param {string} url
     * @returns {string}
     */
    function appendCacheBuster(url) {
        if (!url) return url;
        // file:// プロトコルではクエリパラメータを付けるとローカルファイルが見つからなくなるため付与しない
        if (window.location && window.location.protocol === 'file:') {
            return url;
        }
        const cb = window.APP_VERSION || '20261027_12';
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}v=${cb}`;
    }

    /**
     * スクリプトファイルを動的に読み込む (重複ロード防止機能つき)
     * @param {string} jsPath 
     * @returns {Promise<void>}
     */
    function loadScript(jsPath) {
        if (!jsPath) return Promise.resolve();

        // 既にロード済みなら即座に解決
        if (loadedScripts.has(jsPath)) {
            return Promise.resolve();
        }

        // 現在ロード中ならそのPromiseを待機
        if (loadingScripts.has(jsPath)) {
            return loadingScripts.get(jsPath);
        }

        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = appendCacheBuster(jsPath);
            script.async = false; // 依存関係の順序を保持

            script.onload = () => {
                loadedScripts.add(jsPath);
                loadingScripts.delete(jsPath);
                resolve();
            };

            script.onerror = (err) => {
                loadingScripts.delete(jsPath);
                console.error(`[ComponentLoader] スクリプトの読み込みに失敗しました: ${jsPath}`, err);
                reject(new Error(`Failed to load script: ${jsPath}`));
            };

            document.head.appendChild(script);
        });

        loadingScripts.set(jsPath, promise);
        return promise;
    }

    /**
     * 単一のHTMLパーツを取得してDOMに挿入し、対応するJSを読み込む
     * @param {string|HTMLElement} target - 挿入先のセレクタまたは要素
     * @param {string|null} htmlPath - HTMLパーツのパス (null可)
     * @param {string|null} jsPath - JSファイルのパス (null可)
     * @param {Object} [options] - オプション ({ replace: false, onLoaded: fn })
     * @returns {Promise<HTMLElement>}
     */
    async function loadComponent(target, htmlPath, jsPath, options = {}) {
        let el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) {
            const msg = `[ComponentLoader] 挿入先要素が見つかりません: ${target}`;
            console.warn(msg);
        }

        let htmlLoaded = false;

        // 1. HTMLの取得とDOM挿入
        if (htmlPath && el) {
            try {
                const response = await fetch(appendCacheBuster(htmlPath));
                if (response.ok) {
                    const htmlText = await response.text();
                    if (options.replace) {
                        const temp = document.createElement('div');
                        temp.innerHTML = htmlText.trim();
                        // コメントノードを避けて最初の要素ノードを取得
                        let newEl = null;
                        for (let i = 0; i < temp.childNodes.length; i++) {
                            if (temp.childNodes[i].nodeType === Node.ELEMENT_NODE) {
                                newEl = temp.childNodes[i];
                                break;
                            }
                        }
                        if (newEl && el.parentNode) {
                            el.parentNode.replaceChild(newEl, el);
                            el = newEl;
                        } else {
                            el.innerHTML = htmlText;
                        }
                    } else {
                        el.innerHTML = htmlText;
                    }
                    htmlLoaded = true;
                } else {
                    console.warn(`[ComponentLoader] HTMLの取得ステータス異常 (${response.status}): ${htmlPath}`);
                }
            } catch (err) {
                // file:// 環境などで CORS エラーになった場合も、JSロードに進むよう中断しない
                console.warn(`[ComponentLoader] fetchに失敗しました (${err.message})。JS側のフォールバックに委譲します: ${htmlPath}`);
            }
        }

        // 2. JSの読み込み (HTMLのfetch成否に関係なく必ず読み込む)
        if (jsPath) {
            try {
                await loadScript(jsPath);
            } catch (err) {
                console.error(`[ComponentLoader] JSの読み込みに失敗しました: ${jsPath}`, err);
            }
        }

        if (typeof options.onLoaded === 'function') {
            options.onLoaded(el);
        }

        return el;
    }

    /**
     * 複数のコンポーネントを一括で並列読み込みする
     * @param {Array<{target: string|HTMLElement, html?: string, js?: string, options?: Object}>} configs
     * @returns {Promise<Array<HTMLElement>>}
     */
    function loadComponents(configs = []) {
        if (!Array.isArray(configs) || configs.length === 0) {
            return Promise.resolve([]);
        }
        return Promise.all(
            configs.map(cfg => loadComponent(cfg.target, cfg.html || null, cfg.js || null, cfg.options || {}))
        );
    }

    // グローバル公開
    window.ComponentLoader = {
        loadComponent,
        loadComponents,
        loadScript
    };

    // ショートカット関数として window.loadComponent / window.loadComponents も公開
    window.loadComponent = loadComponent;
    window.loadComponents = loadComponents;

})(window);
