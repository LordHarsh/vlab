-- =============================================================================
-- 011_simulations_tinkercad_only.sql
-- Simplify simulations: only Tinkercad iframes supported.
-- config shape: { "design_id": "XXXXXXX", "height": 500 }
-- =============================================================================

-- Migrate existing rows to tinkercad type with empty config
update simulations set type = 'tinkercad', config = '{}'::jsonb;

-- Drop old multi-type constraint and replace with tinkercad-only
alter table simulations drop constraint if exists simulations_type_check;
alter table simulations add constraint simulations_type_check check (type = 'tinkercad');
