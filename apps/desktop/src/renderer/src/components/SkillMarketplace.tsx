import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketplaceSkill } from "../../../shared/domain";
import { tr } from "../i18n/index";
import { beginLatestRequest, invalidateLatestRequests } from "../lib/latest-request";

interface SkillMarketplaceProps {
  onInstalled: () => Promise<void>;
}

type MarketFilter = "all" | MarketplaceSkill["category"];
type MarketSource = MarketplaceSkill["source"];
const PAGE_SIZE = 20;

export function SkillMarketplace({ onInstalled }: SkillMarketplaceProps) {
  const [source, setSource] = useState<MarketSource>("openai");
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const loadRequest = useRef(0);
  const activeSource = useRef<MarketSource>(source);

  const load = useCallback(async (nextSource: MarketSource, forceRefresh = false) => {
    const ticket = beginLatestRequest(loadRequest);
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const nextSkills = await window.mingshen.listMarketplaceSkills(nextSource, forceRefresh);
      if (!ticket.isCurrent()) return;
      setSkills(nextSkills);
    } catch (cause) {
      if (!ticket.isCurrent()) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (ticket.isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    activeSource.current = source;
    setPage(1);
    setFilter("all");
    setQuery("");
    void load(source, false);
  }, [load, source]);

  useEffect(
    () => () => {
      invalidateLatestRequests(loadRequest);
    },
    [],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return skills.filter((skill) => {
      if (filter !== "all" && skill.category !== filter) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      return `${skill.name} ${skill.description}`.toLocaleLowerCase("zh-CN").includes(normalized);
    });
  }, [filter, query, skills]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleSkills = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const install = async (skill: MarketplaceSkill) => {
    const installKey = `${skill.source}:${skill.path}`;
    setInstalling(installKey);
    setError(null);
    try {
      const result = await window.mingshen.installMarketplaceSkill(skill.source, skill.path);
      if (activeSource.current === skill.source) {
        setSkills((current) =>
          current.map((item) => (item.path === skill.path ? { ...item, installed: true } : item)),
        );
      }
      await onInstalled();
      if (activeSource.current === skill.source && result.extension.name !== skill.name) {
        setError(tr("\u6280\u80FD\u5DF2\u5BFC\u5165\u4E3A {0}\u3002", [result.extension.name]));
      }
    } catch (cause) {
      if (activeSource.current === skill.source) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setInstalling((current) => (current === installKey ? null : current));
    }
  };

  return (
    <section className="settings-block marketplace">
      <div className="settings-block__heading">
        <div>
          <h3>{tr("Skills \u5E02\u573A")}</h3>
          <p>
            {tr(
              "\u4E24\u4E2A\u793E\u533A\u4ED3\u5E93\u72EC\u7ACB\u6D4F\u89C8\uFF0C\u5B89\u88C5\u540E\u90FD\u4F1A\u4FDD\u5B58\u4E3A\u672C\u5730\u6280\u80FD\u526F\u672C\u3002",
            )}
          </p>
        </div>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => void load(source, true)}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? "spin" : ""} aria-hidden="true" size={14} />
          {tr("\u5237\u65B0")}
        </button>
      </div>

      <div
        className="marketplace__sources"
        role="tablist"
        aria-label={tr("\u6280\u80FD\u4ED3\u5E93")}
      >
        <button
          className={
            source === "openai"
              ? "marketplace__source marketplace__source--active"
              : "marketplace__source"
          }
          type="button"
          role="tab"
          aria-selected={source === "openai"}
          onClick={() => setSource("openai")}
        >
          <span>OPENAI</span>
          <strong>OpenAI Skills</strong>
          <small>openai/skills</small>
        </button>
        <button
          className={
            source === "composio"
              ? "marketplace__source marketplace__source--active"
              : "marketplace__source"
          }
          type="button"
          role="tab"
          aria-selected={source === "composio"}
          onClick={() => setSource("composio")}
        >
          <span>COMMUNITY</span>
          <strong>Awesome Claude Skills</strong>
          <small>ComposioHQ/awesome-claude-skills</small>
        </button>
      </div>

      <div className="marketplace__toolbar">
        <label className="marketplace__search">
          <Search aria-hidden="true" size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr("\u641C\u7D22\u6280\u80FD")}
            aria-label={tr("\u641C\u7D22\u6280\u80FD\u5E02\u573A")}
          />
        </label>
        {source === "openai" ? (
          <fieldset className="segmented-control" aria-label={tr("\u6280\u80FD\u5206\u7C7B")}>
            {(
              [
                ["all", tr("\u5168\u90E8")],
                ["curated", tr("\u7CBE\u9009")],
                ["experimental", tr("\u5B9E\u9A8C")],
                ["system", tr("\u7CFB\u7EDF")],
              ] as const
            ).map(([value, label]) => (
              <button
                className={
                  filter === value
                    ? "segmented-control__item segmented-control__item--active"
                    : "segmented-control__item"
                }
                type="button"
                key={value}
                onClick={() => {
                  setFilter(value);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </fieldset>
        ) : null}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {loading ? (
        <div className="marketplace__loading">
          <LoaderCircle className="spin" aria-hidden="true" size={16} />
          {tr("\u6B63\u5728\u8BFB\u53D6")}
          {source === "openai" ? "OpenAI Skills" : "Awesome Claude Skills"}
          {tr("\u4ED3\u5E93")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="extension-empty">
          <GitBranch aria-hidden="true" size={22} />
          <strong>{tr("\u6CA1\u6709\u5339\u914D\u7684\u6280\u80FD")}</strong>
          <p>{tr("\u8C03\u6574\u641C\u7D22\u8BCD\u6216\u5206\u7C7B\u540E\u91CD\u8BD5\u3002")}</p>
        </div>
      ) : (
        <div className="marketplace__list">
          {visibleSkills.map((skill) => (
            <article className="marketplace__row" key={skill.path}>
              <span className="marketplace__row-icon">
                <GitBranch aria-hidden="true" size={15} />
              </span>
              <div className="marketplace__row-copy">
                <div>
                  <strong>{skill.name}</strong>
                  <span>{skill.source === "composio" ? "community" : skill.category}</span>
                </div>
                <p>
                  {skill.description ||
                    tr("\u8BE5\u6280\u80FD\u672A\u63D0\u4F9B\u63CF\u8FF0\u3002")}
                </p>
                <code>{skill.path}</code>
              </div>
              <button
                className={
                  skill.installed
                    ? "btn btn--secondary marketplace__install"
                    : "btn btn--primary marketplace__install"
                }
                type="button"
                disabled={skill.installed || Boolean(installing)}
                onClick={() => void install(skill)}
              >
                {installing === skill.path ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : skill.installed ? (
                  <Check aria-hidden="true" size={14} />
                ) : (
                  <Download aria-hidden="true" size={14} />
                )}
                {skill.installed ? tr("\u5DF2\u5B89\u88C5") : tr("\u5B89\u88C5")}
              </button>
            </article>
          ))}
          <nav
            className="marketplace__pagination"
            aria-label={tr("\u6280\u80FD\u5E02\u573A\u5206\u9875")}
          >
            <button
              className="icon-button"
              type="button"
              aria-label={tr("\u4E0A\u4E00\u9875")}
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft aria-hidden="true" size={15} />
            </button>
            <span>
              {tr("\u7B2C")}
              {safePage} / {pageCount}
              {tr("\u9875 \xB7 \u5171")}
              {filtered.length}
              {tr("\u4E2A")}
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label={tr("\u4E0B\u4E00\u9875")}
              disabled={safePage >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            >
              <ChevronRight aria-hidden="true" size={15} />
            </button>
          </nav>
        </div>
      )}
    </section>
  );
}
