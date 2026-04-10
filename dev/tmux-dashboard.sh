#!/usr/bin/env bash
set -euo pipefail

SESSION="audio-analyzer"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux attach-session -t "$SESSION"
  exit 0
fi

# ── 세션 + 스타일 ─────────────────────────────────────────────
tmux new-session -d -s "$SESSION" -c "$PROJECT_DIR"
tmux rename-window -t "$SESSION:0" "agents"

tmux set-option -t "$SESSION" status-style           "bg=#0d1117,fg=#8b949e"
tmux set-option -t "$SESSION" status-left            "#[bg=#238636,fg=#fff,bold]  AUDIO ANALYZER #[bg=#0d1117,fg=#238636] "
tmux set-option -t "$SESSION" status-right           "#[fg=#8b949e]Ctrl+B+방향키=이동  Ctrl+B+z=확대  #[fg=#58a6ff]%H:%M "
tmux set-option -t "$SESSION" status-left-length     25
tmux set-option -t "$SESSION" status-right-length    45
tmux set-option -t "$SESSION" pane-border-style      "fg=#21262d"
tmux set-option -t "$SESSION" pane-active-border-style "fg=#388bfd,bold"
tmux set-option -t "$SESSION" pane-border-status     top
tmux set-option -t "$SESSION" pane-border-format     "#[bold] #{pane_title} "
tmux set-option -t "$SESSION" allow-rename           off

# ── 레이아웃 구성 ─────────────────────────────────────────────
# 전략: 전체를 세로로 3행(ORCH | 상단에이전트 | 하단에이전트)으로 먼저 자르고
#       그 다음 각 행을 가로로 3열씩 자른다
#
#  pane0: ORCHESTRATOR (전체 너비, 상단 22%)
#  pane1: DSP          pane2: EXT ARCH     pane3: UI DESIGNER   (39%)
#  pane4: QA DEBUG     pane5: PRODUCT MGR  pane6: BACKEND ENG   (39%)

# 행 1: pane0(ORCH) + pane1(나머지 전체)
tmux split-window -v -t "$SESSION:0.0" -p 78   # pane0=22%, pane1=78%

# 행 2/3 분리: pane1을 위/아래로
tmux split-window -v -t "$SESSION:0.1" -p 50   # pane1=39%, pane2=39%

# 중간 행(pane1)을 3열로
tmux split-window -h -t "$SESSION:0.1" -p 66   # pane1 → pane1(33%) + pane3(66%)
tmux split-window -h -t "$SESSION:0.3" -p 50   # pane3 → pane3(33%) + pane4(33%)

# 하단 행(pane2)을 3열로
tmux split-window -h -t "$SESSION:0.2" -p 66   # pane2 → pane2(33%) + pane5(66%)
tmux split-window -h -t "$SESSION:0.5" -p 50   # pane5 → pane5(33%) + pane6(33%)

# 최종 pane 번호:
# 0=ORCHESTRATOR
# 1=DSP  3=EXT  4=UI      (중간 행)
# 2=QA   5=PM   6=BACKEND (하단 행)

# ── 타이틀 설정 ───────────────────────────────────────────────
tmux select-pane -t "$SESSION:0.0" -T "🎯 ORCHESTRATOR"
tmux select-pane -t "$SESSION:0.1" -T "🧑‍🔬 DSP ENGINEER  |  offscreen.js"
tmux select-pane -t "$SESSION:0.3" -T "🏗  EXT ARCHITECT  |  background.js"
tmux select-pane -t "$SESSION:0.4" -T "🎨 UI DESIGNER  |  sidepanel.*"
tmux select-pane -t "$SESSION:0.2" -T "🧪 QA DEBUG  |  test/"
tmux select-pane -t "$SESSION:0.5" -T "📋 PRODUCT MGR  |  DOCS/"
tmux select-pane -t "$SESSION:0.6" -T "🐍 BACKEND ENG  |  backend/"

# ── 각 에이전트 pane: claude 시작 ────────────────────────────
# --agent 플래그 없이 그냥 claude 실행
# .claude/agents/[name].md 를 첫 메시지로 전달해서 역할 설정

tmux send-keys -t "$SESSION:0.1" "claude" Enter
tmux send-keys -t "$SESSION:0.3" "claude" Enter
tmux send-keys -t "$SESSION:0.4" "claude" Enter
tmux send-keys -t "$SESSION:0.2" "claude" Enter
tmux send-keys -t "$SESSION:0.5" "claude" Enter
tmux send-keys -t "$SESSION:0.6" "claude" Enter

# 각 에이전트 역할 고정 (3초 대기 후 역할 주입)
sleep 3
tmux send-keys -t "$SESSION:0.1" "당신은 이 프로젝트의 🧑‍🔬 DSP ENGINEER입니다. offscreen.js와 audio-worklet-processor.js를 담당하며 BPM/Key DSP 알고리즘을 전문으로 합니다. 역할을 한 줄로 확인해주세요." Enter
tmux send-keys -t "$SESSION:0.3" "당신은 이 프로젝트의 🏗 EXT ARCHITECT입니다. background.js와 manifest.json을 담당하며 Chrome MV3 인프라/메시지 라우팅을 전문으로 합니다. 역할을 한 줄로 확인해주세요." Enter
tmux send-keys -t "$SESSION:0.4" "당신은 이 프로젝트의 🎨 UI DESIGNER입니다. sidepanel.*, popup.*, content-script.js를 담당하며 시각 레이어 전체를 전문으로 합니다. 역할을 한 줄로 확인해주세요." Enter
tmux send-keys -t "$SESSION:0.2" "당신은 이 프로젝트의 🧪 QA DEBUG입니다. test/ 디렉토리를 담당하며 회귀 테스트와 계층 간 버그 추적을 전문으로 합니다. 역할을 한 줄로 확인해주세요." Enter
tmux send-keys -t "$SESSION:0.5" "당신은 이 프로젝트의 📋 PRODUCT MANAGER입니다. DOCS/ 전체를 담당하며 스펙 게이트키퍼와 문서 소유를 전문으로 합니다. 코드 수정은 하지 않습니다. 역할을 한 줄로 확인해주세요." Enter
tmux send-keys -t "$SESSION:0.6" "당신은 이 프로젝트의 🐍 BACKEND ENGINEER입니다. backend/ 전체를 담당하며 FastAPI와 Demucs 스템 분리를 전문으로 합니다. 역할을 한 줄로 확인해주세요." Enter

# ── ORCHESTRATOR ─────────────────────────────────────────────
tmux send-keys -t "$SESSION:0.0" "bash '$PROJECT_DIR/dev/intro.sh'" Enter

# ── ORCHESTRATOR에 포커스 ────────────────────────────────────
tmux select-pane -t "$SESSION:0.0"
tmux attach-session -t "$SESSION"
