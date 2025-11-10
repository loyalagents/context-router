import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  auth0: {
    domain: process.env.AUTH0_DOMAIN,
    audience: process.env.AUTH0_AUDIENCE,
    issuer: process.env.AUTH0_ISSUER || `https://${process.env.AUTH0_DOMAIN}/`,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    managementApiAudience:
      process.env.AUTH0_MANAGEMENT_API_AUDIENCE ||
      `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  },
  syncStrategy: process.env.AUTH0_SYNC_STRATEGY || 'ON_LOGIN', // ON_LOGIN, ON_DEMAND, BACKGROUND
}));
