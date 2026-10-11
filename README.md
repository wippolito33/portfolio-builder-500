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

## Annual Sector Select (`/annual.html`)
- Every January 1 (December close), rebalances into that year's two largest stocks per sector in equal amounts and holds for the year, over 1, 3, 5, 10 or 20 years. Compared with the S&P 500 and with today's 22 held over the same span. Includes a sector pie for any year (when bought or at year end), a year-by-year table and the holdings grid. Same layout as the Sector portfolio page.
- Each year's picks (2006 onward) are in `public/annual-picks.js`. They are approximate rankings using today's sector definitions, not a market-cap database; edit them there.

## Aggressive Growth Model (`/growth.html`)
- A 95% equity / 5% bond-and-cash model: US Large-Cap Growth 45%, US Mid-Cap Growth 10%, US Small-Cap Growth 10%, Tech Satellite 7% (all S&P 500 stocks, equal weight inside each sleeve), plus VEA 15%, VWO 8%, HYG 3% and BIL 2%.
- Sleeves, weights and holdings are in `public/growth-model.js`. The S&P 500 has no true small caps, so the small-cap sleeve uses the smallest growth companies in the index (PAYC, EPAM, POOL, ALGN, SMCI) and the mid-cap sleeve the next tier up. Review membership once or twice a year.
- Backtests $10,000 over 1, 3, 5, 10 or 20 years, rebalanced to target every January, against SPY and against the same start never rebalanced. Includes the allocation donut (target or today's drifted weights, flagging sleeves more than 5 points off target), a holdings table, and a year-by-year table.
- Latest prices come from `/api/quotes` (`netlify/functions/quotes.mjs`): one Tiingo request for all 27 holdings, cached for 15 minutes.
- The holdings were picked today, so the backtest benefits from hindsight. The page footer says so.

## Am I Diversified? (`/diversify.html`)
- Client-facing check of how a portfolio is spread out. Load holdings the same ways as the Analyze tab: a positions CSV (RBC and other custodian exports), typed-in holdings, a portfolio file exported from this site, or a saved portfolio. Files are read in the browser and never uploaded. If a portfolio was just loaded on the Analyze tab, it opens automatically.
- Opens with the same growth-of-$10,000 chart as the home page (1, 3, 5, 10 or 20 years), run on the client's holdings at today's weights, rebalanced monthly (the Analyze/Compare engine), against the same holdings at equal weight and SPY. Below it: summary figures and flags, donuts by asset class and by sector, the holdings table, and at the bottom a largest-holdings bar chart (individual stocks over 10% highlighted, with a 10% line). Summary figures cover largest holding, top 5, "acts like N equal-size holdings" = 1 / sum of squared weights), plus plain-language flags.
- Flag thresholds are at the top of `public/diversify.js`: single stock over 10%, top five over 50%, a sector over 30% through individual stocks, no international stock, more than 20% cash, no bonds and under 5% cash.
- Asset class and sector come from `public/sectors.js`; foreign companies listed in the U.S. (TSM, ASML, NVO, etc.) are in the `FOREIGN` list in `diversify.js` and count as international. Funds aren't broken into their holdings.
- Holdings entered as shares are priced with `/api/quotes` (one Tiingo request per 40 tickers), falling back to the last saved month-end price.
- The asset-class donut splits individual U.S. stocks by market cap: large $10B and up, mid $2B to $10B, small under $2B (breakpoints at the top of `public/diversify.js`). U.S. stock funds stay one slice ("US stock funds"). Stocks with no market cap show as "US stocks, size unknown"; a ticker missing from `sectors.js` is sized if a cap is found, otherwise it shows as Other.
- Market caps come from `/api/marketcap` (`netlify/functions/marketcap.mjs`, `netlify/lib/marketCap.mjs`): Tiingo fundamentals first, then Twelve Data statistics. Neither free plan includes market cap for most stocks (Tiingo's free fundamentals cover only a small sample of large companies; Twelve Data's statistics need a paid plan), so on free plans most stocks will show "size unknown". When a provider refuses for plan reasons it's skipped for 24 hours. Caps are saved in Netlify Blobs (store `market-cap`) for 7 days; misses for 3 days.
