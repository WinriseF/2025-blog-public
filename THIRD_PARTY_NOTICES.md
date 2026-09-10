# Third-Party Runtime Components

The image-compression toolbox loads the following pinned browser modules from jsDelivr only after a user starts an operation that needs them. They are not installed into the application bundle. Image bytes are processed locally and are not uploaded to the CDN.

| Component | Version | Purpose | License |
| --- | --- | --- | --- |
| `@jsquash/jpeg` | 1.6.0 | MozJPEG encoding | Apache-2.0 |
| `@jsquash/png` | 3.1.1 | PNG encoding | Apache-2.0 |
| `@jsquash/oxipng` | 2.3.0 | Lossless PNG optimization | Apache-2.0 |
| `@jsquash/webp` | 1.5.0 | libwebp encoding | Apache-2.0 |
| `@jsquash/avif` | 2.1.1 | libavif encoding | Apache-2.0 |
| `exifr` | 7.1.3 | EXIF and ICC inspection | MIT |
| `libimagequant-wasm` | 0.3.0 | Browser bindings for libimagequant | MIT wrapper |
| `libimagequant` / `imagequant` | 4.x dependency of the wrapper | Alpha-aware palette quantization | GPL-3.0-or-later or commercial license |
| `@zip.js/zip.js` | 2.8.59 | Batch result packaging | BSD-3-Clause |

The `libimagequant-wasm` wrapper explicitly depends on the separately licensed `libimagequant` project. Deployments must comply with GPL-3.0-or-later or obtain an appropriate commercial license from the libimagequant author. This notice does not relicense the project or replace the upstream license texts.

Upstream sources:

- <https://github.com/jamsinclair/jSquash>
- <https://github.com/MikeKovarik/exifr>
- <https://github.com/akshetpandey/libimagequant-wasm>
- <https://github.com/ImageOptim/libimagequant>
- <https://github.com/gildas-lormeau/zip.js>
