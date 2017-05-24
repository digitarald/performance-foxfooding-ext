const stringifyQuery = (params) => {
  var esc = encodeURIComponent;
  return Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
}

module.exports = class Analytics {

  constructor(tid) {
    this.tid = tid;
    this.cid = '0';
  }

  setClient(cid) {
    console.log('Analytics client', cid);
    this.cid = cid;
  }

  track(type, params) {
    Object.assign(params, {
      v: 1,
      tid: this.tid,
      cid: this.cid,
      aip: 1,
      ds: 'addon',
      t: type
    });
    // console.log(`analytics track: ${type}`, params);
    fetch('https://www.google-analytics.com/collect', {
      method: 'post',
      body: stringifyQuery(params)
    });
  }

  trackEvent(category, action, label = '', value = '') {
    this.track('event', {
      ec: category,
      ea: action,
      el: label,
      ev: value
    });
  }

  trackException(description, fatal = false) {
    this.track('exception', {
      exd: description,
      exf: fatal ? 1 : 0
    });
  }

  trackUserTiming(category, variable, time = 0) {
    this.track('timing', {
      utc: category,
      utv: variable,
      utt: time
    });
  }
}
