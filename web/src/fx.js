// Celebrations (confetti, badge popups) load on first use so the first screen stays small.
const fx = () => import('./celebrate.js');
export const ticketComplete = (...a) => fx().then((m) => m.ticketComplete(...a));
export const levelUp = (...a) => fx().then((m) => m.levelUp(...a));
export const handleUnlocked = (...a) => fx().then((m) => m.handleUnlocked(...a));
