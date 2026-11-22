const { packager } = require('@electron/packager');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
packager({ dir: root, out: path.join(root, 'release', require('../package.json').version), name: 'PlanaAlive', platform: 'win32', arch: 'x64',
  electronVersion: require('../package.json').devDependencies.electron, asar: true, overwrite: true,
  electronZipDir: fs.existsSync(path.join(root, 'download')) ? path.join(root, 'download') : undefined,
  icon: path.join(root, 'assets/app.ico'), executableName: 'PlanaAlive',
  ignore: [/^\/release($|\/)/, /^\/download($|\/)/, /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/package-lock\.json$/, /^\/.*\.log$/],
  win32metadata: { CompanyName: 'PLANA ALIVE', FileDescription: '普拉娜桌面客户端', ProductName: 'Plana Alive', InternalName: 'PlanaAlive' }
}).then(paths => { for (const dir of paths) { fs.copyFileSync(path.join(root, '使用说明.txt'), path.join(dir, '使用说明.txt')); console.log(dir); } }).catch(e => { console.error(e); process.exitCode = 1; });
