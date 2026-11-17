import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensurePrivateDir, defaultDataDir } from '../../src/services/private-dir';

const posix = process.platform === 'win32' ? describe.skip : describe;
const modeOf = (p: string) => fs.statSync(p).mode & 0o777;

posix('ensurePrivateDir', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'private-dir-test-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('creates a missing dir owner-only', () => {
    const d = path.join(tmp, 'new');
    ensurePrivateDir(d);
    expect(modeOf(d)).toBe(0o700);
  });

  it('tightens an existing world-readable dir when asked', () => {
    const d = path.join(tmp, 'existing');
    fs.mkdirSync(d, { mode: 0o755 });
    fs.chmodSync(d, 0o755);
    ensurePrivateDir(d, { tighten: true });
    expect(modeOf(d)).toBe(0o700);
  });

  it('leaves an existing dir alone without tighten (user-chosen DB path)', () => {
    const d = path.join(tmp, 'shared');
    fs.mkdirSync(d);
    fs.chmodSync(d, 0o755);
    ensurePrivateDir(d);
    expect(modeOf(d)).toBe(0o755);
  });

  it('defaultDataDir is ~/.claude-recall', () => {
    expect(defaultDataDir('/home/u')).toBe(path.join('/home/u', '.claude-recall'));
  });
});
