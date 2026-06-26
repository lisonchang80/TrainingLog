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

## ⚠️ 去 alpha（ios/ AppIcon 與 Watch 必做、2026-06-26 抓到真因）

**qlmanage 產出的 PNG 即使滿版不透明、`sips -g hasAlpha` 仍回 `yes`**（含全 255 alpha 通道）。Apple 對 **app icon** 不准有 alpha 通道——含 alpha 的 1024 在 Xcode/驗證會被退或顯示異常（**這就是「之前 icon size 出不來」的真因**，不是尺寸算錯）。

- **Expo 路徑**（`assets/images/icon.png`）：Expo prebuild 會自動 flatten，含 alpha 沒關係。
- **但 `ios/**/AppIcon.appiconset/` 是手維護**（bare workflow、ios/ 進版控、prebuild 不重生）→ **Expo 的 flatten 救不到**，必須自己先把 master 壓成無 alpha 再餵 `gen-ios-icons.sh` + Watch master。

**macOS 原生實測**：`sips --setProperty hasAlpha no` / tiff round-trip 都**去不掉** alpha；只有 jpeg round-trip 行但有損（銳利邊殘影）。**用 repo 內建的 `pngjs`（純 JS、無損）壓平**：

```bash
cat > /tmp/flatten-png.js <<'EOF'
const fs=require('fs'),{PNG}=require('pngjs');
const[,,src,out]=process.argv,png=PNG.sync.read(fs.readFileSync(src)),d=png.data;
const r=d[0],g=d[1],b=d[2];
for(let i=0;i<d.length;i+=4){const a=d[i+3]/255;d[i]=Math.round(d[i]*a+r*(1-a));d[i+1]=Math.round(d[i+1]*a+g*(1-a));d[i+2]=Math.round(d[i+2]*a+b*(1-a));d[i+3]=255;}
fs.writeFileSync(out,PNG.sync.write(png,{colorType:2}));console.log('wrote',out);
EOF
# 從 repo root 跑（NODE_PATH 指 repo node_modules，因為腳本在 /tmp）
NODE_PATH="$PWD/node_modules" node /tmp/flatten-png.js "$PWD/assets/logo/icon-1024.png" /tmp/icon-flat.png
sips -g hasAlpha /tmp/icon-flat.png   # 應為 hasAlpha: no
```

（composite 到左上角背景色 + `colorType:2` 輸出 RGB；滿版底色時 alpha 全不透明＝無損。）

## 全表面替換（一次換到底）

把無 alpha 的 flat master 鋪到所有表面：

```bash
FLAT=/tmp/icon-flat.png
cp "$FLAT" assets/logo/icon-1024.png                       # 修正 master 本身（之後不再含 alpha）
cp "$FLAT" assets/images/icon.png                          # Expo
cp "$FLAT" assets/images/splash-icon.png                   # splash
sips -z 48 48 "$FLAT" --out assets/images/favicon.png -s format png
cp "$FLAT" "ios/TrainingLog/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"
scripts/gen-ios-icons.sh "$FLAT"                           # 產 13 個降尺寸（無 alpha source → 全無 alpha）
cp "$FLAT" "ios/TrainingLog Watch Watch App/Assets.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"  # Watch（單張 1024、Xcode 自動降尺寸）
```

- Android adaptive（`android-icon-foreground/background/monochrome.png`）需**透明前景符號**，本流程的滿版 master 不適用 → 從 `logo-mark.svg` 另出，非 iOS 上架目標可 defer。
- 換完 ios/ appicon 要 **native rebuild** 才看得到（sim/dev build 不會即時反映；Expo 的 `icon.png` 倒是 Metro reload 就生效）。

## 換成正式 app icon

不要擅自覆蓋現有 `assets/images/icon.png`（先 surface，那可能是還在用的舊圖）。給使用者這行讓他自己換：

```bash
cp /Users/hao800922/code/TrainingLog/assets/logo/icon-1024.png /Users/hao800922/code/TrainingLog/assets/images/icon.png
```

換完要重新 build（`expo prebuild` / dev build）才看得到。**Expo 的 icon pipeline 只對這條 Expo 路徑自動 flatten alpha + 產各尺寸**；手維護的 `ios/**/AppIcon.appiconset/` **不在此列**，必須先依上面「⚠️ 去 alpha」段壓平再餵 `gen-ios-icons.sh`。完整一次換到底見「全表面替換」段。

## SVG 母檔做法重點

- 滿版底色用一個 `<rect width=height=viewBox 邊長>`；符號群組置中、四周留白（app icon 安全區，符號約佔 60–65%）。
- 滾花/磨砂止滑面：用 `<pattern patternUnits="userSpaceOnUse">` 放一顆小 `<circle>`，再用一個 band `<rect fill="url(#id)">` 蓋在握把中央 → 密集圓點。pattern 的點色＝對比色（白底符號用底色點、彩色符號用白點）。
- 配色：app icon 用純色（如 `#2F6BFF` 藍），符號白 `#FFFFFF`；淺底展示版底 `#F4ECE3`。
