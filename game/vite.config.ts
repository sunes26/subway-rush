import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    reportCompressedSize: true,
    rollupOptions: {
      /**
       * 두 페이지를 같이 뽑는다.
       *  · `index.html`  — 게임
       *  · `uikit.html`  — UI 킷 작업대 (`/uikit.html`)
       *
       * 킷을 별도 프로젝트로 떼지 않은 이유: **같은 CSS·같은 UI 코드**를 읽어야
       * 여기서 다듬은 것이 게임에 그대로 들어간다. 레포를 나누면 그 순간
       * 두 번째 원천이 생기고, 색 하나를 고칠 때마다 양쪽을 맞춰야 한다.
       */
      // 경로는 root(=프로젝트 디렉터리) 기준 상대 경로다.
      // `node:path` 를 쓰면 tsconfig 에 node 타입이 없어 typecheck 가 깨진다
      input: { main: 'index.html', uikit: 'uikit.html' },
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  server: { port: 5173, host: '127.0.0.1' },
})
