/**
 * ADR-0028 restart-resilience — cast lock persistence (collapse + clear +
 * validate). Mocks the settings primitives so the unit under test is the
 * collapse / clear / validation logic, not SQLite.
 */

import {
  persistCastLock,
  loadCastLock,
  clearCastLock,
  CAST_LOCK_STATE_KEY,
  type PersistedCastLock,
} from '../../src/services/castLockPersistence';
import {
  getSetting,
  setSetting,
  deleteSetting,
} from '../../src/adapters/sqlite/settingsRepository';
import type { EditLockState } from '../../src/adapters/watch';
import type { Database } from '../../src/db/types';

jest.mock('../../src/adapters/sqlite/settingsRepository');

const mockGet = getSetting as jest.MockedFunction<typeof getSetting>;
const mockSet = setSetting as jest.MockedFunction<typeof setSetting>;
const mockDel = deleteSetting as jest.MockedFunction<typeof deleteSetting>;

const db = {} as Database;

function state(partial: Partial<EditLockState>): EditLockState {
  return {
    role: 'iphone',
    status: 'holder',
    epoch: 1,
    sessionId: 'sess-1',
    requestTimedOut: false,
    ...partial,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('persistCastLock — collapse', () => {
  it('holder persists as holder', async () => {
    await persistCastLock(db, state({ status: 'holder', epoch: 3 }));
    expect(mockSet).toHaveBeenCalledWith(db, CAST_LOCK_STATE_KEY, {
      sessionId: 'sess-1',
      epoch: 3,
      status: 'holder',
    });
  });

  it('offering collapses to holder', async () => {
    await persistCastLock(db, state({ status: 'offering' }));
    expect(mockSet).toHaveBeenCalledWith(
      db,
      CAST_LOCK_STATE_KEY,
      expect.objectContaining({ status: 'holder' }),
    );
  });

  it('locked persists as locked', async () => {
    await persistCastLock(db, state({ status: 'locked', epoch: 2 }));
    expect(mockSet).toHaveBeenCalledWith(
      db,
      CAST_LOCK_STATE_KEY,
      expect.objectContaining({ status: 'locked', epoch: 2 }),
    );
  });

  it('requesting collapses to locked', async () => {
    await persistCastLock(db, state({ status: 'requesting' }));
    expect(mockSet).toHaveBeenCalledWith(
      db,
      CAST_LOCK_STATE_KEY,
      expect.objectContaining({ status: 'locked' }),
    );
  });
});

describe('persistCastLock — clear', () => {
  it('unpaired clears the row (no setSetting)', async () => {
    await persistCastLock(db, state({ status: 'unpaired', sessionId: null, epoch: 0 }));
    expect(mockDel).toHaveBeenCalledWith(db, CAST_LOCK_STATE_KEY);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('paired but null sessionId also clears (defensive)', async () => {
    await persistCastLock(db, state({ status: 'holder', sessionId: null }));
    expect(mockDel).toHaveBeenCalledWith(db, CAST_LOCK_STATE_KEY);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('loadCastLock — validate', () => {
  it('returns a well-formed snapshot', async () => {
    const good: PersistedCastLock = { sessionId: 's', epoch: 4, status: 'locked' };
    mockGet.mockResolvedValueOnce(good);
    expect(await loadCastLock(db)).toEqual(good);
  });

  it('returns null when absent', async () => {
    mockGet.mockResolvedValueOnce(null);
    expect(await loadCastLock(db)).toBeNull();
  });

  it('returns null on a malformed status', async () => {
    mockGet.mockResolvedValueOnce({ sessionId: 's', epoch: 1, status: 'bogus' } as never);
    expect(await loadCastLock(db)).toBeNull();
  });

  it('returns null on a non-numeric epoch', async () => {
    mockGet.mockResolvedValueOnce({ sessionId: 's', epoch: 'x', status: 'holder' } as never);
    expect(await loadCastLock(db)).toBeNull();
  });
});

describe('clearCastLock', () => {
  it('deletes the key', async () => {
    await clearCastLock(db);
    expect(mockDel).toHaveBeenCalledWith(db, CAST_LOCK_STATE_KEY);
  });
});
