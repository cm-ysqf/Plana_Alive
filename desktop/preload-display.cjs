const { ipcRenderer } = require('electron');
// The remote page receives presentation data, never a privileged IPC bridge.
let profile = {}, pointer = null, lastMove = 0, start, petting = false, moved = false;
const dispatch = (type, value) => document.dispatchEvent(new CustomEvent(type, { detail: value }));
function applyProfile() {
  dispatch('plana:desktop-config', profile);
  const subtitle = document.getElementById('subtitle');
  if (subtitle) Object.assign(subtitle.style, { fontSize: profile.subtitleFontSize + 'px', left: (50 + profile.subtitleX) + '%', bottom: profile.subtitleY + '%', maxWidth: profile.subtitleWidth + '%' });
}
ipcRenderer.on('display:settings', (_event, value) => { profile = value; applyProfile(); });
ipcRenderer.on('display:pointer', (_event, value) => dispatch('plana:desktop-pointer', value));
const inHead = event => {
  try { const r = JSON.parse(event.target.dataset.headRect); return event.clientX >= r.x && event.clientX <= r.x + r.width && event.clientY >= r.y && event.clientY <= r.y + r.height; } catch { return false; }
};
window.addEventListener('DOMContentLoaded', () => {
  applyProfile();
  const subtitle = document.getElementById('subtitle');
  if (subtitle) {
    subtitle.hidden = true;
    const syncSubtitle = () => ipcRenderer.send('display:subtitle', { text: subtitle.textContent, visible: subtitle.classList.contains('visible') });
    new MutationObserver(syncSubtitle).observe(subtitle, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    syncSubtitle();
  }
  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted || event.button !== 0 || event.target.closest('button,input,textarea,select,a') || profile.clickThrough) return;
    pointer = event.pointerId; start = { x: event.screenX, y: event.screenY }; moved = false;
    petting = profile.headpat && inHead(event);
    event.target.setPointerCapture?.(pointer);
    if (petting) dispatch('plana:desktop-pet', { phase: 'start', x: event.clientX });
    else if (!profile.windowLocked) ipcRenderer.send('display:drag', 'start');
  });
  document.addEventListener('pointermove', event => {
    if (!event.isTrusted || pointer !== event.pointerId || performance.now() - lastMove < 16) return;
    lastMove = performance.now();
    if (petting) { dispatch('plana:desktop-pet', { phase: 'move', x: event.clientX }); return; }
    if (!moved && Math.hypot(event.screenX - start.x, event.screenY - start.y) > 5) moved = true;
  });
  const end = event => {
    if (pointer === null) return;
    if (petting) dispatch('plana:desktop-pet', { phase: 'end' });
    else if (!moved && event?.isTrusted && event.type === 'pointerup') {
      try { const r = JSON.parse(event.target.dataset.modelRect); if (event.clientX >= r.x && event.clientX <= r.x + r.width && event.clientY >= r.y && event.clientY <= r.y + r.height) ipcRenderer.send('display:tap'); } catch {}
    }
    pointer = null; petting = false; ipcRenderer.send('display:drag', 'end');
  };
  document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end); window.addEventListener('blur', end);
  let geometry = '';
  setInterval(() => {
    const canvas = document.getElementById('canvas'); if (!canvas?.dataset.modelRect) return;
    const next = canvas.dataset.modelRect + canvas.dataset.headRect;
    if (next === geometry) return; geometry = next;
    try { ipcRenderer.send('display:geometry', { model: JSON.parse(canvas.dataset.modelRect), head: JSON.parse(canvas.dataset.headRect) }); } catch {}
  }, 250);
});
