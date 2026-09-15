import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => null }));

import { createCloudAuthService } from '@/features/cloud-auth/auth.service';

function client() {
  return {
    auth: {
      getSession: vi.fn(),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  };
}

describe('cloud auth service', () => {
  it('normalizes email and returns a signup awaiting confirmation', async () => {
    const mock = client();
    mock.auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'user' } },
      error: null,
    });
    const service = createCloudAuthService(mock as never);

    await expect(service.signUp(' user@example.test ', 'password123')).resolves.toEqual({
      session: null,
      user: { id: 'user' },
    });
    expect(mock.auth.signUp).toHaveBeenCalledWith({
      email: 'user@example.test',
      password: 'password123',
    });
  });

  it('maps expected sign-in failures without exposing provider payloads', async () => {
    const mock = client();
    mock.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    });

    await expect(
      createCloudAuthService(mock as never).signIn('a@example.test', 'wrong'),
    ).rejects.toThrow('Invalid email or password.');
  });

  it('supports persisted session restoration and sign out', async () => {
    const mock = client();
    const session = { user: { id: 'user' } };
    mock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    mock.auth.signOut.mockResolvedValue({ error: null });
    const service = createCloudAuthService(mock as never);

    await expect(service.getSession()).resolves.toBe(session);
    await expect(service.signOut()).resolves.toBeUndefined();
  });

  it('says why an account could not be created', async () => {
    const cases: [{ message: string; code?: string; status?: number }, string][] = [
      [
        { message: 'Email rate limit exceeded', code: 'over_email_send_rate_limit', status: 429 },
        'Too many confirmation emails were requested. Wait a while, then try again.',
      ],
      [
        { message: 'Error sending confirmation email', code: 'unexpected_failure', status: 500 },
        'The confirmation email could not be sent. Try again later.',
      ],
      [
        { message: 'Password is known to be weak', code: 'weak_password', status: 422 },
        'Choose a stronger password: at least 8 characters, and not a common one.',
      ],
      [
        { message: 'Email address "a@b.c" is invalid', code: 'email_address_invalid', status: 400 },
        'That email address cannot be used. Check it, or use another address.',
      ],
      [
        { message: 'Signups not allowed for this instance', code: 'signup_disabled', status: 422 },
        'New cloud accounts cannot be created right now.',
      ],
      [
        { message: 'User already registered', code: 'user_already_exists', status: 422 },
        'Unable to create an account with that email.',
      ],
      // An older server with no code still gets the specific sentence.
      [
        { message: 'Error sending confirmation email' },
        'The confirmation email could not be sent.',
      ],
    ];
    for (const [error, expected] of cases) {
      const mock = client();
      mock.auth.signUp.mockResolvedValue({ data: { session: null, user: null }, error });
      await expect(
        createCloudAuthService(mock as never).signUp('a@example.test', 'password123'),
      ).rejects.toThrow(expected);
    }
  });

  it('never shows the provider’s own text for a failure it does not recognise', async () => {
    const mock = client();
    mock.auth.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Database error saving new user', code: 'unexpected_failure', status: 500 },
    });
    await expect(
      createCloudAuthService(mock as never).signUp('a@example.test', 'password123'),
    ).rejects.toThrow(/^Cloud Account request could not be completed\.$/);
  });

  it('reports the unavailable state without a configured client', async () => {
    const service = createCloudAuthService(null);
    expect(service.isConfigured).toBe(false);
    await expect(service.signIn('a@example.test', 'password123')).rejects.toThrow(
      'Cloud Sync is not configured in this build.',
    );
  });
});
