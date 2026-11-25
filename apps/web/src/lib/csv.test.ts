import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('round-trips quotes, commas and new lines', () => {
    const rows = [
      ['sample', 'note'],
      ['S26-000001', 'He said "ok", then left'],
      ['S26-000002', 'two\nlines'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('reads Excel semicolon files, BOM and CRLF, and skips blank lines', () => {
    expect(parseCsv('﻿sample;org_50\r\nS1;1,5\r\n\r\nS2;3\r\n')).toEqual([
      ['sample', 'org_50'],
      ['S1', '1,5'],
      ['S2', '3'],
    ]);
  });

  it('keeps empty cells', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});
