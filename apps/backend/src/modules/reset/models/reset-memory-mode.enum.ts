import { registerEnumType } from '@nestjs/graphql';

export enum ResetMemoryMode {
  MEMORY_ONLY = 'MEMORY_ONLY',
  DEMO_DATA = 'DEMO_DATA',
  FULL_USER_DATA = 'FULL_USER_DATA',
}

registerEnumType(ResetMemoryMode, {
  name: 'ResetMemoryMode',
  description: 'Current-user data reset mode.',
});
