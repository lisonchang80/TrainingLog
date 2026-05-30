/**
 * Slice 13d — failure-envelope factories shared by the inbound WC handler
 * orchestrators (`watchSessionDiscard`, `watchSessionResolve`).
 *
 * These factories enforce the Q11 never-throws structured-result contract:
 * every inbound handler turns a guard failure or a thrown DB error into a
 * flat `{ ok: false, code, message }` shape instead of throwing. If the
 * `dbError` Error-vs-String mapping or any `code` literal drifts, every Watch
 * handler's error path silently changes — so this file locks the *exact*
 * literals.
 */
import {
  badPayload,
  wrongSide,
  dbError,
} from '../../src/services/watchHandlerResult';

describe('watchHandlerResult — failure-envelope factories', () => {
  describe('badPayload', () => {
    it('returns the exact bad-payload shape with caller-supplied message', () => {
      const r = badPayload('missing sessionId');
      expect(r).toEqual({
        ok: false,
        code: 'bad-payload',
        message: 'missing sessionId',
      });
    });

    it('ok is always false', () => {
      expect(badPayload('x').ok).toBe(false);
    });

    it('code is the exact literal "bad-payload"', () => {
      expect(badPayload('x').code).toBe('bad-payload');
    });

    it('passes an empty message through verbatim', () => {
      expect(badPayload('').message).toBe('');
    });
  });

  describe('wrongSide', () => {
    it('returns the exact wrong-side shape with caller-supplied message', () => {
      const r = wrongSide('self-echo from iPhone');
      expect(r).toEqual({
        ok: false,
        code: 'wrong-side',
        message: 'self-echo from iPhone',
      });
    });

    it('ok is always false', () => {
      expect(wrongSide('x').ok).toBe(false);
    });

    it('code is the exact literal "wrong-side"', () => {
      expect(wrongSide('x').code).toBe('wrong-side');
    });
  });

  describe('dbError', () => {
    it('maps a thrown Error to its .message', () => {
      const r = dbError(new Error('UNIQUE constraint failed'));
      expect(r).toEqual({
        ok: false,
        code: 'db-error',
        message: 'UNIQUE constraint failed',
      });
    });

    it('code is the exact literal "db-error"', () => {
      expect(dbError(new Error('boom')).code).toBe('db-error');
    });

    it('ok is always false', () => {
      expect(dbError(new Error('boom')).ok).toBe(false);
    });

    it('preserves an Error subclass .message (uses .message, not name)', () => {
      class CascadeError extends Error {}
      const r = dbError(new CascadeError('cascade rollback'));
      expect(r.message).toBe('cascade rollback');
    });

    it('uses an empty Error message verbatim (does not fall back to String)', () => {
      // `new Error('')` is still `instanceof Error`, so the Error branch wins
      // and `.message` ('') is used — NOT `String(err)` ('Error').
      const r = dbError(new Error(''));
      expect(r.message).toBe('');
    });

    it('maps a thrown string via String(err)', () => {
      const r = dbError('raw string failure');
      expect(r).toEqual({
        ok: false,
        code: 'db-error',
        message: 'raw string failure',
      });
    });

    it('maps a thrown number via String(err)', () => {
      expect(dbError(42).message).toBe('42');
    });

    it('maps null via String(err)', () => {
      expect(dbError(null).message).toBe('null');
    });

    it('maps undefined via String(err)', () => {
      expect(dbError(undefined).message).toBe('undefined');
    });

    it('maps a plain object via String(err)', () => {
      // Default Object#toString → '[object Object]'.
      expect(dbError({ code: 'X' }).message).toBe('[object Object]');
    });

    it('respects a custom toString on a non-Error throw', () => {
      const weird = { toString: () => 'custom-stringified' };
      expect(dbError(weird).message).toBe('custom-stringified');
    });
  });
});
