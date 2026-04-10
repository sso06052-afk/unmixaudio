# 🧮 Algorithm Specifications

**목적**: 본 확장 프로그램의 핵심인 오디오 분석(DSP) 알고리즘 수학적 명세

## 1. BPM Detection Algorithm
- **특징**: 단순 피크 피킹 방식을 벗어나 Transient Flux 및 Autocorrelation(자기상관함수)을 사용.
- **파이프라인**:
  1. 200Hz High-Pass Filter (808 베이스 분리)
  2. Envelope Extraction (맥스 풀링 디시메이션, ~250Hz 변환)
  3. Whitening (Logarithmic Compression으로 킥, 스네어, 하이햇 에너지 평탄화)
  4. Autocorrelation (모든 템포 랙 분석)
  5. Harmonic Comb Summation (배수/약수 템포 병합 채점)

## 2. Key Detection Algorithm
- **특징**: HPCP 게이팅
- **파이프라인**:
  1. Chroma Feature 추출 (Meyda)
  2. Noise Gating (에너지가 낮거나 스펙트럼 편평도가 높은 노이즈 버퍼 버림)
  3. L2 Normalization (에너지 정규화 후 25% 이상 강한 배음만 수집)
  4. Pearson Correlation (Major/Minor 프로파일 점수 계산)
