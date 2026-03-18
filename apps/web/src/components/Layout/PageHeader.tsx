import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  action?: ReactNode;
}

export function PageHeader({ title, action }: Props) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
      <Typography variant="h5" fontWeight={600}>
        {title}
      </Typography>
      {action}
    </Box>
  );
}
