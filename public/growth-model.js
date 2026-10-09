// Aggressive Growth Model: sleeves, target weights and holdings.
// Edit this file to change the model. Weights are shares of the whole
// portfolio and must add up to 1. Inside a sleeve, holdings are equal weight.
//
// The US sleeves hold S&P 500 stocks. The S&P 500 has no true small caps, so
// the mid-cap sleeve uses smaller, faster-growing index members instead of a
// small/mid-cap fund. International, emerging markets, high-yield and cash
// sleeves stay as funds because the S&P 500 doesn't hold them.
// Index membership was checked by hand; review it once or twice a year.
//
// Cash uses BIL (1-3 month T-bills) because it has price history back to 2007;
// SGOV only started in 2020.

const GROWTH_MODEL = [
  {
    id: "large", name: "US Large-Cap Growth", weight: 0.45, role: "Core growth engine", color: "#102A43",
    holdings: [
      ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["NVDA", "NVIDIA"], ["AMZN", "Amazon"],
      ["GOOGL", "Alphabet (Class A)"], ["META", "Meta Platforms"], ["AVGO", "Broadcom"],
      ["TSLA", "Tesla"], ["LLY", "Eli Lilly"], ["NFLX", "Netflix"],
    ],
  },
  {
    id: "mid", name: "US Mid-Cap Growth", weight: 0.20, role: "Smaller, faster-growing S&P 500 names", color: "#3E7CB1",
    holdings: [
      ["AXON", "Axon Enterprise"], ["DECK", "Deckers Outdoor"], ["PODD", "Insulet"], ["FICO", "Fair Isaac"],
      ["TYL", "Tyler Technologies"], ["MPWR", "Monolithic Power Systems"], ["CPRT", "Copart"],
      ["ODFL", "Old Dominion Freight Line"],
    ],
  },
  {
    id: "tech", name: "Tech Satellite", weight: 0.07, role: "High-conviction tilt", color: "#B7791F",
    holdings: [
      ["AMD", "Advanced Micro Devices"], ["NOW", "ServiceNow"], ["PANW", "Palo Alto Networks"],
      ["ANET", "Arista Networks"], ["KLAC", "KLA"],
    ],
  },
  {
    id: "intl", name: "International Developed", weight: 0.15, role: "Global diversification", color: "#12805C",
    holdings: [["VEA", "Vanguard FTSE Developed Markets ETF"]],
  },
  {
    id: "em", name: "Emerging Markets", weight: 0.08, role: "Highest-growth regions", color: "#7FB3A0",
    holdings: [["VWO", "Vanguard FTSE Emerging Markets ETF"]],
  },
  {
    id: "hy", name: "High-Yield Bonds", weight: 0.03, role: "Income with return potential", color: "#9A6B00",
    holdings: [["HYG", "iShares iBoxx $ High Yield Corporate Bond ETF"]],
  },
  {
    id: "cash", name: "Cash / T-Bills", weight: 0.02, role: "Liquidity buffer", color: "#9AA5B1",
    holdings: [["BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF"]],
  },
];
