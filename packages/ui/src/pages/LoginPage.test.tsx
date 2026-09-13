import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TOKEN_STORAGE_KEY } from '../auth/token';
import { mockFetch } from '../test/fetchMock';
import { renderWithProviders } from '../test/render';
import { LoginPage } from './LoginPage';

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/login" element={<LoginPage />} />
      <Route path="/app/overview" element={<div>Overview landing</div>} />
    </Routes>,
    { route: '/app/login' },
  );
}

describe('LoginPage', () => {
  it('submits the password, stores the token and moves on', async () => {
    const { calls } = mockFetch({
      'POST /admin/login': { body: { token: 'jwt-123', expires_at: '2026-09-14T10:00:00.000Z' } },
    });
    renderLogin();

    await userEvent.type(screen.getByLabelText(/password/i), 'secret');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-123'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/admin/login', body: { password: 'secret' } });
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(await screen.findByText('Overview landing')).toBeInTheDocument();
  });

  it('shows an error when the password is rejected', async () => {
    mockFetch({ 'POST /admin/login': { status: 401, body: { error: 'invalid_password' } } });
    renderLogin();

    await userEvent.type(screen.getByLabelText(/password/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong password/i);
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText('Overview landing')).not.toBeInTheDocument();
  });
});
