"use client";

import { Mail } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { SiDiscord, SiGithub, SiGitlab, SiGoogle } from "react-icons/si";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import type { LoginProvider } from "@/lib/auth-providers";

type ConnectedAccountRecord = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  scopes: string[];
};

type ConnectedAccountsCardProps = {
  accounts?: ConnectedAccountRecord[];
  availableProviders?: LoginProvider[];
};

type OAuthProviderRow = {
  kind: "oauth";
  key: string;
  providerId: string;
  label: string;
  provider?: LoginProvider;
  account?: ConnectedAccountRecord;
};

async function postAuthAction(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!response.ok) {
    throw payload ?? new Error("Request failed.");
  }

  return payload ?? {};
}

function ProviderIcon({ providerId }: { providerId: string }): ReactNode {
  if (providerId === "credential") {
    return <Mail className="size-5" aria-hidden />;
  }

  switch (providerId) {
    case "discord":
      return <SiDiscord className="size-5 shrink-0" aria-hidden />;
    case "github":
      return <SiGithub className="size-5 shrink-0" aria-hidden />;
    case "gitlab":
      return <SiGitlab className="size-5 shrink-0" aria-hidden />;
    case "google":
      return <SiGoogle className="size-5 shrink-0" aria-hidden />;
    case "linuxdo":
      return (
        <Image
          src="https://linux.do/logo-128.svg"
          alt=""
          width={20}
          height={20}
          className="shrink-0"
        />
      );
    case "modelscope":
      return (
        <Image
          src="https://g.alicdn.com/sail-web/maas/2.13.111/favicon/128.ico"
          alt=""
          width={20}
          height={20}
          className="shrink-0"
          unoptimized
        />
      );
    case "watcha":
      return (
        <Image
          src="https://watcha.tos-cn-beijing.volces.com/products/logo/1752064513_guan-cha-insights.png?x-tos-process=image/resize,w_72/format,webp"
          alt=""
          width={20}
          height={20}
          className="shrink-0"
        />
      );
    default:
      return <Mail className="size-5" aria-hidden />;
  }
}

const providerLabels: Record<string, string> = {
  discord: "Discord",
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  linuxdo: "Linux.do",
  modelscope: "ModelScope",
  watcha: "Watcha",
};

function getProviderLabel(providerId: string) {
  return providerLabels[providerId] ?? providerId;
}

const EMPTY_ACCOUNTS: ConnectedAccountRecord[] = [];
const EMPTY_PROVIDERS: LoginProvider[] = [];

export function ConnectedAccountsCard({
  accounts = EMPTY_ACCOUNTS,
  availableProviders = EMPTY_PROVIDERS,
}: ConnectedAccountsCardProps) {
  const { refresh } = useRouter();
  const t = useTranslations("usage.settings.connectedAccounts");
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    const credentialAccounts = accounts.filter(
      (a) => a.providerId === "credential",
    );

    const credentialRows = credentialAccounts.map((account) => ({
      kind: "credential" as const,
      key: account.id,
      account,
    }));

    const providerById = new Map<string, LoginProvider>(
      availableProviders.map((provider) => [provider.id, provider]),
    );
    const connectedOAuthRows = accounts
      .filter((account) => account.providerId !== "credential")
      .map<OAuthProviderRow>((account) => {
        const provider = providerById.get(account.providerId);
        return {
          kind: "oauth",
          key: `oauth:${account.id}`,
          providerId: account.providerId,
          label: provider?.label ?? getProviderLabel(account.providerId),
          provider,
          account,
        };
      });
    const connectedProviderIds = new Set(
      connectedOAuthRows.map((row) => row.providerId),
    );
    const availableOAuthRows = availableProviders.flatMap<OAuthProviderRow>(
      (provider) => {
        if (connectedProviderIds.has(provider.id)) {
          return [];
        }

        return [
          {
            kind: "oauth",
            key: `oauth:${provider.id}`,
            providerId: provider.id,
            label: provider.label,
            provider,
          },
        ];
      },
    );

    return [...credentialRows, ...connectedOAuthRows, ...availableOAuthRows];
  }, [accounts, availableProviders]);

  const handleConnect = async (provider: LoginProvider) => {
    const actionKey = `connect:${provider.id}`;
    setBusyKey(actionKey);
    setError(null);

    try {
      const payload =
        provider.kind === "social"
          ? await postAuthAction("/link-social", {
              provider: provider.id,
              callbackURL: "/settings/authentication",
              errorCallbackURL: "/settings/authentication",
            })
          : await postAuthAction("/oauth2/link", {
              providerId: provider.id,
              callbackURL: "/settings/authentication",
              errorCallbackURL: "/settings/authentication",
            });

      if (typeof payload.url === "string" && payload.url) {
        window.location.assign(payload.url);
        return;
      }
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, t("errors.connect")));
      setBusyKey(null);
    }
  };

  const handleDisconnect = async (account: ConnectedAccountRecord) => {
    const actionKey = `disconnect:${account.id}`;
    setBusyKey(actionKey);
    setError(null);

    try {
      const payload = await postAuthAction("/unlink-account", {
        providerId: account.providerId,
        accountId: account.accountId,
      });

      if (payload.status !== true) {
        throw payload;
      }

      refresh();
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, t("errors.disconnect")));
    } finally {
      setBusyKey(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50">
        {rows.map((row) => {
          if (row.kind === "credential") {
            return (
              <div key={row.key} className="flex items-center gap-4 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center text-foreground">
                  <ProviderIcon providerId="credential" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">
                    {t("credentialLabel")}
                  </div>
                </div>
              </div>
            );
          }

          const { provider, account } = row;
          const connectKey = provider ? `connect:${provider.id}` : null;
          const disconnectKey = account ? `disconnect:${account.id}` : null;
          const canDisconnect =
            account &&
            account.providerId !== "credential" &&
            accounts.length > 1;

          if (account) {
            return (
              <div key={row.key} className="flex items-center gap-4 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center text-foreground">
                  <ProviderIcon providerId={row.providerId} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{row.label}</div>
                </div>
                <div className="flex shrink-0 justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDisconnect(account)}
                    disabled={!canDisconnect || busyKey === disconnectKey}
                    title={!canDisconnect ? t("lastProviderHelp") : undefined}
                  >
                    {busyKey === disconnectKey
                      ? t("disconnecting")
                      : t("disconnect")}
                  </Button>
                </div>
              </div>
            );
          }

          if (!provider) {
            return null;
          }

          return (
            <div key={row.key} className="flex items-center gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center text-foreground">
                <ProviderIcon providerId={row.providerId} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{row.label}</div>
              </div>
              <div className="flex shrink-0 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleConnect(provider)}
                  disabled={busyKey === connectKey}
                >
                  {busyKey === connectKey ? t("connecting") : t("connect")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
