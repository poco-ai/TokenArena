"use client";

import {
  Bell,
  ChevronRight,
  Flame,
  Medal,
  Sparkles,
  Target,
} from "lucide-react";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { getAchievementCountBadgeValue } from "@/lib/achievements/catalog";
import { formatAchievementProgress } from "@/lib/achievements/format";
import type { AchievementNotificationData } from "@/lib/achievements/types";
import { formatTokenCount } from "@/lib/usage/format";
import type { UsageShareCardData } from "@/lib/usage/share-card";
import { cn } from "@/lib/utils";
import { AchievementBadge } from "./achievement-badge";

const UsageShareDialog = dynamic(
  () =>
    import("@/components/usage/share-dialog").then(
      (mod) => mod.UsageShareDialog,
    ),
  { ssr: false },
);

type AchievementNotificationProps = {
  usageReportShareData?: UsageShareCardData | null;
};

type FetchState =
  | { status: "idle" | "loading" }
  | { status: "error" }
  | { status: "success"; data: AchievementNotificationData };

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.055, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 340,
      damping: 28,
    },
  },
};

function AnimatedSection({ children }: { children: React.ReactNode }) {
  return (
    <m.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="contents"
    >
      {children}
    </m.div>
  );
}

function AnimatedItem({ children }: { children: React.ReactNode }) {
  return <m.div variants={itemVariants}>{children}</m.div>;
}

function SkeletonRow() {
  return <div className="h-14 bg-muted/60" />;
}

export function AchievementNotification({
  usageReportShareData,
}: AchievementNotificationProps) {
  const locale = useLocale();
  const t = useTranslations("achievements.notification");
  const tItems = useTranslations("achievements.items");
  const tPersona = useTranslations("usage.share.personas");
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const fetchAbortRef = useRef<AbortController>(null);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        if (state.status === "success" || state.status === "loading") {
          setOpen(true);
          return;
        }

        const controller = new AbortController();
        fetchAbortRef.current = controller;
        setState({ status: "loading" });
        setOpen(true);

        fetch("/api/achievements/summary", {
          cache: "no-store",
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok)
              throw new Error("Failed to load achievement summary");
            const data = (await response.json()) as AchievementNotificationData;
            setState({ status: "success", data });
          })
          .catch((_error: unknown) => {
            if (controller.signal.aborted) return;
            setState({ status: "error" });
          });
      } else {
        fetchAbortRef.current?.abort();
        fetchAbortRef.current = null;
        setOpen(false);
      }
    },
    [state.status],
  );

  const summary = state.status === "success" ? state.data : null;
  const recentCount = summary?.recentUnlocks.length ?? 0;

  const reportNotice = usageReportShareData ? (
    <button
      type="button"
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left",
        "bg-[var(--achievement-report-notice-bg)]",
        "transition-[background-color,box-shadow,transform] duration-200",
        "hover:bg-[var(--achievement-report-notice-hover)] hover:shadow-sm",
        "hover:ring-2 hover:ring-ring/20",
        "active:bg-[var(--achievement-report-notice-hover)] active:shadow-sm active:ring-2 active:ring-ring/25",
        "active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
      onClick={() => {
        setReportOpen(true);
        handleOpenChange(false);
      }}
    >
      <span className="relative min-w-0 flex-1 overflow-hidden">
        <span className="block truncate font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {t("report.description")}
        </span>
      </span>

      <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-950 shadow-inner ring-1 ring-border transition-transform duration-200 dark:ring-border group-hover:scale-[1.04] group-active:scale-[1.04]">
        <Image
          src="/printer.jpg"
          alt=""
          width={96}
          height={96}
          className="size-full object-cover object-center"
          draggable={false}
        />
      </span>
    </button>
  ) : null;

  return (
    <LazyMotion features={domAnimation}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="relative size-8 shrink-0 rounded-full hover:bg-muted/70 dark:hover:bg-muted/45"
            aria-label={t("button")}
          >
            <Bell className="size-4" aria-hidden strokeWidth={1.8} />
            <AnimatePresence>
              {recentCount > 0 ? (
                <m.span
                  key="badge"
                  className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end p-0.5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  <m.span
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 20,
                    }}
                    className="inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-0.5 text-[9px] font-semibold leading-none text-background tabular-nums"
                  >
                    {recentCount}
                  </m.span>
                </m.span>
              ) : usageReportShareData ? (
                <m.span
                  key="dot-wrap"
                  className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end p-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  <m.span
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 22,
                    }}
                    className="size-1.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-background dark:bg-emerald-400"
                  />
                </m.span>
              ) : null}
            </AnimatePresence>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          className="flex max-h-[min(var(--radix-popover-content-available-height,90svh),90svh)] min-h-0 w-[22rem] flex-col gap-0 overflow-hidden p-0"
        >
          {/* Header */}
          <PopoverHeader className="shrink-0 gap-1 border-b border-border/60 px-4 py-3">
            <PopoverTitle className="flex items-center gap-2 text-sm">
              <Medal className="size-4" strokeWidth={1.8} />
              {t("title")}
            </PopoverTitle>
          </PopoverHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* Loading */}
            {(state.status === "loading" || state.status === "idle") && (
              <div className="divide-y divide-border/40">
                {reportNotice && (
                  <div className="px-4 py-3">{reportNotice}</div>
                )}
                <div className="space-y-px px-4 py-3">
                  {["s1", "s2", "s3"].map((key) => (
                    <SkeletonRow key={key} />
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {state.status === "error" && (
              <div className="divide-y divide-border/40">
                {reportNotice && (
                  <div className="px-4 py-3">{reportNotice}</div>
                )}
                <div className="p-4 text-xs text-muted-foreground">
                  {t("error")}
                </div>
              </div>
            )}

            {/* Success */}
            {summary && (
              <AnimatedSection>
                <div className="divide-y divide-border/40">
                  {/* Report notice */}
                  {reportNotice && (
                    <AnimatedItem>
                      <div className="px-4 py-3">{reportNotice}</div>
                    </AnimatedItem>
                  )}

                  {/* Stats row — asymmetric: score gets 2fr, level+streak share 1fr each */}
                  <AnimatedItem>
                    <div className="grid grid-cols-[2fr_1fr_1fr] divide-x divide-border/40">
                      <div className="px-4 py-3">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                          {t("score")}
                        </div>
                        <div className="mt-1 text-base font-semibold tabular-nums">
                          {formatTokenCount(summary.score, locale)}
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                          {t("level")}
                        </div>
                        <div className="mt-1 text-base font-semibold tabular-nums">
                          {summary.level}
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                          {t("streak")}
                        </div>
                        <div className="mt-1 text-base font-semibold tabular-nums">
                          {summary.currentStreak}
                        </div>
                      </div>
                    </div>
                  </AnimatedItem>

                  {/* Persona */}
                  <AnimatedItem>
                    <div className="space-y-1.5 px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                        <Sparkles className="size-3" strokeWidth={1.8} />
                        {t("persona")}
                      </div>
                      <div className="text-sm text-foreground/90">
                        {summary.currentPersona
                          ? tPersona(`${summary.currentPersona}.title`)
                          : t("noPersona")}
                      </div>
                    </div>
                  </AnimatedItem>

                  {/* Recent unlocks */}
                  <AnimatedItem>
                    <div className="space-y-2 px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                        <Flame className="size-3" strokeWidth={1.8} />
                        {t("recentUnlocks")}
                      </div>
                      {summary.recentUnlocks.length > 0 ? (
                        <div className="divide-y divide-border/30">
                          {summary.recentUnlocks.map((achievement) => (
                            <div
                              key={achievement.code}
                              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                            >
                              <AchievementBadge
                                iconKey={achievement.iconKey}
                                tier={achievement.tier}
                                size="sm"
                                count={getAchievementCountBadgeValue(
                                  achievement.code,
                                  achievement.awardCount,
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-foreground">
                                  {tItems(`${achievement.code}.title`)}
                                </div>
                                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                                  +{achievement.points} pts
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border border-dashed border-border/50 p-3 text-xs text-muted-foreground">
                          {t("emptyRecent")}
                        </div>
                      )}
                    </div>
                  </AnimatedItem>

                  {/* Next targets */}
                  <AnimatedItem>
                    <div className="space-y-2 px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                        <Target className="size-3" strokeWidth={1.8} />
                        {t("nextTargets")}
                      </div>
                      {summary.nextTargets.length > 0 ? (
                        <div className="divide-y divide-border/30">
                          {summary.nextTargets.map((achievement) => (
                            <div
                              key={achievement.code}
                              className="space-y-2 py-2.5 first:pt-0 last:pb-0"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="truncate text-sm font-medium text-foreground">
                                  {tItems(`${achievement.code}.title`)}
                                </div>
                                <div className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                  {formatAchievementProgress({
                                    current: achievement.progress.current,
                                    target: achievement.progress.target,
                                    unit: achievement.progress.unit,
                                    locale,
                                  })}
                                </div>
                              </div>
                              {/* Progress bar: scaleX avoids layout thrash from width animation */}
                              <div className="h-1 w-full overflow-hidden bg-muted/80">
                                <m.div
                                  className="h-full w-full origin-left bg-foreground/80"
                                  initial={{ scaleX: 0 }}
                                  animate={{
                                    scaleX: Math.max(
                                      achievement.progress.ratio,
                                      0.04,
                                    ),
                                  }}
                                  transition={{
                                    type: "spring",
                                    stiffness: 120,
                                    damping: 22,
                                    delay: 0.1,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="border border-dashed border-border/50 p-3 text-xs text-muted-foreground">
                          {t("emptyNextTargets")}
                        </div>
                      )}
                    </div>
                  </AnimatedItem>

                  {/* Footer CTA */}
                  <AnimatedItem>
                    <div className="px-4 py-3">
                      <Button
                        asChild
                        type="button"
                        size="sm"
                        className="w-full"
                      >
                        <Link href="/achievements">
                          {t("viewAll")}
                          <ChevronRight className="size-4" strokeWidth={1.8} />
                        </Link>
                      </Button>
                    </div>
                  </AnimatedItem>
                </div>
              </AnimatedSection>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {usageReportShareData ? (
        <UsageShareDialog
          data={usageReportShareData}
          defaultTemplate="receipt"
          open={reportOpen}
          onOpenChange={setReportOpen}
          trigger={null}
        />
      ) : null}
    </LazyMotion>
  );
}
