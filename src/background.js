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
let isEnabled = true;
let canRecord = false;
let sampleId = 0;
let sampleStart = 0;
let lastSample = 0;
const beacons = [];

// get uid for user
const bootstrapUid = async () => {
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
  console.log(`Reporting as ${uid}`);
  browserAction.enable();
  browserAction.setTitle({ title: `Registered as ${uid}` });
  canRecord = true;
};

bootstrapUid();

geckoProfiler.onRunning.addListener(isRunning => {
  isRunning = true;
});

const profilePageLoad = async () => {
  if (!canRecord || !isEnabled) {
    return;
  }
  if (lastSample && lastSample + sampleInterval > Date.now()) {
    return;
  }
  analytics.trackEvent('profile', 'start');
  sampleId = setTimeout(collectProfile, sampleLength);
  sampleStart = Date.now();
  browserAction.setIcon({ path: './icons/icon-running.svg' });
  if (!isRunning) {
    await geckoProfiler.start(profileSettings);
  }
  performance.mark('profiler.start');
};

const collectProfile = async () => {
  if (!sampleId) {
    console.log('Profiler not running');
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
    await geckoProfiler.pause().catch(err => console.error(err));
    beacons.push(await geckoProfiler.getProfile());
    await browser.geckoProfiler.resume().catch(err => console.error(err));
  } catch (e) {
    analytics.trackException('getData failed');
  }
  clearTimeout(getDataTimeout);
  const collectTime = Date.now() - start;
  console.log('Profile data read out in %d ms', collectTime);
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
      analytics.trackUserTiming('profile', 'upload', Date.now() - start);
    } catch (err) {
      analytics.trackException('Upload failed');
      console.error(`Upload failed with ${err}`);
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
  const compressed = pako.gzip(input);
  const compressedSize = compressed.length;
  console.log(
    `Compressed ${signed.key} by ${Math.round(inputSize / compressedSize)}x: ${Math.round(compressedSize / 1024)} kb`
  );
  const blob = new Blob([compressed], { type: 'application/json' });
  const upload = await fetch(signed.url, {
    method: 'put',
    body: blob,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    },
  });
  if (!upload.ok) {
    throw new Error((await upload.text()));
  }
  console.log(`Uploaded ${signed.key}`);
  beacons.splice(beacons.indexOf(beacon), 1);
};

const noteId = 'status-notification';

browserAction.onClicked.addListener(() => {
  if (!uid) {
    return;
  }
  if (sampleId) {
    collectProfile();
  } else {
    isEnabled = !isEnabled;
    if (isEnabled) {
      analytics.trackEvent('status', 'enable');
      notifications.create(noteId, {
        type: 'basic',
        iconUrl: extension.getURL('icons/icon-running.svg'),
        title: 'Foxfooding enabled',
        message: `Performance will be recorded for ${sampleLength / 60000} min, every ${sampleInterval / 60000} min`,
      });
      browserAction.setIcon({ path: './icons/icon-default.svg' });
      browserAction.setTitle({ title: 'Click to disable sampling.' });
    } else {
      analytics.trackEvent('status', 'disable');
      // Flush collected profiles
      notifications.create(noteId, {
        type: 'basic',
        iconUrl: extension.getURL('icons/icon-disabled.svg'),
        title: 'Foxfooding disabled for this session',
        message: beacons.length > 2 || (beacons.length === 1 && !isUploading)
          ? `Cancelled ${beacons.length} pending profile uploads`
          : 'Just click to enable foxfooding',
      });
      beacons.length = 0;
      lastSample = 0;
      browserAction.setTitle({ title: 'Sampling disabled. Click to enable.' });
      browserAction.setIcon({ path: './icons/icon-disabled.svg' });
    }
  }
});

browser.tabs.onActivated.addListener(() => {
  profilePageLoad();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    !tab.highlighted ||
    !tab.url.startsWith('http') ||
    (changeInfo.status !== 'loading' && !changeInfo.url)
  ) {
    return;
  }
  profilePageLoad();
});
