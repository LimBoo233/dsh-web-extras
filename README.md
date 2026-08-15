# dsh-web-extras

DeepSeek Harness Web 界面增强插件（bundle），包含两个功能：

1. **完成提醒**：会话完成时播放提示音，并可弹出立绘图片（支持上传/裁剪/翻转）。
2. **外观定制**：背景图（URL / 本地图片 + 水平翻转 + 预览 + 缩放 + 位置 + 透明度）、侧边栏/气泡/输入区/代码块透明度、输入区失焦折叠。

纯浏览器端实现（client 插件），无 Host 侧代码；所有配置与图片数据保存在本地浏览器，不经过任何服务器。

## 安装

要求：已安装 DeepSeek Harness CLI，并使用 Web 界面（`dsh --profile web`）。

### 方式一：GitHub（源码安装，自动构建）

```sh
dsh plugin --profile web add github:<你的用户名>/dsh-web-extras
```

首次安装时 pnpm 会要求允许构建脚本（pnpm ≥ 10）。若失败，按提示把包名加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 后重试：

```yaml
allowBuilds:
  dsh-web-extras: true
```

> 这是对包内代码的信任授权：仅安装你信任来源的包，并建议固定 commit（`github:<你的用户名>/dsh-web-extras#<sha>`）。

### 方式二：tarball

```sh
git clone <你的仓库地址>
cd dsh-web-extras
pnpm install
pnpm pack          # 生成 dsh-web-extras-0.1.0.tgz
dsh plugin --profile web add ./dsh-web-extras-0.1.0.tgz
```

### 方式三：npm（若已发布）

```sh
dsh plugin --profile web add dsh-web-extras
```

安装后**重启 dsh**（或重建前端产物），刷新浏览器页面即可生效。

### 卸载

```sh
dsh plugin --profile web remove dsh-web-extras
```

## 使用

安装后浏览器设置页会出现两个新入口：

- 设置 → **完成提醒**：提示音开关、试听、立绘开关、上传/替换/移除立绘、拖动缩放 + 水平翻转 + 遮罩裁剪（高分辨率输出）。
- 设置 → **外观**：背景图 URL/本地图片、水平翻转、与窗口同比例的实时预览（拖拽定位、滚轮缩放）、缩放模式、位置、背景图透明度；展开「高级选项」可调侧边栏/气泡/输入区/代码块透明度与输入区折叠。

完成提醒触发时机：任意会话从「运行中」转为「空闲」时（右下角弹出，5 秒自动消失，点击可关闭）。

## 数据与隐私

| 数据 | 存储位置 | 说明 |
|---|---|---|
| 完成提醒设置 | localStorage `dsh-ntfy-config` | 开关状态 |
| 立绘图片内容 | IndexedDB `dsh-ntfy-store` | 上传/裁剪后的图片，刷新后自动恢复 |
| 外观设置 | localStorage `dsh-styl-config` | 全部数值与开关 |
| 本地背景图片内容 | IndexedDB `dsh-styl-store` | 刷新后自动恢复，无需重选 |

全部数据仅存于本浏览器，清除浏览器数据（或更换浏览器/电脑）后丢失；插件不含任何网络请求，提示音由 Web Audio 实时合成，不依赖音频文件。

## 兼容性说明

- 背景图**水平翻转**对本地图片无限制；对 URL 图片要求图片服务器允许跨域读取（CORS），否则自动降级为原图并在设置页提示。
- 浏览器无法读取本地文件的真实路径，因此「记住图片」通过把图片内容存入 IndexedDB 实现，效果等同免重选。

## 开发

```sh
pnpm install
pnpm build        # 生成 lib/index.js（Node 半）+ lib/client.js（浏览器半）
```

构建用 esbuild，自包含、不依赖 DeepSeek Harness 源码仓库。浏览器 bundle 格式与官方 client 插件一致（`window.__ModuleLoader__.load` factory + 平台模块 external）。

## 许可证

MIT
