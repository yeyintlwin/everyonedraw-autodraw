# Everyone Draw ပုံဆွဲအကူ — Design

## ရည်ရွယ်ချက်

ပုံတစ်ပုံကို everyonedraw ရဲ့ palette အရောင်တွေအဖြစ် ပြောင်းပြီး၊ ကိုယ်တိုင် pixel တစ်ခုချင်း လက်နဲ့ ဆွဲရတာ လွယ်အောင် ကူညီပေးမယ့် local web page။

**မလုပ်တာ:** everyonedraw ပေါ်မှာ အလိုအလျောက် pixel မချဘူး (site က bot ကို တားထားတယ်)။ site ပေါ်မှာ overlay မတင်ဘူး။ session အများကြီး မသိမ်းဘူး (နောက်ဆုံးတစ်ခုပဲ)။

## ဖိုင်များ

| ဖိုင် | တာဝန် |
|---|---|
| `index.html` | markup + CSS — ဒီဖိုင်ကို double-click ဖွင့်သုံး |
| `app.js` | UI logic (ပုံတင်၊ grid ဆွဲ၊ click၊ N key၊ သိမ်းဆည်း) |
| `core.js` | logic သက်သက် (DOM မသုံး)၊ browser နဲ့ Node နှစ်ခုလုံးမှာ run လို့ရ |
| `core.test.js` | `node --test` နဲ့ core.js ကို စစ်တဲ့ test |

External library / CDN မသုံးဘူး။ internet မရှိလည်း အလုပ်လုပ်တယ်။

## Site အချက်အလက် (2026-11-09 မှာ စစ်ပြီး)

- URL: `https://everyonedraw.com/{zoom}/{x}/{y}` — (x, y) pixel က screen အလယ်တည့်တည့် ရောက်တယ်။ zoom = pixel တစ်ခုရဲ့ CSS px အရွယ်။
- **x က ညာဘက်ကို တိုး၊ y က အပေါ်ဘက်ကို တိုး** (screen နဲ့ ပြောင်းပြန်)။
- ဒါကြောင့် ပုံရဲ့ ဘယ်အပေါ်ထောင့်ကို (X0, Y0) ထားရင် — ပုံ pixel (col c, row r) → canvas `(X0 + c, Y0 − r)`။
- Palette — web ၁၆ ရောင် (PICO-8): `#000000 #1D2B53 #7E2553 #5F574F #AB5236 #008751 #83769C #FF004D #FF77A8 #29ADFF #FFA300 #C2C3C7 #00E436 #FFCCAA #FFEC27 #FFF1E8`
- App မှာပဲရတဲ့ ၁၆ ရောင်: `#291814 #111D35 #422136 #49333B #742F29 #125359 #754665 #065AB5 #BE1250 #A28879 #FF6C24 #FF6E59 #00B543 #FF9D81 #A8E72E #F3EF7D`

## core.js

| Function | အလုပ် |
|---|---|
| `PALETTE_WEB`, `PALETTE_APP` | `{name, hex}` စာရင်း |
| `getPalette(useApp)` | `{name, hex, rgb, lab}` စာရင်း (၁၆ သို့ ၃၂ ရောင်) |
| `srgbToOklab(r, g, b)` | sRGB → OKLab `[L, a, b]` |
| `nearestColor(r, g, b, palette)` | အနီးဆုံး palette index |
| `resizeImage(rgba, w, h, newW)` | area-average နဲ့ အရွယ်ချုံ့၊ အမြင့်က အချိုးအတိုင်း၊ အကျယ်ရော အမြင့်ပါ 512 (`MAX_SIDE`) ထက် မကျော် |
| `quantize(rgba, w, h, palette, dither)` | `dither`: `'none'` / `'fs'` (Floyd–Steinberg)။ alpha < 128 → transparent (`-1`)။ ပြန်ပေးတာ `{w, h, idx: Int16Array}` |
| `buildLayers(q)` | အရောင်တစ်ခုစီရဲ့ pixel စာရင်း (row-major)၊ pixel အရေအတွက် များတာ အရင် |
| `findNext(layers, done, startLayer)` | `startLayer` ကစပြီး မဆွဲရသေးတဲ့ pixel ရှာ (ဆုံးရင် အစကို ပြန်ပတ်)၊ `{layer, pixel}` သို့ `null` |
| `encodeIdx(idx)` / `decodeIdx(str)` | pixel တစ်ခု = စာလုံးတစ်လုံး (base-36) — localStorage အတွက်၊ မမှန်တဲ့ စာလုံးပါရင် `decodeIdx` က `null` |
| `toCanvas(c, r, X0, Y0)` | `{x: X0 + c, y: Y0 − r}` |
| `parseLocation(text)` | everyonedraw URL / `x, y` / `(x, y)` ကို `{x, y}` အဖြစ် ဖတ် (မြန်မာဂဏန်း ၀–၉ ရ၊ ဒဿမ မရ)၊ မရရင် `null` |
| `siteUrl(x, y, zoom)` | `https://everyonedraw.com/{zoom}/{x}/{y}` |

## UI (index.html)

**ဘယ်ဘက် panel — setting**
- ပုံထည့်: file ရွေး / drag & drop / Ctrl+V
- အကျယ်: default 64၊ 1–512
- Dithering: None (default) / Floyd–Steinberg
- "App အရောင် ၃၂ ရောင် သုံးမယ်" checkbox (default ပိတ်)
- နေရာ: X0, Y0 ရိုက်ထည့် သို့ everyonedraw URL paste
- Jump zoom: default 40
- PNG download ခလုတ် (1x အရွယ်)

**အလွှာ စာရင်း**
- အရောင်တစ်ခုစီ: အရောင်ကွက်၊ နာမည်၊ ပြီး/စုစုပေါင်း၊ ▲▼ နဲ့ အစီအစဉ်ပြောင်း
- "အားလုံး" ကို ရွေးရင် ပုံအပြည့်ကို ပြ
- စုစုပေါင်း progress bar

**Grid**
- cell အရွယ် အလိုအလျောက် ချိန်၊ +/− နဲ့ zoom
- cell ≥ 6px ဆိုရင် grid line ပြ
- ရွေးထားတဲ့အရောင်: မဆွဲရသေး = အရောင်အပြည့်၊ ဆွဲပြီး = မှိန် + အလယ်မှာ အစက်
- တခြားအရောင်တွေ = 15% opacity၊ transparent = checker ကွက်
- လက်ရှိ target pixel = အနီရောင် outline
- Mouse တင်ရင်: canvas coordinate နဲ့ အရောင်နာမည် ပြ
- Click: ပြီး/မပြီး ပြောင်း

**"နောက် pixel" ခလုတ် (N key)**
1. လက်ရှိ target ရှိရင် "ပြီး" လို့ မှတ်
2. ရွေးထားတဲ့အလွှာထဲက မဆွဲရသေးတဲ့ နောက် pixel (row-major) ကို target လုပ်။ အလွှာ ပြီးသွားရင် နောက်အလွှာကို အလိုလို ကူး
3. `window.open(siteUrl(x, y, zoom), 'everyonedraw')` — tab တစ်ခုတည်းကို ပြန်သုံး
4. target ရဲ့ coordinate နဲ့ အရောင်ကို ကြီးကြီး ပြ

## သိမ်းဆည်းခြင်း

- `localStorage` မှာ နောက်ဆုံး session တစ်ခု သိမ်း: quantize ရလဒ် (`w, h, idx`)၊ setting တွေ၊ X0/Y0၊ အလွှာ အစီအစဉ်၊ ပြီးသွားတဲ့ pixel index တွေ
- page ပြန်ဖွင့်ရင် ပုံ ပြန်တင်စရာမလိုဘဲ ဆက်ဆွဲလို့ရ
- ပုံအသစ်တင်ရင် / အကျယ် / dithering / palette / X0,Y0 ပြောင်းရင် progress အသစ်စ (ဆွဲပြီးသားနေရာ မတူတော့လို့)
- `localStorage` အလုပ်မလုပ်ရင် (try/catch) သတိပေးစာ တစ်ခါပြပြီး သိမ်းစရာမလိုဘဲ ဆက်သုံးလို့ရ

## Error handling

- ပုံမဟုတ်တဲ့ ဖိုင် → အမှားစာ ပြ
- နေရာ မမှန်ရင် → input ကို အနီရောင်ပြ၊ "နောက် pixel" ခလုတ် ပိတ်
- ပုံမတင်ရသေးရင် → grid နေရာမှာ "ပုံထည့်ပါ" ပြ

## စစ်ဆေးခြင်း

- `node --test core.test.js`: palette အရောင်က ကိုယ့်ကိုယ်ကို ပြန်တွေ့တာ၊ resize၊ quantize (none / fs)၊ transparent ကျော်တာ၊ buildLayers၊ `toCanvas` (y အပေါ်တိုး)၊ `parseLocation` ပုံစံအမျိုးမျိုး၊ `siteUrl`
- UI: Chrome မှာ ဖွင့်ပြီး ပုံတင်၊ အလွှာပြောင်း၊ click၊ N key၊ reload ပြီး progress ကျန်လား စစ်
