const purge = require('../src/purge');

const simpleCleaned = /^Visit \/\/[\w-]{7,15}$/;

describe('purge unknown domains', () => {
  test('from a simple string', () => {
    expect(purge('Visit http://example.org')).toMatch(simpleCleaned);
    expect(purge('Visit http://example.org/')).toMatch(simpleCleaned);
    expect(purge('Visit http://google.com.cool')).toMatch(simpleCleaned);
    expect(purge('Visit http://google.co')).toMatch(simpleCleaned);
  });

  test('from a quoted string', () => {
    expect(purge('Visit "http://example.org/"')).toMatch(/^Visit "\/\/[\w-]{7,15}"$/);
    expect(purge('Visit \'http://example.org/\'')).toMatch(/^Visit '\/\/[\w-]{7,15}'$/);
  });

  test('from a string with file', () => {
    expect(purge('Visit http://example.org/download.js')).toMatch(/^Visit \/\/[\w-]{7,15}\/[\w-]{7,15}$/);
  });

  test('from a string with line number', () => {
    expect(purge('Visit http://example.org/download.js:15')).toMatch(/^Visit \/\/[\w-]{7,15}\/[\w-]{7,15}:15$/);
  });

  test('from a array', () => {
    const clean = purge([
      'Visit http://example.org/',
      'Visit https://example.com/'
    ]);
    expect(clean[0]).toMatch(simpleCleaned);
    expect(clean[1]).toMatch(simpleCleaned);
  });

  test('from an object', () => {
    const clean = purge({
      a: 'Visit http://example.org/',
      b: 'Visit https://example.com/'
    });
    expect(clean.a).toMatch(simpleCleaned);
    expect(clean.b).toMatch(simpleCleaned);
  });
  test('from a nested mixed type', () => {
    const clean = purge([
      'Visit http://example.org/',
      {
        a: 'Visit http://example.org/',
        b: [
          'Visit http://example.org/',
          'Visit https://example.com/'
        ]
      }
    ]);
    expect(clean[0]).toMatch(simpleCleaned);
    expect(clean[1].a).toMatch(simpleCleaned);
    expect(clean[1].a).toMatch(simpleCleaned);
  });
});

describe('not purge', () => {
  test('strings without domains', () => {
    expect(purge('')).toBe('');
    expect(purge('foo bar')).toBe('foo bar');
  });

  test('falsies', () => {
    expect(purge(false)).toBe(false);
    expect(purge(null)).toBe(null);
    expect(purge(undefined)).toBe(undefined);
  });

  test('numbers', () => {
    expect(purge(5)).toBe(5);
    expect(purge('5')).toBe('5');
    expect(purge(5.4321)).toBe(5.4321);
  });
});

describe('semi-purge known domains', () => {
  test('from a simple string', () => {
    expect(purge('Visit http://google.com')).toMatch('Visit //google.com');
    expect(purge('Visit http://google.com/')).toMatch('Visit //google.com');
    expect(purge('Visit http://mail.google.com')).toMatch('Visit //mail.google.com');
    expect(purge('Visit http://mail.google.com/')).toMatch('Visit //mail.google.com');
  });

  test('from a string with file', () => {
    expect(purge('Visit http://google.com/download.js')).toMatch(/^Visit \/\/google\.com\/[\w-]{7,15}$/);
    expect(purge('Visit http://mail.google.com/download.js')).toMatch(/^Visit \/\/mail\.google\.com\/[\w-]{7,15}$/);
  });

  test('from a string with line number', () => {
    expect(purge('Visit http://google.com/download.js:15')).toMatch(/^Visit \/\/google\.com\/[\w-]{7,15}:15$/);
    expect(purge('Visit http://mail.google.com/download.js:15')).toMatch(/^Visit \/\/mail\.google\.com\/[\w-]{7,15}:15$/);
  });
});
