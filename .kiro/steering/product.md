# Fantasy Survivor

A fantasy sports web app for CBS Survivor. Players create or join leagues, draft castaways, and earn points based on real episode events.

## Core concepts

- Leagues: private groups with an admin, invite-code join flow, configurable roster size and scoring
- Castaways: Survivor contestants managed by the league admin; can be eliminated or restored
- Draft: snake-style draft (live or auto) where players pick castaways for their team
- Scoring: admin scores episode events using configurable scoring rules; eliminated castaways earn consolation points
- Trades: 1-for-1 castaway trades between players, requiring receiver acceptance then admin approval
- Waiver wire: mechanism for picking up unowned castaways
- Challenges: weekly trivia/prediction challenges worth bonus points
- Leaderboard: aggregated player scores across episodes and challenges

## User roles

- Player: joins leagues, drafts, trades, submits challenge answers, views scores
- League admin: manages castaways, scoring rules, episodes, draft, trades, and waiver wire for their league
