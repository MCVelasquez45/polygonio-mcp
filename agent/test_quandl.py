import httpx
import asyncio
import os

API_KEY = os.getenv("QUANDL_API_KEY", "").strip()
BASE_URL = "https://data.nasdaq.com/api/v3"

async def test_quandl():
    if not API_KEY:
        print("QUANDL_API_KEY is not configured; skipping Quandl smoke check.")
        return

    datasets = [
        "CHRIS/CME_ES1",  # Continuous ES
        "WIKI/FB",        # WIKI free dataset (should default work)
    ]
    
    async with httpx.AsyncClient() as client:
        # Test 1: Check key on WIKI dataset (usually free)
        print("Testing Quandl API key from environment.")
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }
        
        for dataset in datasets:
            print(f"\n--- Testing Dataset: {dataset} ---")
            url = f"{BASE_URL}/datasets/{dataset}.json"
            params = {
                "api_key": API_KEY,
                "limit": 1
            }
            try:
                response = await client.get(url, params=params, headers=headers)
                print(f"Status Code: {response.status_code}")
                if response.status_code == 200:
                    data = response.json()
                    print(f"Success! Name: {data['dataset']['name']}")
                else:
                    print(f"Error: {response.text}")
            except Exception as e:
                print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_quandl())
