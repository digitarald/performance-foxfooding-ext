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
  bufferSize: Math.pow(10, 7),
  interval: 2,
  features: ['stackwalk', 'leaf', 'threads'],
  threads: ['GeckoMain', 'Compositor'],
};
const sampleInterval = 15 * 60 * 1000;
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
  resetBadge();
  const { autoStart } = await storage.local.get('autoStart');
  if (autoStart !== false) {
    enable();
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
  browserAction.setIcon({ path: './icons/icon-running.svg' });
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
  browserAction.setIcon({ path: './icons/icon-default.svg' });
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
    const data = await geckoProfiler.getProfile();
    const { samples } = data.threads.find(
      thread => thread.name === 'GeckoMain' && thread.processType === 'default'
    );
    const profileDelta = samples.data.slice(-1)[0][1] - samples.data[0][1];
    console.log(logLabel, 'Profiler length', profileDelta);
    uploadQueue.push(data);
    await browser.geckoProfiler
      .resume()
      .catch(err => console.error(logLabel, 'Failed to resume profiler', err));
    const delta = Date.now() - start;
    console.log(logLabel, `Profile data read out in ${delta}ms`);
    analytics.trackUserTiming('profile', 'get-data', delta);
  } catch (err) {
    console.error(logLabel, 'Failed to get profile', err);
    analytics.trackException('getData failed');
  }
  clearTimeout(getDataTimeout);
  setTimeout(maybeUpload, uploadDelay);
  resetBadge();
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
    uploadQueue.splice(0, 1);
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
  uploadQueue.length = 0;
  const body = ['When you are ready to continue foxfooding, click the button.'];
  if (uploadQueue.length > 2 || (uploadQueue.length === 1 && !isUploading)) {
    body.push(`${uploadQueue.length} pending upload(s) got discarded.`);
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
