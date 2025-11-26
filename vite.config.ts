import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './', // file:// 프로토콜에서 리소스를 찾기 위해 상대 경로 사용
  root: 'renderer',
  build: {
    // 📦 Electron 패키징 시 main 번들과 같은 트리(dist-electron)에 렌더러 파일을 배치
    // main.ts 의 __dirname 은 dist-electron/windows 이므로
    // ../renderer/index.html, ../renderer/overlay.html 을 바라보게 맞춘다
    outDir: '../dist-electron/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'renderer/index.html'),
        overlay: path.resolve(__dirname, 'renderer/overlay.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // /overlay 라우트를 overlay.html로 매핑
    fs: {
      strict: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './renderer/src'),
    },
  },
});

