// ==UserScript==
// @name         Side-by-side Web Page Translator / Original + Translation
// @namespace    https://violentmonkey.github.io/
// @version      1.0.1
// @description  Synchronous web page translation: original on the left, translation on the right, shared scroll, preserves page appearance as much as possible.
// @author       ChatGPT
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      translate.googleapis.com
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    targetLang: localStorage.getItem('vmBilingualTranslator.targetLang') || 'ru',
    sourceLang: 'auto',

    /**
     * true  — translate automatically after page load.
     * false — translate only via button.
     */
    autoStart: false,

    translateSelector: [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'li',
      'blockquote',
      'figcaption',
      'caption',
      'summary',
      'dt',
      'dd',
      'td',
      'th'
    ].join(','),

    candidateIgnoreSelector: [
      '.vm-bilingual-translator-ui',
      '.vm-bilingual-translator-row',
      '[data-vm-bilingual-ignore]',
      '[data-vm-bilingual-done="1"]',
      'script',
      'style',
      'noscript',
      'template',
      'pre',
      'code',
      'kbd',
      'samp',
      'textarea',
      'input',
      'select',
      'option',
      'button',
      'svg',
      'canvas',
      'math',
      '[contenteditable="true"]'
    ].join(','),

    textNodeIgnoreSelector: [
      '[data-vm-bilingual-ignore]',
      'script',
      'style',
      'noscript',
      'template',
      'pre',
      'code',
      'kbd',
      'samp',
      'textarea',
      'input',
      'select',
      'option',
      'button',
      'svg',
      'canvas',
      'math',
      '[contenteditable="true"]'
    ].join(','),

    minTextChars: 3,
    maxTextCharsPerNode: 1200,
    maxBlockChars: 7000,
    maxParallelRequests: 4,
    cachePrefix: 'vm-bilingual-translator-cache-v1:'
  };

  const state = {
    active: false,
    runId: 0,
    total: 0,
    done: 0,
    errors: 0,
    observer: null,
    mutationTimer: null,
    ui: null,
    statusEl: null
  };

  const memoryCache = new Map();
  const requestQueue = [];
  let activeRequests = 0;

  injectStyles();
  createUI();
  registerMenuCommands();
  registerHotkeys();

  if (CONFIG.autoStart) {
    window.setTimeout(function () {
      startTranslation();
    }, 800);
  }

  function injectStyles() {
    const css = `
      :root {
        --vm-bilingual-gap: 18px;
        --vm-bilingual-divider-color: rgba(127, 127, 127, 0.32);
        --vm-bilingual-translation-bg: rgba(127, 127, 127, 0.055);
      }

      .vm-bilingual-translator-row {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
        grid-auto-rows: auto !important;
        align-items: start !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }

      .vm-bilingual-translator-col {
        display: block !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
      }

      .vm-bilingual-translator-original {
        padding-right: var(--vm-bilingual-gap) !important;
        border-right: 1px solid var(--vm-bilingual-divider-color) !important;
      }

      .vm-bilingual-translator-translation {
        padding-left: var(--vm-bilingual-gap) !important;
        background: var(--vm-bilingual-translation-bg) !important;
      }

      .vm-bilingual-translator-translation.vm-bilingual-translator-pending {
        opacity: 0.58 !important;
      }

      .vm-bilingual-translator-translation.vm-bilingual-translator-error {
        outline: 1px dashed rgba(220, 70, 70, 0.65) !important;
      }

      .vm-bilingual-translator-ui {
        position: fixed !important;
        top: 12px !important;
        right: 12px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        max-width: min(720px, calc(100vw - 24px)) !important;
        padding: 8px 10px !important;
        border-radius: 12px !important;
        background: rgba(20, 20, 24, 0.88) !important;
        color: #fff !important;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35) !important;
        backdrop-filter: blur(10px) !important;
        -webkit-backdrop-filter: blur(10px) !important;
        font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        user-select: none !important;
      }

      .vm-bilingual-translator-ui * {
        font: inherit !important;
        box-sizing: border-box !important;
      }

      .vm-bilingual-translator-ui strong {
        font-weight: 700 !important;
        white-space: nowrap !important;
      }

      .vm-bilingual-translator-ui button,
      .vm-bilingual-translator-ui select {
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        border-radius: 8px !important;
        padding: 5px 8px !important;
        color: #fff !important;
        background: rgba(255, 255, 255, 0.12) !important;
        cursor: pointer !important;
        outline: none !important;
      }

      .vm-bilingual-translator-ui button:hover,
      .vm-bilingual-translator-ui select:hover {
        background: rgba(255, 255, 255, 0.2) !important;
      }

      .vm-bilingual-translator-ui button:active {
        transform: translateY(1px) !important;
      }

      .vm-bilingual-translator-ui select option {
        color: #111 !important;
        background: #fff !important;
      }

      .vm-bilingual-translator-status {
        min-width: 90px !important;
        max-width: 220px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        opacity: 0.9 !important;
      }

      @media (max-width: 760px) {
        .vm-bilingual-translator-row {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        .vm-bilingual-translator-original {
          padding-right: 0 !important;
          padding-bottom: 0.45em !important;
          margin-bottom: 0.45em !important;
          border-right: 0 !important;
          border-bottom: 1px solid var(--vm-bilingual-divider-color) !important;
        }

        .vm-bilingual-translator-translation {
          padding-left: 0 !important;
        }

        .vm-bilingual-translator-ui {
          top: auto !important;
          right: 8px !important;
          bottom: 8px !important;
          left: 8px !important;
          justify-content: center !important;
          flex-wrap: wrap !important;
        }

        .vm-bilingual-translator-status {
          min-width: auto !important;
          max-width: 100% !important;
        }
      }

      @media print {
        .vm-bilingual-translator-ui {
          display: none !important;
        }
      }
    `;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      document.documentElement.appendChild(style);
    }
  }

  function createUI() {
    const ui = document.createElement('div');
    ui.className = 'vm-bilingual-translator-ui';
    ui.setAttribute('data-vm-bilingual-ignore', '1');

    const languages = [
      ['ru', 'Русский'],
      ['en', 'English'],
      ['uk', 'Українська'],
      ['de', 'Deutsch'],
      ['fr', 'Français'],
      ['es', 'Español'],
      ['it', 'Italiano'],
      ['pt', 'Português'],
      ['pl', 'Polski'],
      ['tr', 'Türkçe'],
      ['zh-CN', '中文'],
      ['ja', '日本語'],
      ['ko', '한국어']
    ];

    let optionsHtml = '';

    for (let i = 0; i < languages.length; i += 1) {
      const code = languages[i][0];
      const label = languages[i][1];
      const selected = code === CONFIG.targetLang ? 'selected' : '';

      optionsHtml += '<option value="' + escapeHtml(code) + '" ' + selected + '>' +
        escapeHtml(label) +
        '</option>';
    }

    ui.innerHTML = [
      '<button type="button" data-vm-action="toggle" title="Hide panel (show via Violentmonkey menu)">✕</button>',
      '<strong>↔ Translate</strong>',
      '<select data-vm-action="language" title="Translation language">',
      optionsHtml,
      '</select>',
      '<button type="button" data-vm-action="start" title="Translate page">Translate</button>',
      '<button type="button" data-vm-action="restore" title="Restore page to original">Restore</button>',
      '<button type="button" data-vm-action="scan" title="Translate new blocks on dynamic page">New</button>',
      '<span class="vm-bilingual-translator-status" data-vm-role="status">ready</span>'
    ].join('');

    ui.addEventListener('click', function (event) {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      const action = target.getAttribute('data-vm-action');

      if (action === 'start') {
        startTranslation();
      }

      if (action === 'restore') {
        restorePage();
      }

      if (action === 'scan') {
        startTranslation({ onlyNew: true });
      }

      if (action === 'toggle') {
        hideUI();
      }
    });

    ui.addEventListener('change', function (event) {
      const target = event.target;

      if (!(target instanceof HTMLSelectElement)) {
        return;
      }

      const action = target.getAttribute('data-vm-action');

      if (action === 'language') {
        CONFIG.targetLang = target.value;
        localStorage.setItem('vmBilingualTranslator.targetLang', CONFIG.targetLang);

        if (state.active) {
          restorePage({ silent: true });
          startTranslation();
        } else {
          setStatus('language: ' + CONFIG.targetLang);
        }
      }
    });

    state.ui = ui;
    state.statusEl = ui.querySelector('[data-vm-role="status"]');

    function mount() {
      if (document.body) {
        document.body.appendChild(ui);
      } else {
        document.documentElement.appendChild(ui);
      }
    }

    if (document.body) {
      mount();
    } else {
      window.addEventListener('DOMContentLoaded', mount, { once: true });
    }

    if (localStorage.getItem('vmBilingualTranslator.uiHidden') !== '0') {
      ui.style.setProperty('display', 'none', 'important');
    }
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') {
      return;
    }

    GM_registerMenuCommand('Translate page to two columns', function () {
      startTranslation();
    });

    GM_registerMenuCommand('Restore page to original', function () {
      restorePage();
    });

    GM_registerMenuCommand('Translate new blocks', function () {
      startTranslation({ onlyNew: true });
    });

    GM_registerMenuCommand('Show / Hide UI panel', function () {
      if (state.ui && state.ui.style.display === 'none') {
        showUI();
      } else if (state.ui) {
        hideUI();
      }
    });
  }

  function registerHotkeys() {
    window.addEventListener('keydown', function (event) {
      if (event.altKey && event.shiftKey && event.code === 'KeyT') {
        event.preventDefault();

        if (state.active) {
          restorePage();
        } else {
          startTranslation();
        }
      }
    }, true);
  }

  function hideUI() {
    const ui = state.ui;

    if (!ui) {
      return;
    }

    ui.style.setProperty('display', 'none', 'important');
    localStorage.setItem('vmBilingualTranslator.uiHidden', '1');
  }

  function showUI() {
    const ui = state.ui;

    if (!ui) {
      return;
    }

    ui.style.removeProperty('display');
    localStorage.setItem('vmBilingualTranslator.uiHidden', '0');
  }

  function toggleUI() {
    const ui = state.ui;

    if (!ui) {
      return;
    }

    if (ui.style.display === 'none') {
      showUI();
    } else {
      hideUI();
    }
  }

  function startTranslation(options) {
    options = options || {};

    const onlyNew = Boolean(options.onlyNew);

    if (!document.body) {
      setStatus('body not found');
      return;
    }

    if (!state.active) {
      state.active = true;
      state.runId += 1;
      state.total = 0;
      state.done = 0;
      state.errors = 0;
    }

    const runId = state.runId;
    const hosts = findTranslatableHosts(document.body);

    if (!hosts.length) {
      setStatus(onlyNew ? 'no new blocks' : 'text not found');
      ensureMutationObserver();
      return;
    }

    let addedNodes = 0;

    for (let i = 0; i < hosts.length; i += 1) {
      addedNodes += processHost(hosts[i], runId);
    }

    if (addedNodes === 0) {
      setStatus(onlyNew ? 'no new text' : 'no text to translate');
    } else {
      updateProgress();
    }

    ensureMutationObserver();
  }

  function restorePage(options) {
    options = options || {};

    const silent = Boolean(options.silent);

    state.runId += 1;
    state.active = false;
    state.total = 0;
    state.done = 0;
    state.errors = 0;

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    if (state.mutationTimer) {
      window.clearTimeout(state.mutationTimer);
      state.mutationTimer = null;
    }

    const rows = Array.prototype.slice.call(
      document.querySelectorAll('.vm-bilingual-translator-row')
    );

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const host = row.parentElement;

      if (!host) {
        continue;
      }

      const original = row.children[0];

      if (original) {
        while (original.firstChild) {
          host.insertBefore(original.firstChild, row);
        }
      }

      row.remove();
      host.removeAttribute('data-vm-bilingual-done');
      host.classList.remove('vm-bilingual-translator-host');
    }

    if (!silent) {
      setStatus('restored');
    }
  }

  function ensureMutationObserver() {
    if (state.observer || !document.body) {
      return;
    }

    state.observer = new MutationObserver(function (mutations) {
      if (!state.active) {
        return;
      }

      let hasExternalMutation = false;

      for (let i = 0; i < mutations.length; i += 1) {
        const target = mutations[i].target;

        if (!(target instanceof Element)) {
          hasExternalMutation = true;
          break;
        }

        if (!target.closest('.vm-bilingual-translator-row, .vm-bilingual-translator-ui')) {
          hasExternalMutation = true;
          break;
        }
      }

      if (!hasExternalMutation) {
        return;
      }

      if (state.mutationTimer) {
        window.clearTimeout(state.mutationTimer);
      }

      state.mutationTimer = window.setTimeout(function () {
        if (state.active) {
          startTranslation({ onlyNew: true });
        }
      }, 900);
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function findTranslatableHosts(root) {
    const candidates = Array.prototype.slice.call(
      root.querySelectorAll(CONFIG.translateSelector)
    );

    return candidates.filter(isGoodCandidate);
  }

  function isGoodCandidate(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.dataset.vmBilingualDone === '1') {
      return false;
    }

    if (element.closest(CONFIG.candidateIgnoreSelector)) {
      return false;
    }

    if (element.closest('[data-vm-bilingual-done="1"]')) {
      return false;
    }

    if (!isVisible(element)) {
      return false;
    }

    const text = getNormalizedText(element);

    if (!text) {
      return false;
    }

    if (text.length < CONFIG.minTextChars) {
      return false;
    }

    if (text.length > CONFIG.maxBlockChars) {
      return false;
    }

    if (!containsHumanLetters(text)) {
      return false;
    }

    if (looksLikeTechnicalGarbage(text)) {
      return false;
    }

    if (hasNestedTranslatableBlock(element)) {
      return false;
    }

    return true;
  }

  function hasNestedTranslatableBlock(element) {
    const nested = Array.prototype.slice.call(
      element.querySelectorAll(CONFIG.translateSelector)
    );

    for (let i = 0; i < nested.length; i += 1) {
      const child = nested[i];

      if (child === element) {
        continue;
      }

      if (!(child instanceof HTMLElement)) {
        continue;
      }

      if (child.closest(CONFIG.candidateIgnoreSelector)) {
        continue;
      }

      const text = getNormalizedText(child);

      if (
        text &&
        text.length >= CONFIG.minTextChars &&
        text.length <= CONFIG.maxBlockChars &&
        containsHumanLetters(text)
      ) {
        return true;
      }
    }

    return false;
  }

  function processHost(host, runId) {
    if (!(host instanceof HTMLElement)) {
      return 0;
    }

    if (host.dataset.vmBilingualDone === '1') {
      return 0;
    }

    const row = document.createElement('span');
    row.className = 'vm-bilingual-translator-row';

    const original = document.createElement('span');
    original.className = 'vm-bilingual-translator-col vm-bilingual-translator-original';

    while (host.firstChild) {
      original.appendChild(host.firstChild);
    }

    const translation = original.cloneNode(true);
    translation.className = 'vm-bilingual-translator-col vm-bilingual-translator-translation vm-bilingual-translator-pending';
    translation.setAttribute('lang', CONFIG.targetLang);
    translation.setAttribute('dir', 'auto');

    sanitizeTranslationClone(translation);

    row.appendChild(original);
    row.appendChild(translation);
    host.appendChild(row);

    host.dataset.vmBilingualDone = '1';
    host.classList.add('vm-bilingual-translator-host');

    const textNodes = collectTextNodes(translation);

    if (!textNodes.length) {
      translation.classList.remove('vm-bilingual-translator-pending');
      return 0;
    }

    state.total += textNodes.length;

    Promise.allSettled(
      textNodes.map(function (node) {
        return translateTextNode(node, runId);
      })
    ).then(function () {
      if (state.runId !== runId) {
        return;
      }

      if (!translation.isConnected) {
        return;
      }

      translation.classList.remove('vm-bilingual-translator-pending');

      if (translation.querySelector('[data-vm-translation-error="1"]')) {
        translation.classList.add('vm-bilingual-translator-error');
      }
    });

    return textNodes.length;
  }

  function sanitizeTranslationClone(root) {
    if (root instanceof Element) {
      root.removeAttribute('id');
    }

    const idNodes = Array.prototype.slice.call(root.querySelectorAll('[id]'));

    for (let i = 0; i < idNodes.length; i += 1) {
      idNodes[i].removeAttribute('id');
    }

    const allElements = [root].concat(
      Array.prototype.slice.call(root.querySelectorAll('*'))
    );

    for (let i = 0; i < allElements.length; i += 1) {
      const element = allElements[i];

      if (!(element instanceof Element)) {
        continue;
      }

      const attrs = Array.prototype.slice.call(element.attributes);

      for (let j = 0; j < attrs.length; j += 1) {
        const attr = attrs[j];

        if (/^on/i.test(attr.name)) {
          element.removeAttribute(attr.name);
        }
      }
    }

    const heavySelectors = [
      'script',
      'style',
      'noscript',
      'template',
      'iframe',
      'canvas',
      'video',
      'audio',
      'source',
      'picture',
      'object',
      'embed'
    ].join(',');

    const heavyNodes = Array.prototype.slice.call(root.querySelectorAll(heavySelectors));

    for (let i = 0; i < heavyNodes.length; i += 1) {
      heavyNodes[i].remove();
    }

    const images = Array.prototype.slice.call(root.querySelectorAll('img'));

    for (let i = 0; i < images.length; i += 1) {
      const img = images[i];
      const alt = img.getAttribute('alt');

      if (alt && alt.trim()) {
        const replacement = document.createElement('span');
        replacement.textContent = alt.trim();
        img.replaceWith(replacement);
      } else {
        img.remove();
      }
    }

    const formElements = Array.prototype.slice.call(
      root.querySelectorAll('input, textarea, select, option, button')
    );

    for (let i = 0; i < formElements.length; i += 1) {
      formElements[i].remove();
    }
  }

  function collectTextNodes(root) {
    const nodes = [];

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const parent = node.parentElement;

          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }

          if (parent.closest(CONFIG.textNodeIgnoreSelector)) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = node.nodeValue || '';

          if (!isTranslatableText(text)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;

    while ((node = walker.nextNode())) {
      nodes.push(node);
    }

    return nodes;
  }

  async function translateTextNode(node, runId) {
    const raw = node.nodeValue || '';
    const split = splitOuterWhitespace(raw);
    const core = split.core;

    if (!isTranslatableText(core)) {
      markDone(runId);
      return;
    }

    try {
      const translated = await enqueueRequest(function () {
        return translateText(core);
      });

      if (state.runId !== runId) {
        return;
      }

      if (!node.isConnected) {
        return;
      }

      node.nodeValue = split.leading + translated + split.trailing;
    } catch (error) {
      console.warn('[Bilingual Translator] Translation error:', error);

      state.errors += 1;

      const parent = node.parentElement;

      if (parent) {
        parent.setAttribute('data-vm-translation-error', '1');
      }
    } finally {
      markDone(runId);
    }
  }

  function markDone(runId) {
    if (state.runId !== runId) {
      return;
    }

    state.done += 1;
    updateProgress();
  }

  async function translateText(text) {
    const cached = getCachedTranslation(text);

    if (cached !== null) {
      return cached;
    }

    const url =
      'https://translate.googleapis.com/translate_a/single' +
      '?client=gtx' +
      '&sl=' + encodeURIComponent(CONFIG.sourceLang) +
      '&tl=' + encodeURIComponent(CONFIG.targetLang) +
      '&dt=t' +
      '&q=' + encodeURIComponent(text);

    const json = await requestJson(url);
    const translated = extractGoogleTranslation(json) || text;

    setCachedTranslation(text, translated);

    return translated;
  }

  function requestJson(url) {
    return new Promise(function (resolve, reject) {
      const gmRequest = typeof GM_xmlhttpRequest === 'function'
        ? GM_xmlhttpRequest
        : null;

      if (!gmRequest) {
        fetch(url)
          .then(function (response) {
            if (!response.ok) {
              throw new Error('HTTP ' + response.status);
            }

            return response.json();
          })
          .then(resolve)
          .catch(reject);

        return;
      }

      gmRequest({
        method: 'GET',
        url: url,
        timeout: 30000,
        headers: {
          Accept: 'application/json,text/plain,*/*'
        },
        onload: function (response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('HTTP ' + response.status));
            return;
          }

          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error);
          }
        },
        onerror: function (error) {
          reject(error);
        },
        ontimeout: function () {
          reject(new Error('Translation request timeout'));
        }
      });
    });
  }

  function extractGoogleTranslation(json) {
    if (!Array.isArray(json)) {
      return '';
    }

    const chunks = json[0];

    if (!Array.isArray(chunks)) {
      return '';
    }

    let result = '';

    for (let i = 0; i < chunks.length; i += 1) {
      const part = chunks[i];

      if (Array.isArray(part) && typeof part[0] === 'string') {
        result += part[0];
      }
    }

    return result;
  }

  function enqueueRequest(task) {
    return new Promise(function (resolve, reject) {
      requestQueue.push({
        task: task,
        resolve: resolve,
        reject: reject
      });

      pumpQueue();
    });
  }

  function pumpQueue() {
    while (
      activeRequests < CONFIG.maxParallelRequests &&
      requestQueue.length > 0
    ) {
      const item = requestQueue.shift();

      activeRequests += 1;

      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(function () {
          activeRequests -= 1;
          pumpQueue();
        });
    }
  }

  function getCachedTranslation(text) {
    const key = getCacheKey(text);

    if (memoryCache.has(key)) {
      return memoryCache.get(key);
    }

    try {
      const raw = localStorage.getItem(key);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);

      if (!parsed || parsed.s !== text || typeof parsed.t !== 'string') {
        return null;
      }

      memoryCache.set(key, parsed.t);
      return parsed.t;
    } catch (error) {
      return null;
    }
  }

  function setCachedTranslation(text, translated) {
    const key = getCacheKey(text);

    memoryCache.set(key, translated);

    if (text.length > 1000) {
      return;
    }

    try {
      localStorage.setItem(key, JSON.stringify({
        s: text,
        t: translated,
        ts: Date.now()
      }));
    } catch (error) {
      // localStorage may be full. This is not critical.
    }
  }

  function getCacheKey(text) {
    return CONFIG.cachePrefix +
      CONFIG.sourceLang +
      ':' +
      CONFIG.targetLang +
      ':' +
      hashString(text);
  }

  function hashString(str) {
    let hash = 2166136261;

    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return String((hash >>> 0).toString(36)) + '-' + String(str.length);
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);

    if (style.display === 'none') {
      return false;
    }

    if (style.visibility === 'hidden') {
      return false;
    }

    if (style.opacity === '0') {
      return false;
    }

    const rects = element.getClientRects();

    if (!rects || rects.length === 0) {
      return false;
    }

    return true;
  }

  function getNormalizedText(element) {
    const text = element.innerText || element.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
  }

  function isTranslatableText(text) {
    const value = text.trim();

    if (!value) {
      return false;
    }

    if (value.length < CONFIG.minTextChars) {
      return false;
    }

    if (value.length > CONFIG.maxTextCharsPerNode) {
      return false;
    }

    if (!containsHumanLetters(value)) {
      return false;
    }

    if (looksLikeTechnicalGarbage(value)) {
      return false;
    }

    return true;
  }

  function containsHumanLetters(text) {
    /**
     * Without \\p{L} to avoid SyntaxError in older engines.
     * Latin, Cyrillic, Greek, some European letters, CJK, Japanese, Korean.
     */
    return /[A-Za-zА-Яа-яЁё\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(text);
  }

  function looksLikeTechnicalGarbage(text) {
    const value = text.trim();

    if (!value) {
      return true;
    }

    if (/^[\d\s.,:;!?()[\]{}+\-*/=<>|@#$%^&~`'"_\\]+$/.test(value)) {
      return true;
    }

    if (/^(https?:\/\/|www\.)\S+$/i.test(value)) {
      return true;
    }

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return true;
    }

    if (/^[a-f0-9]{24,}$/i.test(value)) {
      return true;
    }

    return false;
  }

  function splitOuterWhitespace(text) {
    const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);

    if (!match) {
      return {
        leading: '',
        core: text,
        trailing: ''
      };
    }

    return {
      leading: match[1] || '',
      core: match[2] || '',
      trailing: match[3] || ''
    };
  }

  function updateProgress() {
    if (!state.total) {
      setStatus('ready');
      return;
    }

    const percent = Math.round((state.done / state.total) * 100);
    const errorSuffix = state.errors ? ', errors: ' + state.errors : '';

    setStatus(state.done + '/' + state.total + ' · ' + percent + '%' + errorSuffix);
  }

  function setStatus(text) {
    if (state.statusEl) {
      state.statusEl.textContent = text;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
