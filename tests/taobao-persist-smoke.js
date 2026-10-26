const { app, session } = require('electron');
const path = require('path');

const PARTITION = 'persist:giwin-taobao-search';
const COOKIE_NAME = 'giwin_login_persistence_probe';
const mode = process.argv.includes('set') ? 'set' : 'read';
const userDataArg = process.argv.find(arg => arg.startsWith('--probe-user-data='));

if (userDataArg) {
  app.setPath('userData', path.resolve(userDataArg.slice('--probe-user-data='.length)));
}
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const taobaoSession = session.fromPartition(PARTITION);
  if (mode === 'set') {
    await taobaoSession.cookies.set({
      url: 'https://www.taobao.com/',
      name: COOKIE_NAME,
      value: 'persisted-login-probe',
      domain: '.taobao.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: Math.floor(Date.now() / 1000) + 3600
    });
    await taobaoSession.cookies.flushStore();
    console.log('TAOBAO_PERSIST_SET_OK');
    app.exit(0);
    return;
  }

  const cookies = await taobaoSession.cookies.get({ name: COOKIE_NAME });
  const persisted = cookies.length === 1 && cookies[0].value === 'persisted-login-probe';
  console.log(persisted ? 'TAOBAO_PERSIST_READ_OK' : 'TAOBAO_PERSIST_READ_FAILED');
  if (cookies.length) {
    await taobaoSession.cookies.remove('https://www.taobao.com/', COOKIE_NAME);
    await taobaoSession.cookies.flushStore();
  }
  app.exit(persisted ? 0 : 1);
}).catch(error => {
  console.error(error && error.stack || error);
  app.exit(2);
});
