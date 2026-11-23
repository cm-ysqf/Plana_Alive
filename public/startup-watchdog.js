// This script loads before the module graph, so missing imports cannot leave a silent splash.
(() => {
  let failure = '';
  const show = message => { const node = document.getElementById('loading'); if (node) { node.hidden = false; node.textContent = message; } else failure = message; };
  window.addEventListener('error', event => {
    if (event.target?.tagName === 'SCRIPT') show('角色脚本加载失败，请重新连接或刷新页面。');
    else if (event.message && !Number(document.getElementById('canvas')?.dataset.frameCount)) show('角色启动失败，请重新连接或刷新页面。');
  }, true);
  document.addEventListener('DOMContentLoaded', () => { if (failure) show(failure); });
  setTimeout(() => {
    const node = document.getElementById('loading');
    if (!Number(document.getElementById('canvas')?.dataset.frameCount) && node && /正在唤醒/.test(node.textContent)) show('角色加载较慢，请检查网络后重新连接；若仍未显示，请刷新页面。');
  }, 20000);
})();
