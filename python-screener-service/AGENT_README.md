# Polygon Screener Service (Internal Documentation)

This document provides a deep dive into the Screener Service architecture, intended for developers and agents understanding the system internals.

## 1. Project Overview

- **Type**: Python Microservice
- **Framework**: FastAPI
- **Dependencies**: `pandas`, `polygon-api-client`, `pydantic`.
- **Purpose**: Provides specialized, high-computation filtering of option chains (e.g., finding the best 0DTE Covered Calls).

## 2. Architecture

This service is designed to offload heavy data processing from the Node.js server. The Node server (or client) calls this service to get ranked lists of trading opportunities.

### Directory Structure
```
python-screener-service/
├── main.py        # FastAPI entrypoint
├── screener.py    # Core financial mathematics & Polygon API logic
└── requirements.txt
```

### Key Endpoints

- `POST /api/screen/0dte-covered-calls`
  - **Input**: `ScreenParams` (symbol, delta range, min/max OTM %, etc.)
  - **Output**: List of `Opportunity` objects (strike, bid/ask, probability of profit, expected yield).
  - **Logic**:
    1.  Fetches the Option Chain for the target expiration.
    2.  Resolves the spot price.
    3.  Filters out illiquid or "bad spread" options.
    4.  Calculates Greeks (if missing) or uses Polygon's values.
    5.  Calculates **Probability of Profit (PoP)** using Black-Scholes logic.
    6.  Ranks results by user preference (Yield, Max Profit, PoP).

## 3. Core Logic (`screener.py`)

- **`find_best_options_calls`**: The main driver function.
- **`market_math`**: Contains helper functions like `pop_estimate` (Probability of Profit) using `math.erf` to estimate the probability of the option expiring worthless (ideal for sellers).

## 4. Development Guidelines

- **Running Locally**:
  ```bash
  pip install -r requirements.txt
  python main.py
  ```
- **Environment**: Needs `POLYGON_API_KEY` to function.
- **Port**: Defaults to `8001`.

### Adding a New Screen
1.  Define a new Pydantic model for parameters in `main.py`.
2.  Implement the filtering logic in `screener.py`.
3.  Expose a new route in `main.py` (e.g., `/api/screen/iron-condor`).
