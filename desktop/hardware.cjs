const os = require('node:os');
// Keep this an explicit allowlist: no hostname, location, username, serials or device IDs.
function hardwareReport(appVersion, gpuInfo = {}, system = os) {
  const cpus = system.cpus();
  return { schemaVersion: 1, appVersion, os: system.platform(), arch: system.arch(), osVersion: system.release(),
    cpuModel: (cpus[0]?.model || 'Unknown').slice(0, 160), cpuCores: Math.max(1, cpus.length),
    memoryGiB: Math.round(system.totalmem() / 1024 ** 3 * 4) / 4,
    gpus: [...new Set((gpuInfo.gpuDevice || []).map(gpu => gpu.deviceString || gpu.vendorString || '').filter(Boolean))].slice(0, 8).map(value => value.slice(0, 160)) };
}
async function uploadHardware({ app, cloudSession, origin, signal }) {
  const gpu = await app.getGPUInfo('basic').catch(() => ({}));
  const response = await cloudSession.fetch(origin + '/api/diagnostics/hardware', {
    method: 'POST', credentials: 'include', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hardwareReport(app.getVersion(), gpu))
  });
  if (!response.ok) throw new Error(`配置统计上传失败（${response.status}）`);
  await response.body?.cancel();
}
module.exports = { hardwareReport, uploadHardware };
