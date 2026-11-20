"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent, KeyboardEvent } from "react";

import { PersonGraph2D } from "@/components/PersonGraph2D";
import { ScrollableTabs } from "@/components/ScrollableTabs";
import { ViewModeSwitch } from "@/components/ViewModeSwitch";
import type { ViewMode } from "@/components/ViewModeSwitch";
import {
  ERA_TO_SCOPE,
  KEY_FIGURES,
  PERSON_GRAPH_ERAS,
  PERSON_GRAPH_SCOPES,
  PERSON_NAME_ALIASES,
  SAN_GUO_FACTION_SHORTCUTS,
  SCOPE_TO_ERA,
} from "@/data/person-graph";
import type {
  PersonGraphData,
  PersonGraphEraId,
  PersonGraphScopeId,
} from "@/data/person-graph";

import styles from "./page.module.css";

/** 默认视图：细览·春秋（中心人物孔子），保持既有体验。 */
const INITIAL_ERA = PERSON_GRAPH_ERAS[0];
const INITIAL_SCOPE = PERSON_GRAPH_SCOPES[0];

/** 搜索下拉最多展示的候选数。 */
const SEARCH_RESULT_LIMIT = 8;

export default function GraphPage() {
  const [mode, setMode] = useState<ViewMode>("detail");
  const [eraId, setEraId] = useState<PersonGraphEraId>(INITIAL_ERA.id);
  const [scopeId, setScopeId] = useState<PersonGraphScopeId>(INITIAL_SCOPE.id);
  const [centerPersonId, setCenterPersonId] = useState(INITIAL_ERA.defaultCenterPersonId);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  /** 记住每个简阅断代在细览里停留过的分期；切回细览时据此恢复。 */
  const lastDetailEraByScope = useRef<Partial<Record<PersonGraphScopeId, PersonGraphEraId>>>({});

  const era = useMemo(
    () => PERSON_GRAPH_ERAS.find((option) => option.id === eraId) ?? INITIAL_ERA,
    [eraId],
  );
  const scope = useMemo(
    () => PERSON_GRAPH_SCOPES.find((option) => option.id === scopeId) ?? INITIAL_SCOPE,
    [scopeId],
  );

  /**
   * 当前模式下的归一化视图：简阅读 scope、细览读 era，
   * 之后的渲染（Tab、meta、搜索、名人堂、阵营按钮、画布）全部只读这一个对象。
   */
  const active =
    mode === "brief"
      ? {
          id: scope.id as string,
          label: scope.label,
          graph: scope.graph,
          defaultCenterPersonId: scope.defaultCenterPersonId,
        }
      : {
          id: era.id as string,
          label: era.label,
          graph: era.graph,
          defaultCenterPersonId: era.defaultCenterPersonId,
        };

  const tabOptions =
    mode === "brief"
      ? PERSON_GRAPH_SCOPES.map((option) => ({ id: option.id as string, label: option.label }))
      : PERSON_GRAPH_ERAS.map((option) => ({ id: option.id as string, label: option.label }));

  const resetSearch = useCallback(() => {
    setSearchQuery("");
    setIsSearchOpen(false);
    setActiveSearchIndex(0);
  }, []);

  /** 切换中心人物：搜索、名人堂、阵营按钮、底层长按四条入口共用。 */
  const applyCenterPerson = useCallback(
    (personId: string) => {
      setCenterPersonId(personId);
      resetSearch();
    },
    [resetSearch],
  );

  /** 切模式/切期时：当前中心在目标图里仍存在就保留，否则落到目标期默认中心。 */
  const keepCenterOr = (graph: PersonGraphData, fallback: string) => {
    setCenterPersonId((prev) =>
      graph.nodes.some((node) => node.id === prev) ? prev : fallback,
    );
  };

  /**
   * 切换分期：当前中心人物在目标图里仍存在就保留，否则回落到目标期默认中心。
   * 例：春秋·孔子 → 战国（不存在）落商鞅；东晋·谢安 → 南北朝（不存在）落孝文帝；
   * 西晋·司马炎 → 简阅·魏晋南北朝（存在）仍以司马炎为中心。
   */
  const selectTab = (id: string) => {
    if (mode === "brief") {
      const nextScope = PERSON_GRAPH_SCOPES.find((option) => option.id === id);
      if (!nextScope) return;
      setScopeId(nextScope.id);
      keepCenterOr(nextScope.graph, nextScope.defaultCenterPersonId);
    } else {
      const nextEra = PERSON_GRAPH_ERAS.find((option) => option.id === id);
      if (!nextEra) return;
      setEraId(nextEra.id);
      lastDetailEraByScope.current[ERA_TO_SCOPE[nextEra.id]] = nextEra.id;
      keepCenterOr(nextEra.graph, nextEra.defaultCenterPersonId);
    }
    resetSearch();
  };

  /**
   * 切换简阅 / 细览：
   * - 细 → 简：定位到当前分期所属断代（春秋/战国 → 先秦），中心人物能保留就保留（如孔子）。
   * - 简 → 细：恢复该断代在细览里上次停留的分期，无记录时用 SCOPE_TO_ERA 的默认映射。
   */
  const switchMode = (next: ViewMode) => {
    if (next === mode) return;
    if (next === "brief") {
      const nextScope =
        PERSON_GRAPH_SCOPES.find((option) => option.id === ERA_TO_SCOPE[eraId]) ?? INITIAL_SCOPE;
      setScopeId(nextScope.id);
      keepCenterOr(nextScope.graph, nextScope.defaultCenterPersonId);
    } else {
      const nextEraId = lastDetailEraByScope.current[scopeId] ?? SCOPE_TO_ERA[scopeId];
      const nextEra = PERSON_GRAPH_ERAS.find((option) => option.id === nextEraId) ?? INITIAL_ERA;
      setEraId(nextEra.id);
      keepCenterOr(nextEra.graph, nextEra.defaultCenterPersonId);
    }
    setMode(next);
    resetSearch();
  };

  /** 当前视图全部人物的模糊搜索结果：先列前缀命中，再列包含命中；别名（如拓跋宏）折算成节点名。 */
  const searchMatches = useMemo(() => {
    const keyword = searchQuery.trim();
    if (!keyword) return [];
    const aliasTargets = new Set(
      Object.entries(PERSON_NAME_ALIASES)
        .filter(([alias]) => alias.includes(keyword))
        .map(([, target]) => target),
    );
    return active.graph.nodes
      .filter((node) => node.name.includes(keyword) || aliasTargets.has(node.name))
      .sort((left, right) => {
        const leftPrefix = left.name.startsWith(keyword) ? 1 : 0;
        const rightPrefix = right.name.startsWith(keyword) ? 1 : 0;
        return rightPrefix - leftPrefix || left.name.localeCompare(right.name, "zh-Hans-CN");
      })
      .slice(0, SEARCH_RESULT_LIMIT)
      .map((node) => node.name);
  }, [active.graph, searchQuery]);

  /** 名人堂：按当前视图标签取配置，并过滤掉不在当期图数据中的人名。 */
  const keyFigures = useMemo(() => {
    const configured = KEY_FIGURES[active.label] ?? [];
    const available = new Set(active.graph.nodes.map((node) => node.id));
    return configured.filter((name) => available.has(name));
  }, [active.graph, active.label]);

  /** 阵营快捷入口只在三国视图出现（细阅「三国」与简阅「三国」同 id）。 */
  const factionShortcuts = active.id === "sanguo" ? SAN_GUO_FACTION_SHORTCUTS : [];

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
          <p className={styles.eyebrow}>史脉 HistoLink · V0.8.2.2</p>
        </div>

        <h1 className={styles.title}>人物关系图</h1>
        <p className={styles.lead}>
          点击节点看详情，长按切换中心，拖拽调整位置；支持别名搜索（如唐太宗）与简阅 / 细览切换。
          <span className={styles.help}>
            <button
              type="button"
              className={styles.helpButton}
              aria-label="人物关系图补充说明"
              aria-describedby="graph-help-tip"
            >
              ?
            </button>
            <span id="graph-help-tip" role="tooltip" className={styles.helpTip}>
              边的粗细表示两人共同参与的历史事件数量；三国分期左栏顶部另有魏 · 蜀 · 吴阵营快捷入口，点击即以该阵营君主为中心；搜索支持本名与庙号别名（如「清圣祖」→ 康熙帝、「明太祖」→ 朱元璋）。
            </span>
          </span>
        </p>

        <div className={styles.tabsRow}>
          <ScrollableTabs
            ariaLabel="分期选择"
            options={tabOptions}
            activeId={active.id}
            scrollLeftLabel="查看更早的分期"
            scrollRightLabel="查看更晚的分期"
            onSelect={selectTab}
          />
          <div className={styles.viewSwitchSlot}>
            <ViewModeSwitch value={mode} onChange={switchMode} ariaLabel="人物图视图模式" />
          </div>
        </div>

        <p className={styles.eraMeta}>
          {mode === "brief" ? "简阅 · " : ""}
          {active.label} · {active.graph.nodes.length} 位人物 · {active.graph.edges.length} 条关系 ·
          当前中心 {centerPersonId}
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
                  placeholder={`在${active.label} ${active.graph.nodes.length} 位人物中搜索`}
                  role="combobox"
                  aria-label={`在${active.label}人物中搜索`}
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
              <h2 className={styles.sideTitle}>名人堂 · {active.label}</h2>
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
              data={active.graph}
              centerPersonId={centerPersonId}
              onCenterPersonChange={applyCenterPerson}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
