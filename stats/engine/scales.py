"""Ordered answer scales (Likert and friends), so survey categories are numbered in their natural
order (Strongly disagree = 1 ... Strongly agree = 5) instead of alphabetically."""

from __future__ import annotations

import re

# Each scale: positions low -> high; each position lists the spellings that mean it.
SCALES: list[list[set[str]]] = [
    [{"strongly disagree", "completely disagree"}, {"disagree", "somewhat disagree", "slightly disagree", "mostly disagree"}, {"neither agree nor disagree", "neither agree or disagree", "neutral", "undecided", "not sure", "unsure", "neither"}, {"agree", "somewhat agree", "slightly agree", "mostly agree"}, {"strongly agree", "completely agree"}],
    [{"very dissatisfied", "extremely dissatisfied"}, {"dissatisfied", "somewhat dissatisfied"}, {"neutral", "neither satisfied nor dissatisfied", "neither satisfied or dissatisfied"}, {"satisfied", "somewhat satisfied"}, {"very satisfied", "extremely satisfied"}],
    [{"never"}, {"rarely", "seldom", "almost never"}, {"sometimes", "occasionally"}, {"often", "frequently", "usually", "most of the time"}, {"always", "very often", "almost always"}],
    [{"very poor", "terrible"}, {"poor", "bad"}, {"fair", "average", "okay", "ok", "neutral"}, {"good"}, {"very good"}, {"excellent"}],
    [{"very unlikely", "extremely unlikely"}, {"unlikely", "somewhat unlikely"}, {"neither likely nor unlikely", "neutral", "not sure", "unsure", "maybe"}, {"likely", "somewhat likely"}, {"very likely", "extremely likely"}],
    [{"not at all", "none"}, {"slightly", "a little", "a little bit"}, {"somewhat", "moderately", "some", "moderate"}, {"very", "very much", "quite a bit", "a lot", "much"}, {"extremely", "completely", "a great deal"}],
    [{"very low"}, {"low"}, {"medium", "moderate", "average", "middle"}, {"high"}, {"very high"}],
    [{"not important", "not at all important", "unimportant"}, {"slightly important", "of little importance", "low importance"}, {"moderately important", "somewhat important", "neutral"}, {"important", "very important"} if False else {"important"}, {"very important", "extremely important"}],
    [{"very unhappy"}, {"unhappy"}, {"neutral", "neither happy nor unhappy"}, {"happy"}, {"very happy"}],
    [{"much worse"}, {"worse", "somewhat worse"}, {"about the same", "the same", "same", "no change"}, {"better", "somewhat better"}, {"much better"}],
    [{"none", "no trust", "not at all"}, {"a little", "little", "low"}, {"some", "moderate", "moderately"}, {"a lot", "high", "much"}, {"completely", "complete", "full"}],
    [{"no formal education", "none", "no education", "never attended"}, {"primary", "primary school", "basic", "basic education", "jhs", "junior high", "middle school"}, {"secondary", "secondary school", "shs", "senior high", "high school", "vocational", "technical", "vocational/technical"}, {"diploma", "tertiary", "college", "some college", "hnd"}, {"bachelor", "bachelors", "bachelor's", "degree", "undergraduate", "first degree"}, {"master", "masters", "master's", "postgraduate", "graduate"}, {"phd", "doctorate", "doctoral"}],
    [{"very poor", "much below average"}, {"poor", "below average"}, {"average", "about average"}, {"comfortable", "above average", "well off"}, {"rich", "wealthy", "very comfortable", "much above average"}],
]


def norm(v: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[_\-]+", " ", str(v).strip().lower())).strip(" .")


def natural_codes(levels: list[str]) -> dict[str, int] | None:
    """Each level's code on its scale (1 = the scale's lowest point), if the levels all belong to one
    known ordered scale (at least 3 of them). A missing point keeps its place: on a 5-point agreement
    scale with no 'Strongly disagree' answers, 'Disagree' is still 2."""
    if len(levels) < 3:
        return None
    keys = [norm(v) for v in levels]
    for scale in SCALES:
        pos = {}
        for lv, k in zip(levels, keys):
            hit = next((i for i, syn in enumerate(scale) if k in syn), None)
            if hit is None:
                break
            pos[lv] = hit + 1
        else:
            if len(set(pos.values())) == len(levels):
                return pos
    return None


def natural_order(levels: list[str]) -> list[str] | None:
    codes = natural_codes(levels)
    return sorted(levels, key=lambda v: codes[v]) if codes else None
