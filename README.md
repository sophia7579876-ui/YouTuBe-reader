# Video Atlas · 视频图谱

用公开 API 搜索 YouTube 视频，查看统计、评论、回复和带时间戳的字幕。用同一批结果做筛选、分析和导出。应用无需账号或 YouTube API Key，页面没有播放器。

## 一键启动

需要 Node.js **24.5 或更高版本**（建议当前最新的 Node 24 LTS）、npm，以及可访问所选公开 API 的网络。支持 macOS 和 Linux。

```sh
npm ci && npm run dev
```

打开 **http://127.0.0.1:5173**。开发命令同时启动 Vite 和 Fastify。生产构建由同一个 Fastify 进程提供页面与 API。

```sh
npm ci && npm run build && npm start
```

生产地址为 **http://127.0.0.1:3000**。应用默认监听回环地址。按 `Ctrl+C` 关闭。

## 使用

1. 输入 `AI Agent`、`Claude Code`、`OpenAI Codex`、`AI automation` 或中文关键词。选择 20、50、100 条及视频类型，随后搜索。时间和最低播放量过滤随改随用。表头可切换升序／降序，范围是已获取样本。
2. 列表先呈现搜索直接可用的统计，依次查询前 3 条的点赞和评论数。需要更多时点击 **补齐点赞和评论数**。补齐遵守上游限速，100 条可能需要数分钟，支持停止。未知值显示为 `—`。
3. 点击标题打开详情，展开回复或加载下一页。评论关键词筛选只作用于已经加载的内容。字幕页可换轨、复制全文和导出带时间戳的 TXT。
4. **数据分析** 使用当前筛选的结果。**数据源状态** 显示配置、最近请求、错误、缓存和回退计数。
5. **JSON／CSV** 按当前筛选和排序导出全量已取结果，包含单字段来源和采集时间。CSV 中未知值为空，JSON 中为 `null`。

## 配置

启动命令读取进程环境变量。可运行 `PORT=8080 npm start` 更改生产监听端口。

| 变量 | 默认值 |
| --- | --- |
| `INVIDIOUS_URL` | `https://yt.chocolatemoo53.com` |
| `PIPED_URL` | `https://api.piped.private.coffee` |
| `PIPED_MEDIA_URL` | `https://proxy.piped.private.coffee` |
| `ATLAS_DB` | `.data/atlas.sqlite` |
| `PORT` / `HOST` | `3000` / `127.0.0.1`，生产 |
| `WEB_PORT` / `API_PORT` / `WEB_HOST` | `5173` / `3000` / `127.0.0.1`，开发 |

公开实例由其运营者维护。可配置经运营方允许的实例。使用自建 Piped 时一并配置其媒体代理 origin。现有 HTTP 出站代理由 Node 的 `--use-env-proxy` 使用。SQLite 默认保存在本机，数据库和构建缓存都可重新生成。

## 验证

```sh
npm test
npm run build

# 使用已安装的 Chromium 时可设置 CHROMIUM_PATH=/path/to/chromium
npx playwright install chromium
npm run test:browser
```

`npm run test:live` 会串行请求真实公开端点，完成 4 × 100 搜索、10 个视频的评论和 5 个字幕样本，可能需要数分钟。`npm run test:fallback` 在可控主源故障下向真实 Piped 请求。两项会更新文档目录中的对应 JSON，可用 `ATLAS_LIVE_REPORT` 和 `ATLAS_FALLBACK_REPORT` 重定向。Playwright 也用真实网络或同一环境之前采集的有效缓存。测试会随视频状态、排行及实例可用性变化。
运行 `npm run test:features` 可额外验证普通视频、Shorts 受限、无字幕和关闭评论的对照。

[实测与验收](docs/benchmark.md) · [架构](docs/architecture.md) · [数据质量](docs/data-quality.md)
