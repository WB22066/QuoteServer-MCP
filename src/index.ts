import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

interface Env {
  TIINGO_API_TOKEN: string;
}

function cleanQuote(q: any) {
  return {
    symbol: q.ticker,
    price: q.tngoLast ?? q.mid ?? q.last ?? null,
    source: "tiingo",
    timestamp: q.timestamp,
    previousClose: q.prevClose,
    open: q.open,
    high: q.high,
    low: q.low,
    volume: q.volume,
  };
}

async function fetchTiingo(symbols: string[], env: Env) {
  const tickerString = symbols
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .join(",");

  const response = await fetch(
    `https://api.tiingo.com/iex/${encodeURIComponent(tickerString)}`,
    {
      headers: {
        Authorization: `Token ${env.TIINGO_API_TOKEN}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Tiingo request failed: ${response.status}`);
  }

  const data: any[] = await response.json();
  return data.map(cleanQuote);
}

function cleanBar(d: any) {
  return {
    date: String(d.date).slice(0, 10),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
    adjClose: d.adjClose,
  };
}

async function fetchTiingoHistory(
  symbol: string,
  startDate: string,
  endDate: string | undefined,
  frequency: string,
  env: Env
) {
  const params = new URLSearchParams({
    startDate,
    ...(endDate ? { endDate } : {}),
    resampleFreq: frequency,
  });

  const response = await fetch(
    `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(
      symbol.trim().toUpperCase()
    )}/prices?${params.toString()}`,
    {
      headers: {
        Authorization: `Token ${env.TIINGO_API_TOKEN}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Tiingo history request failed: ${response.status}`);
  }

  const data: any[] = await response.json();
  return data.map(cleanBar);
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "Wayne Tiingo Quote Server",
    version: "1.0.0",
  });

  server.registerTool(
    "get_quote",
    {
      description: "Get the current Tiingo quote for a US stock or ETF",
      inputSchema: {
        symbol: z.string(),
      },
    },
    async ({ symbol }) => {
      const quotes = await fetchTiingo([symbol], env);
      const quote = quotes[0];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(quote),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_quotes",
    {
      description:
        "Get current Tiingo quotes for multiple US stocks or ETFs",
      inputSchema: {
        symbols: z.array(z.string()).min(1).max(100),
      },
    },
    async ({ symbols }) => {
      const quotes = await fetchTiingo(symbols, env);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: quotes.length,
              quotes,
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_history",
    {
      description: "Get historical daily prices for a US stock or ETF",
      inputSchema: {
        symbol: z.string(),
        startDate: z.string().describe("YYYY-MM-DD"),
        endDate: z.string().describe("YYYY-MM-DD, defaults to today").optional(),
        frequency: z
          .enum(["daily", "weekly", "monthly"])
          .default("daily")
          .optional(),
      },
    },
    async ({ symbol, startDate, endDate, frequency }) => {
      const bars = await fetchTiingoHistory(
        symbol,
        startDate,
        endDate,
        frequency ?? "daily",
        env
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              symbol: symbol.trim().toUpperCase(),
              source: "tiingo",
              frequency: frequency ?? "daily",
              bars,
            }),
          },
        ],
      };
    }
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return createMcpHandler(() => createServer(env))(request, env, ctx);
    }

    return new Response(
      JSON.stringify({
        name: "Wayne Tiingo MCP Quote Server",
        mcp: "/mcp",
      }),
      {
        headers: {
          "content-type": "application/json",
        },
      }
    );
  },
};
