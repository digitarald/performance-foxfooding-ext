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
const profileSettings = {
  bufferSize: Math.pow(10, 6) * 3, // x2 is 60sec on my machine, x3 for stack variations
  interval: 2,
  features: ['js', 'stackwalk', 'leaf', 'threads'],
  threads: ['GeckoMain', 'Compositor'],
};
const intervalRanks = [15, 10, 5];
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

  browserAction.disable();
  const items = await storage.local.get('uid');
  if (items.uid) {
    uid = items.uid;
  } else {
    const resp = await (await fetch(`${apiEndpoint}/api/collect/`, {
      method: 'post',
    })).json();
    uid = resp.uid;
    await storage.local.set({ uid: uid });
  }
  console.log(
    logLabel,
    `Welcome Foxfooder ${uid}!`,
    `(Share with caution! This unique identifier links your browser with the anonymously uploaded profiles.)`
  );
  browserAction.enable();
  await resetBadge();
  const { autoStart } = await storage.local.get('autoStart');
  if (!Number.isInteger(autoStart) || autoStart <= Date.now()) {
    await enable();
  }
};

bootstrap();

const startProfile = async () => {
  if (!canRecord || !isEnabled || (lastSample && lastSample + sampleInterval > Date.now())) {
    return;
  }
  canRecord = false;
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
  sampleStart = 0;
  await browserAction.setIcon({ path: './icons/icon-default.svg' });
  browserAction.setBadgeText({ text: 'Rec' });
  const getDataTimeout = setTimeout(() => {
    resetBadge();
  }, 30000);
  try {
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

    const capturing = `${logLabel} Capturing profile`;
    console.time(capturing);
    const profile = await geckoProfiler.getProfile();
    console.timeEnd(capturing);
    const samples = profile.threads.find(
      thread => thread.name === 'GeckoMain' && thread.processType === 'default'
    ).samples.data;
    const duration = samples.slice(-1)[0][1] - samples[0][1];
    console.log(logLabel, `Captured ${(duration / 1000).toFixed(2)}s`);

    const processing = `${logLabel} Processing profile`;
    console.time(processing);
    deflateWorker.postMessage(JSON.stringify(profile));
    await didCompress;
    deflateWorker.terminate();
    await browser.geckoProfiler
      .stop()
      .catch(err => console.error(logLabel, 'Failed to stop profiler', err));
    console.timeEnd(processing);
  } catch (err) {
    console.error(logLabel, 'Failed to capture profile', err);
  }
  clearTimeout(getDataTimeout);
  setTimeout(maybeUpload, uploadDelay);
  await resetBadge();
};

const dropMarker = (tab, type) => {
  if (!sampleId) {
    return;
  }
  tabs
    .executeScript(tab, {
      code: `performance.mark("profiler-tab-${type} ${tab} " + location.origin) && null;`,
      runAt: 'document_start',
    })
    .catch(async err => {
      // Happens for about: pages
      if (err.message && /Missing host permission for the tab/.test(err.message)) {
        const activeTab = await tabs.get(tab);
        performance.mark(`profiler-tab-${type} ${tab} ${activeTab.url}`);
      } else {
        console.error(logLabel, 'Could not drop label', err);
      }
    });
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
    const start = Date.now();
    await uploadNext(uploadQueue[0]);
    // Check length here/ Upload could have been cancelled and queue flushed
    if (uploadQueue.length) {
      uploadQueue.splice(0, 1);
    }
  } catch (err) {
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
  const size = (beacon.byteLength / 1024 / 1024).toFixed(2);
  console.log(logLabel, `Uploading ${size} Mb to ${signed.key}`);
  const label = `${logLabel} Uploading`;
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
  storage.local.set({ autoStart: 0 });
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
  storage.local.set({ autoStart: Date.now() + 3600000 });
  geckoProfiler.stop();
  if (sampleId) {
    sampleId = 0;
    resetBadge();
  }
  // Reset sampling interval
  lastSample = 0;
  const body = ['Disabled status will be remembered between restarts for 1 hour.'];
  if (uploadQueue.length > 2 || (uploadQueue.length === 1 && !isUploading)) {
    body.push(`${uploadQueue.length} pending upload(s) got discarded.`);
  }
  // Flush collected profiles
  uploadQueue.length = 0;
  notifications.create(noteId, {
    type: 'basic',
    iconUrl: extension.getURL('icons/icon-disabled.svg'),
    title: 'Foxfooding Paused',
    message: body.join(' '),
  });
  browserAction.setTitle({ title: 'Foxfooding disabled. Click to re-enable.' });
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
    await startProfile();
    dropMarker(tabId, 'activate');
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (
    !tab.highlighted ||
    !tab.url.startsWith('http') ||
    (changeInfo.status !== 'loading' && !changeInfo.url)
  ) {
    return;
  }
  await startProfile();
  dropMarker(tabId, 'load');
});
