const Profiler = require('./profiler.js');
const Analytics = require('./analytics.js');
const pako = require('pako/dist/pako_deflate.js');

const analytics = new Analytics('UA-96144575-1');

const { runtime, browserAction, tabs, webNavigation, storage } = browser;

const profiler = new Profiler(runtime.connect({name: 'profiler'}));

// config
const SERVER_URL = 'https://quantum-ppb.herokuapp.com';
const PROFILE_SETTINGS = {
  entries: 10000000, // 60sec, per testing
  interval: 2,
  features: ['stackwalk', 'threads', 'leaf', 'js'],
  threads: ['GeckoMain', 'Compositor']
};
const SAMPLE_INTERVAL = 15 * 60 * 1000;
const SAMPLE_LENGTH_MAX = 60 * 1000;
const ALWAYS_ON = true;

// state
let uid = null;
let isUploading = false;
let isEnabled = true;
let canRecord = false;
let sampleId = 0;
let sampleStart = 0;
let lastSample = 0;
let stopProfiler = true;
const beacons = [];

// get uid for user
const bootstrapUid = async () => {
  browserAction.disable();
  const items = await storage.local.get('uid');
  if (items.uid) {
    uid = items.uid;
    analytics.setClient(uid);
    analytics.trackEvent('bootstrap', 'storage');
  } else {
    const resp = await (
      await fetch(`${SERVER_URL}/beacons/`, {
        method: 'post'
      })
    ).json();
    uid = resp.uid;
    await storage.local.set({uid: uid});
    analytics.setClient(uid);
    analytics.trackEvent('bootstrap', 'register');
  }
  console.log(`Logged in as ${uid}`);
  browserAction.enable();
  browserAction.setTitle({title: `Registered as ${uid}`});
  canRecord = true;
}

bootstrapUid();

const profilePageLoad = async () => {
  if (!canRecord || !isEnabled) {
    return;
  }
  if (lastSample && lastSample + SAMPLE_INTERVAL > Date.now()) {
    return;
  }
  analytics.trackEvent('profile', 'start');
  const status = await profiler.getStatus();
  console.log('Profile status', status);
  if (!status) {
    profiler.start(PROFILE_SETTINGS);
    stopProfiler = !ALWAYS_ON;
  } else {
    stopProfiler = false;
  }
  canRecord = false;
  browserAction.setIcon({path: './icons/icon-running.svg'});
  sampleId = setTimeout(collectProfile, SAMPLE_LENGTH_MAX);
  sampleStart = Date.now();
}

const collectProfile = async () => {
  if (!sampleId) {
    console.log('Profiler not running');
    return;
  }
  lastSample = Date.now();
  clearTimeout(sampleId);
  sampleId = 0;
  analytics.trackEvent('profile', 'collect');
  analytics.trackUserTiming('profile', 'sampling', Date.now() - sampleStart);
  sampleStart = 0;
  browserAction.setIcon({path: './icons/icon-default.svg'});
  browserAction.setBadgeText({text: 'Rec'});
  const start = Date.now();
  const data = await profiler.getData();
  if (stopProfiler) {
    profiler.stop();
  }
  beacons.push(data);
  canRecord = true;
  analytics.trackUserTiming('profile', 'get-data', Date.now() - start);
  browserAction.setBadgeText({text: ''});
  setTimeout(maybeUpload, 5000);
}

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
  setTimeout(maybeUpload, 5000);
}

const uploadNext = async (beacon) => {
  const signed = await (
    await fetch(`${SERVER_URL}/beacons/${uid}`, {
      method: 'post'
    })
  ).json();
  const input = JSON.stringify(beacon);
  const inputSize = input.length;
  const compressed = pako.gzip(input);
  const compressedSize = compressed.length;
  console.log(`Compressed by ${Math.round(inputSize / compressedSize)}x`);
  const blob = new Blob([compressed], { type : 'application/json' });

  console.log(`Uploading ${signed.key} to ${signed.url}`);
  const upload = await fetch(signed.url, {
    method: 'put',
    body: blob,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip'
    }
  });
  if (!upload.ok) {
    throw new Error(await upload.text());
  }
  console.log(`Uploaded ${signed.key}`);
  beacons.splice(beacons.indexOf(beacon), 1);
}

browserAction.onClicked.addListener(() => {
  if (!uid) {
    return;
  }
  if (sampleId) {
    collectProfile();
  } else {
    isEnabled = !isEnabled;
    if (isEnabled) {
      browserAction.setIcon({path: './icons/icon-default.svg'});
      browserAction.setTitle({title: 'Click to disable sampling.'});
    } else {
      // Flush collected profiles
      beacons.length = 0;
      browserAction.setTitle({title: 'Sampling disabled. Click to enable.'});
      browserAction.setIcon({path: './icons/icon-disabled.svg'});
    }
  }
});

const urlFilter = {
  url: [
    { schemes: ['http', 'https'] }
  ]
};

webNavigation.onBeforeNavigate.addListener((details) => {
  if (!details.frameId) {
    profilePageLoad();
  }
}, urlFilter);
