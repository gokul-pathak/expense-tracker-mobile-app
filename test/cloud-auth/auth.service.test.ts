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

  it('reports the unavailable state without a configured client', async () => {
    const service = createCloudAuthService(null);
    expect(service.isConfigured).toBe(false);
    await expect(service.signIn('a@example.test', 'password123')).rejects.toThrow(
      'Cloud Sync is not configured in this build.',
    );
  });
});
