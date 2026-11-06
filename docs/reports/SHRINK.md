# 按实际显示尺寸估算的缩小空间（只读估算）

假设文件体积与像素数成正比；设计分辨率 720x1280，scale=1.0 即刚好按显示尺寸，1.5 留给高密度屏幕。只统计 CSB 布局里的引用。

## scale 1.0

- 单独的图：130 张，4.0 MB → 3.8 MB（省 0.2 MB）
- 图集页：189 个，9.9 MB → 9.4 MB（省 0.5 MB）

## scale 1.5

- 单独的图：130 张，4.0 MB → 3.9 MB（省 0.1 MB）
- 图集页：189 个，9.9 MB → 9.7 MB（省 0.2 MB）

## 单独的图里缩小空间最大的 30 张（scale 1.0）

| 路径 | 原尺寸 | 显示尺寸 | 原 MB | 估算 MB |
|---|---|---|---|---|
| resource/item/42.png | 105x105 | 37x37 | 0.03 | 0.00 |
| resource/item/10411.png | 105x105 | 59x59 | 0.03 | 0.01 |
| resource/bigbg/bigbg_93.png | 184x208 | 2x2 | 0.01 | 0.00 |
| resource/bigbg/bigbg_94.png | 612x761 | 6x8 | 0.01 | 0.00 |
| resource/bigbg/bigbg_12.png | 466x307 | 720x35 | 0.01 | 0.00 |
| resource/item/13.png | 105x105 | 32x32 | 0.00 | 0.00 |
| resource/item/17.png | 105x105 | 32x32 | 0.00 | 0.00 |
| resource/item/10405.png | 105x105 | 45x45 | 0.00 | 0.00 |
| resource/item/1.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/item/2.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/item/10407.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/item/10301.png | 105x105 | 52x52 | 0.00 | 0.00 |
| resource/item/7.png | 105x105 | 52x52 | 0.00 | 0.00 |
| resource/item/37004.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/item/3.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/item/4.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/item/19.png | 105x105 | 37x37 | 0.00 | 0.00 |
| resource/item/34.png | 105x105 | 37x37 | 0.00 | 0.00 |
| resource/item/18.png | 105x105 | 52x52 | 0.00 | 0.00 |
| resource/item/41.png | 80x80 | 32x32 | 0.00 | 0.00 |
| resource/item/15.png | 105x105 | 52x52 | 0.00 | 0.00 |
| resource/item/21.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/item/10.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/item/30.png | 105x105 | 37x37 | 0.00 | 0.00 |
| resource/item/37003.png | 105x105 | 42x42 | 0.00 | 0.00 |
| resource/bigbg/action/txt_cn_action_eight_login_title.png | 566x77 | 419x76 | 0.01 | 0.01 |
| resource/item/10601.png | 105x105 | 63x63 | 0.00 | 0.00 |
| resource/item/10014.png | 90x90 | 31x31 | 0.00 | 0.00 |
| resource/item/10603.png | 105x105 | 73x73 | 0.00 | 0.00 |
| resource/item/10004.png | 90x90 | 54x54 | 0.00 | 0.00 |

## 图片在 resource/ 下有名字，但没有出现在任何 CSB 布局里（可能由代码加载）：3866 张，57.2 MB，见 no_layout_use.json

