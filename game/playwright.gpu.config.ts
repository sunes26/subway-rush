import { defineConfig, devices } from '@playwright/test'
/**
 * **실제 GPU** 로 도는 설정. 성능·조작감 판단은 반드시 이걸로 한다.
 *
 * 기본 `playwright.config.ts` 는 `--use-angle=swiftshader` — WebGL 을 CPU 로 그린다
 * (스크린샷이 검게 나오는 걸 막으려는 설정이다). 소프트웨어 래스터는 실제 GPU 보다
 * 수십 배 느리고 **필레이트에 과민**해서, 멀쩡한 빌드를 성능 회귀로 오진하게 만든다.
 * 실제로 두 번 그랬다 — 마감 상향 때 한 번, 발광 글로우 때 또 한 번.
 *
 *     npx playwright test -c playwright.gpu.config.ts
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 720 },
    headless: false,
    launchOptions: { args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // 이 블록이 없으면 dev 서버가 이미 떠 있을 때만 돌아간다 — 없는 상태에서 실행하면 전부 실패한다.
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
