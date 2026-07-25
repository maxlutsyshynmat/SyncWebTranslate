# SyncTranslate — Bilingual Web Page Translator

A **Violentmonkey / Tampermonkey** userscript that transforms any web page into a **side-by-side bilingual view**: the original text on the left, the machine translation on the right.

## Features

- **Side-by-side layout** — Original and translated text appear in parallel columns, preserving the page's original structure and styling.
- **Synchronized scrolling** — Both columns share the same scroll container, so they stay perfectly aligned as you scroll.
- **Any source language → any target language** — Uses Google Translate API (free). Auto-detects the source language.
- **Preserves page appearance** — Images, layout, fonts, colors, and interactive elements on the original side remain untouched.
- **Dynamic page support** — A MutationObserver automatically translates new content added to the page (SPAs, infinite scroll, etc.).
- **Hotkey** — Press `Alt+Shift+T` to toggle translation on/off.
- **Language selection** — Built-in UI panel in the top-right corner lets you pick from 13 languages (RU, EN, UK, DE, FR, ES, IT, PT, PL, TR, ZH-CN, JA, KO).
- **Caching** — Translated segments are cached in memory and `localStorage` to avoid redundant API calls.

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Create a new script and paste the contents of [`userscript.js`](./userscript.js), or install directly from the `.user.js` URL if hosted.
3. The script runs automatically on all HTTP/HTTPS pages (`@match http://*/*` and `@match https://*/*`).

## Usage

1. Navigate to any web page.
2. Click the **↔ Translate** button in the floating UI panel (top-right corner).
3. Select your target language from the dropdown.
4. The page will be split into two columns: original (left) and translated (right).
5. Scroll normally — both sides stay synced.
6. Click **Restore** to return the page to its original single-column state.
7. Click **New** to translate blocks added dynamically after the initial translation.

### Menu Commands

The script also registers Violentmonkey menu commands:
- **Translate page to two columns** — Start translation
- **Restore page to original** — Restore original view
- **Translate new blocks** — Translate newly added blocks

## How It Works

1. The script identifies translatable text blocks (headings, paragraphs, list items, blockquotes, table cells, etc.).
2. Each block is duplicated into two columns: the **original** (preserved as-is) and the **translation** (clone stripped of IDs, event handlers, media elements, and form controls).
3. The right column's text nodes are sent to the [Google Translate API](https://translate.googleapis.com/translate_a/single) in parallel (up to 4 concurrent requests).
4. As each segment is translated, the text is replaced in-place. The `pending` class is removed from the translation column once all segments are done.

## Configuration

Edit the `CONFIG` object at the top of `userscript.js`:

| Key | Default | Description |
|---|---|---|
| `targetLang` | `'ru'` | Target language code (stored in localStorage as `vmBilingualTranslator.targetLang`) |
| `autoStart` | `false` | Whether to translate immediately on page load |
| `minTextChars` | `3` | Minimum text length to translate |
| `maxTextCharsPerNode` | `1200` | Max characters per individual text node |
| `maxBlockChars` | `7000` | Max characters per block element |
| `maxParallelRequests` | `4` | Max concurrent translation requests |

## Browser Compatibility

Works in all modern browsers with Violentmonkey or Tampermonkey. Tested on Chrome, Firefox, and Edge.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later.

You may use, modify, distribute, and sell this software, including commercially.
If you modify this software and distribute it, or run a modified version as a network service,
you must make the corresponding source code available under the same license.

See the LICENSE file for details.
