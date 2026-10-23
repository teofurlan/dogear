// @vitest-environment node
import {expect, test, vi} from 'vitest';
import {registerPwa} from './pwa.js';

function environment({production = true, secure = true, supported = true} = {}) {
  const register = vi.fn().mockResolvedValue({});
  const navigator = supported ? {serviceWorker: {register}} : {};
  const location = {protocol: secure ? 'https:' : 'http:', hostname: 'dogear.test'};
  return {register, navigator, location, production, secureContext: secure};
}

test('registers the root service worker only in production on a secure supported origin', () => {
  const env = environment();
  expect(registerPwa(env)).toBe(true);
  expect(env.register).toHaveBeenCalledWith('/sw.js', {scope: '/'});
});

test.each([
  {production: false, secure: true, supported: true},
  {production: true, secure: false, supported: true},
  {production: true, secure: true, supported: false}
])('does not register when the environment is not eligible: %j', options => {
  const env = environment(options);
  expect(registerPwa(env)).toBe(false);
  expect(env.register).not.toHaveBeenCalled();
});

test('does not throw or leak registration failures', async () => {
  const env = environment();
  env.register.mockRejectedValue(new Error('https://private.example/token?secret=1'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(registerPwa(env)).toBe(true);
  await Promise.resolve();
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});
