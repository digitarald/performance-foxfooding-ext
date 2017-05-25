const shortid = require('shortid');

const stringifyQuery = (params) => {

}

module.exports = {
  tid: '',
  uid: '',

  configure: async function(tid, storage) {
    console.log('configure', this.tid);
    if (this.tid) {
      return;
    }
    this.tid = tid;
    let { uid } = await storage.get('uid');
    if (!uid) {
      uid = shortid.generate();
      storage.set({uid: uid});
    }
    this.uid = uid;
  },

  send: function(type, params) {
    console.log(`Analytics send ${type}: ${JSON.stringify(params)}`);
    Object.assign(params, {
      v: 1,
      tid: this.tid,
      uid: this.uid,
      aip: 1,
      ds: 'addon',
      t: type
    });
    const query = Object.keys(params)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    // console.log(`analytics track: ${type}`, params);
    fetch('https://www.google-analytics.com/collect', {
      method: 'post',
      body: query
    });
  },

  trackEvent: function(category, action, label = '', value = '') {
    this.send('event', {
      ec: category,
      ea: action,
      el: label,
      ev: value
    });
  },

  trackException: function(description, fatal = false) {
    this.send('exception', {
      exd: description,
      exf: fatal ? 1 : 0
    });
  },

  trackUserTiming: function(category, variable, time = 0) {
    this.send('timing', {
      utc: category,
      utv: variable,
      utt: time
    });
  }
}
