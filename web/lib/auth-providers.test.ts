import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getEnabledLoginProviders,
  getEnabledOAuth2ProviderConfigs,
} from "./auth-providers";

const modelScopeEnv = {
  MODELSCOPE_CLIENT_ID: "modelscope-client-id",
  MODELSCOPE_CLIENT_SECRET: "modelscope-client-secret",
};

describe("ModelScope OAuth provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is enabled only when both client credentials are configured", () => {
    expect(getEnabledLoginProviders(modelScopeEnv)).toEqual([
      { id: "modelscope", kind: "oauth2", label: "ModelScope" },
    ]);
    expect(
      getEnabledLoginProviders({
        MODELSCOPE_CLIENT_ID: "modelscope-client-id",
      }),
    ).toEqual([]);
  });

  it("uses ModelScope OIDC endpoints and normalizes its userinfo response", async () => {
    const [provider] = getEnabledOAuth2ProviderConfigs(modelScopeEnv);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: "modelscope-user-id",
        preferred_username: "modelscope-user",
        picture: "https://example.com/avatar.png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(provider).toMatchObject({
      providerId: "modelscope",
      authorizationUrl: "https://www.modelscope.cn/oauth/authorize",
      tokenUrl: "https://www.modelscope.cn/oauth/token",
      userInfoUrl: "https://www.modelscope.cn/oauth/userinfo",
      scopes: ["openid", "profile"],
    });

    await expect(
      provider.getUserInfo?.({ accessToken: "access-token" }),
    ).resolves.toEqual({
      id: "modelscope-user-id",
      name: "modelscope-user",
      image: "https://example.com/avatar.png",
      email: "modelscope-user-id@modelscope.local",
      emailVerified: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.modelscope.cn/oauth/userinfo",
      { headers: { Authorization: "Bearer access-token" } },
    );
  });
});
