# Database Schema Specification

This document defines all database schemas for the trading system, their relationships, and recommended database technologies.

---

## Technology Stack Overview

| Schema Domain | Primary DB | Secondary DB | Rationale |
|---------------|------------|--------------|-----------|
| **Strategies** | PostgreSQL | - | ACID, JSONB, relational integrity |
| **Backtests** | TimescaleDB | S3 (raw data) | Time-series optimized, compression |
| **Paper Trades** | PostgreSQL + Redis | - | Real-time updates + persistence |
| **Trades** | ClickHouse | PostgreSQL (metadata) | Billion-row analytics, fast aggregations |
| **Market Data** | InfluxDB | Parquet (S3) | High write throughput, retention policies |
| **Agent Interactions** | PostgreSQL + Elasticsearch | - | Structured + semantic search |
| **Knowledge Graph** | Neo4j | PostgreSQL (backup) | Graph traversals, pattern matching |
| **Risk & Compliance** | PostgreSQL | Redis (alerts) | ACID, complex queries |

---

## 1. Strategy Schema (PostgreSQL)

```sql
CREATE TABLE strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    version VARCHAR(20) NOT NULL,  -- semver: major.minor.patch
    status VARCHAR(20) NOT NULL CHECK (status IN (
        'draft', 'coding', 'backtesting', 'paper_trading', 
        'validated', 'live', 'paused', 'archived'
    )),
    
    -- Code & Configuration
    entry_class VARCHAR(200),
    language VARCHAR(20) DEFAULT 'python',
    git_repo_url TEXT,
    git_commit_hash CHAR(40),
    config JSONB NOT NULL DEFAULT '{}',
    
    -- Risk Limits
    risk_parameters JSONB DEFAULT '{
        "max_position_size": 0.05,
        "max_daily_loss": 0.02,
        "max_symbol_exposure": 0.2,
        "circuit_breaker_level": 0.08
    }',
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    tags TEXT[] DEFAULT '{}'
);

CREATE TABLE strategy_parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(20) CHECK (type IN ('int', 'float', 'string', 'bool', 'enum')),
    default_value TEXT,
    min_value NUMERIC,
    max_value NUMERIC,
    description TEXT,
    category VARCHAR(20) CHECK (category IN ('entry', 'exit', 'risk', 'filter', 'optimization'))
);
```

---

## 2. Backtest Schema (TimescaleDB)

```sql
CREATE TABLE backtests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES strategies(id),
    strategy_version VARCHAR(20) NOT NULL,
    
    -- Configuration
    parameters JSONB NOT NULL,
    data_range JSONB NOT NULL DEFAULT '{
        "start": null,
        "end": null,
        "market_regime": "mixed"
    }',
    
    -- Simulation Environment
    simulation_config JSONB NOT NULL DEFAULT '{
        "initial_capital": 100000,
        "commission_model": "fixed_percent",
        "slippage_model": "volume_adjusted"
    }',
    
    -- Results
    metrics JSONB NOT NULL DEFAULT '{}',
    trade_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TimescaleDB Hypertable for equity curves
SELECT create_hypertable('equity_curves', 'timestamp');
CREATE TABLE equity_curves (
    backtest_id UUID NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    equity NUMERIC(20,4) NOT NULL,
    drawdown NUMERIC(8,4),
    PRIMARY KEY (backtest_id, timestamp)
);
```

---

## 3. Paper Trade Schema (PostgreSQL + Redis)

```sql
-- PostgreSQL: Persistent state
CREATE TABLE paper_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES strategies(id),
    backtest_id UUID REFERENCES backtests(id),
    
    status VARCHAR(20) CHECK (status IN (
        'initializing', 'running', 'paused', 'stopped', 'completed'
    )),
    start_time TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    
    current_capital NUMERIC(20,4) NOT NULL,
    daily_pnl NUMERIC(20,4) DEFAULT 0,
    
    readiness_score NUMERIC(5,2) DEFAULT 0,
    passed_checks TEXT[] DEFAULT '{}',
    failed_checks TEXT[] DEFAULT '{}'
);
```

**Redis Schema** (real-time state):
```json
{
  "paper_trade:{id}": {
    "positions": {"SPY": {"quantity": 100, "avg_price": 450.25}},
    "pending_orders": [],
    "today_trades": [],
    "alert_flags": []
  }
}
```

---

## 4. Trade Schema (ClickHouse)

```sql
CREATE TABLE trades (
    trade_id String,
    strategy_id UUID,
    symbol String,
    side Enum('buy', 'sell'),
    quantity Float64,
    entry_time DateTime64(6, 'UTC'),
    entry_price Float64,
    exit_time DateTime64(6, 'UTC'),
    exit_price Float64,
    
    pnl_abs Float64,
    pnl_pct Float64,
    duration_seconds Int64,
    mae_pct Float32,
    mfe_pct Float32,
    
    market_regime Enum('bull', 'bear', 'choppy', 'high_vol', 'low_vol'),
    
    backtest_id UUID DEFAULT NULL,
    paper_trade_id UUID DEFAULT NULL,
    live_trade_flag Boolean DEFAULT FALSE
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(entry_time)
ORDER BY (strategy_id, entry_time);
```

---

## 5. Market Data Schema (InfluxDB)

```
# Line Protocol
ohlcv,symbol=SPY,interval=1m open=450.25,high=451.10,low=449.80,close=450.95,volume=1250000 1640995200000000000
```

**Retention Policies**:
- Tick data: 30 days
- 1-minute bars: 1 year
- Daily bars: Forever

---

## 6. Agent Interaction Schema (PostgreSQL + Elasticsearch)

```sql
CREATE TABLE agent_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    interaction_type VARCHAR(30) CHECK (interaction_type IN (
        'strategy_ideation', 'code_review', 'backtest_analysis',
        'paper_monitoring', 'risk_assessment', 'promotion_review'
    )),
    
    strategy_id UUID REFERENCES strategies(id),
    user_query TEXT NOT NULL,
    agent_response JSONB NOT NULL DEFAULT '{}',
    tools_called JSONB DEFAULT '[]',
    
    human_feedback JSONB DEFAULT '{
        "rating": null,
        "implemented": false,
        "outcome_metrics": {}
    }',
    
    processing_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Knowledge Graph Schema (Neo4j)

```cypher
// Strategy Pattern nodes
CREATE (p:StrategyPattern {
  id: apoc.create.uuid(),
  name: "Momentum with Volume Confirmation",
  avg_sharpe: 1.4,
  avg_max_dd: 0.18,
  confidence: 0.85
});

// Market Regime nodes
CREATE (r:MarketRegime {
  id: "high_vol_bull",
  name: "High Volatility Bull Market",
  typical_duration_days: 45
});

// Relationships
CREATE (p)-[:PERFORMS_WELL_IN {avg_sharpe: 1.8}]->(r);
```

---

## 8. Risk Check Schema (PostgreSQL)

```sql
CREATE TABLE risk_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_type VARCHAR(50) CHECK (check_type IN (
        'pre_trade', 'post_trade', 'intraday', 'end_of_day'
    )),
    strategy_id UUID REFERENCES strategies(id),
    
    concentration JSONB DEFAULT '{}',
    scenario_analysis JSONB DEFAULT '{}',
    liquidity_metrics JSONB DEFAULT '{}',
    violations JSONB DEFAULT '[]',
    
    passed_all_checks BOOLEAN DEFAULT FALSE,
    check_time TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 9. Promotion Gate Schema (PostgreSQL)

```sql
CREATE TABLE promotion_gates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES strategies(id),
    from_phase VARCHAR(30) NOT NULL,
    to_phase VARCHAR(30) NOT NULL,
    
    requirements JSONB NOT NULL DEFAULT '[]',
    approvals_received JSONB DEFAULT '[]',
    
    status VARCHAR(20) CHECK (status IN (
        'pending', 'in_review', 'approved', 'rejected'
    )),
    
    agent_readiness_score NUMERIC(5,2),
    agent_recommendation VARCHAR(20),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 10. Additional Schemas

### Data Lineage
```sql
CREATE TABLE data_lineage (
    id UUID PRIMARY KEY,
    entity_type VARCHAR(50),
    entity_id UUID,
    data_sources JSONB NOT NULL DEFAULT '[]',
    checksum CHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Circuit Breaker
```sql
CREATE TABLE circuit_breakers (
    strategy_id UUID REFERENCES strategies(id),
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    activated_by VARCHAR(100),
    reason VARCHAR(100),
    conditions_to_resume TEXT[],
    PRIMARY KEY (strategy_id, activated_at)
);
```

---

## Implementation Roadmap

### Week 1-2: Foundation
- Deploy PostgreSQL 15+ with TimescaleDB extension
- Create core tables (strategies, backtests)
- Set up Redis for real-time state

### Week 3-4: Analytics
- Set up ClickHouse cluster for trade analytics
- Configure InfluxDB for market data
- Create materialized views

### Week 5-6: Intelligence Layer
- Deploy Elasticsearch for semantic search
- Set up Neo4j for knowledge graph
- Implement CDC pipelines

### Week 7-8: Production Readiness
- Prometheus monitoring for all DBs
- TLS encryption
- Cross-region backup
