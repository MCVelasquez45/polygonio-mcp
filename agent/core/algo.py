import heapq
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Any, Optional
from decimal import Decimal

@dataclass(order=False)
class MarketEntry:
    """
    Wrapper for min-heap comparison logic.
    adapted from DrugEntry for generic market data.
    """
    sort_val: float  # Using float as Polygon API returns floats
    symbol: str
    metadata: dict = field(default_factory=dict, compare=False)
    
    def __lt__(self, other):
        # Primary: sort_val (worst = smallest in our min-heap)
        # We want to keep the LARGEST values, so the min-heap should pop the SMALLEST.
        if self.sort_val != other.sort_val:
            return self.sort_val < other.sort_val
        # Secondary: Alphabetical tie-breaker (Evict 'Z' before 'A')
        return self.symbol > other.symbol
    
    def __gt__(self, other):
        return not self.__lt__(other) and self != other

class MarketLeaderboard:
    """
    Maintains the Top K market items using a min-heap.
    Great for streaming data or finding the top performers in a large list 
    based on custom calculated metrics.
    """
    
    def __init__(self, k: int, is_increase: bool = True):
        self.k = k
        self.is_increase = is_increase
        self.entries: Dict[str, int] = {}  # {symbol: count}
        self.heap: List[MarketEntry] = []
    
    def add(self, symbol: str, value: float, metadata: dict = None):
        if symbol in self.entries:
            self.entries[symbol] += 1
            return
        
        # Determine sort value
        # If we want "Top Highest Values" (is_increase=True):
        #   Heap should store the Top K. 
        #   The "worst" of the Top K is the smallest value.
        #   Min-heap pops smallest value.
        #   So sort_val = value directly.
        #   We pop if new item > min-heap root.
        
        # If we want "Top Lowest Values" (is_increase=False, e.g. biggest losers):
        #   We want to keep the Smallest values (Change = -10%, -9%...).
        #   The "worst" of the "smallest values" is the largest value (e.g. -2%).
        #   So we invert the value for the heap? 
        #   Actually, let's keep it simple: 
        #   If is_increase=True (Find Highest): sort_val = value. (Pop smallest)
        #   If is_increase=False (Find Lowest): sort_val = -value. (Pop largest negative -> pop 'least negative')
        
        sort_val = value if self.is_increase else -value
        
        item = MarketEntry(float(sort_val), symbol, metadata or {})
        
        if len(self.heap) < self.k:
            heapq.heappush(self.heap, item)
            self.entries[symbol] = 1
        elif item > self.heap[0]:
            # This item is "better" (larger sort_val) than the worst in our heap.
            # Replace the worst.
            worst = heapq.heapreplace(self.heap, item)
            if worst.symbol in self.entries:
                del self.entries[worst.symbol]
            self.entries[symbol] = 1

    def get_results(self) -> List[Dict[str, Any]]:
        # Return sorted results (best first)
        rank_multiplier = 1 if self.is_increase else -1
        
        # Sorted from smallest sort_val to largest.
        # if is_increase=True: small to large. Reverse for "Rank 1 = Largest".
        # if is_increase=False: small to large (-large_neg to -small_neg). 
        #    Wait. If is_increase=False:
        #    Value -10. sort_val = 10.
        #    Value -2. sort_val = 2.
        #    Heap has [2, 10]. Sorted: 2, 10.
        #    Reverse: 10, 2.
        #    Unpack: -10, -2.
        #    Correct.
        
        sorted_heap = sorted(self.heap, key=lambda x: x.sort_val, reverse=True)
        
        return [{
            "symbol": r.symbol,
            "value": r.sort_val * rank_multiplier,
            "metadata": r.metadata,
            "rank": idx + 1
        } for idx, r in enumerate(sorted_heap)]
