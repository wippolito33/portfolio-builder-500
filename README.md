# Portfolio Builder 500

Internal research tool for Alexander Capital. Builds a sector-diversified portfolio from the
S&P 500 and backtests it against the index.

## How it works
1. For each of the 11 GICS sectors, keeps the top two of the largest S&P 500 names (curated size-ordered list): 22 stocks.
   Live prices come from **Tiingo**.
2. Backtests $10,000 over 5, 10 and 20 years, buy-and-hold, dividends reinvested (adjusted close).
3. Drops the two worst performers over each period and holds the remaining 20 at 5% each.
   If a stock wasn't public at the start date, it's excluded and the rest are equal-weighted.
4. Compares against all 22 equal-weighted and SPY.
5. Prices refresh every 5 minutes while the page is open.

## Project layout
- `public/` – the website (index.html, app.js)
- `netlify/functions/portfolio.mjs` – `/api/portfolio`: live quotes + top-2-per-sector ranking
- `netlify/functions/history.mjs` – `/api/history`: monthly price history for backtests
- `netlify/lib/tiingo.mjs` – Tiingo helper
- The sector candidate list lives at the top of `portfolio.mjs`. Review it once or twice a year.

## Deploy
1. Create a new GitHub repo named `portfolio-builder-500` and upload these files.
2. In Netlify: Add new site → Import an existing project → GitHub → pick the repo.
3. In Netlify, add an environment variable `TIINGO_KEY` with your Tiingo key (mark it secret).
4. Leave build command blank; Netlify reads `netlify.toml`. Click Deploy.

## Notes
- Requires a free Tiingo API key set as the `TIINGO_KEY` environment variable in Netlify
  (Site configuration -> Environment variables). Sign up at tiingo.com.
- Results are hypothetical and backtested with hindsight. Internal use only; review with compliance before sharing.

## Staying inside Tiingo's free plan
The free plan allows 50 requests an hour and 1,000 a day. To stay well under that:
- Live prices use one request for all 22 stocks, cached on Netlify for 5 minutes (at most ~12 an hour).
- 20-year history uses 23 requests, cached on Netlify for 24 hours.
- Company names and the 22 holdings are listed in `portfolio.mjs`, so no requests are spent on them.

## Analyze a portfolio (`/analyze.html`)
- Import a custodian positions CSV (any file with Symbol and Quantity columns, including RBC exports) or type holdings in. Files are read in the browser and never uploaded.
- Pick a position to sell and a ticker to buy instead. The page shows a 1/3/5/10-year backtest and a forward range of outcomes (resampled historical monthly returns), including estimated tax on the sale.
- Each holding uses one data request, cached for 24 hours. If the free limits are reached, the page waits a minute and continues automatically.

## Data sources
- **Tiingo** (`TIINGO_KEY`): live prices, and price history first. Free plan: 50 requests/hour, 1,000/day. History includes dividends.
- **Twelve Data** (`TWELVEDATA_KEY`): price history once Tiingo's hourly limit is reached. Free plan: 8 requests/minute, 800/day. Asks for dividend-adjusted prices; if the plan doesn't allow that, uses split-adjusted prices and the page flags the stock as "No dividends".
- Both keys are Netlify environment variables (Site configuration -> Environment variables). Changing a key requires a redeploy.

## Sectors and saved portfolios
- The sector chart uses the ticker list in `public/sectors.js` (GICS sectors for stocks; funds grouped as U.S. stock, international stock, or bond funds). Unlisted tickers show as "Other"; add them there.
- Saved portfolios live in the browser's local storage on that computer only (shares and cost basis, revalued at the latest prices when reopened). Export creates a `.json` file that can be opened on another computer from the same file picker. Nothing is stored on a server.

## Compare (`/compare.html`)
- Sets a portfolio (the one last loaded on the Analyze tab, any saved portfolio, or a file) against the sector portfolio, all 22 sector stocks equal-weighted, and the S&P 500 over 1, 3, 5, 10 and 20 years, plus a sector-mix comparison.
- Shared browser code lives in `public/common.js` (file parsing, history loading, saved portfolios, return math).

## Saved price history
- Monthly history for every stock is saved in Netlify Blobs (store `price-history`) and refreshed at most once every 20 hours, so data providers are only called for stocks the site hasn't seen before. If a provider's limit is hit, the saved copy is used.
- `netlify/functions/refresh-history.mjs` runs every weekday at 22:30 UTC to refresh the 22 sector stocks, SPY, and the stalest other saved stocks (up to 40 requests).
- The 22 sector stocks are listed in `netlify/lib/sectors.mjs`.
