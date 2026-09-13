import { Alert, Button, Center, Group, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { setToken, useToken } from '../auth/token';
import { BrandMark } from '../components/BrandMark';
import { errorMessage } from '../lib/notify';

const HOME_ROUTE = '/app/overview';

interface LocationState {
  from?: string;
}

function describeLoginFailure(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return 'Wrong password.';
  return errorMessage(error);
}

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const token = useToken();
  const navigate = useNavigate();
  const location = useLocation();

  const destination = (location.state as LocationState | null)?.from ?? HOME_ROUTE;

  if (token) return <Navigate to={destination} replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.login(password);
      setToken(session.token);
      navigate(destination, { replace: true });
    } catch (failure) {
      setError(describeLoginFailure(failure));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Center mih="100vh" bg="gray.0" p="md">
      <Paper p="xl" w={380} maw="100%" shadow="sm">
        <Stack gap="md">
          <Group gap="sm">
            <BrandMark size={32} />
            <div>
              <Title order={3}>Tahweel</Title>
              <Text size="xs" c="dimmed">
                Wallet receipt confirmation
              </Text>
            </div>
          </Group>
          <Text size="sm" c="dimmed">
            Sign in with the admin password configured on the server.
          </Text>
          <form onSubmit={(event) => void submit(event)}>
            <Stack gap="sm">
              <PasswordInput
                label="Password"
                placeholder="Admin password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
                autoFocus
                autoComplete="current-password"
              />
              {error && (
                <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} role="alert">
                  {error}
                </Alert>
              )}
              <Button type="submit" loading={submitting} fullWidth>
                Sign in
              </Button>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Center>
  );
}
