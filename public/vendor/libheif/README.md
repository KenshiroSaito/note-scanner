# libheif-js (vendored)

HEIC decoder for browsers with no native support (Chrome, Firefox). See spec
decision 6 for why it is vendored rather than installed.

| | |
|---|---|
| Package | [`libheif-js`](https://www.npmjs.com/package/libheif-js) 1.23.2 |
| Source | <https://github.com/catdad-experiments/libheif-js> |
| File | `libheif-wasm/libheif-bundle.mjs` — ES module, WebAssembly inlined |
| sha256 | `d05292271af008d300cc75be374feb8fd35b418a71420a556c3fb817f662b502` |
| License | LGPL-3.0 (`LICENSE`); libheif's own terms in `LICENSE-libheif` |

The file is unmodified. It is loaded only by `public/lib/heic-worker.js`, and
only once a HEIC file that the browser cannot decode itself is dropped, so a
page that never sees one never downloads it.

## Updating

```sh
npm pack libheif-js@<version>
tar xzf libheif-js-<version>.tgz
cp package/libheif-wasm/libheif-bundle.mjs public/vendor/libheif/
cp package/LICENSE public/vendor/libheif/LICENSE
cp package/libheif-wasm/LICENSE public/vendor/libheif/LICENSE-libheif
shasum -a 256 public/vendor/libheif/libheif-bundle.mjs
```

Then update the version and hash above and run `npm test` — `test/heic.test.js`
decodes a real HEIC through this file.
