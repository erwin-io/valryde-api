import { OAuth2Client } from 'google-auth-library';

import { ApiError } from '../lib/api-error.js';

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  displayName: string;
}

export interface GoogleIdentityService {
  verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity>;
}

export interface GoogleTokenVerifier {
  verifyIdToken(options: {
    idToken: string;
    audience: string | string[];
  }): Promise<{
    getPayload():
      | { sub?: string; email?: string; email_verified?: boolean; name?: string }
      | undefined;
  }>;
}

export class GoogleAuthLibraryIdentityService implements GoogleIdentityService {
  constructor(
    private readonly clientIds: string[],
    private readonly client: GoogleTokenVerifier = new OAuth2Client(),
  ) {}

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (this.clientIds.length === 0) {
      throw new ApiError(
        503,
        'GOOGLE_SIGN_IN_UNAVAILABLE',
        'Google sign-in has not been configured',
      );
    }
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientIds });
      const payload = ticket.getPayload();
      if (
        payload?.sub === undefined ||
        payload.email === undefined ||
        payload.email_verified !== true
      ) {
        throw new Error('Google identity is missing a verified email');
      }
      return {
        subject: payload.sub,
        email: payload.email.toLowerCase(),
        displayName: payload.name?.trim() || payload.email.split('@')[0] || 'Valryde user',
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Google identity token is invalid');
    }
  }
}
