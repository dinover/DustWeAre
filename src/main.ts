import './ui/styles.css';
import { Game } from './core/Game';

const root = document.getElementById('app')!;
const game = new Game(root);
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __dwa: Game }).__dwa = game;

// Fade the boot ember once the first frames are on screen.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const boot = document.getElementById('boot');
    boot?.classList.add('gone');
    setTimeout(() => boot?.remove(), 1400);
  }),
);
