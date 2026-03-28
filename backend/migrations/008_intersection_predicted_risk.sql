-- ML predicted risk per node for routing / app lookup.
-- Run after 005. Upsert from train_model pipeline.

alter table public.intersection_safety
  add column if not exists predicted_risk double precision not null default 0;

alter table public.intersection_safety
  add column if not exists future_risk_score double precision not null default 0;

comment on column public.intersection_safety.predicted_risk is
  'XGBoost predicted risk (0-100 style); used as graph node cost for A* routing.';
comment on column public.intersection_safety.future_risk_score is
  'Training label window composite (percentile); stored for audit/compare.';
