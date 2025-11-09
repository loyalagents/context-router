import { registerAs } from '@nestjs/config';

export default registerAs('graphql', () => ({
  playground: process.env.GRAPHQL_PLAYGROUND === 'true',
  debug: process.env.GRAPHQL_DEBUG === 'true',
  introspection: process.env.NODE_ENV !== 'production',
}));
