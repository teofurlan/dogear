import {expect,test} from 'vitest';
import {authConfig} from './config.js';
const env={VITE_AUTH0_DOMAIN:'tenant.auth0.com',VITE_AUTH0_CLIENT_ID:'public-client',VITE_AUTH0_AUDIENCE:'https://api.dogear'};
test('the SPA configuration contains public identifiers and requests only basic identity',()=>{
  const config=authConfig(env,'http://localhost:5173');
  expect(config.cacheLocation).toBe('memory');
  expect(config.useRefreshTokens).toBe(false);
  expect(config.authorizationParams).toEqual({audience:env.VITE_AUTH0_AUDIENCE,redirect_uri:'http://localhost:5173',scope:'openid'});
});
test('missing identifiers and URL-shaped tenant names never enable a mock login',()=>{
  expect(()=>authConfig({},'http://localhost:5173')).toThrow();
  expect(()=>authConfig({...env,VITE_AUTH0_DOMAIN:'https://wrong.example/path'},'http://localhost:5173')).toThrow();
});
