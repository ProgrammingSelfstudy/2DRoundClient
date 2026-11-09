# 路径规范

代码进 git，图片和产物不进 git。三个目录并列放在 `~/Documents/code/` 下。

```
2DRoundServer/     服务器和后台
2DRoundClient/     客户端代码（本仓库）
  mini/            小游戏和网页（Cocos Creator + TypeScript）
  web/             TS 网页开发页（连服务器、协议对拍）
  app/             App（Axmol + Lua）。暂缓，目前不存在
  shared/core/     C++ 核心。规划中，目前不存在；网页端不需要（战斗表现的计算放在 mini/assets/scripts/skillplan.ts，纯 TS），原生包才可能用到
  shared/protogen/ 协议代码生成器
  pipeline/        资源处理脚本；dashboard/ 是进度页和预览页的源文件
  docs/            本文档；docs/reports/ 是各步骤的汇总报告
2DRoundAssets/     图片和产物，不进 git
  source/          原始输入，只读：decrypted-images.zip、restored-source（都是指向原位置的链接，不复制）
  work/            临时文件（抽样、编码中间件），可随时删除
  reports/         体检、引用、分包的数据文件；进度页由这里提供服务
  build/<版本>/    每次构建的产物，一个版本一个目录
```

## 构建产物和 CDN

```
build/<版本>/
  manifest.<平台>.json              逻辑路径 -> hash、大小、所属分组、原版路径
  f/<hash 前 2 位>/<hash>.<后缀>      文件本体，按内容 hash 命名，永不改动，可长期缓存
CDN：{cdn_base}/<平台>/<版本>/manifest.<平台>.json
     {cdn_base}/f/<前2位>/<hash>.<后缀>
```

服务器后台的 `client_release.manifest_url` 指向清单；发布和回滚只是切换清单，文件本身不动。

## 代码里用的逻辑路径

| 类型 | 逻辑路径 | 对应原版 |
|---|---|---|
| 登录和首包 | `boot/...` | `resource/login/` |
| 通用界面图集 | `ui/common/...` | `resource/common/` |
| 界面模块 | `ui/<模块>/<名>.webp` | `resource/<模块>/` |
| 图标 | `icons/<类别>/<编号>.webp`（item、skill、head、headcircle、function、partner） | `resource/item/` 等 |
| 背景 | `bg/<名>.webp` | `resource/bigbg/` |
| 英雄 Spine | `spine/hero/<模型>/<动作>.<后缀>` | `v9o8…/H…/` |
| 特效和怪物 Spine | `spine/fx/<模型>/<动作>.<后缀>` | `v9o8…/E…/` |

原版目录名 `v9o8qm1Y40cbOAlh6LDp0kMDi5CzXlsO` 在新客户端里不保留。清单的 `src` 字段记着原路径，方便对照抓包。

## 常用命令

```
ASSETS=~/Documents/code/2DRoundAssets
SRC=$ASSETS/source/restored-source
python3 -I pipeline/audit.py $ASSETS/source/decrypted-images.zip $ASSETS/reports
python3 -I pipeline/resmap.py $SRC $ASSETS/reports/audit.json $ASSETS/reports
python3 -I pipeline/refs.py $SRC $ASSETS/reports
python3 -I pipeline/csb.py $SRC $ASSETS/reports
python3 -I pipeline/dedupe.py $ASSETS/reports
python3 -I pipeline/bundles.py $SRC $ASSETS/reports
python3 -I pipeline/status.py $ASSETS/reports
sh pipeline/sync_docs.sh        # 把 reports 下的 .md 汇总同步到 docs/reports
```

进度页：`python3 -m http.server 8765 --bind 127.0.0.1 --directory $ASSETS/reports`，打开 http://127.0.0.1:8765/index.html 。
