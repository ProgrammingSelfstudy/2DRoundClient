# 引用扫描（候选，只读）

## 图片按「怎么找到的」分类

| 类别 | 张数 | MB |
|---|---|---|
| unnamed | 3113 | 413.9 |
| template | 3465 | 36.0 |
| spine-lua | 3019 | 532.1 |
| literal | 550 | 25.6 |
| linked | 13 | 1.5 |
| spine-data | 48 | 2.3 |

- literal：路径直接写在 CSB 或 Lua 里。linked：被 plist、atlas 或 skel 间接引用。template：由 Lua 的 string.format 模板和已知编号拼出。
- spine-data / spine-lua：Spine 模型编号出现在服务器数据表 / 只出现在 Lua 里（多数在配置表目录，可视为被数据引用）。
- unnamed：没有任何引用能指到它。要么路径是运行时按别的方式拼的，要么没人用。

## 1. 没有引用的图片候选（unnamed）：3113 张，413.9 MB

按最长边分桶的体积：>2048 153.4MB，<=2048 200.1MB，<=1024 46.0MB，<=512 9.8MB，<=128 4.6MB

| 名称 | 格式 | 尺寸 | 文件 MB |
|---|---|---|---|
| 3FDEB2DEBC07A571.png | png | 4096x4096 | 8.94 |
| 9FEF17988CB317F2.png | png | 4015x2057 | 7.54 |
| B5BE856B3E124361.png | png | 3903x3330 | 6.77 |
| 76D80889F06AB9D4.png | png | 4079x2387 | 6.40 |
| 89CAEE2CD6F97056.png | png | 4033x2207 | 5.03 |
| 0BF0EC791ADDE50B.png | png | 8124x5618 | 4.58 |
| 29A700F79EBD5406.png | png | 3677x2499 | 4.48 |
| 0B53B6248BB5CC46.png | png | 3852x3848 | 4.13 |
| C29A93AB7B7C67F6.png | png | 3283x3225 | 3.79 |
| 2FFF34FD014E5EC9.png | png | 3882x1484 | 3.66 |
| C5180AE769D297C1.png | png | 3442x1346 | 3.56 |
| D38135B82794AF52.png | png | 4096x4096 | 3.54 |
| 7276C2CC8C56D29F.png | png | 3826x3174 | 3.34 |
| 74B24A979AC08CAE.webp | webp | 4096x4096 | 3.33 |
| 878A5B354E78974C.webp | webp | 4096x4096 | 3.31 |
| CD4611486DEC07A2.png | png | 1607x1962 | 2.91 |
| 8690FFCBBCCD8E93.png | png | 3848x3848 | 2.80 |
| 24D94D983951A107.png | png | 2046x2048 | 2.59 |
| A5245B90AC4823A4.png | png | 2036x2046 | 2.50 |
| 9D95D4ECF630C846.png | png | 2004x2042 | 2.26 |
| DD3A4D3DC3FB6FCB.png | png | 1607x1962 | 2.24 |
| B0C2A11F856EC5A5.png | png | 4096x4096 | 2.18 |
| F047F6C1079D15C9.png | png | 1528x1484 | 2.13 |
| F71BCDA0D45A8A80.png | png | 1607x1962 | 2.11 |
| 55238F3A98C7B809.png | png | 1528x1528 | 2.05 |
| 53A51B1886A0BD1D.png | png | 2048x2048 | 2.04 |
| EED39155F736BDB8.png | png | 2048x2048 | 2.03 |
| E51BF2F3F8593372.png | png | 2019x1574 | 2.03 |
| 16FEBC91CF2A3CF6.png | png | 7970x5924 | 2.03 |
| 903CAADC63699617.webp | webp | 4065x2087 | 1.98 |
| B649F5968A4144F5.png | png | 2048x2047 | 1.98 |
| 248BB8F5D34F5945.png | png | 2044x2041 | 1.93 |
| 6E7C6484B3D5A2BA.png | png | 2030x1665 | 1.87 |
| 46A13ED3EBAC7DA7.png | png | 3696x3078 | 1.82 |
| 594C5CB082E6653E.webp | webp | 2548x2054 | 1.74 |
| 885D10DD3B6B8E08.png | png | 1528x1528 | 1.74 |
| 714C11D4AF7CBAE5.png | png | 1176x2054 | 1.73 |
| 855A7BB2DA5C505B.png | png | 2047x2047 | 1.73 |
| A040159B6373E964.png | png | 2040x2048 | 1.72 |
| 75DBFD1BE81D9EA8.webp | webp | 4096x2048 | 1.69 |
| 16D84B11DEB50989.webp | webp | 2533x2084 | 1.67 |
| C9FEE855766D0613.webp | webp | 4024x2359 | 1.64 |
| AF22986D5ED29163.png | png | 1860x1854 | 1.63 |
| 0665B51406469434.png | png | 1962x1072 | 1.60 |
| 85770288AB48E794.png | png | 2047x1927 | 1.58 |
| 65F70EEDD24E8DF6.png | png | 1861x2046 | 1.57 |
| A2117A6D200A362E.png | png | 2444x1021 | 1.55 |
| 15840ACBE1C9CF8C.png | png | 2048x2048 | 1.52 |
| F7BA31997CD156EF.png | png | 1974x1730 | 1.50 |
| CDFCF85AEAB526CE.png | png | 938x2073 | 1.50 |
| A8812B17562AE2E1.png | png | 2887x836 | 1.48 |
| F3E53BD7AF78F60E.webp | webp | 3648x1842 | 1.48 |
| 3D0495C74E34FD12.webp | webp | 2048x2048 | 1.46 |
| 49F5CF6322F53EAB.png | png | 1869x1912 | 1.44 |
| 794DD8B7A43CDF72.webp | webp | 2048x2048 | 1.39 |
| 69CA94D356B80A6A.png | png | 1515x1528 | 1.38 |
| 9532B3FD20DDB5F2.webp | webp | 2048x2048 | 1.34 |
| 44401F19605B9D92.webp | webp | 4096x2048 | 1.33 |
| 552D57302082B899.png | png | 2048x2048 | 1.28 |
| D4E383B5C0C76A75.png | png | 2048x2047 | 1.28 |

## 2. plist 图集里没有被引用的小图帧

- 190 个图集，3177 帧，其中 464 帧（14%）没被引用，占图集像素面积的 18%。

| 图集 | 帧数 | 未引用帧 | 未引用面积占比 |
|---|---|---|---|
| resource/startower/startower.plist | 41 | 18 | 65% |
| resource/partnersummon/partnersummon.plist | 76 | 41 | 50% |
| resource/firstcharge/firstcharge.plist | 9 | 3 | 83% |
| resource/actionyearmonster/actionyearmonster_ch.plist | 21 | 3 | 65% |
| resource/element/element.plist | 28 | 10 | 67% |
| resource/newpartnersummon/newpartnersummon.plist | 18 | 4 | 36% |
| resource/tips/tips.plist | 22 | 4 | 47% |
| resource/form/form.plist | 17 | 6 | 74% |
| resource/welfare/welfare.plist | 108 | 30 | 20% |
| resource/vip/vip.plist | 52 | 17 | 25% |
| resource/seerpalace/seerpalace.plist | 19 | 5 | 61% |
| resource/pokedex/pokedex.plist | 45 | 9 | 33% |
| resource/actionsevenlogin/actionsevenlogin.plist | 16 | 7 | 46% |
| resource/primus/primus.plist | 13 | 7 | 60% |
| resource/startwork/startwork.plist | 6 | 3 | 83% |
| resource/guildboss/guildboss.plist | 34 | 12 | 48% |
| resource/exchange/exchange.plist | 14 | 8 | 61% |
| resource/dramachapter/dramachapter.plist | 8 | 1 | 25% |
| resource/monopoly/monopolyboard.plist | 32 | 9 | 36% |
| resource/hero/partnercombo.plist | 10 | 9 | 61% |
| resource/onecent/onecent.plist | 4 | 2 | 78% |
| resource/guildactive/guildactive.plist | 8 | 6 | 66% |
| resource/newfirstcharge1/newfirstcharge1.plist | 10 | 1 | 24% |
| resource/hero/hero.plist | 87 | 30 | 11% |
| resource/mall_charge/mall_charge.plist | 30 | 6 | 29% |
| resource/mainui/mainui.plist | 91 | 19 | 12% |
| resource/mall_skin/mall_skin.plist | 12 | 2 | 38% |
| resource/battle/battle.plist | 56 | 18 | 21% |
| resource/godbattle/godbattle.plist | 29 | 9 | 17% |
| resource/animateaction/animateaction_yaunzhen.plist | 14 | 3 | 5% |
