import { Alert, Center, Loader, Table, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { errorMessage } from '../lib/notify';

export function ErrorAlert({ error, title = 'Could not load' }: { error: unknown; title?: string }) {
  return (
    <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} title={title}>
      {errorMessage(error)}
    </Alert>
  );
}

export function LoadingBlock() {
  return (
    <Center p="xl">
      <Loader size="sm" />
    </Center>
  );
}

export function EmptyRow({ colSpan, label = 'Nothing here yet.' }: { colSpan: number; label?: string }) {
  return (
    <Table.Tr>
      <Table.Td colSpan={colSpan}>
        <Text size="sm" c="dimmed" ta="center" py="md">
          {label}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}
