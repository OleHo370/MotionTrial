# Qi Mirror typography assets

The cover and level selector currently use the PC's installed Bodoni MT display face and Segoe UI body face through CSS `local()` aliases in `app/game-type.css`. Both were checked against Windows font registry entries and font-file name tables, then confirmed loaded in the production browser. This approximates the editorial display/body contrast of [the user's reference](https://www.hhuh.io/#tracks); that site's Makcasa and Estiana faces are not installed on this PC and were not downloaded. See `artifacts/qi-editorial-20261017/font-audit.md` and `production-qa.json`. No font installation or runtime external font request is used.

The Chinese brush fonts below remain the existing locally hosted project assets. Caveat is retained for historical reproducibility but is no longer used by the cover or level selector. The cover's large `氣` is an image (`public/landing-art/qi-brush-mark.png`), independent of font availability; its generation prompt and provenance are in `artifacts/qi-editorial-20261017/brush-art.json`.

| Intended use | Typeface | Local file | Internal version | License |
| --- | --- | --- | --- | --- |
| Retained earlier English handwriting asset (inactive) | Caveat, variable weight 400–700 | `public/fonts/qi/caveat-variable.ttf` | 2.000 | SIL OFL 1.1 |
| Chinese brush lettering | Ma Shan Zheng, regular 400 | `public/fonts/qi/ma-shan-zheng-regular.ttf` | 2.003 | SIL OFL 1.1 |
| Traditional brand character 氣 only | LXGW WenKai TC, regular 400, official single-character subset | `public/fonts/qi/lxgw-wenkai-tc-qi.ttf` | 1.330 | SIL OFL 1.1 |

These licenses allow embedding and redistribution with software, including commercial software, subject to their conditions. The original copyright notices and complete licenses are included beside the assets as `Caveat-OFL.txt`, `MaShanZheng-OFL.txt`, and `LXGWWenKaiTC-OFL.txt`. Do not sell the font files by themselves or remove the license notices.

## Official sources and reproducibility

- [Google Fonts Caveat directory](https://github.com/google/fonts/tree/5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643/ofl/caveat), fixed Google Fonts commit `5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643`.
- [Google Fonts Ma Shan Zheng directory](https://github.com/google/fonts/tree/406197b91ff39a93061c2c2eeaee67ddf2ae1f0d/ofl/mashanzheng), fixed Google Fonts commit `406197b91ff39a93061c2c2eeaee67ddf2ae1f0d`.
- [Google Fonts LXGW WenKai TC directory](https://github.com/google/fonts/tree/4e5f06dbb274a27ebe71ed54ea706b3ee40eabd9/ofl/lxgwwenkaitc), license/metadata fixed to Google Fonts commit `4e5f06dbb274a27ebe71ed54ea706b3ee40eabd9`.
- The WenKai TC single-character file was downloaded unchanged from the official [Google Fonts CSS API request for 氣](https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC&text=%E6%B0%A3&display=swap). Its returned CSS is preserved in `artifacts/qi-type-20261017/font-sources/lxgw-wenkai-tc-qi.css`; its exact Google `fonts.gstatic.com` file URL and SHA-256 are recorded in `public/fonts/qi/source.json`. Google Fonts API responses may evolve, so the shipped file hash identifies this exact subset.

The public `source.json` records each font's source URL, repository commit, internal version, byte size, SHA-256, license URL, license SHA-256, and checked character coverage. Unmodified upstream `METADATA.pb` snapshots are stored in `artifacts/qi-type-20261017/font-sources/`.

## Character coverage verification

`artifacts/qi-type-20261017/font-sources/verify-fonts.mjs` reads the TrueType `cmap` tables directly using Node; no Python, new npm dependency, or fabricated browser result is used. The script checks Latin A–Z/a–z/0–9 for Caveat and all unique Han characters in the home page, level page, level-number helper, and the original 24-form playlist.

At collection, Caveat covered 62/62 checked Latin characters. Ma Shan Zheng covered 139 checked Chinese characters, including all 24 form names and Chinese level numerals, but lacks the traditional character 氣 (U+6C23). The WenKai TC subset supplies that character. The composite Chinese stack therefore covered all 140/140 checked Han characters with no missing glyphs. This is a font-file check; browser rendering is verified separately during UI acceptance.

Run from the project root using the existing runtime:

```powershell
& '.local-runtime/node-v24.22.0-win-x64/node.exe' 'artifacts/qi-type-20261017/font-sources/verify-fonts.mjs'
```

## Earlier downloaded-font integration examples

These examples document the previous handwriting implementation. Current English display and body text use the installed-font aliases in `app/game-type.css`.

```css
@font-face {
  font-family: 'Qi Caveat';
  src: url('/fonts/qi/caveat-variable.ttf') format('truetype');
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
}
@font-face {
  font-family: 'Qi Ma Shan Zheng';
  src: url('/fonts/qi/ma-shan-zheng-regular.ttf') format('truetype');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Qi WenKai Brand';
  src: url('/fonts/qi/lxgw-wenkai-tc-qi.ttf') format('truetype');
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  unicode-range: U+6C23;
}
/* English lettering */
.english { font-family: 'Qi Caveat', cursive; }
/* All Chinese, including 氣 */
.chinese { font-family: 'Qi Ma Shan Zheng', 'Qi WenKai Brand', cursive; }
```

The complete Caveat and Ma Shan Zheng fonts were retained to avoid missing future level labels. The combined font payload is 6,263,760 bytes before HTTP compression. Existing video, model, tracking, WASM, Three.js, database, and private recording files were not modified by font asset collection.
