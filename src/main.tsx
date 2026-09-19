import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 개발 중에는 캐시가 최신 코드를 가려서 헷갈리므로 배포 빌드에서만 등록한다.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 서비스 워커는 HTTPS(또는 localhost)에서만 등록된다. 실패해도 앱은 그대로 동작한다.
    });
  });
}
