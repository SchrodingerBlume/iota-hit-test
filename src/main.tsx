import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/app.css';
import { applyTheme, currentTheme } from './ui/theme';

// 首帧就把主题挂上，别先白一下再变黑
applyTheme(currentTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
