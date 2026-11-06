# Third-Party Runtime Components

The database cell viewer uses Microsoft `jsonc-parser@3.3.1` (MIT) to format JSON via text edits while preserving original numeric literals. Source: <https://github.com/microsoft/node-jsonc-parser>.

The database viewer serves `@sqlite.org/sqlite-wasm@3.54.1-build1` JavaScript and WASM from the application's own origin, preserving the upstream JavaScript notices. The npm wrapper is Apache-2.0; SQLite is public domain, and the generated Emscripten glue carries its upstream MIT / University of Illinois-NCSA notices. Source: <https://github.com/sqlite/sqlite-wasm>. Selected database contents are not sent to the server.

The image-compression toolbox loads the following pinned browser modules from jsDelivr only after a user starts an operation that needs them. They are not installed into the application bundle. Image bytes are processed locally and are not uploaded to the CDN.

| Component | Version | Purpose | License |
| --- | --- | --- | --- |
| `@winrisef/jpegli-wasm` | 0.1.0 | JPEGli encoding | MIT wrapper; bundled upstream notices apply |
| `@jsquash/oxipng` | 2.3.0 | Lossless PNG optimization | Apache-2.0 |
| `@jsquash/webp` | 1.5.0 | libwebp encoding | Apache-2.0 |
| `@jsquash/avif` | 2.1.1 | libavif encoding | Apache-2.0 |
| `@jsquash/jxl` | 1.3.0 | libjxl encoding and decoding | Apache-2.0 |
| `exifr` | 7.1.3 | EXIF and ICC inspection | MIT |
| `libimagequant-wasm` | 0.3.0 | Browser bindings for lossy palette quantization | MIT wrapper |
| `libimagequant` / `imagequant` | 4.x dependency of the wrapper | Lossy 24/32-bit to indexed PNG quantization (up to 256 colors) | GPL-3.0-or-later or commercial license |
| `@zip.js/zip.js` | 2.8.59 | Batch result packaging | BSD-3-Clause |

The `libimagequant-wasm` wrapper explicitly depends on the separately licensed `libimagequant` project. Deployments must comply with GPL-3.0-or-later or obtain an appropriate commercial license from the libimagequant author. This notice does not relicense the project or replace the upstream license texts.

Upstream sources:

- <https://github.com/jamsinclair/jSquash>
- <https://github.com/WinriseF/jpegli-wasm>
- <https://github.com/MikeKovarik/exifr>
- <https://github.com/akshetpandey/libimagequant-wasm>
- <https://github.com/ImageOptim/libimagequant>
- <https://github.com/gildas-lormeau/zip.js>
