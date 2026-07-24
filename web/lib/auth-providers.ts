import type { OAuth2Tokens, OAuth2UserInfo } from "better-auth/oauth2";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";

type ProviderEnvName =
  | "DISCORD_CLIENT_ID"
  | "DISCORD_CLIENT_SECRET"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "GITLAB_BASE_URL"
  | "GITLAB_CLIENT_ID"
  | "GITLAB_CLIENT_SECRET"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "LINUXDO_CLIENT_ID"
  | "LINUXDO_CLIENT_SECRET"
  | "MODELSCOPE_CLIENT_ID"
  | "MODELSCOPE_CLIENT_SECRET"
  | "WATCHA_CLIENT_ID"
  | "WATCHA_CLIENT_SECRET";

type ProviderCredentials = {
  clientId: ProviderEnvName;
  clientSecret: ProviderEnvName;
};

type ProviderBase = {
  label: string;
  credentials: ProviderCredentials;
};

type SocialProviderDefinition = ProviderBase & {
  id: "discord" | "github" | "google";
  kind: "social";
};

type OAuth2ProviderDefinition = ProviderBase & {
  id: "gitlab" | "linuxdo" | "modelscope" | "watcha";
  kind: "oauth2";
  scopes: string[];
  baseUrl?: ProviderEnvName;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  redirectURI?: string;
  pkce?: boolean;
  getUserInfo?: (
    tokens: OAuth2Tokens,
    env?: NodeJS.ProcessEnv,
  ) => Promise<OAuth2UserInfo | null>;
};

export type LoginProvider = Pick<
  SocialProviderDefinition | OAuth2ProviderDefinition,
  "id" | "kind" | "label"
>;

async function getWatchaUserInfo(tokens: OAuth2Tokens) {
  const response = await fetch(
    `https://watcha.cn/oauth/api/userinfo?access_token=${tokens.accessToken}`,
  );
  const data = (await response.json()) as {
    statusCode: number;
    data?: {
      user_id: number;
      nickname: string;
      avatar_url?: string;
    };
  };

  if (!data.data || data.statusCode !== 200) {
    return null;
  }

  return {
    id: String(data.data.user_id),
    name: data.data.nickname,
    image: data.data.avatar_url || undefined,
    email: `${data.data.user_id}@watcha.local`,
    emailVerified: true,
  };
}

async function getGitLabUserInfo(tokens: OAuth2Tokens, env = process.env) {
  const baseUrl = getEnvValue("GITLAB_BASE_URL", env)?.replace(/\/+$/, "");
  if (!baseUrl) {
    return null;
  }

  const response = await fetch(`${baseUrl}/api/v4/user`, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    id: number | string;
    name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
    email?: string | null;
    public_email?: string | null;
    confirmed_at?: string | null;
  };

  const id = String(data.id);
  const email =
    data.email ||
    data.public_email ||
    (data.username ? `${data.username}@gitlab.local` : `${id}@gitlab.local`);

  return {
    id,
    name: data.name || data.username || "GitLab User",
    image: data.avatar_url || undefined,
    email,
    emailVerified: Boolean(
      data.confirmed_at || data.email || data.public_email,
    ),
  };
}

async function getModelScopeUserInfo(tokens: OAuth2Tokens) {
  const response = await fetch("https://www.modelscope.cn/oauth/userinfo", {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    sub?: string | null;
    name?: string | null;
    preferred_username?: string | null;
    picture?: string | null;
    email?: string | null;
    email_verified?: boolean | null;
  };
  const id = data.sub?.trim();

  if (!id) {
    return null;
  }

  const email = data.email?.trim();
  return {
    id,
    name: data.name || data.preferred_username || "ModelScope User",
    image: data.picture || undefined,
    email: email || `${id}@modelscope.local`,
    emailVerified: Boolean(email && data.email_verified),
  };
}

const socialProviderDefinitions: readonly SocialProviderDefinition[] = [
  {
    id: "discord",
    kind: "social",
    label: "Discord",
    credentials: {
      clientId: "DISCORD_CLIENT_ID",
      clientSecret: "DISCORD_CLIENT_SECRET",
    },
  },
  {
    id: "github",
    kind: "social",
    label: "GitHub",
    credentials: {
      clientId: "GITHUB_CLIENT_ID",
      clientSecret: "GITHUB_CLIENT_SECRET",
    },
  },
  {
    id: "google",
    kind: "social",
    label: "Google",
    credentials: {
      clientId: "GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
    },
  },
] as const;

const oauth2ProviderDefinitions: readonly OAuth2ProviderDefinition[] = [
  {
    id: "gitlab",
    kind: "oauth2",
    label: "GitLab",
    credentials: {
      clientId: "GITLAB_CLIENT_ID",
      clientSecret: "GITLAB_CLIENT_SECRET",
    },
    baseUrl: "GITLAB_BASE_URL",
    scopes: ["read_user"],
    getUserInfo: getGitLabUserInfo,
  },
  {
    id: "linuxdo",
    kind: "oauth2",
    label: "Linux.do",
    credentials: {
      clientId: "LINUXDO_CLIENT_ID",
      clientSecret: "LINUXDO_CLIENT_SECRET",
    },
    authorizationUrl: "https://connect.linux.do/oauth2/authorize",
    tokenUrl: "https://connect.linux.do/oauth2/token",
    userInfoUrl: "https://connect.linux.do/api/user",
    scopes: ["read"],
  },
  {
    id: "modelscope",
    kind: "oauth2",
    label: "ModelScope",
    credentials: {
      clientId: "MODELSCOPE_CLIENT_ID",
      clientSecret: "MODELSCOPE_CLIENT_SECRET",
    },
    authorizationUrl: "https://www.modelscope.cn/oauth/authorize",
    tokenUrl: "https://www.modelscope.cn/oauth/token",
    userInfoUrl: "https://www.modelscope.cn/oauth/userinfo",
    scopes: ["openid", "profile"],
    getUserInfo: getModelScopeUserInfo,
  },
  {
    id: "watcha",
    kind: "oauth2",
    label: "Watcha",
    credentials: {
      clientId: "WATCHA_CLIENT_ID",
      clientSecret: "WATCHA_CLIENT_SECRET",
    },
    authorizationUrl: "https://watcha.cn/oauth/authorize",
    tokenUrl: "https://watcha.cn/oauth/api/token",
    userInfoUrl: "https://watcha.cn/oauth/api/userinfo",
    scopes: ["read"],
    getUserInfo: getWatchaUserInfo,
  },
] as const;

const providerDefinitions = [
  ...socialProviderDefinitions,
  ...oauth2ProviderDefinitions,
] as const;

function getEnvValue(
  name: ProviderEnvName,
  env = process.env,
): string | undefined {
  return env[name];
}

function hasProviderCredentials(
  credentials: ProviderCredentials,
  env = process.env,
): boolean {
  return Boolean(
    getEnvValue(credentials.clientId, env) &&
      getEnvValue(credentials.clientSecret, env),
  );
}

function resolveProviderBaseUrl(
  name: ProviderEnvName | undefined,
  env = process.env,
): string | null {
  if (!name) {
    return null;
  }

  const value = getEnvValue(name, env)?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

function hasOAuth2ProviderConfig(
  provider: OAuth2ProviderDefinition,
  env = process.env,
): boolean {
  if (!hasProviderCredentials(provider.credentials, env)) {
    return false;
  }

  if (provider.baseUrl) {
    return Boolean(resolveProviderBaseUrl(provider.baseUrl, env));
  }

  return Boolean(
    provider.authorizationUrl?.trim() &&
      provider.tokenUrl?.trim() &&
      provider.userInfoUrl?.trim(),
  );
}

function getProviderCredentials(
  credentials: ProviderCredentials,
  env = process.env,
): { clientId: string; clientSecret: string } | null {
  const clientId = getEnvValue(credentials.clientId, env);
  const clientSecret = getEnvValue(credentials.clientSecret, env);

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
  };
}

export function getEnabledLoginProviders(env = process.env): LoginProvider[] {
  return providerDefinitions.reduce<LoginProvider[]>((acc, provider) => {
    const isEnabled =
      provider.kind === "social"
        ? hasProviderCredentials(provider.credentials, env)
        : hasOAuth2ProviderConfig(provider, env);
    if (isEnabled) {
      acc.push({ id: provider.id, kind: provider.kind, label: provider.label });
    }
    return acc;
  }, []);
}

export function isSocialProviderEnabled(
  providerId: "discord" | "github" | "google",
  env = process.env,
): boolean {
  const provider = socialProviderDefinitions.find(
    (candidate) => candidate.id === providerId,
  );

  return provider ? hasProviderCredentials(provider.credentials, env) : false;
}

export function getEnabledOAuth2ProviderConfigs(
  env = process.env,
): GenericOAuthConfig[] {
  return oauth2ProviderDefinitions.flatMap((provider) => {
    if (!hasOAuth2ProviderConfig(provider, env)) {
      return [];
    }

    const credentials = getProviderCredentials(provider.credentials, env);
    const baseUrl = resolveProviderBaseUrl(provider.baseUrl, env);
    if (!credentials) {
      return [];
    }

    const authorizationUrl =
      provider.authorizationUrl ?? `${baseUrl}/oauth/authorize`;
    const tokenUrl = provider.tokenUrl ?? `${baseUrl}/oauth/token`;
    const userInfoUrl = provider.userInfoUrl ?? `${baseUrl}/api/v4/user`;
    const getUserInfoFn = provider.getUserInfo;
    const getUserInfo = getUserInfoFn
      ? (tokens: OAuth2Tokens) => getUserInfoFn(tokens, env)
      : undefined;

    return [
      {
        providerId: provider.id,
        authorizationUrl,
        tokenUrl,
        userInfoUrl,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        scopes: provider.scopes,
        redirectURI: provider.redirectURI,
        pkce: provider.pkce,
        getUserInfo,
      } satisfies GenericOAuthConfig,
    ];
  });
}
