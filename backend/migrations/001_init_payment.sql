-- 001_init_payment.sql
-- UnmixAudio Freemium 결제 시스템 — Supabase Postgres 초기 스키마.
-- Supabase SQL Editor 에서 그대로 실행 가능.

-- 라이선스 — Lemon Squeezy webhook 으로 발급/갱신
CREATE TABLE IF NOT EXISTS licenses (
  license_key VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  ls_order_id VARCHAR(64) NOT NULL,
  ls_subscription_id VARCHAR(64),
  plan VARCHAR(16) NOT NULL,            -- 'monthly' | 'annual'
  status VARCHAR(16) NOT NULL,          -- 'active' | 'expired' | 'cancelled'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 월별 사용량 카운터 — Free quota 추적
CREATE TABLE IF NOT EXISTS usage (
  device_id VARCHAR(36) NOT NULL,
  year_month CHAR(7) NOT NULL,          -- 'YYYY-MM' (UTC)
  count INT DEFAULT 0,
  last_ip INET,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (device_id, year_month)
);

-- 인덱스 — IP 기준 quota 조회 / 이메일 기준 라이선스 조회
CREATE INDEX IF NOT EXISTS idx_usage_ip_month ON usage(last_ip, year_month);
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
