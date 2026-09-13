import { Table, Text } from '@mantine/core';
import type { ReactNode } from 'react';

export interface Field {
  label: string;
  value: ReactNode;
}

function renderValue(value: ReactNode): ReactNode {
  if (value === null || value === undefined || value === '') {
    return (
      <Text span c="dimmed" size="sm">
        —
      </Text>
    );
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return value;
}

export function FieldList({ fields }: { fields: Field[] }) {
  return (
    <Table withRowBorders={false} highlightOnHover={false} verticalSpacing={4}>
      <Table.Tbody>
        {fields.map((field) => (
          <Table.Tr key={field.label}>
            <Table.Td w={150} style={{ verticalAlign: 'top' }}>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                {field.label}
              </Text>
            </Table.Td>
            <Table.Td style={{ wordBreak: 'break-word' }}>
              <Text size="sm" span>
                {renderValue(field.value)}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
