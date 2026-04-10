#!/usr/bin/env bash
# ================================================================
#  Agent Debate Mode — 에이전트 토론
#  사용법: ./dev/debate.sh "논제를 여기 입력"
#  예시:   ./dev/debate.sh "AudioWorklet vs ScriptProcessor 어느게 나은가"
# ================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOPIC="${1:-}"

if [[ -z "$TOPIC" ]]; then
  echo ""
  echo "  사용법: ./dev/debate.sh \"논제를 입력하세요\""
  echo ""
  echo "  예시:"
  echo "    ./dev/debate.sh \"BPM 감지에 Mel Flux vs Autocorrelation 뭐가 나은가\""
  echo "    ./dev/debate.sh \"팝업 vs 사이드패널 — 어느 UI 구조가 더 좋은가\""
  echo "    ./dev/debate.sh \"backend Python API 필요한가 vs 확장만으로 충분한가\""
  echo ""
  exit 1
fi

SESSION="audio-analyzer"
DEBATE_WIN="DEBATE"

# audio-analyzer 세션이 없으면 만들기
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "대시보드가 꺼져있습니다. ./dev/tmux-dashboard.sh 먼저 실행하세요."
  exit 1
fi

# 이미 DEBATE 윈도우 있으면 제거
tmux list-windows -t "$SESSION" | grep -q "$DEBATE_WIN" && \
  tmux kill-window -t "$SESSION:$DEBATE_WIN" 2>/dev/null || true

# 새 DEBATE 윈도우 생성
tmux new-window -t "$SESSION" -n "$DEBATE_WIN" -c "$PROJECT_DIR"

# ── 레이아웃: 토론 3-pane ─────────────────────────────────────────
#
#  ┌─────────────────────────┬─────────────────────────┐
#  │   🔵 찬성 에이전트       │   🔴 반대 에이전트        │  70%
#  │   (dsp-engineer 입장)   │   (ext-architect 입장)   │
#  ├─────────────────────────┴─────────────────────────┤
#  │              ⚖️ 결론 / 요약 에이전트                 │  30%
#  └────────────────────────────────────────────────────┘

tmux split-window -h -t "$SESSION:$DEBATE_WIN.0" -p 50   # 좌 | 우
tmux split-window -v -t "$SESSION:$DEBATE_WIN.0" -p 30   # 좌 → 상/하, 하=결론

# pane 0 = 찬성(좌상), pane 1 = 반대(우), pane 2 = 결론(좌하)

# 색상
tmux select-pane -t "$SESSION:$DEBATE_WIN.0" -P "fg=#e0e0e0,bg=#0a0e1a"
tmux select-pane -t "$SESSION:$DEBATE_WIN.1" -P "fg=#e0e0e0,bg=#1a0a0a"
tmux select-pane -t "$SESSION:$DEBATE_WIN.2" -P "fg=#e0e0e0,bg=#0a1a0a"

# ── 논제 헤더 출력 ────────────────────────────────────────────────
TOPIC_LINE="논제: $TOPIC"

tmux send-keys -t "$SESSION:$DEBATE_WIN.0" "clear && printf '\033[1;96m' && echo '' && echo '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' && echo \"  🔵 찬성 — DSP ENGINEER\" && echo \"  $TOPIC_LINE\" && echo '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' && printf '\033[0m' && echo ''" Enter

tmux send-keys -t "$SESSION:$DEBATE_WIN.1" "clear && printf '\033[1;91m' && echo '' && echo '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' && echo \"  🔴 반대 — EXT ARCHITECT\" && echo \"  $TOPIC_LINE\" && echo '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' && printf '\033[0m' && echo ''" Enter

tmux send-keys -t "$SESSION:$DEBATE_WIN.2" "clear && printf '\033[1;92m' && echo '' && echo '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' && echo \"  ⚖️  결론 / 요약 — QA ENGINEER\" && echo \"  $TOPIC_LINE\" && echo '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' && printf '\033[0m' && echo ''" Enter

# ── 에이전트 실행 ─────────────────────────────────────────────────
sleep 1

PRO_PROMPT="당신은 Audio Analyzer 프로젝트의 DSP Engineer입니다. 아래 논제에 대해 찬성 입장에서 기술적 근거를 들어 주장하세요. 이 프로젝트의 코드와 아키텍처를 기반으로 구체적으로 논거를 제시하세요.

논제: $TOPIC

형식:
1. 핵심 주장 (1-2줄)
2. 기술적 근거 3가지
3. 우리 프로젝트에서의 실제 적용 이점"

CON_PROMPT="당신은 Audio Analyzer 프로젝트의 Extension Architect입니다. 아래 논제에 대해 반대 입장에서 기술적 근거를 들어 주장하세요. 이 프로젝트의 코드와 아키텍처를 기반으로 구체적으로 논거를 제시하세요.

논제: $TOPIC

형식:
1. 핵심 반박 (1-2줄)
2. 기술적 반론 3가지
3. 우리 프로젝트에서의 실제 리스크"

SUMMARY_PROMPT="당신은 Audio Analyzer 프로젝트의 QA Engineer입니다. 위 토론의 찬반 주장을 종합해서 객관적으로 결론을 내려주세요. 우리 프로젝트 상황에서 실제로 어떤 선택이 맞는지 판정하세요.

논제: $TOPIC

형식:
1. 찬성 측 핵심 요약
2. 반대 측 핵심 요약
3. 최종 판정 및 이유
4. 실행 권고사항"

# 찬성/반대 동시 실행 (백그라운드)
tmux send-keys -t "$SESSION:$DEBATE_WIN.0" "claude -p '$PRO_PROMPT'" Enter
tmux send-keys -t "$SESSION:$DEBATE_WIN.1" "claude -p '$CON_PROMPT'" Enter

echo ""
echo "  토론이 시작됐습니다: $TOPIC"
echo "  찬성/반대 주장이 완료되면 결론 pane(하단)에서 직접 claude 실행하세요:"
echo "  claude -p '$SUMMARY_PROMPT'"
echo ""

# DEBATE 윈도우로 이동
tmux select-window -t "$SESSION:$DEBATE_WIN"
tmux select-pane -t "$SESSION:$DEBATE_WIN.0"
