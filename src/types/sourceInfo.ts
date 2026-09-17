export type SourceInfo = {
  displayName: string;
  type: string;
  identityKey?: string;
  rawName?: string;
};

export type CredentialInfo = {
  name: string;
  type: string;
  rawName?: string;
  /** 账号邮箱。监控中心「渠道-邮箱」展示用；api-key 类凭证后端不下发，此时为空。 */
  email?: string;
};
