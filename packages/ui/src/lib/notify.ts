import { notifications } from '@mantine/notifications';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function notifySuccess(message: string, title = 'Done'): void {
  notifications.show({ color: 'tahweel', title, message });
}

export function notifyError(error: unknown, title = 'Request failed'): void {
  notifications.show({ color: 'red', title, message: errorMessage(error) });
}
