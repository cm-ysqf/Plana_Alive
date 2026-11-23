const { build, Platform, Arch } = require('electron-builder');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');

build({
  projectDir: root,
  targets: Platform.WINDOWS.createTarget('portable', Arch.x64),
  publish: 'never',
  config: {
    appId: 'PLANA.ALIVE.Desktop',
    productName: pkg.productName,
    executableName: 'PlanaAlive',
    electronVersion: pkg.devDependencies.electron,
    electronDist: path.join(root, 'node_modules/electron/dist'),
    directories: { output: path.join(root, 'release', pkg.version, 'portable') },
    artifactName: 'PlanaAlive-${version}-Portable.${ext}',
    asar: true,
    npmRebuild: false,
    files: [
      'package.json', 'main.cjs', 'updater.cjs', 'update-public-key.json', 'geometry.cjs', 'hardware.cjs', 'settings.cjs',
      'preload-*.cjs', 'ui/**/*', 'display/**/*', 'assets/**/*', '使用说明.txt'
    ],
    win: { icon: path.join(root, 'assets/app.ico'), signExecutable: false },
    portable: { requestExecutionLevel: 'user', unpackDirName: false }
  }
}).then(files => files.forEach(file => console.log(file))).catch(error => {
  console.error(error); process.exitCode = 1;
});
