import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const authMock = {
  status: 'anonymous',
  user: null,
  googleConfigured: true,
  googleClientId: 'google-client',
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  refresh: vi.fn(),
  verifyEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  resendVerification: vi.fn(),
  updateProfile: vi.fn(),
  listSessions: vi.fn(),
  getWorkspace: vi.fn(),
  revokeSession: vi.fn(),
  signInWithGoogle: vi.fn(),
};

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => authMock,
}));

const { AuthScreen } = await import('../auth/AuthScreen');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthScreen', () => {
  it('renders enterprise login with Google sign-in when configured', () => {
    window.history.pushState({}, '', '/auth/login');
    render(<AuthScreen />);
    expect(screen.getByRole('heading', { name: 'Access AI-Trader' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeDisabled();
  });

  it('renders reset flow from the auth reset route', () => {
    window.history.pushState({}, '', '/auth/reset?token=abc');
    render(<AuthScreen />);
    expect(screen.getByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });
});
