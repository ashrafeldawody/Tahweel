import { Code } from '@mantine/core';

export function JsonView({ value }: { value: unknown }) {
  const text = value === null || value === undefined ? 'null' : JSON.stringify(value, null, 2);
  return (
    <Code block fz="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text}
    </Code>
  );
}
