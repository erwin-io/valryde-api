import { describe, expect, it, vi } from 'vitest';

import {
  GoogleAuthLibraryIdentityService,
  type GoogleTokenVerifier,
} from '../src/services/google-identity-service.js';

describe('Google token verification adapter', () => {
  it('passes configured audiences and normalizes a verified identity', async () => {
    const verifyIdToken = vi.fn(async () => ({
      getPayload: () => ({
        sub: 'google-subject',
        email: 'Driver@Example.COM',
        email_verified: true,
        name: '  Driver Name  ',
      }),
    }));
    const service = new GoogleAuthLibraryIdentityService(
      ['web-client-id', 'android-client-id'],
      { verifyIdToken },
    );

    await expect(service.verifyIdToken('fixture-token')).resolves.toEqual({
      subject: 'google-subject',
      email: 'driver@example.com',
      displayName: 'Driver Name',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'fixture-token',
      audience: ['web-client-id', 'android-client-id'],
    });
  });

  it('is owner-gated when no approved client IDs are configured', async () => {
    const verifyIdToken = vi.fn();
    const verifier = { verifyIdToken } as unknown as GoogleTokenVerifier;
    const service = new GoogleAuthLibraryIdentityService([], verifier);
    await expect(service.verifyIdToken('fixture-token')).rejects.toMatchObject({
      statusCode: 503,
      code: 'GOOGLE_SIGN_IN_UNAVAILABLE',
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it.each([
    { sub: 'subject', email: 'driver@example.com', email_verified: false },
    { sub: 'subject', email_verified: true },
    { email: 'driver@example.com', email_verified: true },
  ])('rejects incomplete or unverified payloads without exposing provider details', async (payload) => {
    const service = new GoogleAuthLibraryIdentityService(['client-id'], {
      async verifyIdToken() {
        return { getPayload: () => payload };
      },
    });
    await expect(service.verifyIdToken('fixture-token')).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Google identity token is invalid',
    });
  });
});
