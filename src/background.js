const analytics = require('./analytics.js');
const {
  runtime,
  geckoProfiler,
  browserAction,
  tabs,
  webNavigation,
  storage,
  notifications,
  extension,
} = browser;

// config
const logLabel = '[foxfooding]';
const apiEndpoint = 'https://performance-foxfooding.herokuapp.com';
const analyticsId = 'UA-49796218-57';
const profileSettings = {
  bufferSize: Math.pow(10, 6) * 3, // x2 is 60sec on my machine, x3 for stack variations
  interval: 2,
  features: ['js', 'stackwalk', 'leaf', 'threads'],
  threads: ['GeckoMain', 'Compositor'],
};
const intervalRanks = [30, 10, 5];
let clientRank = 0;
let sampleInterval = intervalRanks[clientRank] * 60 * 1000;
const sampleLength = 60 * 1000;
const uploadDelay = 15000;

// state
let uid = null;
let isUploading = false;
let isEnabled = false;
let canRecord = false;
let sampleId = 0;
let sampleStart = 0;
let lastSample = 0;
const uploadQueue = [];

// get uid for user
const bootstrap = async () => {
  // set sampling intervals by platform importance
  const osInfo = await runtime.getPlatformInfo();
  const isWin = osInfo.os === 'win';
  const is64 = osInfo.arch === 'x86-64';
  clientRank = 0 + isWin + (isWin && is64);
  sampleInterval = intervalRanks[clientRank] * 60 * 1000;

  // configure analytics with cid from storage
  await analytics.configure(analyticsId, storage.local);
  browserAction.disable();
  const items = await storage.local.get('uid');
  if (items.uid) {
    uid = items.uid;
    analytics.trackEvent('bootstrap', 'storage');
  } else {
    const resp = await (await fetch(`${apiEndpoint}/api/collect/`, {
      method: 'post',
    })).json();
    uid = resp.uid;
    await storage.local.set({ uid: uid });
    analytics.trackEvent('bootstrap', 'register');
  }
  console.log(logLabel, `Foxfooding as ${uid}`);
  browserAction.enable();
  await resetBadge();
  const { autoStart } = await storage.local.get('autoStart');
  if (autoStart !== false) {
    await enable();
  }
};

bootstrap();

const startProfile = async () => {
  if (!canRecord || !isEnabled || (lastSample && lastSample + sampleInterval > Date.now())) {
    return;
  }
  canRecord = false;
  analytics.trackEvent('profile', 'start');
  sampleId = setTimeout(collectProfile, sampleLength);
  sampleStart = Date.now();
  await browserAction.setIcon({ path: './icons/icon-running.svg' });
  await geckoProfiler
    .start(profileSettings)
    .catch(err => console.error(logLabel, 'Failed to start profiler', err));
  console.log(logLabel, 'Sampling started');
};

const collectProfile = async () => {
  if (!sampleId || !isEnabled) {
    console.log(logLabel, 'Sampling not running');
    return;
  }
  lastSample = Date.now();
  clearTimeout(sampleId);
  sampleId = 0;
  analytics.trackEvent('profile', 'collect');
  analytics.trackUserTiming('profile', 'sampling', Date.now() - sampleStart);
  sampleStart = 0;
  await browserAction.setIcon({ path: './icons/icon-default.svg' });
  browserAction.setBadgeText({ text: 'Rec' });
  const getDataTimeout = setTimeout(() => {
    analytics.trackEvent('profile', 'get-data-timeout');
    resetBadge();
  }, 30000);
  try {
    const start = Date.now();
    await geckoProfiler
      .pause()
      .catch(err => console.error(logLabel, 'Failed to pause profiler', err));
    const deflateWorker = new Worker('./deflate.js');
    const didCompress = new Promise((resolve, reject) => {
      deflateWorker.onmessage = evt => {
        uploadQueue.push(new Uint8Array(evt.data.compressed));
        resolve();
      };
      deflateWorker.onerror = reject;
    });
    const profile = await geckoProfiler.getProfile();
    const samples = profile.threads.find(
      thread => thread.name === 'GeckoMain' && thread.processType === 'default'
    ).samples.data;
    const duration = samples.slice(-1)[0][1] - samples[0][1];
    deflateWorker.postMessage(JSON.stringify(profile));
    await didCompress;
    deflateWorker.terminate();
    await browser.geckoProfiler
      .stop()
      .catch(err => console.error(logLabel, 'Failed to stop profiler', err));
    const delta = Date.now() - start;
    console.log(
      logLabel,
      `Profile data (${(duration / 1000).toFixed(2)}s) captured in ${(delta / 1000).toFixed(2)}s`
    );
    analytics.trackUserTiming('profile', 'get-data', delta);
  } catch (err) {
    console.error(logLabel, 'Failed to capture profile', err);
    analytics.trackException('getData failed');
  }
  clearTimeout(getDataTimeout);
  setTimeout(maybeUpload, uploadDelay);
  await resetBadge();
};

const resetBadge = () => {
  canRecord = true;
  browserAction.setBadgeText({ text: '' });
};

const maybeUpload = async () => {
  if (isUploading || !uploadQueue.length) {
    return;
  }
  isUploading = true;
  try {
    analytics.trackEvent('profile', 'upload');
    const start = Date.now();
    await uploadNext(uploadQueue[0]);
    // Check length here/ Upload could have been cancelled and queue flushed
    if (uploadQueue.length) {
      uploadQueue.splice(0, 1);
    }
    analytics.trackUserTiming('profile', 'upload', Date.now() - start);
  } catch (err) {
    analytics.trackException('Upload failed');
    console.error(logLabel, `Upload failed: ${err}`);
  }
  isUploading = false;
  setTimeout(maybeUpload, uploadDelay);
};

const uploadNext = async beacon => {
  const signed = await (await fetch(`${apiEndpoint}/api/collect/${uid}`, {
    method: 'post',
  })).json();
  const blob = new Blob([beacon], { type: 'application/json' });
  if (!isEnabled) {
    return;
  }
  const label = `${logLabel} uploaded ${signed.key}, ${(beacon.byteLength / 1024 / 1024).toFixed(
    2
  )} Mb`;
  console.time(label);
  const upload = await fetch(signed.url, {
    method: 'put',
    body: blob,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    },
  });
  console.timeEnd(label);
  if (!upload.ok) {
    throw new Error(await upload.text());
  }
};

const noteId = 'status-notification';

const enable = async () => {
  if (isEnabled) {
    return;
  }
  isEnabled = true;
  storage.local.set({ autoStart: true });
  analytics.trackEvent('status', 'enable');
  notifications.create(noteId, {
    type: 'basic',
    iconUrl: extension.getURL('icons/icon-running.svg'),
    title: 'You Are 🦊 Foxfooding 🍽!',
    message: `Every ${sampleInterval / 60000}min performance will be recorded for ${sampleLength /
      60000}min and uploaded for analysis.`,
  });
  await browserAction.setIcon({ path: './icons/icon-default.svg' });
  browserAction.setTitle({ title: 'Click to disable foxfooding' });
};

const disable = async () => {
  if (!isEnabled) {
    return;
  }
  isEnabled = false;
  storage.local.set({ autoStart: false });
  geckoProfiler.stop();
  if (sampleId) {
    sampleId = 0;
    resetBadge();
  }
  // Reset sampling interval
  lastSample = 0;
  const body = ['Just click the button when you are ready to continue foxfooding.'];
  if (uploadQueue.length > 2 || (uploadQueue.length === 1 && !isUploading)) {
    body.push(`${uploadQueue.length} pending upload(s) got discarded.`);
  }
  analytics.trackEvent('status', 'disable');
  // Flush collected profiles
  uploadQueue.length = 0;
  notifications.create(noteId, {
    type: 'basic',
    iconUrl: extension.getURL('icons/icon-disabled.svg'),
    title: 'Foxfooding Paused',
    message: body.join(' '),
  });
  browserAction.setTitle({ title: 'Foxfooding disabled. Click to enable.' });
  await browserAction.setIcon({ path: './icons/icon-disabled.svg' });
};

browserAction.onClicked.addListener(() => {
  if (!uid) {
    return;
  }
  if (sampleId) {
    return collectProfile();
  }
  if (isEnabled) {
    disable();
  } else {
    enable();
  }
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const activeTab = await tabs.get(tabId);
  if (activeTab && activeTab.incognito) {
    disable();
  } else {
    startProfile();
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    !tab.highlighted ||
    !tab.url.startsWith('http') ||
    (changeInfo.status !== 'loading' && !changeInfo.url)
  ) {
    return;
  }
  startProfile();
});
