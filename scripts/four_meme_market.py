#!/usr/bin/env python3
"""
Fetch four.meme token market data with official-page-first output.

Why this script exists:
- The public contract at `0x5c95...762b` does not expose the older
  `getAllTokens()` / `getTokenInfo()` interface reliably.
- four.meme's displayed numbers can differ slightly from raw on-chain math due
  to rounding and presentation rules.

This script therefore uses two layers:
1. Official page parsing via `r.jina.ai/http://four.meme/...` for values shown
   on four.meme.
2. Direct BSC JSON-RPC calls as a fallback for live inner/outer price,
   liquidity, supply, and Pancake pair state.

Examples:
  python3 scripts/four_meme_market.py 0xbc1ed24e9eda663d02202dfc0c441f7c156d4444
  python3 scripts/four_meme_market.py --pretty
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


FOUR_PROXY_CONTRACT = "0x5c952063c7fc8610ffdb798152d69f0b9550762b"
PANCAKE_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73"
WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
BNB_USD_FEED = "0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee"

RPC_URLS = [
    "https://bsc.publicnode.com",
    "https://bsc-dataseed1.binance.org",
    "https://bsc-dataseed2.binance.org",
    "https://rpc.ankr.com/bsc",
]

JINA_BASE = "https://r.jina.ai/http://four.meme"
USER_AGENT = "Mozilla/5.0"
DEFAULT_TIMEOUT = 15
SALEABLE_SUPPLY = 800_000_000.0


# Hard-coded selectors so the script stays dependency-free.
SEL_TOKEN_INFOS = "0xe684626b"  # _tokenInfos(address)
SEL_NAME = "0x06fdde03"
SEL_SYMBOL = "0x95d89b41"
SEL_TOTAL_SUPPLY = "0x18160ddd"
SEL_DECIMALS = "0x313ce567"
SEL_GET_PAIR = "0xe6a43905"  # getPair(address,address)
SEL_GET_RESERVES = "0x0902f1ac"
SEL_TOKEN0 = "0x0dfe1681"
SEL_TOKEN1 = "0xd21220a7"
SEL_LATEST_ROUND_DATA = "0xfeaf968c"


def is_address(value: str) -> bool:
    return bool(re.fullmatch(r"0x[a-fA-F0-9]{40}", value or ""))


def norm_address(value: str) -> str:
    return value.lower()


def pad_address(address: str) -> str:
    return address.lower().replace("0x", "").rjust(64, "0")


def hex_to_words(raw_hex: str) -> list[str]:
    clean = (raw_hex or "").replace("0x", "")
    if not clean:
        return []
    if len(clean) % 64 != 0:
        clean = clean.ljust((len(clean) + 63) // 64 * 64, "0")
    return [clean[i : i + 64] for i in range(0, len(clean), 64)]


def decode_uint(word: str) -> int:
    return int(word, 16) if word else 0


def decode_bool(word: str) -> bool:
    return bool(decode_uint(word))


def decode_address_word(word: str) -> str:
    if not word:
        return "0x" + ("0" * 40)
    return "0x" + word[-40:].lower()


def decode_dynamic_string(raw_hex: str) -> str:
    words = hex_to_words(raw_hex)
    if len(words) < 2:
        return ""
    offset_bytes = decode_uint(words[0])
    offset_words = offset_bytes // 32
    if offset_words >= len(words):
        return ""
    length = decode_uint(words[offset_words])
    start = (offset_words + 1) * 64
    end = start + (length * 2)
    try:
        return bytes.fromhex(raw_hex.replace("0x", "")[start:end]).decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


def expand_four_price(value: str) -> float | None:
    if not value:
        return None
    value = value.strip()
    m = re.fullmatch(r"0\.0\{(\d+)\}(\d+)", value)
    if m:
        zeros = int(m.group(1))
        tail = m.group(2)
        return float("0." + ("0" * zeros) + tail)
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return None


def parse_compact_number(value: str) -> float | None:
    if not value:
        return None
    text = value.strip().replace(",", "").replace("$", "")
    m = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)([KMBT]?)", text, re.I)
    if not m:
        try:
            return float(text)
        except ValueError:
            return None
    number = float(m.group(1))
    suffix = m.group(2).upper()
    scale = {
        "": 1,
        "K": 1_000,
        "M": 1_000_000,
        "B": 1_000_000_000,
        "T": 1_000_000_000_000,
    }[suffix]
    return number * scale


def parse_plain_number(value: str) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def safe_round(value: float | None, digits: int = 8) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


class RpcClient:
    def __init__(self, urls: list[str], timeout: int = DEFAULT_TIMEOUT):
        self.urls = [u.strip() for u in urls if u and u.strip()]
        self.timeout = timeout
        self._request_id = 1

    def _post(self, url: str, payload: dict[str, Any]) -> Any:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def rpc(self, method: str, params: list[Any]) -> Any:
        last_error: Exception | None = None
        for url in self.urls:
            try:
                payload = {
                    "jsonrpc": "2.0",
                    "id": self._request_id,
                    "method": method,
                    "params": params,
                }
                self._request_id += 1
                data = self._post(url, payload)
                if "error" in data:
                    raise RuntimeError(f"{url} -> {data['error']}")
                return data["result"]
            except Exception as exc:
                last_error = exc
                continue
        raise RuntimeError(f"All RPC endpoints failed: {last_error}")

    def eth_call(self, to: str, data: str) -> str:
        return str(self.rpc("eth_call", [{"to": to, "data": data}, "latest"]))


def build_call(selector: str, *args_32bytes: str) -> str:
    return selector + "".join(args_32bytes)


def call_uint(rpc: RpcClient, to: str, selector: str) -> int | None:
    raw = rpc.eth_call(to, selector)
    words = hex_to_words(raw)
    return decode_uint(words[0]) if words else None


def call_address(rpc: RpcClient, to: str, selector: str) -> str | None:
    raw = rpc.eth_call(to, selector)
    words = hex_to_words(raw)
    return decode_address_word(words[0]) if words else None


def call_string(rpc: RpcClient, to: str, selector: str) -> str:
    raw = rpc.eth_call(to, selector)
    return decode_dynamic_string(raw)


def fetch_url(url: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def fetch_board_addresses(limit: int) -> list[str]:
    url = f"{JINA_BASE}/en"
    text = fetch_url(url)
    matches = re.findall(r"https?://four\.meme/(?:en/)?token/(0x[a-fA-F0-9]{40})", text)
    result: list[str] = []
    seen: set[str] = set()
    for match in matches:
        address = norm_address(match)
        if address in seen:
            continue
        seen.add(address)
        result.append(address)
        if len(result) >= limit:
            break
    return result


def fetch_official_page_snapshot(address: str) -> dict[str, Any]:
    url = f"{JINA_BASE}/token/{address}"
    text = fetch_url(url)

    price_match = re.search(
        r"([0-9.{}]+)\s+([A-Za-z0-9$._-]+)\s*([+-]?[0-9.]+%)\s+"
        r"Market Cap\$([0-9.,KMBT]+)\s+"
        r"Virtual Liquidity\$([0-9.,KMBT]+)\s+"
        r"Volume\$([0-9.,KMBT]+)",
        text,
        re.I,
    )
    curve_match = re.search(
        r"There are\s+([0-9,.\-]+)\s+(.+?)\s+still available for sale in the bonding curve "
        r"and there is\s+([0-9,.\-]+)\s+([^(]+)\(Raised amount[:：]\s*([0-9,.\-]+)\s+([^)]+)\)\s+"
        r"in the bonding curve\.",
        text,
        re.I | re.S,
    )
    progress_match = re.search(r"Bonding Curve Progress\s+([0-9.]+)%", text, re.I)
    supply_match = re.search(r"Total Supply\s*:\s*([0-9,.\-]+)", text, re.I)
    created_match = re.search(r"Creation Time\s+([0-9/: -]+)", text, re.I)

    snapshot: dict[str, Any] = {
        "official_page_found": True,
        "official_raw_url": url,
        "price_bnb": None,
        "quote_symbol": None,
        "price_change_24h_pct": None,
        "market_cap_usd": None,
        "liquidity_usd": None,
        "volume_usd": None,
        "progress_pct": None,
        "remaining_supply": None,
        "bonding_quote_amount_bnb": None,
        "target_quote_amount_bnb": None,
        "total_supply": None,
        "creation_time": created_match.group(1).strip() if created_match else None,
    }

    if price_match:
        snapshot["price_bnb"] = expand_four_price(price_match.group(1))
        snapshot["quote_symbol"] = price_match.group(2).strip()
        snapshot["price_change_24h_pct"] = parse_plain_number(price_match.group(3).replace("%", ""))
        snapshot["market_cap_usd"] = parse_compact_number(price_match.group(4))
        snapshot["liquidity_usd"] = parse_compact_number(price_match.group(5))
        snapshot["volume_usd"] = parse_compact_number(price_match.group(6))

    if curve_match:
        snapshot["remaining_supply"] = parse_plain_number(curve_match.group(1))
        snapshot["bonding_quote_amount_bnb"] = parse_plain_number(curve_match.group(3))
        snapshot["target_quote_amount_bnb"] = parse_plain_number(curve_match.group(5))

    if progress_match:
        snapshot["progress_pct"] = parse_plain_number(progress_match.group(1))

    if supply_match:
        snapshot["total_supply"] = parse_plain_number(supply_match.group(1))

    return snapshot


def fetch_bnb_usd_price(rpc: RpcClient) -> float | None:
    try:
        round_data_raw = rpc.eth_call(BNB_USD_FEED, SEL_LATEST_ROUND_DATA)
        decimals_raw = rpc.eth_call(BNB_USD_FEED, SEL_DECIMALS)
        round_words = hex_to_words(round_data_raw)
        decimals_words = hex_to_words(decimals_raw)
        if len(round_words) < 2 or not decimals_words:
            return None
        answer = decode_uint(round_words[1])
        decimals = decode_uint(decimals_words[0])
        if answer <= 0:
            return None
        return answer / (10 ** decimals)
    except Exception:
        return None


def fetch_token_meta(rpc: RpcClient, address: str) -> dict[str, Any]:
    name = ""
    symbol = ""
    total_supply = None
    decimals = 18

    try:
        name = call_string(rpc, address, SEL_NAME)
    except Exception:
        pass
    try:
        symbol = call_string(rpc, address, SEL_SYMBOL)
    except Exception:
        pass
    try:
        decimals_raw = call_uint(rpc, address, SEL_DECIMALS)
        if decimals_raw is not None:
            decimals = int(decimals_raw)
    except Exception:
        pass
    try:
        total_supply_raw = call_uint(rpc, address, SEL_TOTAL_SUPPLY)
        if total_supply_raw is not None:
            total_supply = total_supply_raw / (10 ** decimals)
    except Exception:
        pass

    return {
        "name": name,
        "symbol": symbol,
        "decimals": decimals,
        "total_supply": total_supply,
    }


def fetch_four_token_infos(rpc: RpcClient, address: str) -> dict[str, Any]:
    data = build_call(SEL_TOKEN_INFOS, pad_address(address))
    raw = rpc.eth_call(FOUR_PROXY_CONTRACT, data)
    words = hex_to_words(raw)
    if len(words) < 13:
        raise RuntimeError(f"_tokenInfos returned {len(words)} words, expected >= 13")

    total_supply = decode_uint(words[3]) / 1e18
    target_quote_amount = decode_uint(words[5]) / 1e18
    remaining_supply = decode_uint(words[7]) / 1e18
    bonding_quote_amount = decode_uint(words[8]) / 1e18
    inner_price_bnb = decode_uint(words[9]) / 1e18

    progress_pct = None
    if SALEABLE_SUPPLY > 0:
        progress_pct = max(0.0, min(100.0, 100.0 - ((remaining_supply * 100.0) / SALEABLE_SUPPLY)))

    return {
        "total_supply": total_supply,
        "target_quote_amount_bnb": target_quote_amount,
        "remaining_supply": remaining_supply,
        "bonding_quote_amount_bnb": bonding_quote_amount,
        "inner_price_bnb": inner_price_bnb,
        "progress_pct": progress_pct,
    }


def fetch_pancake_state(rpc: RpcClient, token_address: str, token_decimals: int) -> dict[str, Any]:
    pair_call = build_call(SEL_GET_PAIR, pad_address(token_address), pad_address(WBNB))
    pair_raw = rpc.eth_call(PANCAKE_FACTORY, pair_call)
    pair_words = hex_to_words(pair_raw)
    pair = decode_address_word(pair_words[0]) if pair_words else "0x" + ("0" * 40)

    if pair == "0x" + ("0" * 40):
        return {
            "pair_address": None,
            "outer_price_bnb": None,
            "pair_wbnb_liquidity_bnb": None,
        }

    reserves_raw = rpc.eth_call(pair, SEL_GET_RESERVES)
    token0 = call_address(rpc, pair, SEL_TOKEN0)
    token1 = call_address(rpc, pair, SEL_TOKEN1)
    words = hex_to_words(reserves_raw)
    if len(words) < 2:
        return {
            "pair_address": pair,
            "outer_price_bnb": None,
            "pair_wbnb_liquidity_bnb": None,
        }

    reserve0 = decode_uint(words[0])
    reserve1 = decode_uint(words[1])
    token_decimals_scale = 10 ** token_decimals

    outer_price_bnb = None
    pair_wbnb_liquidity_bnb = None

    if token0 == WBNB and reserve1 > 0:
        pair_wbnb_liquidity_bnb = reserve0 / 1e18
        outer_price_bnb = (reserve0 / 1e18) / (reserve1 / token_decimals_scale)
    elif token1 == WBNB and reserve0 > 0:
        pair_wbnb_liquidity_bnb = reserve1 / 1e18
        outer_price_bnb = (reserve1 / 1e18) / (reserve0 / token_decimals_scale)

    return {
        "pair_address": pair,
        "outer_price_bnb": outer_price_bnb,
        "pair_wbnb_liquidity_bnb": pair_wbnb_liquidity_bnb,
    }


def merge_snapshot(
    address: str,
    meta: dict[str, Any],
    onchain: dict[str, Any],
    pancake: dict[str, Any],
    official: dict[str, Any] | None,
    bnb_usd_price: float | None,
) -> dict[str, Any]:
    total_supply = (
        (official or {}).get("total_supply")
        or meta.get("total_supply")
        or onchain.get("total_supply")
        or 1_000_000_000.0
    )

    is_bonded = bool(pancake.get("pair_address") and pancake.get("outer_price_bnb"))

    fallback_price_bnb = pancake.get("outer_price_bnb") if is_bonded else onchain.get("inner_price_bnb")
    price_bnb = (official or {}).get("price_bnb") or fallback_price_bnb

    if price_bnb and bnb_usd_price:
        computed_market_cap_usd = price_bnb * total_supply * bnb_usd_price
    else:
        computed_market_cap_usd = None

    if is_bonded and pancake.get("pair_wbnb_liquidity_bnb") is not None:
        fallback_liquidity_bnb = pancake["pair_wbnb_liquidity_bnb"]
    else:
        fallback_liquidity_bnb = (official or {}).get("bonding_quote_amount_bnb") or onchain.get("bonding_quote_amount_bnb")

    liquidity_usd = (official or {}).get("liquidity_usd")
    liquidity_bnb = fallback_liquidity_bnb
    if liquidity_usd is None and fallback_liquidity_bnb is not None:
        liquidity_usd = fallback_liquidity_bnb * bnb_usd_price if bnb_usd_price else None
    if liquidity_bnb is None and liquidity_usd is not None and bnb_usd_price:
        liquidity_bnb = liquidity_usd / bnb_usd_price

    result = {
        "token": address,
        "name": meta.get("name") or "",
        "symbol": meta.get("symbol") or "",
        "quote_symbol": (official or {}).get("quote_symbol") or "BNB",
        "stage": "outer" if is_bonded else "inner",
        "is_bonded": is_bonded,
        "price_source": "official_page" if (official or {}).get("price_bnb") is not None else ("pancake" if is_bonded else "bonding_curve"),
        "data_source": "official_page+onchain" if official else "onchain",
        "price_bnb": price_bnb,
        "price_change_24h_pct": (official or {}).get("price_change_24h_pct"),
        "market_cap_usd": (official or {}).get("market_cap_usd") or computed_market_cap_usd,
        "liquidity_usd": liquidity_usd,
        "liquidity_bnb": liquidity_bnb,
        "volume_usd": (official or {}).get("volume_usd"),
        "bnb_usd_price": bnb_usd_price,
        "total_supply": total_supply,
        "remaining_supply": (official or {}).get("remaining_supply") or onchain.get("remaining_supply"),
        "bonding_curve_progress_pct": (official or {}).get("progress_pct") or onchain.get("progress_pct"),
        "bonding_quote_amount_bnb": (official or {}).get("bonding_quote_amount_bnb") or onchain.get("bonding_quote_amount_bnb"),
        "target_quote_amount_bnb": (official or {}).get("target_quote_amount_bnb") or onchain.get("target_quote_amount_bnb"),
        "inner_price_bnb": onchain.get("inner_price_bnb"),
        "outer_price_bnb": pancake.get("outer_price_bnb"),
        "pancake_pair": pancake.get("pair_address"),
        "creation_time": (official or {}).get("creation_time"),
        "official_page_found": bool(official),
    }
    return result


def fetch_token_snapshot(rpc: RpcClient, address: str, with_official: bool = True) -> dict[str, Any]:
    address = norm_address(address)
    meta = fetch_token_meta(rpc, address)
    onchain = fetch_four_token_infos(rpc, address)
    pancake = fetch_pancake_state(rpc, address, int(meta.get("decimals") or 18))
    official = None
    if with_official:
        try:
            official = fetch_official_page_snapshot(address)
        except Exception:
            official = None
    bnb_usd_price = fetch_bnb_usd_price(rpc)
    merged = merge_snapshot(address, meta, onchain, pancake, official, bnb_usd_price)
    return merged


def compact_jsonable(data: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(value, float):
            result[key] = safe_round(value, 10)
        else:
            result[key] = value
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch four.meme token market snapshots.")
    parser.add_argument("addresses", nargs="*", help="Token addresses. If omitted, discover from four.meme home board.")
    parser.add_argument("--limit", type=int, default=10, help="Discovery count when no addresses are passed.")
    parser.add_argument("--skip-official", action="store_true", help="Use on-chain data only.")
    parser.add_argument("--pretty", action="store_true", help="Pretty print JSON.")
    parser.add_argument("--sleep", type=float, default=0.2, help="Sleep between multiple token requests.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        if args.addresses:
            addresses = [norm_address(v) for v in args.addresses]
        else:
            addresses = fetch_board_addresses(max(1, args.limit))
    except Exception as exc:
        print(json.dumps({"error": f"failed to discover addresses: {exc}"}))
        return 1

    bad = [addr for addr in addresses if not is_address(addr)]
    if bad:
        print(json.dumps({"error": "invalid address", "addresses": bad}))
        return 1

    rpc = RpcClient(RPC_URLS)
    results: list[dict[str, Any]] = []

    for index, address in enumerate(addresses):
        try:
            snapshot = fetch_token_snapshot(rpc, address, with_official=not args.skip_official)
            results.append(compact_jsonable(snapshot))
        except Exception as exc:
            results.append({"token": address, "error": str(exc)})
        if index < len(addresses) - 1 and args.sleep > 0:
            time.sleep(args.sleep)

    payload = {
        "count": len(results),
        "items": results,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
