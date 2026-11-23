import { Paginated, toSkipTake } from './pagination';

describe('pagination helpers', () => {
  it('converts page/pageSize to skip/take', () => {
    expect(toSkipTake({ page: 3, pageSize: 25 })).toEqual({ skip: 50, take: 25 });
  });

  it('computes totalPages, including the empty case', () => {
    expect(new Paginated([], 0, { page: 1, pageSize: 20 }).meta.totalPages).toBe(0);
    expect(new Paginated([], 41, { page: 1, pageSize: 20 }).meta.totalPages).toBe(3);
  });
});
