import { chromium } from '@playwright/test'
import { createServer } from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../dist')
const screenshotDir = path.resolve(__dirname, '../screenshots')

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true })
}

// Simple static file server for dist/
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const server = createServer((req, res) => {
  let reqPath = req.url.split('?')[0]
  if (reqPath === '/') reqPath = '/index.html'

  // Handle mock health endpoint
  if (reqPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', keys_configured: 2, cache_enabled: true, model: 'gemini-2.0-flash', failure_simulation: true }))
    return
  }

  const filePath = path.join(distDir, reqPath)
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
  } else {
    // Fallback to index.html for SPA
    const indexHtml = path.join(distDir, 'index.html')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    fs.createReadStream(indexHtml).pipe(res)
  }
})

const PORT = 4179

server.listen(PORT, async () => {
  console.log(`Server listening at http://localhost:${PORT}`)
  const browser = await chromium.launch({ headless: true })
  const widths = [320, 375, 768, 1024, 1440]

  try {
    for (const width of widths) {
      const page = await browser.newPage({
        viewport: { width, height: 850 },
      })

      await page.goto(`http://localhost:${PORT}`)
      await page.waitForSelector('[data-testid="chat-input"]')

      // Check horizontal overflow
      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth
        const scrollWidth = document.documentElement.scrollWidth
        const bodyScrollWidth = document.body.scrollWidth
        return {
          docWidth,
          scrollWidth,
          bodyScrollWidth,
          hasOverflow: scrollWidth > docWidth || bodyScrollWidth > docWidth,
        }
      })

      console.log(`Width ${width}px overflow check:`, overflow)

      const ssPath = path.join(screenshotDir, `viewport-${width}.png`)
      await page.screenshot({ path: ssPath, fullPage: false })
      console.log(`Saved screenshot: ${ssPath}`)
      await page.close()
    }
  } catch (err) {
    console.error('Error during responsive tests:', err)
  } finally {
    await browser.close()
    server.close()
    console.log('Finished responsive checks.')
  }
})
