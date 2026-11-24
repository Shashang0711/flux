import { normaliseImoNumber } from '@flux/shared';

describe('normaliseImoNumber', () => {
  it.each([
    ['9074729', '9074729'],
    ['IMO 9074729', '9074729'],
    ['imo9176187', '9176187'],
    [' 931 9466 ', '9319466'],
  ])('accepts %s', (input, expected) => {
    expect(normaliseImoNumber(input)).toBe(expected);
  });

  it.each([['9074728'], ['907472'], ['90747290'], ['ABCDEFG'], ['']])('rejects %s', (input) => {
    expect(normaliseImoNumber(input)).toBeNull();
  });
});
