const test = require('node:test');
const assert = require('node:assert/strict');
const { hardwareReport, uploadHardware } = require('../hardware.cjs');
test('hardware reports have a fixed nonidentifying field set and exclude GPU identifiers', () => {
  const system = { cpus: () => [{model:'Test CPU'},{model:'Test CPU'}], platform: () => 'win32', arch: () => 'x64', release: () => '10.0.1', totalmem: () => 16 * 1024 ** 3,
    hostname: () => { throw Error('must not read hostname'); } };
  const value = hardwareReport('0.3.0', { gpuDevice: [{deviceString:'Test GPU',deviceId:123,vendorId:4,uuid:'private'}] }, system);
  assert.deepEqual(Object.keys(value).sort(), ['schemaVersion','appVersion','os','arch','osVersion','cpuModel','cpuCores','memoryGiB','gpus'].sort());
  assert.deepEqual(value.gpus,['Test GPU']); assert.equal(value.memoryGiB,16);
});
test('hardware upload uses a fixed server route, and failure does not create persistent identifiers', async () => {
  let request;
  await uploadHardware({ app:{getVersion:()=> '0.3.0',getGPUInfo:async()=>({})}, origin:'https://example.test',
    cloudSession:{ fetch:async(url,options)=>{request={url,options};return {ok:true};} } });
  assert.equal(request.url,'https://example.test/api/diagnostics/hardware');
  const body=JSON.parse(request.options.body); assert.ok(!('hostname' in body)); assert.ok(!('deviceId' in body));
});
