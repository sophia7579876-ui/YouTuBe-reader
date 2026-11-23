import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const shots = process.env.ATLAS_SCREENSHOTS
test('real search → filters and export → detail → replies, next page and transcript', async ({page, context}) => {
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('request', req => {
    if (req.url().startsWith('http') && !req.url().startsWith('http://127.0.0.1:')) external.push(req.url())
  })
  await page.goto('/')
  await expect(page).toHaveTitle('Video Atlas · 视频图谱')
  await expect(page.getByRole('heading',{name:'视频搜索',exact:true})).toBeVisible()
  await expect(page.getByText('开始搜索',{exact:true})).toBeVisible()
  await page.getByLabel('搜索关键词').fill('Claude Code')
  await page.getByLabel('结果数量').selectOption('100')
  await page.getByRole('button',{name:'搜索',exact:true}).click()
  await expect(page.getByRole('table').locator('tbody tr').first()).toBeVisible()
  await expect(page.getByText('仅对已获取结果排序',{exact:false})).toBeVisible()

  const json = page.waitForEvent('download')
  await page.getByRole('button',{name:'JSON',exact:true}).click()
  const exportJson = await json
  const payload = JSON.parse(await readFile((await exportJson.path())!,'utf8'))
  expect(payload.videos.length).toBeGreaterThan(20)
  expect(payload.videos.every((v: {id:string;views:number;publishedAt:string}) =>
    /^[\w-]{11}$/.test(v.id) && v.views >= 0 && !!v.publishedAt)).toBe(true)
  await expect(page.locator('.videos-table tbody img').first()).toHaveJSProperty('complete',true)
  const thumbnail = page.locator('.videos-table tbody img').first()
  expect(await thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  const csv = page.waitForEvent('download')
  await page.getByRole('button',{name:'CSV',exact:true}).click()
  expect(await readFile((await (await csv).path())!,'utf8')).toContain('video_id,title,url,channel')
  await page.getByLabel('最低播放量').fill('999999999999')
  await expect(page.getByText('没有匹配的视频',{exact:true})).toBeVisible()
  await page.getByLabel('最低播放量').fill('')
  await page.getByLabel('排序',{exact:true}).selectOption('publishedAt')
  await expect(page.getByRole('columnheader',{name:'发布日期'})).toHaveAttribute('aria-sort','descending')
  await page.getByRole('button',{name:'发布日期',exact:true}).click()
  await expect(page.getByRole('columnheader',{name:'发布日期'})).toHaveAttribute('aria-sort','ascending')
  await page.getByLabel('排序',{exact:true}).selectOption('views')
  await page.getByLabel('发布时间',{exact:true}).selectOption('7')
  await expect(page.getByLabel('发布时间',{exact:true})).toHaveValue('7')
  await page.getByLabel('发布时间',{exact:true}).selectOption('0')

  if (shots) {
    await expect.poll(() => page.locator('.videos-table tbody img').evaluateAll(elements =>
      elements.filter(e => (e as HTMLImageElement).naturalWidth > 0).length), {timeout:30_000}).toBeGreaterThanOrEqual(4)
    await page.screenshot({path:join(shots,'search.png')})
  }
  await page.getByRole('navigation').getByRole('link',{name:'数据分析',exact:true}).click()
  await expect(page.getByRole('heading',{name:'发布时间分布'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'评论数分布'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'播放量 Top 20'})).toBeVisible()
  if (shots) await page.screenshot({path:join(shots,'analysis.png')})
  await page.getByRole('navigation').getByRole('link',{name:'视频搜索',exact:true}).click()

  const exactVideo = page.locator('a[href*="/video/ntDIxaeo3Wg"]:not([aria-hidden])').first()
  for (let i = 0; i < 7 && !(await exactVideo.count()); i++) {
    const next = page.getByRole('button',{name:'下一页'})
    if (!(await next.isEnabled())) break
    await next.click()
  }
  await expect(exactVideo).toBeVisible()
  await exactVideo.click()
  await expect(page.getByRole('heading',{name:/Claude Code - Full Tutorial/})).toBeVisible()
  await expect(page.locator('.metrics-strip .stat').nth(0).locator('strong')).toHaveText(/\d/)
  await expect(page.locator('.metrics-strip .stat').nth(2).locator('strong')).toHaveText(/\d/)

  const topRows = page.locator('ol[aria-label="评论列表"] > li')
  await expect(topRows).toHaveCount(20)
  const popularAuthor = await topRows.first().locator('.comment-byline strong').textContent()
  await page.getByRole('button',{name:/查看回复/}).first().click()
  await expect(page.getByRole('list',{name:'评论回复'}).first().locator('li').first()).toBeVisible()
  const paging = page.waitForResponse(response => response.url().includes('cursor=') && response.url().includes('/comments'))
  await page.getByRole('button',{name:'加载更多评论',exact:true}).click()
  expect((await paging).ok()).toBe(true)
  await expect(topRows).toHaveCount(40)
  await page.getByLabel('搜索已加载评论').fill('!@@unmatched@@!')
  await expect(page.getByText('已加载评论中没有匹配内容',{exact:true})).toBeVisible()
  await page.getByLabel('搜索已加载评论').fill('')
  if (shots) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({path:join(shots,'comments.png')})
  }
  await page.getByLabel('评论排序').selectOption('new')
  await expect(topRows).toHaveCount(20)
  await expect(topRows.first().locator('.comment-byline strong')).not.toHaveText(popularAuthor ?? 'unknown')

  await page.getByRole('button',{name:/^字幕/}).click()
  await expect(page.getByLabel('字幕语言')).toBeVisible()
  await expect(page.getByRole('list',{name:'转录文本'}).locator('time').first()).toHaveText(/\d\d:\d\d:\d\d\.\d{3}/)
  await page.getByText('完整字幕文本',{exact:true}).click()
  await expect(page.locator('.full-transcript pre')).toHaveText(/\S{8}/)
  expect(await page.locator('.full-transcript pre').textContent()).not.toMatch(/<\d\d:\d\d(?::\d\d)?\.\d{3}>/)
  if (shots) await page.screenshot({path:join(shots,'transcript.png')})
  const textDownload = page.waitForEvent('download')
  await page.getByRole('button',{name:'导出 TXT'}).click()
  const contents = await readFile((await (await textDownload).path())!,'utf8')
  expect(contents).toMatch(/^\[\d\d:\d\d:\d\d\.\d{3}\] \S/)
  await context.grantPermissions(['clipboard-read','clipboard-write'])
  await page.getByRole('button',{name:'复制全文'}).click()
  await expect(page.getByText('已复制',{exact:true})).toBeVisible()

  await page.getByRole('navigation').getByRole('link',{name:'数据源状态',exact:true}).click()
  await expect(page.getByRole('heading',{name:'已配置来源'})).toBeVisible()
  await expect(page.getByText('请求成功率',{exact:true})).toBeVisible()
  expect(errors).toEqual([])
  expect(external).toEqual([])
})

test('mobile layout keeps navigation and active inputs within the viewport', async ({page}) => {
  await page.setViewportSize({width:390,height:844})
  await page.goto('/')
  await expect(page.getByRole('navigation')).toBeVisible()
  await expect(page.getByLabel('搜索关键词')).toBeVisible()
  await expect(page.getByRole('button',{name:'搜索',exact:true})).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  if (shots) await page.screenshot({path:join(shots,'mobile.png')})
})
