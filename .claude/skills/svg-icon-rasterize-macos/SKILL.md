---
name: svg-icon-rasterize-macos
description: Author SVG logo/app-icon masters and rasterize them to PNG on macOS WITHOUT installing a rasterizer. Trigger words：'logo'、'app icon'、'icon.png'、'splash'、'favicon'、'SVG 轉 PNG'、'rasterize'、'品牌視覺'、'做 icon'。Covers：assets/logo/ master layout、qlmanage Quick-Look fallback、sips 驗尺寸、Read PNG 目視、換進 assets/images/icon.png、Expo icon pipeline 自動去 alpha、App Store 品質注意事項。
---

# SVG icon → PNG on macOS (no librsvg)

TrainingLog 的品牌/app-icon 視覺流程。當使用者要做 logo、app icon、splash、favicon，或要把 SVG 轉成 PNG 時用。

## 檔案放哪

- **母檔 SVG**：`assets/logo/`（版本控管、可縮放、之後所有尺寸從這裡出）
  - `icon.svg` — 正式 app icon 來源：**滿版色底矩形 + 置中符號、無圓角、無透明**（iOS 會自動套圓角遮罩；自己畫圓角會被裁掉、有 alpha 會被 ASC 退件）
  - `icon-light.svg` — 淺底/圓角展示版（行銷、網頁、文件、App 內）
  - `logo-mark.svg` — 透明底純符號、viewBox 裁緊（App 內標頭、splash）
- **產出 PNG**：先放 `assets/logo/icon-1024.png`（預覽用），確認後再覆蓋 `assets/images/icon.png`
- Expo 的 icon 設定在 `app.json` → `expo.icon`（指向 `./assets/images/icon.png`，1024 規格）。splash 在 `expo-splash-screen` plugin 的 `image`（`./assets/images/splash-icon.png`）、favicon 在 `expo.web.favicon`。

## 機器現況（2026-06-22 實測）

`rsvg-convert` / `magick` / `convert` / `inkscape` / `cairosvg` **全都沒有**，node_modules 也沒有 `sharp` / `@resvg/resvg-js`。
**不要幫使用者裝**（feedback_workflow：不要幫忙裝工具）。只剩 macOS 內建的 `qlmanage`（Quick Look）可用。

## 轉檔（qlmanage fallback）

```bash
cd /Users/hao800922/code/TrainingLog/assets/logo && \
qlmanage -t -s 1024 -o . icon.svg >/dev/null 2>&1 && \
mv -f icon.svg.png icon-1024.png && \
sips -g pixelWidth -g pixelHeight icon-1024.png | grep pixel
```

- `qlmanage -t -s <px> -o <dir> <file.svg>` 產出檔名是 `<原名>.png`（即 `icon.svg.png`），要自己 `mv` 改名。
- 方形 SVG（viewBox 1024×1024）→ 出 1024×1024。`sips` 驗 `pixelWidth/pixelHeight`。
- **一定要 `Read` 那張 PNG 目視確認**：qlmanage 偶爾對複雜 SVG 出空白/透明/縮放錯。簡單 flat SVG（純 rect + pattern）實測 OK。
- 品質夠當預覽/開發 icon；**送 App Store 前**建議用設計工具或日後裝 `librsvg`/`resvg` 從同一份 `icon.svg` 重出，色彩/抗鋸齒更準。

## 換成正式 app icon

不要擅自覆蓋現有 `assets/images/icon.png`（先 surface，那可能是還在用的舊圖）。給使用者這行讓他自己換：

```bash
cp /Users/hao800922/code/TrainingLog/assets/logo/icon-1024.png /Users/hao800922/code/TrainingLog/assets/images/icon.png
```

換完要重新 build（`expo prebuild` / dev build）才看得到。**Expo 的 icon pipeline 會自動 flatten alpha + 產各尺寸**，所以滿版不透明 PNG 直接可用，alpha 不用自己處理。

## SVG 母檔做法重點

- 滿版底色用一個 `<rect width=height=viewBox 邊長>`；符號群組置中、四周留白（app icon 安全區，符號約佔 60–65%）。
- 滾花/磨砂止滑面：用 `<pattern patternUnits="userSpaceOnUse">` 放一顆小 `<circle>`，再用一個 band `<rect fill="url(#id)">` 蓋在握把中央 → 密集圓點。pattern 的點色＝對比色（白底符號用底色點、彩色符號用白點）。
- 配色：app icon 用純色（如 `#2F6BFF` 藍），符號白 `#FFFFFF`；淺底展示版底 `#F4ECE3`。
