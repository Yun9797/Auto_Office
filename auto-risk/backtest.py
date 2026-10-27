"""
코인 이동평균 추세추종 백테스트 (업비트 일봉 / 4시간봉, 여러 코인)

규칙
- 진입: 단기 이동평균(기본 20일)이 장기 이동평균(기본 60일) 위로 올라가면, 다음 날 시가에 매수
- 청산: 단기 이평이 장기 이평 아래로 내려가면 다음 날 시가에 매도
- 손절: 매수가 대비 -8%에 닿으면 즉시 매도 (갭 하락이면 시가에 매도)
- 비용: 수수료 0.05% + 슬리피지 0.05% (매수, 매도 각각)

이동평균 기간(--fast, --slow)은 '봉 개수'다. 일봉 20/60은 4시간봉으로 120/360과 비슷하다.

실행 예
    pip install -r requirements.txt
    python backtest.py                       # 비트코인·이더리움·두들즈·아이리스 일봉, 상장부터 전부
    python backtest.py --markets KRW-BTC     # 한 코인만 자세히 (연도별 수익, 최근 거래)
    python backtest.py --markets 이더리움,KRW-XRP
    python backtest.py --markets all         # 주요 코인 10개
    python backtest.py --interval 4h --fast 120 --slow 360
    python backtest.py --fast 10 --slow 30 --stop 0.05
    python backtest.py --demo                # 인터넷 없이 가짜 데이터로 코드 동작만 확인

결과 거래 내역은 results/trades_<봉>.csv 로 저장된다.
"""

import argparse
import os
import time

import numpy as np
import pandas as pd

UPBIT_URLS = {
    "day": "https://api.upbit.com/v1/candles/days",
    "4h": "https://api.upbit.com/v1/candles/minutes/240",
}
MAX_BARS = {"day": 4000, "4h": 24000}  # 2017년 업비트 오픈 이후 전부를 덮는 개수

# 기본으로 돌릴 코인. 티커(KRW-BTC)나 업비트 한글/영문 이름 모두 쓸 수 있다.
MY_COINS = ["비트코인", "이더리움", "두들즈", "아이리스"]

# --markets all 일 때 돌리는 업비트 원화마켓 주요 코인
MAJOR_MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE",
                 "KRW-ADA", "KRW-TRX", "KRW-LINK", "KRW-AVAX", "KRW-BCH"]


# ---------------------------------------------------------------- 데이터

def fetch_upbit_candles(market="KRW-BTC", interval="day", bars=None):
    """업비트 캔들을 과거로 거슬러 올라가며 200개씩, 더 없을 때까지 받는다."""
    import requests

    bars = bars or MAX_BARS[interval]
    rows, to = [], None
    while len(rows) < bars:
        params = {"market": market, "count": min(200, bars - len(rows))}
        if to:
            params["to"] = to
        resp = requests.get(UPBIT_URLS[interval], params=params, timeout=10)
        if resp.status_code == 429:  # 요청이 너무 빠르면 잠깐 쉬고 다시
            time.sleep(1)
            continue
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        rows.extend(batch)
        to = batch[-1]["candle_date_time_utc"].replace("T", " ")
        if len(batch) < params["count"]:
            break  # 상장일까지 다 받음
        time.sleep(0.12)  # 업비트 요청 제한(초당 10회) 여유 있게

    df = pd.DataFrame(rows).rename(columns={
        "candle_date_time_kst": "date",
        "opening_price": "open",
        "high_price": "high",
        "low_price": "low",
        "trade_price": "close",
        "candle_acc_trade_volume": "volume",
    })
    df["date"] = pd.to_datetime(df["date"])
    if interval == "day":
        df["date"] = df["date"].dt.normalize()
    df = df[["date", "open", "high", "low", "close", "volume"]]
    return df.drop_duplicates("date").sort_values("date").set_index("date")


def resolve_markets(names):
    """'두들즈' 같은 이름을 업비트 원화마켓 티커(KRW-XXX)로 바꾼다."""
    if all(n.upper().startswith("KRW-") for n in names):
        return [n.upper() for n in names]
    import requests

    resp = requests.get("https://api.upbit.com/v1/market/all", timeout=10)
    resp.raise_for_status()
    krw = [m for m in resp.json() if m["market"].startswith("KRW-")]
    found = []
    for n in names:
        key = n.strip().lower()
        if key.upper().startswith("KRW-"):
            found.append(key.upper())
            continue
        exact = [m for m in krw if key in (m["korean_name"].lower(), m["english_name"].lower(),
                                            m["market"][4:].lower())]
        partial = [m for m in krw if key in m["korean_name"].lower() or key in m["english_name"].lower()]
        hits = exact or partial
        if len(hits) == 1:
            m = hits[0]
            print(f"  {n} -> {m['market']} ({m['korean_name']} / {m['english_name']})")
            found.append(m["market"])
        elif hits:
            print(f"  {n}: 여러 개가 맞아요, 티커로 지정해 주세요 -> "
                  + ", ".join(f"{m['market']}({m['korean_name']})" for m in hits))
        else:
            print(f"  {n}: 업비트 원화마켓에서 찾지 못했어요 (상장 폐지됐거나 이름이 다를 수 있음)")
    return found


def load_data(market, interval="day", bars=None, cache_dir="data"):
    """한 번 받은 데이터는 CSV로 저장해 두고, 6시간 안에 다시 실행하면 재사용한다."""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{market}_{interval}_full.csv")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 6 * 3600:
        return pd.read_csv(path, index_col="date", parse_dates=True)
    print(f"  {market} {interval} 데이터 받는 중...", flush=True)
    df = fetch_upbit_candles(market, interval, bars)
    df.to_csv(path)
    return df


def make_demo_data(days=2000, seed=7):
    """인터넷 없이 테스트할 때 쓰는 가짜 가격 (추세 구간과 횡보 구간이 섞이게)."""
    rng = np.random.default_rng(seed)
    drift = np.repeat(rng.normal(0, 0.004, days // 100 + 1), 100)[:days]
    ret = drift + rng.normal(0, 0.035, days)
    close = 30_000_000 * np.exp(np.cumsum(ret))
    open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, 0.005, days))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.015, days)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.015, days)))
    idx = pd.date_range(end=pd.Timestamp.today().normalize(), periods=days, freq="D")
    return pd.DataFrame({"open": open_, "high": high, "low": low,
                         "close": close, "volume": 0.0}, index=idx)


# ---------------------------------------------------------------- 백테스트

def backtest(df, fast=20, slow=60, stop=0.08, fee=0.0005, slippage=0.0005,
             capital=10_000_000):
    df = df.copy()
    df["ma_fast"] = df["close"].rolling(fast).mean()
    df["ma_slow"] = df["close"].rolling(slow).mean()
    # 오늘 종가로 신호를 만들고 내일 시가에 주문한다 (미래 데이터를 보지 않도록)
    df["want_long"] = (df["ma_fast"] > df["ma_slow"]).shift(1, fill_value=False)

    cash, coins = float(capital), 0.0
    entry_price, entry_date = None, None
    stopped_out = False  # 손절 후에는 신호가 한 번 꺼졌다 다시 켜질 때까지 재진입하지 않음
    equity, trades = [], []
    cost = fee + slippage

    for date, bar in df.iterrows():
        # 1) 신호 변화에 따라 시가에 매수 / 매도
        if not bar["want_long"]:
            stopped_out = False
        if coins == 0 and bar["want_long"] and not stopped_out:
            buy_price = bar["open"] * (1 + slippage)
            coins = cash * (1 - fee) / buy_price
            cash = 0.0
            entry_price, entry_date = buy_price, date
        elif coins > 0 and not bar["want_long"]:
            cash = coins * bar["open"] * (1 - cost)
            trades.append((entry_date, date, entry_price, bar["open"], "신호"))
            coins = 0.0

        # 2) 장중 손절
        if coins > 0:
            stop_price = entry_price * (1 - stop)
            if bar["low"] <= stop_price:
                exit_price = min(bar["open"], stop_price)  # 갭 하락이면 시가
                cash = coins * exit_price * (1 - cost)
                trades.append((entry_date, date, entry_price, exit_price, "손절"))
                coins = 0.0
                stopped_out = True

        equity.append(cash + coins * bar["close"])

    df["equity"] = equity
    trades = pd.DataFrame(trades, columns=["entry_date", "exit_date",
                                           "entry_price", "exit_price", "reason"])
    if len(trades):
        trades["return"] = trades["exit_price"] * (1 - cost) / trades["entry_price"] - 1
    return df, trades


# ---------------------------------------------------------------- 성과 지표

def max_drawdown(equity):
    return (equity / equity.cummax() - 1).min()


def summarize(df, trades, capital=10_000_000):
    eq = df["equity"]
    years = (eq.index[-1] - eq.index[0]).days / 365.25
    total = eq.iloc[-1] / capital - 1
    monthly = (1 + total) ** (1 / (years * 12)) - 1

    hold = df["close"] / df["close"].iloc[0] * capital
    hold_total = hold.iloc[-1] / capital - 1

    wins = trades[trades["return"] > 0] if len(trades) else trades
    losses = trades[trades["return"] <= 0] if len(trades) else trades
    pf = (wins["return"].sum() / -losses["return"].sum()
          if len(losses) and losses["return"].sum() < 0 else float("nan"))

    return {
        "기간": f"{eq.index[0].date()} ~ {eq.index[-1].date()} ({years:.1f}년)",
        "전략 총수익률": f"{total:+.1%}",
        "전략 월평균(복리)": f"{monthly:+.2%}",
        "전략 최대낙폭(MDD)": f"{max_drawdown(eq):.1%}",
        "단순보유 총수익률": f"{hold_total:+.1%}",
        "단순보유 MDD": f"{max_drawdown(hold):.1%}",
        "거래 횟수": len(trades),
        "승률": f"{len(wins) / len(trades):.0%}" if len(trades) else "-",
        "평균 수익(이긴 거래)": f"{wins['return'].mean():+.1%}" if len(wins) else "-",
        "평균 손실(진 거래)": f"{losses['return'].mean():+.1%}" if len(losses) else "-",
        "손익비(Profit factor)": f"{pf:.2f}",
    }


def yearly_table(df):
    """연도별로 전략과 단순보유를 비교 (특정 해에만 잘 된 건지 확인용)."""
    eq_year = df["equity"].resample("YE").last()
    px_year = df["close"].resample("YE").last()
    eq_start = pd.concat([pd.Series([df["equity"].iloc[0]]), eq_year.iloc[:-1]]).values
    px_start = pd.concat([pd.Series([df["close"].iloc[0]]), px_year.iloc[:-1]]).values
    return pd.DataFrame({
        "전략": (eq_year.values / eq_start - 1),
        "단순보유": (px_year.values / px_start - 1),
    }, index=eq_year.index.year).map(lambda x: f"{x:+.1%}")


def pooled_stats(trades):
    """여러 코인의 거래를 한데 모아 승률·손익비를 본다 (표본을 늘리는 목적)."""
    wins = trades[trades["return"] > 0]
    losses = trades[trades["return"] <= 0]
    pf = wins["return"].sum() / -losses["return"].sum() if len(losses) else float("nan")
    return {
        "전체 거래 횟수": len(trades),
        "승률": f"{len(wins) / len(trades):.0%}",
        "평균 수익(이긴 거래)": f"{wins['return'].mean():+.1%}" if len(wins) else "-",
        "평균 손실(진 거래)": f"{losses['return'].mean():+.1%}" if len(losses) else "-",
        "거래당 평균 수익": f"{trades['return'].mean():+.2%}",
        "손익비(Profit factor)": f"{pf:.2f}",
        "손절로 끝난 비율": f"{(trades['reason'] == '손절').mean():.0%}",
    }


def print_detail(name, result, trades, args):
    print(f"\n=== {name} | {args.interval} | MA {args.fast}/{args.slow} | 손절 {args.stop:.0%} ===")
    for k, v in summarize(result, trades).items():
        print(f"{k:<22}{v}")
    print("\n[연도별 수익률]")
    print(yearly_table(result).to_string())
    if len(trades):
        print("\n[최근 거래 5건]")
        show = trades.tail(5).copy()
        show["return"] = show["return"].map(lambda x: f"{x:+.1%}")
        print(show.to_string(index=False))


def main():
    p = argparse.ArgumentParser(description="코인 이동평균 추세추종 백테스트")
    p.add_argument("--markets", default=",".join(MY_COINS),
                   help="쉼표로 구분, 티커나 이름 (예: KRW-BTC,이더리움) / all = 주요 10개")
    p.add_argument("--market", help="--markets 와 같음 (예전 옵션)")
    p.add_argument("--interval", choices=["day", "4h"], default="day")
    p.add_argument("--bars", type=int, default=None, help="받을 봉 개수 (기본: 상장부터 전부)")
    p.add_argument("--fast", type=int, default=20)
    p.add_argument("--slow", type=int, default=60)
    p.add_argument("--stop", type=float, default=0.08, help="손절 비율 (0.08 = -8%%)")
    p.add_argument("--demo", action="store_true", help="가짜 데이터로 실행")
    args = p.parse_args()

    if args.demo:
        result, trades = backtest(make_demo_data(), args.fast, args.slow, args.stop)
        print_detail("가짜 데이터(데모)", result, trades, args)
        return

    markets = args.market or args.markets
    markets = MAJOR_MARKETS if markets == "all" else resolve_markets(markets.split(","))

    rows, all_trades = [], []
    for m in markets:
        try:
            df = load_data(m, args.interval, args.bars)
        except Exception as e:  # 상장 안 된 코인 등
            print(f"  {m} 건너뜀: {e}")
            continue
        if len(df) < args.slow + 10:
            print(f"  {m} 건너뜀: 데이터가 너무 짧음")
            continue
        result, trades = backtest(df, args.fast, args.slow, args.stop)
        if len(markets) == 1:
            print_detail(m, result, trades, args)
        s = summarize(result, trades)
        rows.append({"코인": m, "기간": s["기간"], "전략": s["전략 총수익률"],
                     "전략 MDD": s["전략 최대낙폭(MDD)"], "단순보유": s["단순보유 총수익률"],
                     "보유 MDD": s["단순보유 MDD"], "거래": s["거래 횟수"], "승률": s["승률"],
                     "손익비": s["손익비(Profit factor)"]})
        if len(trades):
            all_trades.append(trades.assign(market=m))

    if not all_trades:
        print("거래가 없습니다.")
        return
    trades = pd.concat(all_trades, ignore_index=True)
    os.makedirs("results", exist_ok=True)
    trades.to_csv(f"results/trades_{args.interval}.csv", index=False, encoding="utf-8-sig")

    if len(markets) > 1:
        print(f"\n=== 코인별 결과 | {args.interval} | MA {args.fast}/{args.slow} | 손절 {args.stop:.0%} ===")
        print(pd.DataFrame(rows).to_string(index=False))
    print("\n[전체 거래 합산]")
    for k, v in pooled_stats(trades).items():
        print(f"{k:<22}{v}")
    print(f"\n거래 내역 저장: results/trades_{args.interval}.csv")


if __name__ == "__main__":
    main()
