// The two largest S&P 500 stocks in each sector, by market cap.
// Tiingo's free plan has no market-cap data, so this list is maintained by
// hand. Review it once or twice a year.
export const SECTORS = {
  "Information Technology": [["NVDA", "NVIDIA"], ["MSFT", "Microsoft"]],
  "Communication Services": [["GOOGL", "Alphabet (Class A)"], ["META", "Meta Platforms"]],
  "Consumer Discretionary": [["AMZN", "Amazon"], ["TSLA", "Tesla"]],
  "Financials": [["BRK-B", "Berkshire Hathaway (Class B)"], ["JPM", "JPMorgan Chase"]],
  "Health Care": [["LLY", "Eli Lilly"], ["JNJ", "Johnson & Johnson"]],
  "Consumer Staples": [["WMT", "Walmart"], ["COST", "Costco"]],
  "Energy": [["XOM", "Exxon Mobil"], ["CVX", "Chevron"]],
  "Industrials": [["GE", "GE Aerospace"], ["CAT", "Caterpillar"]],
  "Materials": [["LIN", "Linde"], ["SHW", "Sherwin-Williams"]],
  "Utilities": [["NEE", "NextEra Energy"], ["CEG", "Constellation Energy"]],
  "Real Estate": [["WELL", "Welltower"], ["PLD", "Prologis"]],
};

export const SECTOR_SYMBOLS = Object.values(SECTORS).flat().map(([s]) => s);
