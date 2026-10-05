import { uuidv7 } from './uuid-v7.js';

describe('uuidv7', () => {
  it('is a version 7, RFC variant UUID', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('sorts by time', () => {
    const ids = [uuidv7(1_000), uuidv7(2_000), uuidv7(3_000)];
    expect([...ids].sort()).toEqual(ids);
  });
});
