export function authConfig(env, origin) {
  const domain = env.VITE_AUTH0_DOMAIN?.trim();
  const clientId = env.VITE_AUTH0_CLIENT_ID?.trim();
  const audience = env.VITE_AUTH0_AUDIENCE?.trim();
  if (!domain || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(domain) || !clientId || !audience) {
    throw new Error('Set the public Auth0 identifiers in web/.env.local using .env.example.');
  }
  return {
    domain, clientId, cacheLocation: 'memory', useRefreshTokens: false,
    authorizationParams: {audience, redirect_uri: origin, scope: 'openid'}
  };
}
