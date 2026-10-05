import { useEffect, useState } from "react";
import { CircleNotchIcon, WarningIcon } from "@phosphor-icons/react";
import type { TrendItem } from "../../shared/types";
import { PageShell, SectionLabel, VerdictBadge, relTime, useNow } from "./ui";

/** /trending: hosts failing for many networks right now (GET /api/trends, N12). */
export default function TrendingPage() {
  const [items, setItems] = useState<TrendItem[] | null | undefined>();
  const now = useNow(true, 30_000);

  useEffect(() => {
    document.title = "Trending outages · IsItMe";
    let alive = true;
    fetch("/api/trends")
      .then((res) => (res.ok ? (res.json() as Promise<TrendItem[]>) : null))
      .catch(() => null)
      .then((t) => alive && setItems(Array.isArray(t) ? t : null));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PageShell>
      <section className="rounded-2xl border border-kumo-line bg-kumo-base p-5 sm:px-7">
        <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">
          Trending outages
        </h1>
        <p className="mt-1 text-sm text-kumo-subtle">
          Sites people are finding broken right now, ranked by how many
          different networks saw them fail, not by how many checks ran.
        </p>
        <div className="mt-5">
          {items === undefined ? (
            <div className="flex items-center gap-2 py-8 text-sm text-kumo-subtle">
              <CircleNotchIcon size={16} className="animate-spin" /> Loading…
            </div>
          ) : items === null ? (
            <div className="flex items-center gap-2 py-8 text-sm text-kumo-subtle">
              <WarningIcon size={16} className="text-kumo-warning" />
              Couldn't load trends. Try again in a minute.
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-kumo-elevated px-4 py-6 text-sm leading-relaxed text-kumo-subtle">
              <p className="font-medium text-kumo-default">
                Nothing trending right now.
              </p>
              <p className="mt-1">
                A site only shows up here once people on at least 3 different
                networks (ASNs) found it failing. That keeps one person's
                private or internal lookups off this page.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-kumo-line">
                    {[
                      "Site",
                      "Verdict",
                      "Provider",
                      "Networks",
                      "Last seen"
                    ].map((h) => (
                      <th key={h} className="py-2 pr-3 font-normal">
                        <SectionLabel>{h}</SectionLabel>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-kumo-line">
                  {items.map((t) => (
                    <tr key={t.host}>
                      <td className="py-2.5 pr-3">
                        <a
                          href={`/h/${encodeURIComponent(t.host)}`}
                          className="font-mono text-[13px] break-all text-kumo-link"
                          title={`24h history for ${t.host}`}
                        >
                          {t.host}
                        </a>
                      </td>
                      <td className="py-2.5 pr-3">
                        <VerdictBadge verdict={t.verdict} />
                      </td>
                      <td className="py-2.5 pr-3 text-kumo-default">
                        {t.provider ?? (
                          <span className="text-kumo-inactive">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[13px] text-kumo-default">
                        {t.asns}
                      </td>
                      <td className="py-2.5 text-xs whitespace-nowrap text-kumo-subtle">
                        {relTime(t.lastAt, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}
