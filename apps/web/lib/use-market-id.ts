"use client";
import { useEffect, useState } from "react";
import { isHex, type Hex } from "viem";

function validMarketId(value: string | undefined): value is Hex {
  return !!value && isHex(value) && value.length === 66 && !/^0x0{64}$/i.test(value);
}

export function useMarketId() {
  const configured = process.env.NEXT_PUBLIC_MARKET_ID;
  const [marketId, setMarketId] = useState<Hex | undefined>(validMarketId(configured) ? configured : undefined);
  useEffect(() => {
    const queryId = new URLSearchParams(window.location.search).get("id") ?? undefined;
    if (validMarketId(queryId)) setMarketId(queryId);
  }, []);
  return marketId;
}
