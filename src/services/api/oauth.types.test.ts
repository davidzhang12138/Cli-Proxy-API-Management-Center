import type { OAuthStartOptions } from './oauth';

const oauthStartOptionsAcceptsProxyUrl = {
  proxyUrl: 'socks5://127.0.0.1:1080',
} satisfies OAuthStartOptions;

void oauthStartOptionsAcceptsProxyUrl;
