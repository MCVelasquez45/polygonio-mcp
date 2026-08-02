import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const authMock = {
  status: 'anonymous',
  user: null,
  googleConfigured: true,
  googleClientId: 'google-client',
  authConfigStatus: 'ready',
  alpacaConfigured: true,
  alpacaPaper: true,
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
  updateOnboarding: vi.fn(),
  connectPaperBroker: vi.fn(),
  connectAlpacaBroker: vi.fn(),
  completeOnboarding: vi.fn(),
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
  authMock.googleConfigured = true;
  authMock.authConfigStatus = 'ready';
});

describe('AuthScreen', () => {
  it('renders enterprise login with Google sign-in when configured', () => {
    window.history.pushState({}, '', '/auth/login');
    render(<AuthScreen />);
    expect(screen.getByRole('heading', { name: 'Sign in to AI-Trader' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeDisabled();
    expect(screen.getByLabelText('Show password')).toBeInTheDocument();
  });

  it('renders reset flow from the auth reset route', () => {
    window.history.pushState({}, '', '/auth/reset?token=abc');
    render(<AuthScreen />);
    expect(screen.getByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('explains when Google authentication is unavailable', () => {
    authMock.googleConfigured = false;
    window.history.pushState({}, '', '/auth/login');
    render(<AuthScreen />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Google sign-in is not configured');
  });
});
