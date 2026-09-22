import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { Crash } from './ui/Crash';
import './styles/app.css';
import { applyTheme, currentTheme } from './ui/theme';
import { startBundledFonts } from './fonts/bundled';

// 首帧就把主题挂上，别先白一下再变黑
applyTheme(currentTheme());
startBundledFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash><App /></Crash>
  </StrictMode>,
);
