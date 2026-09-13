import { Badge, Paper, Table, createTheme, type MantineColorsTuple } from '@mantine/core';

const tahweel: MantineColorsTuple = [
  '#effcf9',
  '#c9f4ea',
  '#9de9d8',
  '#6bdac3',
  '#3fc8ad',
  '#1fa892',
  '#0F766E',
  '#0d625b',
  '#0b4f49',
  '#083b37',
];

export const theme = createTheme({
  primaryColor: 'tahweel',
  primaryShade: 6,
  colors: { tahweel },
  defaultRadius: 'md',
  fontFamily: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", Consolas, "Courier New", monospace',
  headings: { fontWeight: '600' },
  components: {
    Table: Table.extend({
      defaultProps: { highlightOnHover: true, verticalSpacing: 'xs', horizontalSpacing: 'sm', fz: 'sm' },
    }),
    Paper: Paper.extend({
      defaultProps: { withBorder: true, radius: 'md' },
    }),
    Badge: Badge.extend({
      defaultProps: { radius: 'sm', variant: 'light' },
    }),
  },
});
