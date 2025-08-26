# Swoop
A 2 player push-your-luck board game.

## React Implementation

The game logic is implemented in React and bundled with [Vite](https://vitejs.dev/).
Tailwind CSS is processed via PostCSS for a production-ready build.

## Development

Install dependencies (requires Node.js):

```
npm install
```

Start a development server:

```
npm run dev
```

Run the placeholder test script:

```
npm test
```

## Simulation Mode

A headless simulator runs two non-reactive bots against each other for a configurable number of games (rounds). It reports ~10 key metrics.

Run with defaults (100 rounds to target score 5):

```
npm run simulate
```

Configure rounds, target score, and an optional seed:

```
npm run simulate -- --rounds=1000 --target=5 --seed=42
```

Bot strategies:
- Bot 1: Prefers highest odd sums (11 > 9 > 7 > 5 > 3), then highest overall; banks when it delivered in the turn or after ~3 actions.
- Bot 2: Mixed; tends to favor even/high sums for baskets about half the time, otherwise highest sums; banks if delivered, after ~4 actions, or occasionally at random.

Notes and future considerations for bots (non-reactive for now):
- Adaptive banking by risk of bust and deterrent exposure.
- Lane congestion and blocker awareness in pair selection.
- Opponent threat modeling and tailwind optimization (both sides).
- Basket scarcity awareness and prioritization of safe returns.
- Heuristics for when to Swoop vs Move under odd-lane slope.
- Managing active-piece cap (max 2) strategically across lanes.
- Endgame targeting when one point away from victory.
