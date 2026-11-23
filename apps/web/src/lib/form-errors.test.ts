import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { errorMessage, fieldErrors } from './form-errors';

describe('fieldErrors', () => {
  it('reads validation issues (array form)', () => {
    const error = new ApiError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [
        { path: 'email', message: 'Enter a valid email address' },
        { path: 'email', message: 'second message is ignored' },
        { path: 'password', message: 'Too short' },
      ],
    });
    expect(fieldErrors(error)).toEqual({
      email: 'Enter a valid email address',
      password: 'Too short',
    });
  });

  it('reads conflict issues ({ fields } form)', () => {
    const error = new ApiError(409, {
      code: 'CONFLICT',
      message: 'A user with this email already exists',
      details: { fields: [{ path: 'admin.email', message: 'Email is already in use' }] },
    });
    expect(fieldErrors(error)).toEqual({ 'admin.email': 'Email is already in use' });
  });

  it('returns nothing for other errors', () => {
    expect(fieldErrors(new Error('x'))).toEqual({});
    expect(errorMessage(new Error('x'))).toBe('Something went wrong. Please try again.');
  });
});
