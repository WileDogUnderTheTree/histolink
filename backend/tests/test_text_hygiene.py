"""模型输出重复治理 `text_hygiene` 测试（V1.0.6.2 专项修复 · 痛点 2，全离线）。

覆盖：
- 截图中的真实循环回答（同一事实被复述 3–4 遍）能被折叠到「第一份完整回答」；
- 流式期循环检测（整句复述 / `依据一/二/三` 小节重开）返回正确截断点；
- 正常回答（并列结构 / 表格 / 两节 Markdown）不被误删；
- 幂等：清洗后的文本再清洗不再变化；
- V1.0.8：开头「用户未提供……无法直接列举」推诿废话被删除，纯推诿回答不清空。
"""

from __future__ import annotations

from text_hygiene import (
    REPEATED_BODY_RATIO,
    find_repetition_cut,
    is_repetitive,
    sanitize_model_answer,
    strip_false_refusal_preamble,
)

#: 实测截图（会话库 turn 35）：同一事实复述 3 遍。
LOOPED_ANSWER = (
    "1. 据《晋书·苻坚载记》记载，前秦皇帝苻坚在淝水之战中亲征东晋，但被谢安、谢玄等将领击败。  \n"
    "2. 《资治通鉴》指出，谢安作为东晋宰相，成功指挥了这场战役，使前秦军队溃败，成为历史上著名的“风声鹤唳”事件。  \n"
    "3. 《宋书·谢玄传》提到谢玄率领北府军在淝水之战中大败前秦，确立了东晋在南北对峙中的优势。  \n"
    "淝水之战中，前秦的统帅是苻坚，击败前秦的是东晋名臣谢安。\n\n\n"
    "前秦的统帅是苻坚，击败前秦的是东晋名臣谢安。\n\n"
    "1. **依据一**：《晋书·苻坚载记》指出，苻坚作为前秦皇帝，在淝水之战中亲征东晋，但被谢安、谢玄等将领击败。  \n"
    "2. **依据二**：《资治通鉴》记载，谢安以宰相身份指挥东晋军队，成功击溃前秦，成为“风声鹤唳”事件的直接责任人。  \n"
    "3. **依据三**：《宋书·谢玄传》提到谢玄率领北府军在淝水之战中大败前秦，确立了东晋在南北对峙中的优势。"
)

#: 实测截图（会话库 turn 33）：同一结论被复述 4 遍（土木堡之变）。
LOOPED_TUMU_ANSWER = (
    "1. 土木堡之变中被俘的明朝皇帝是明英宗朱祁镇。  \n"
    "2. 北京保卫战由兵部尚书于谦主持，他调集兵力、组织防御，最终击退瓦剌军队。  \n"
    "3. 于谦在保卫战中发挥了关键作用，稳定了朝局，为明朝后续的恢复提供了保障。  \n"
    "土木堡之变中被俘的明朝皇帝是明英宗朱祁镇，北京保卫战由兵部尚书于谦主持。  \n"
    "1. **依据一**：土木堡之变发生在1449年，明英宗朱祁镇亲征瓦剌，结果被俘，成为历史上著名的“北狩”。  \n"
    "2. **依据二**：于谦在明英宗被俘后被任命为兵部尚书，负责指挥北京的防御，组织了有效的抵抗。  \n"
    "3. **依据三**：于谦通过加强城防、调集援军、鼓舞军民士气，成功击退瓦剌，稳定了明朝政权。  \n"
    "土木堡之变中被俘的明朝皇帝是明英宗朱祁镇，北京保卫战由兵部尚书于谦主持。  \n"
    "1. **依据一**：1449年土木堡之变，明英宗亲征瓦剌被俘，成为“北狩”。  \n"
    "2. **依据二**：兵部尚书于谦被任命主持北京城防，组织了有效的防御。  \n"
    "3. **依据三**：于谦通过城防加固、援军集结和军民动员，成功击退瓦剌，稳定了明朝政权。  \n"
    "土木堡之变中被俘的明朝皇帝是明英宗朱祁镇，北京保卫战由兵部尚书于谦主持。"
)

#: 正常回答：两节结构 + 分点分析（不应被误删）。
NORMAL_ANSWER = (
    "### 📜 史料实证\n"
    "赤壁之战（东汉，208年）：曹操南下荆州，孙权、刘备联军迎击于赤壁，"
    "周瑜用黄盖诈降火攻，焚曹军战船，曹操北还。（据《三国志·吴书·周瑜传》）\n\n"
    "### 💡 史令分析\n"
    "1. **以弱胜强的关键在于火攻与联军协同**：曹军不习水战，联军利用东南风实施火攻。\n"
    "2. **政治格局的转折点**：此战奠定三国鼎立的基础，曹操退回北方，孙刘分治荆州。\n"
    "3. **史料价值**：《三国志》与《资治通鉴》均记载了此战，细节略有出入。"
)


def test_sanitize_looped_answer_keeps_first_complete_answer() -> None:
    cleaned, removed = sanitize_model_answer(LOOPED_ANSWER)

    # 明显的重复内容被删除，删除比例达到「循环复述」判定线。
    assert removed > 0
    assert removed / len(LOOPED_ANSWER) >= REPEATED_BODY_RATIO
    # 第二份「依据一/二/三」整段消失，同一结论只保留一次。
    assert "依据一" not in cleaned
    assert cleaned.count("击败前秦的是东晋名臣谢安。") == 1
    # 第一份事实仍然完整保留（没有把正确内容误删）。
    assert "据《晋书·苻坚载记》记载" in cleaned
    assert "谢玄率领北府军" in cleaned


def test_sanitize_tumu_answer_collapses_repeated_conclusion() -> None:
    cleaned, removed = sanitize_model_answer(LOOPED_TUMU_ANSWER)

    assert removed / len(LOOPED_TUMU_ANSWER) >= REPEATED_BODY_RATIO
    conclusion = (
        "土木堡之变中被俘的明朝皇帝是明英宗朱祁镇，北京保卫战由兵部尚书于谦主持。"
    )
    assert cleaned.count(conclusion) == 1
    # 第二份「依据一/二/三」重写段被整体丢弃（保留模型第一份完整回答）。
    assert "依据一" not in cleaned
    assert cleaned.startswith("1. 土木堡之变中被俘的明朝皇帝是明英宗朱祁镇")


def test_sanitize_normal_answer_is_untouched() -> None:
    cleaned, removed = sanitize_model_answer(NORMAL_ANSWER)

    # 正常回答只允许出现「首尾空白 / 连续空行」级别的差异。
    assert removed <= 2
    assert cleaned == NORMAL_ANSWER.strip()
    assert "### 📜 史料实证" in cleaned
    assert "### 💡 史令分析" in cleaned


def test_sanitize_is_idempotent() -> None:
    once, _ = sanitize_model_answer(LOOPED_ANSWER)
    twice, removed_again = sanitize_model_answer(once)

    assert twice == once
    assert removed_again == 0


def test_sanitize_empty_input() -> None:
    assert sanitize_model_answer("") == ("", 0)
    assert sanitize_model_answer(None) == ("", 0)  # type: ignore[arg-type]


def test_find_repetition_cut_detects_looped_conclusion() -> None:
    cut = find_repetition_cut(LOOPED_TUMU_ANSWER)

    assert cut is not None
    # 截断点应落在第一份结论之后、第二份「依据」之前。
    head = LOOPED_TUMU_ANSWER[:cut]
    assert "北京保卫战由兵部尚书于谦主持" in head
    assert "依据一" not in head
    assert is_repetitive(LOOPED_TUMU_ANSWER) is True


def test_find_repetition_cut_detects_second_section_marker() -> None:
    text = (
        "1. 依据一：赤壁之战发生在208年，孙刘联军击败曹操。\n"
        "2. 依据二：此战奠定三国鼎立的基础。\n"
        "3. 依据三：曹操退回北方。\n"
        "1. 依据一：赤壁之战发生于208年，孙刘联军大败曹操。\n"
        "2. 依据二：此战奠定三国鼎立基础。\n"
    )
    cut = find_repetition_cut(text)

    assert cut is not None
    assert "3. 依据三：曹操退回北方。" in text[:cut]
    assert text[:cut].count("依据一") == 1


def test_find_repetition_cut_ignores_normal_answer() -> None:
    assert find_repetition_cut(NORMAL_ANSWER) is None
    assert is_repetitive(NORMAL_ANSWER) is False
    assert find_repetition_cut("简短回答，没有循环。") is None


#: 实测直答输出（结论 + 依据 + 结尾把前文又总结一遍）：直答链路应丢掉结尾复述段。
RESTATED_TAIL_ANSWER = (
    "先给直接结论：赤壁之战发生在208年。\n\n"
    "补充依据：建安十三年（208年）冬，孙权与刘备联军在赤壁（今湖北赤壁）击败曹操。\n\n"
    "关键人物：周瑜、诸葛亮、曹操。\n\n"
    "事件影响：奠定三国鼎立格局。\n\n"
    "赤壁之战发生在208年。建安十三年冬，孙权与刘备联军在赤壁击败曹操，"
    "周瑜、诸葛亮、曹操为关键人物，此战奠定三国鼎立格局。"
)


def test_drop_restated_tail_for_direct_answer() -> None:
    cleaned, removed = sanitize_model_answer(
        RESTATED_TAIL_ANSWER, drop_restated_tail=True
    )

    assert removed > 0
    # 结尾那段「把前文再总结一遍」的复述被丢弃，核心结论与依据保留。
    assert cleaned.endswith("事件影响：奠定三国鼎立格局。")
    assert cleaned.count("赤壁之战发生在208年") == 1
    assert "击败曹操" in cleaned


def test_restated_tail_kept_by_default_for_evidence_pipeline() -> None:
    """证据管线默认不开启结尾复述裁剪（避免误删「史令分析」这类真实分析段）。"""

    cleaned, _removed = sanitize_model_answer(RESTATED_TAIL_ANSWER)
    assert cleaned.endswith("此战奠定三国鼎立格局。")


def test_drop_restated_tail_keeps_normal_two_section_answer() -> None:
    cleaned, removed = sanitize_model_answer(NORMAL_ANSWER, drop_restated_tail=True)

    assert removed <= 2
    assert "### 💡 史令分析" in cleaned
    assert "以弱胜强的关键" in cleaned


def test_drop_duplicated_trailing_line_for_direct_answer() -> None:
    text = (
        "先给直接结论：赤壁之战发生在208年。\n\n"
        "补充依据：建安十三年（208年）冬，孙权与刘备联军在赤壁击败曹操。\n\n"
        "赤壁之战发生在208年。"
    )
    cleaned, _removed = sanitize_model_answer(text, drop_restated_tail=True)
    # 结尾单独一行的同义复述被删除，核心结论仍在。
    assert not cleaned.endswith("赤壁之战发生在208年。")
    assert "先给直接结论" in cleaned
    # 默认链路对「完全相同 / 近似的整句复述」同样会截断（跨行也不允许同一事实再出现）。
    default_cleaned, _ = sanitize_model_answer(text)
    assert not default_cleaned.endswith("赤壁之战发生在208年。")


def test_drop_summary_paragraph_with_restated_conclusion() -> None:
    text = (
        "先给直接结论：赤壁之战发生在公元208年。\n\n"
        "补充依据：建安十三年（208年）冬，孙权与刘备联军在赤壁大败曹军。\n\n"
        "赤壁之战发生在公元208年，也就是建安十三年。这场战争是东汉时期的重要转折点，"
        "奠定了三国鼎立的格局。"
    )
    cleaned, _removed = sanitize_model_answer(text, drop_restated_tail=True)
    assert "东汉时期的重要转折点" not in cleaned
    assert cleaned.endswith("孙权与刘备联军在赤壁大败曹军。")


def test_drop_rewritten_duplicate_paragraph() -> None:
    """模型把整个答案换措辞又写一遍（无依据一标记）：后续复述段整体丢弃。"""

    text = (
        "赤壁之战是东汉时期的关键战役，发生在公元208年，是孙权、刘备联军对抗曹操。\n"
        "据《三国志》和《资治通鉴》的记载，建安十三年（208年），曹操率军南下，孙权与刘备在赤壁展开决战。\n"
        "此战以火攻曹军，奠定三国鼎立的基础，是东汉末年的重要转折点。\n\n"
        "赤壁之战是东汉时期的关键战役，发生在公元208年，也就是建安十三年冬。\n"
        "据《三国志》和《资治通鉴》的记载，曹操率军南下，孙权与刘备在赤壁展开决战。"
    )
    cleaned, removed = sanitize_model_answer(text, drop_restated_tail=True)

    assert removed > 0
    assert "也就是建安十三年冬" not in cleaned
    assert cleaned.startswith("赤壁之战是东汉时期的关键战役")
    # 第一份完整回答保留，第二份重写段整体丢弃。
    assert cleaned.count("建安十三年") == 1


# ---------------------------------------------------------------------------
# V1.0.8：删除自相矛盾的「推诿式开场白」
# ---------------------------------------------------------------------------


def test_strip_false_refusal_preamble_removes_contradictory_opening() -> None:
    """「用户未提供……无法直接列举」删掉，后面的真实答案原样保留。"""

    text = (
        "用户未提供具体战役名称，无法直接列举。\n\n"
        "韩信参与的主要战役包括：井陉之战、潍水之战、垓下之战。"
    )
    cleaned, removed = strip_false_refusal_preamble(text)
    assert "用户未提供" not in cleaned
    assert "无法直接列举" not in cleaned
    assert cleaned.startswith("韩信参与的主要战役")
    assert removed > 0

    # 常见变体：说法 / 主语不同。
    for variant in (
        "您没有提供具体的战役信息，因此无法直接回答。\n韩信打过井陉之战。",
        "当前问题未提供具体战役名称，难以直接列举。\n韩信打过垓下之战。",
        "抱歉，用户未说明具体年代，无法确定。井陉之战发生于前204年。",
    ):
        cleaned_variant, _removed = strip_false_refusal_preamble(variant)
        assert "无法" not in cleaned_variant.split("\n")[0] or "无法" not in cleaned_variant
        assert cleaned_variant.strip()


def test_strip_false_refusal_preamble_keeps_pure_refusal_and_normal_answer() -> None:
    """整段只有推诿（确实没答案）/ 正常回答都不改动。"""

    pure_refusal = "用户未提供具体信息，无法直接回答。"
    assert strip_false_refusal_preamble(pure_refusal) == (pure_refusal, 0)

    normal = "韩信是西汉开国功臣，主要战役有井陉之战、潍水之战与垓下之战。"
    assert strip_false_refusal_preamble(normal) == (normal, 0)
    assert strip_false_refusal_preamble("") == ("", 0)
    assert strip_false_refusal_preamble(None) == ("", 0)  # type: ignore[arg-type]
