import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 安全基线：仅绑定 127.0.0.1——局域网（192.168.x.x / 10.x.x.x）不可达；
// 高位随机端口 26847 避免与本机其他测试项目冲突；strictPort 防止端口被占用后静默漂移。
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', workflow: 'workflow.html' } } },
  server: { port: 26847, host: '127.0.0.1', strictPort: true },
  preview: { port: 26847, host: '127.0.0.1', strictPort: true }
});
