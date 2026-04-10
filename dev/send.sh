#!/usr/bin/env bash
# 특정 에이전트 pane에 태스크 전송
# 사용법: ./dev/send.sh [에이전트] [할일]
# 예시:   ./dev/send.sh dsp "BPM 옥타브 에러 원인 찾아줘"
#         ./dev/send.sh all "현재 담당 파일 전체 리뷰해줘"

SESSION="audio-analyzer"

declare -A PANE_MAP=(
  ["dsp"]=1
  ["dsp-engineer"]=1
  ["arch"]=2
  ["extension-architect"]=2
  ["ui"]=3
  ["ui-designer"]=3
  ["qa"]=4
  ["qa-debug"]=4
  ["pm"]=5
  ["product-manager"]=5
  ["be"]=6
  ["backend"]=6
  ["backend-engineer"]=6
)

AGENT="${1:-}"
TASK="${2:-}"

if [[ -z "$AGENT" || -z "$TASK" ]]; then
  echo ""
  echo "  사용법: ./dev/send.sh [에이전트] \"[할일]\""
  echo ""
  echo "  에이전트 이름:"
  echo "    dsp         — DSP Engineer    (offscreen.js)"
  echo "    arch        — Ext Architect   (background.js)"
  echo "    ui          — UI Designer     (sidepanel.*)"
  echo "    qa          — QA Debug        (test/)"
  echo "    pm          — Product Manager (DOCS/)"
  echo "    be          — Backend Eng     (backend/)"
  echo "    all         — 전체 에이전트"
  echo ""
  echo "  예시:"
  echo "    ./dev/send.sh dsp \"BPM 옥타브 에러 원인 분석해줘\""
  echo "    ./dev/send.sh all \"현재 담당 파일 상태 리뷰해줘\""
  echo "    ./dev/send.sh dsp qa \"BPM 알고리즘 변경 후 회귀 테스트 돌려줘\""
  echo ""
  exit 0
fi

# "all" 이면 전체 에이전트에 전송
if [[ "$AGENT" == "all" ]]; then
  for pane in 1 2 3 4 5 6; do
    tmux send-keys -t "$SESSION:0.${pane}" "$TASK" Enter
  done
  echo "  → 전체 에이전트에 전송: $TASK"
  exit 0
fi

# 인자가 3개면 두 에이전트에게 동시 전송
if [[ -n "${3:-}" ]]; then
  TASK="$3"
  for name in "$AGENT" "$2"; do
    pane="${PANE_MAP[$name]:-}"
    if [[ -n "$pane" ]]; then
      tmux send-keys -t "$SESSION:0.${pane}" "$TASK" Enter
      echo "  → $name (pane $pane)에 전송"
    fi
  done
  exit 0
fi

# 단일 에이전트 전송
PANE="${PANE_MAP[$AGENT]:-}"
if [[ -z "$PANE" ]]; then
  echo "  알 수 없는 에이전트: $AGENT"
  exit 1
fi

tmux send-keys -t "$SESSION:0.${PANE}" "$TASK" Enter
echo "  → $AGENT (pane $PANE)에 전송: $TASK"
