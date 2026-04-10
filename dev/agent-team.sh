#!/usr/bin/env bash
# ============================================================
#  Quick Agent Team Launcher
#  Usage: ./dev/agent-team.sh [agent-name] [prompt]
#
#  예시:
#    ./dev/agent-team.sh                          # 6-pane 대시보드 실행
#    ./dev/agent-team.sh dsp-engineer "BPM 분석해줘"  # 단일 에이전트 실행
#    ./dev/agent-team.sh debate "AudioWorklet vs ScriptProcessor 뭐가 낫나?"
# ============================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# tmux 설치 확인
if ! command -v tmux &>/dev/null; then
  echo "❌ tmux가 설치되어 있지 않습니다."
  echo "   brew install tmux"
  exit 1
fi

# claude 설치 확인
if ! command -v claude &>/dev/null; then
  echo "❌ claude CLI가 설치되어 있지 않습니다."
  exit 1
fi

AGENT="${1:-}"
PROMPT="${2:-}"

# ── 인자 없으면 대시보드 실행 ────────────────────────────────
if [[ -z "$AGENT" ]]; then
  exec "$PROJECT_DIR/dev/tmux-dashboard.sh"
fi

# ── debate 모드 ──────────────────────────────────────────────
if [[ "$AGENT" == "debate" ]]; then
  SESSION="debate-$(date +%s)"
  TOPIC="${PROMPT:-토론 주제를 입력하세요}"

  tmux new-session -d -s "$SESSION" -c "$PROJECT_DIR"
  tmux rename-window -t "$SESSION:0" "🗣 debate"

  # 3-pane: 찬성 / 반대 / 판정
  tmux send-keys -t "$SESSION:0.0" "claude -p '당신은 @dsp-engineer입니다. 다음 주제에 대해 찬성 입장을 논리적으로 주장하세요: $TOPIC'" Enter

  tmux split-window -h -t "$SESSION:0.0" -c "$PROJECT_DIR"
  tmux send-keys -t "$SESSION:0.1" "claude -p '당신은 @extension-architect입니다. 다음 주제에 대해 반대 입장을 논리적으로 주장하세요: $TOPIC'" Enter

  tmux split-window -v -t "$SESSION:0.0" -c "$PROJECT_DIR"
  tmux send-keys -t "$SESSION:0.2" "echo '⏳ 찬성/반대 논거가 나오면 이 pane에서 claude를 실행해 판정하세요'" Enter

  tmux select-layout -t "$SESSION:0" main-horizontal
  tmux attach-session -t "$SESSION"
  exit 0
fi

# ── 단일 에이전트 실행 ───────────────────────────────────────
VALID_AGENTS="dsp-engineer extension-architect ui-designer product-manager qa-debug backend-engineer"
if ! echo "$VALID_AGENTS" | grep -qw "$AGENT"; then
  echo "❌ 알 수 없는 에이전트: $AGENT"
  echo "   사용 가능: $VALID_AGENTS"
  echo "   또는: debate"
  exit 1
fi

if [[ -n "$PROMPT" ]]; then
  claude --agent "$AGENT" -p "$PROMPT"
else
  claude --agent "$AGENT"
fi
