const analytics = require('./analytics.js');
const pako = require('pako/dist/pako_deflate.js');
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
  bufferSize: 5000000, // 60sec, per testing. TBD: Validate
  interval: 4,
  features: ['stackwalk', 'leaf', 'threads'],
  threads: ['GeckoMain', 'Compositor'],
};
const sampleInterval = 15 * 60 * 1000;
const sampleLength = 60 * 1000;
const uploadTimeout = 5000;

// state
let uid = null;
let isRunning = false;
let isUploading = false;
let isEnabled = false;
let canRecord = false;
let sampleId = 0;
let sampleStart = 0;
let lastSample = 0;
const beacons = [];

// get uid for user
const bootstrap = async () => {
  await analytics.configure(analyticsId, storage.local);
  browserAction.disable();
  const items = await storage.local.get('uid');
  if (items.uid) {
    uid = items.uid;
    analytics.trackEvent('bootstrap', 'storage');
  } else {
    const resp = await (await fetch(`${apiEndpoint}/beacons/`, {
      method: 'post',
    })).json();
    uid = resp.uid;
    await storage.local.set({ uid: uid });
    analytics.trackEvent('bootstrap', 'register');
  }
  console.log(logLabel, `Foxfooding as ${uid}`);
  browserAction.enable();
  resetBadge();
  const { autoStart } = await storage.local.get('autoStart');
  if (autoStart !== false) {
    enable();
  }
};

bootstrap();

geckoProfiler.onRunning.addListener(isRunning => {
  isRunning = true;
});

const startProfile = async () => {
  if (!canRecord || !isEnabled || (lastSample && lastSample + sampleInterval > Date.now())) {
    return;
  }
  canRecord = false;
  analytics.trackEvent('profile', 'start');
  sampleId = setTimeout(collectProfile, sampleLength);
  sampleStart = Date.now();
  browserAction.setIcon({ path: './icons/icon-running.svg' });
  if (!isRunning) {
    await geckoProfiler.start(profileSettings);
    isRunning = true;
  }
  console.log(logLabel, 'Sampling started');
  performance.mark('profiler.start');
};

const collectProfile = async () => {
  if (!sampleId || !isEnabled) {
    console.log(logLabel, 'Sampling not running');
    return;
  }
  lastSample = Date.now();
  clearTimeout(sampleId);
  sampleId = 0;
  performance.mark('profiler.collect');
  performance.measure('profiler', 'profiler.start', 'profiler.collect');
  analytics.trackEvent('profile', 'collect');
  analytics.trackUserTiming('profile', 'sampling', Date.now() - sampleStart);
  sampleStart = 0;
  browserAction.setIcon({ path: './icons/icon-default.svg' });
  browserAction.setBadgeText({ text: 'Rec' });
  const start = Date.now();
  const getDataTimeout = setTimeout(() => {
    analytics.trackEvent('profile', 'get-data-timeout');
    resetBadge();
  }, 15000);
  try {
    await geckoProfiler.pause().catch(err => console.error(logLabel, err));
    beacons.push(await geckoProfiler.getProfile());
    await browser.geckoProfiler.resume().catch(err => console.error(logLabel, err));
  } catch (e) {
    analytics.trackException('getData failed');
  }
  clearTimeout(getDataTimeout);
  const collectTime = Date.now() - start;
  console.log(logLabel, `Profile data read out in ${collectTime}ms`);
  analytics.trackUserTiming('profile', 'get-data', collectTime);
  setTimeout(maybeUpload, uploadTimeout);
  resetBadge();
};

const resetBadge = () => {
  canRecord = true;
  browserAction.setBadgeText({ text: '' });
};

const maybeUpload = async () => {
  if (isUploading) {
    return;
  }
  isUploading = true;
  if (beacons.length) {
    try {
      analytics.trackEvent('profile', 'upload');
      const start = Date.now();
      await uploadNext(beacons[0]);
      beacons.splice(0, 1);
      analytics.trackUserTiming('profile', 'upload', Date.now() - start);
    } catch (err) {
      analytics.trackException('Upload failed');
      console.error(logLabel, `Upload failed: ${err}`);
    }
  }
  isUploading = false;
  setTimeout(maybeUpload, uploadTimeout);
};

const uploadNext = async beacon => {
  const signed = await (await fetch(`${apiEndpoint}/beacons/${uid}`, {
    method: 'post',
  })).json();
  const input = JSON.stringify(beacon);
  const inputSize = input.length;
  console.time(`${logLabel} gzip`);
  const compressed = pako.gzip(input);
  const compressedSize = compressed.length;
  console.log(
    logLabel,
    `Compressed ${signed.key} by ${Math.round(inputSize / compressedSize)}x: ${Math.round(compressedSize / 1024)}kb`
  );
  console.timeEnd(`${logLabel} gzip`);
  const blob = new Blob([compressed], { type: 'application/json' });
  console.time(`${logLabel} upload`);
  const upload = await fetch(signed.url, {
    method: 'put',
    body: blob,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    },
  });
  console.timeEnd(`${logLabel} upload`);
  if (!upload.ok) {
    throw new Error((await upload.text()));
  }
  console.log(logLabel, `Uploaded ${signed.key}`);
};

const noteId = 'status-notification';

const enable = () => {
  if (isEnabled) {
    return;
  }
  isEnabled = true;
  storage.local.set({ autoStart: true });
  analytics.trackEvent('status', 'enable');
  notifications.create(noteId, {
    type: 'basic',
    iconUrl: extension.getURL('icons/icon-default.svg'),
    title: 'Foxfooding enabled',
    message: `Every ${sampleInterval / 60000}min performance will be recorded for ${sampleLength / 60000}min.`,
  });
  browserAction.setIcon({ path: './icons/icon-default.svg' });
  browserAction.setTitle({ title: 'Click to disable foxfooding' });
};

const disable = () => {
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
  // Flush collected profiles
  beacons.length = 0;
  const body = ['When you are ready to continue foxfooding, click the button.'];
  if (beacons.length > 2 || (beacons.length === 1 && !isUploading)) {
    body.push(`${beacons.length} pending upload(s) got discarded.`);
  }
  notifications.create(noteId, {
    type: 'basic',
    iconUrl: extension.getURL('icons/icon-disabled.svg'),
    title: 'Foxfooding paused',
    message: body.join(' '),
  });
  browserAction.setTitle({ title: 'Foxfooding disabled. Click to enable.' });
  browserAction.setIcon({ path: './icons/icon-disabled.svg' });
  analytics.trackEvent('status', 'disable');
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
