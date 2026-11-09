# Everyone Draw ပုံဆွဲအကူ — Chrome Extension (Overlay) Design

ဒီ design က `2026-11-09-everyone-draw-helper-design.md` (local page + N key) ကို အစားထိုးတယ်။

## ဘာကြောင့် ပြောင်းလဲ

local page ကနေ N နှိပ်ရင် everyonedraw ကို page ပြန် load ပြီး target pixel ကို screen အလယ်ချပေးတာ — ဘယ်ကွက်ကို click ရမလဲ site ပေါ်မှာ အမှတ်အသား မရှိလို့ user က ဘယ်ရောက်နေမှန်း မသိဘူး။

## ရည်ရွယ်ချက်

everyonedraw page ပေါ်မှာပဲ:
- site ကို ပုံမှန်အတိုင်း သုံးလို့ရနေရမယ် (pan, zoom, အရောင်ရွေး, click)
- ကိုယ့်ပုံကို canvas ပေါ်မှာ ဖောက်ထွင်းမြင်ရအောင် နေရာအတိအကျမှာ ထပ်ပြမယ်
- ကိုယ့် panel (ပုံထည့်၊ နေရာ၊ အရောင်၊ progress) ကို site ပေါ်မှာ ပြမယ်

**မလုပ်တာ:** pixel ကို အလိုအလျောက် မချဘူး၊ site ကို click / request မပို့ဘူး။ အရောင်ရွေးတာ၊ click တာ user ကိုယ်တိုင်။

## Site အချက်အလက် (2026-11-09 စစ်ပြီး)

- canvas 6 ခု (2D, `fixed top-0 z-[-1]`, viewport အရွယ်): 0 = background block, 1 = pixel tile, 2 = live pixel (ပုံမှန် ဖောက်ထွင်း), 3 = grid line, 4 = hover preview, 5 = input
- canvas 0 ကို view ပြောင်းတိုင်း 128×128 world-pixel block တွေကို `fillRect(dx, dy, 128·zoom, 128·zoom)` နဲ့ ဆွဲတယ်။ block အစွန်းတွေက x, y နှစ်ခုလုံးမှာ `128k + 64` ပေါ်ကျတယ် (zoom 1, 13, 40 မှာ စစ်ပြီး)
- y က အပေါ်ကို တိုး။ Share ခလုတ် `Share (x, y)` က screen အလယ် pixel ကို live ပြတယ်။ URL `/{zoom}/{x}/{y}` က pan ပြီး ~1s မှ update၊ integer ပဲ
- canvas တွေ taint မဖြစ်ဘူး — `getImageData` နဲ့ အရောင်ဖတ်လို့ရ
- route ပြောင်းရင် page အပြည့် reload ဖြစ်တယ်

## View transform

pixel X ရဲ့ ဘယ်အစွန်း = `ax + X·zoom`၊ row Y ရဲ့ အပေါ်အစွန်း = `ay − Y·zoom` (CSS px)။
block fillRect တစ်ခု + screen အလယ် pixel ခန့်မှန်းချက် (အရင် view / Share / URL) ကနေ block ရဲ့ k ကို round လုပ်ပြီး အတိအကျ တွက်တယ်။ Share နဲ့ 32 pixel ထက်ကွာရင် Share နဲ့ ပြန်တွက်၊ မကိုက်သေးရင် view = မသိ (overlay ဖျောက်)။

## ဖိုင်များ (project folder = unpacked extension)

| ဖိုင် | တာဝန် |
|---|---|
| `manifest.json` | MV3, `https://everyonedraw.com/*` မှာ `world: MAIN` content script |
| `core.js` | logic သက်သက် (ရှိပြီးသား + view math + detect + findNearest) |
| `site.js` | site adapter — canvas 0 fillRect ကို စောင့်ကြည့်ပြီး view တွက်၊ canvas 0–2 အရောင်ဖတ် |
| `overlay.js` | ကိုယ့် canvas (site canvas တွေနောက်၊ `pointer-events:none`) ပေါ်မှာ ပုံဆွဲ |
| `panel.js` | shadow DOM panel၊ state၊ localStorage၊ detection loop |
| `README.md` | install / သုံးနည်း (မြန်မာ) |

`index.html`, `app.js` ကို ဖျက်မယ်။

## Overlay

- ရွေးထားတဲ့အရောင် (မဆွဲရသေး) = 65% opacity၊ zoom ≥ 8 မှာ ကွက်တိုင်း အမည်း/အဖြူ border
- တခြားအရောင် (မဆွဲရသေး) = 30% opacity
- site ပေါ်မှာ မှန်ပြီးသား ကွက် = မဆွဲ (site ရဲ့ အစစ်ကို မြင်ရ)
- ပုံဘောင် = အနီ dashed
- "နောက်တစ်ကွက် ရှာ" — screen ပေါ်မှာရှိရင် အနီဘောင် ၃ စက္ကန့် လှုပ်ပြ၊ မရှိရင် site ကို အဲကွက်ဆီ reload

## အလိုအလျောက် စစ်တာ

zoom ≥ 2 ဖြစ်ရင် screen ပေါ်က ကွက်တိုင်းရဲ့ အလယ်ကို canvas 2 → 1 → 0 အစဉ်နဲ့ ဖတ် (alpha 255 ပထမဆုံးတစ်ခု)။ target အရောင်နဲ့ တူရင် "ပြီး"၊ မတူရင် "မပြီး" (တခြားသူ ဖျက်သွားရင်လည်း ပြန်ပေါ်)။ မဖတ်နိုင်တဲ့ ကွက် = အရင်အတိုင်း။ view ပြောင်းပြီး 250ms၊ click ပြီး 400ms၊ ၁.၅ စက္ကန့်တိုင်း စစ်။

## Panel

ဘယ်ဘက်အပေါ် (ဆွဲရွှေ့ရ၊ ချုံ့ရ)။ ၁။ ပုံ (file / drag / Ctrl+V, အကျယ် default 64, dithering, ၃၂ ရောင်) ၂။ နေရာ (x, y = ဘယ်အပေါ်ထောင့်၊ "screen အလယ်မှာ ထားမယ်") ၃။ အရောင်စာရင်း (ကျန်တဲ့အရေအတွက်) + လက်ရှိအရောင် + "နောက်တစ်ကွက် ရှာ" + overlay ပြ/ဖျောက် ၄။ progress + ပုံဖယ်။
site ရဲ့ keyboard/mouse shortcut တွေ မထိအောင် panel ထဲက event တွေကို site ဆီ မရောက်အောင် တားတယ်။

## သိမ်းဆည်းခြင်း

everyonedraw.com ရဲ့ `localStorage['edhelper.v2']` — ပုံ (encodeIdx)၊ setting၊ origin၊ active အရောင်၊ matched (`0`/`1` string)၊ panel နေရာ။ reload ရင် ပြန်ရ။ source ပုံ မသိမ်းလို့ reload ပြီးရင် setting ပြောင်းဖို့ ပုံ ပြန်ထည့်ရ။

## စစ်ဆေးခြင်း

- `node --test core.test.js` — view math ကို site မှာ တကယ်တိုင်းထားတဲ့ ဂဏန်းတွေ (zoom 1/13/40, hover cell) နဲ့ စစ်
- browser: site page ထဲကို script တွေ inject ပြီး overlay နေရာ၊ pan/zoom လိုက်တာ၊ panel ကို စစ်
