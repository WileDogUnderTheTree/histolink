"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent, FocusEvent, KeyboardEvent } from "react";

import { PersonGraph2D } from "@/components/PersonGraph2D";
import { KEY_FIGURES, PERSON_GRAPH_ERAS, SAN_GUO_FACTION_SHORTCUTS } from "@/data/person-graph";
import type { PersonGraphEraId } from "@/data/person-graph";

import styles from "./page.module.css";

/** 默认分期：春秋（中心人物孔子）。 */
const INITIAL_ERA = PERSON_GRAPH_ERAS[0];

/** 搜索下拉最多展示的候选数。 */
const SEARCH_RESULT_LIMIT = 8;

export default function GraphPage() {
  const [eraId, setEraId] = useState<PersonGraphEraId>(INITIAL_ERA.id);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  const era = useMemo(
    () => PERSON_GRAPH_ERAS.find((option) => option.id === eraId) ?? INITIAL_ERA,
    [eraId],
  );

  const [centerPersonId, setCenterPersonId] = useState(era.defaultCenterPersonId);

  /** 切换中心人物：搜索、名人堂、底层长按三条入口共用。 */
  const applyCenterPerson = useCallback((personId: string) => {
    setCenterPersonId(personId);
    setSearchQuery("");
    setIsSearchOpen(false);
    setActiveSearchIndex(0);
  }, []);

  const selectEra = useCallback((nextEraId: PersonGraphEraId) => {
    const nextEra = PERSON_GRAPH_ERAS.find((option) => option.id === nextEraId);
    if (!nextEra) return;
    setEraId(nextEra.id);
    // 分期切换时重置为该期代表中心，避免把上一期人物当中心导致空图。
    setCenterPersonId(nextEra.defaultCenterPersonId);
    setSearchQuery("");
    setIsSearchOpen(false);
    setActiveSearchIndex(0);
  }, []);

  /** 当前分期全部人物的模糊搜索结果：先列前缀命中，再列包含命中。 */
  const searchMatches = useMemo(() => {
    const keyword = searchQuery.trim();
    if (!keyword) return [];
    return era.graph.nodes
      .filter((node) => node.name.includes(keyword))
      .sort((left, right) => {
        const leftPrefix = left.name.startsWith(keyword) ? 1 : 0;
        const rightPrefix = right.name.startsWith(keyword) ? 1 : 0;
        return rightPrefix - leftPrefix || left.name.localeCompare(right.name, "zh-Hans-CN");
      })
      .slice(0, SEARCH_RESULT_LIMIT)
      .map((node) => node.name);
  }, [era, searchQuery]);

  /** 名人堂：按分期取配置，并过滤掉不在当期图数据中的人名。 */
  const keyFigures = useMemo(() => {
    const configured = KEY_FIGURES[era.label] ?? [];
    const available = new Set(era.graph.nodes.map((node) => node.id));
    return configured.filter((name) => available.has(name));
  }, [era]);

  /** 阵营快捷入口只在三国分期出现；点击复用统一的换中心入口。 */
  const factionShortcuts = era.id === "sanguo" ? SAN_GUO_FACTION_SHORTCUTS : [];

  const activeSearchResult = searchMatches[Math.min(activeSearchIndex, searchMatches.length - 1)];

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setActiveSearchIndex(0);
    setIsSearchOpen(true);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsSearchOpen(false);
      return;
    }
    if (searchMatches.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsSearchOpen(true);
      setActiveSearchIndex((index) => (index + 1) % searchMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsSearchOpen(true);
      setActiveSearchIndex((index) => (index - 1 + searchMatches.length) % searchMatches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeSearchResult) applyCenterPerson(activeSearchResult);
    }
  };

  /** 焦点移出整个搜索区域（含下拉）时才收起下拉，保证点击候选不会先被关掉。 */
  const handleSearchBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsSearchOpen(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topbar}>
          <Link className={styles.back} href="/">
            ← 返回首页
          </Link>
          <p className={styles.eyebrow}>史脉 HistoLink · V0.6.2</p>
        </div>

        <h1 className={styles.title}>人物关系图</h1>
        <p className={styles.lead}>
          左栏可按人名搜索或从名人堂直达；中栏展示当前中心人物的一度关系网，边的粗细表示两人共同参与历史事件的数量。单击相邻人物可查看两人关系与共同事件，长按切换中心，拖拽可调整位置。三国分期左栏顶部另提供魏、蜀、吴三方阵营快捷入口。
        </p>

        <div className={styles.tabs} role="tablist" aria-label="分期选择">
          {PERSON_GRAPH_ERAS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={eraId === option.id}
              className={`${styles.tab}${eraId === option.id ? ` ${styles.tabActive}` : ""}`}
              onClick={() => selectEra(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className={styles.eraMeta}>
          {era.label} · {era.graph.nodes.length} 位人物 · {era.graph.edges.length} 条关系 · 默认中心{" "}
          {era.defaultCenterPersonId}
        </p>

        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="人物快捷导航">
            {factionShortcuts.length > 0 ? (
              <div className={`${styles.sideBlock} ${styles.factionBlock}`}>
                <h2 className={styles.sideTitle}>阵营快捷</h2>
                <div className={styles.factions}>
                  {factionShortcuts.map((faction) => (
                    <button
                      key={faction.id}
                      type="button"
                      className={`${styles.factionButton}${
                        centerPersonId === faction.centerPersonId
                          ? ` ${styles.factionButtonActive}`
                          : ""
                      }`}
                      data-camp={faction.id}
                      aria-pressed={centerPersonId === faction.centerPersonId}
                      onClick={() => applyCenterPerson(faction.centerPersonId)}
                    >
                      {faction.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.sideBlock}>
              <h2 className={styles.sideTitle}>搜索人物</h2>
              <div className={styles.search} onBlur={handleSearchBlur}>
                <input
                  className={styles.searchInput}
                  type="text"
                  value={searchQuery}
                  placeholder={`在${era.label} ${era.graph.nodes.length} 位人物中搜索`}
                  role="combobox"
                  aria-label={`在${era.label}人物中搜索`}
                  aria-autocomplete="list"
                  aria-expanded={isSearchOpen && searchQuery.trim().length > 0}
                  aria-controls="person-search-results"
                  autoComplete="off"
                  onChange={handleSearchChange}
                  onFocus={() => {
                    if (searchQuery.trim()) setIsSearchOpen(true);
                  }}
                  onKeyDown={handleSearchKeyDown}
                />
                {isSearchOpen && searchQuery.trim() ? (
                  <ul
                    className={styles.searchList}
                    id="person-search-results"
                    role="listbox"
                    aria-label="搜索结果"
                  >
                    {searchMatches.length > 0 ? (
                      searchMatches.map((name, index) => (
                        <li key={name} role="option" aria-selected={name === activeSearchResult}>
                          <button
                            type="button"
                            className={`${styles.searchOption}${
                              name === activeSearchResult ? ` ${styles.searchOptionActive}` : ""
                            }`}
                            onClick={() => applyCenterPerson(name)}
                          >
                            {name}
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className={styles.searchEmpty}>未找到「{searchQuery.trim()}」</li>
                    )}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className={styles.sideBlock}>
              <h2 className={styles.sideTitle}>名人堂 · {era.label}</h2>
              <div className={styles.hall}>
                {keyFigures.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`${styles.hallButton}${
                      name === centerPersonId ? ` ${styles.hallButtonActive}` : ""
                    }`}
                    aria-pressed={name === centerPersonId}
                    onClick={() => applyCenterPerson(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <p className={styles.sideHint}>
              点击名人堂标签或搜索结果，直接以该人物为中心重绘关系网；深处的节点也无需再逐层长按。
            </p>
          </aside>

          <div className={styles.graphArea}>
            <PersonGraph2D
              data={era.graph}
              centerPersonId={centerPersonId}
              onCenterPersonChange={applyCenterPerson}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
