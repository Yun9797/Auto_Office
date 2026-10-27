"""
오피스 화면 ↔ 'auto-risk' 백테스트 연결용 실행기.

auto-risk/backtest.py 를 그대로 불러와 돌리고, 결과를 JSON 한 줄로 내보낸다.
(원본 backtest.py 는 고치지 않는다)

사용: python run_backtest.py <auto-risk 폴더> '<옵션 JSON>'
옵션: {"markets": "KRW-BTC", "interval": "day", "fast": 20, "slow": 60, "stop": 0.08, "demo": false}
"""

import contextlib
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def current_candle_start(interval):
    """지금 진행 중인(아직 안 끝난) 봉의 시작 시각 — CSV 의 date 형식(KST, 시간대 없음)에 맞춘다."""
    now_utc = datetime.now(timezone.utc)
    if interval == "day":
        # 업비트 일봉은 KST 09:00 에 시작하고, CSV 에는 그날 날짜(00:00)로 저장돼 있다
        return (now_utc.astimezone(KST) - timedelta(hours=9)).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    # 4시간봉은 UTC 0·4·8·12·16·20시 시작 → KST 로 바꿔 저장돼 있다
    start = now_utc.replace(hour=now_utc.hour - now_utc.hour % 4, minute=0, second=0, microsecond=0)
    return start.astimezone(KST).replace(tzinfo=None)


def update_cache(bt, pd, market, interval, cache_dir="data"):
    """
    시세 파일을 '이어 붙이기' 방식으로 최신화한다.
      - 파일이 없으면: 상장부터 전부 받는다 (처음 한 번)
      - 파일이 있으면: 마지막 저장 날짜 이후의 새 봉만 받아 뒤에 붙인다
      - 진행 중인 오늘(현재) 봉은 값이 계속 바뀌므로 항상 뺀다 → 확정된 봉만 쌓인다
    저장 뒤 파일 수정 시각이 새로 찍히므로 backtest.load_data 는 업비트에 다시 묻지 않고 이 파일을 쓴다.
    """
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{market}_{interval}_full.csv")
    cutoff = pd.Timestamp(current_candle_start(interval))

    if not os.path.exists(path):
        print(f"  {market} {interval}: 처음이라 상장부터 전부 받는 중...", flush=True)
        df = bt.fetch_upbit_candles(market, interval)
        df = df[df.index < cutoff]
        df.to_csv(path)
        print(f"  {market} {interval}: {len(df)}개 봉 저장 (~{df.index[-1]})")
        return

    old = pd.read_csv(path, index_col="date", parse_dates=True)
    old = old[old.index < cutoff]  # 예전 방식으로 저장된 '진행 중 봉' 정리
    last = old.index[-1] if len(old) else None

    # 마지막 저장 이후 빈 구간을 덮을 만큼만 받는다 (200개로 부족하면 늘려서 다시)
    bars = 200
    while True:
        new = bt.fetch_upbit_candles(market, interval, bars=bars)
        if last is None or len(new) < bars or new.index.min() <= last or bars >= bt.MAX_BARS[interval]:
            break
        bars = min(bars * 4, bt.MAX_BARS[interval])

    new = new[new.index < cutoff]
    added = new[new.index > last] if last is not None else new
    merged = pd.concat([old, new])
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()  # 겹치는 봉은 최신 값으로
    merged.to_csv(path)
    print(f"  {market} {interval}: 새 봉 {len(added)}개 추가 → 총 {len(merged)}개 (~{merged.index[-1]})")


def main():
    project_dir, opts = sys.argv[1], json.loads(sys.argv[2])
    os.chdir(project_dir)  # data/ 캐시와 results/ 를 원래 폴더에 그대로 쓰도록
    sys.path.insert(0, project_dir)

    # backtest.py 안의 print 는 화면 로그용으로 stderr 로 돌린다 (stdout 은 JSON 전용)
    with contextlib.redirect_stdout(sys.stderr):
        import pandas as pd
        import backtest as bt

        fast, slow, stop = int(opts.get("fast", 20)), int(opts.get("slow", 60)), float(opts.get("stop", 0.08))
        interval = opts.get("interval", "day")

        if opts.get("demo"):
            sources = [("가짜 데이터(데모)", bt.make_demo_data())]
        else:
            names = [n for n in str(opts.get("markets", "KRW-BTC")).split(",") if n.strip()]
            markets = bt.MAJOR_MARKETS if names == ["all"] else bt.resolve_markets(names)
            sources = []
            for m in markets:
                try:
                    try:
                        update_cache(bt, pd, m, interval)
                    except Exception as e:  # 인터넷이 끊겨도 저장된 데이터로는 돌린다
                        print(f"  {m} 최신화 실패, 저장된 데이터 사용: {e}")
                    sources.append((m, bt.load_data(m, interval)))
                except Exception as e:
                    print(f"  {m} 건너뜀: {e}")

        # 전략 탐색 모드: 이동평균·손절 조합을 전부 돌려 숫자 요약만 돌려준다
        if opts.get("sweep"):
            grid = opts["sweep"]
            rows = []
            for name, df in sources:
                for f in grid["fast"]:
                    for s in grid["slow"]:
                        if f >= s or len(df) < s + 10:
                            continue
                        for st in grid["stop"]:
                            result, trades = bt.backtest(df, int(f), int(s), float(st))
                            eq = result["equity"]
                            years = (eq.index[-1] - eq.index[0]).days / 365.25
                            total = eq.iloc[-1] / 10_000_000 - 1
                            wins = int((trades["return"] > 0).sum()) if len(trades) else 0
                            rows.append({
                                "market": name, "fast": int(f), "slow": int(s), "stop": float(st),
                                "monthly": round(((1 + total) ** (1 / (years * 12)) - 1) * 100, 3),
                                "mdd": round(float(bt.max_drawdown(eq)) * 100, 2),
                                "total": round(total * 100, 1),
                                "trades": len(trades),
                                "winRate": round(wins / len(trades) * 100) if len(trades) else 0,
                            })
            out = {"ok": True, "params": {"interval": interval}, "sweep": rows}
            sys.__stdout__.write(json.dumps(out, ensure_ascii=False))
            return

        coins, all_trades = [], []
        for name, df in sources:
            if len(df) < slow + 10:
                print(f"  {name} 건너뜀: 데이터가 너무 짧음")
                continue
            result, trades = bt.backtest(df, fast, slow, stop)
            capital = 10_000_000
            step = max(1, len(result) // 160)
            curve = result.iloc[::step]
            coins.append({
                "name": name,
                "summary": {k: (int(v) if isinstance(v, (int,)) else v)
                            for k, v in bt.summarize(result, trades).items()},
                "yearly": [{"year": int(y), "strategy": r["전략"], "hold": r["단순보유"]}
                           for y, r in bt.yearly_table(result).iterrows()],
                "curve": [{"date": str(d.date()),
                           "strategy": round(e / capital, 4),
                           "hold": round(c / result["close"].iloc[0], 4)}
                          for d, e, c in zip(curve.index, curve["equity"], curve["close"])],
                "recentTrades": [{"entry": str(t.entry_date.date()), "exit": str(t.exit_date.date()),
                                  "return": round(float(t["return"]), 4), "reason": t.reason}
                                 for _, t in trades.tail(8).iterrows()] if len(trades) else [],
            })
            if len(trades):
                all_trades.append(trades.assign(market=name))

        pooled = None
        if all_trades:
            merged = pd.concat(all_trades, ignore_index=True)
            pooled = bt.pooled_stats(merged)
            if not opts.get("demo"):
                os.makedirs("results", exist_ok=True)
                merged.to_csv(f"results/trades_{interval}.csv", index=False, encoding="utf-8-sig")

    def clean(v):
        if isinstance(v, float) and math.isnan(v):
            return None
        return v

    out = {"ok": True, "params": {"interval": interval, "fast": fast, "slow": slow, "stop": stop},
           "coins": coins, "pooled": {k: clean(v) for k, v in pooled.items()} if pooled else None}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # 화면에 그대로 보여줄 수 있게 JSON 으로
        sys.stdout.write(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False))
        sys.exit(1)
