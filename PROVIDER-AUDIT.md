# Nuvio Provider Doctor

Generated: 2026-09-07T15:36:32.979Z  
Manifest providers: **24**  
Enabled: **24**  
Structural failures: **0**  
Live smoke pass: **24**  
Live smoke fail/timeout: **0**  

| ID | Enabled | Syntax | Export | Live smoke | Streams | Error |
|---|---:|---|---|---|---:|---|
| allmovieland | yes | PASS | PASS | PASS | 0 |  |
| anidb | yes | PASS | PASS | PASS | 0 |  |
| anizone | yes | PASS | PASS | PASS | 0 |  |
| bollyflix | yes | PASS | PASS | PASS | 0 |  |
| cinejoy | yes | PASS | PASS | PASS | 0 |  |
| hdhub | yes | PASS | PASS | PASS | 7 |  |
| hexa | yes | PASS | PASS | PASS | 6 |  |
| moviebox | yes | PASS | PASS | PASS | 0 |  |
| moviesdrive | yes | PASS | PASS | PASS | 0 |  |
| moviesmod | yes | PASS | PASS | PASS | 0 |  |
| pinoymovieshub | yes | PASS | PASS | PASS | 0 |  |
| primesrc | yes | PASS | PASS | PASS | 0 |  |
| rogmovies | yes | PASS | PASS | PASS | 0 |  |
| showbox | yes | PASS | PASS | PASS | 0 |  |
| torrents | yes | PASS | PASS | PASS | 20 |  |
| uhdmovies | yes | PASS | PASS | PASS | 0 |  |
| vaplayer | yes | PASS | PASS | PASS | 3 |  |
| vegamovies | yes | PASS | PASS | PASS | 0 |  |
| vidcore | yes | PASS | PASS | PASS | 0 |  |
| videasy | yes | PASS | PASS | PASS | 7 |  |
| vidfast | yes | PASS | PASS | PASS | 4 |  |
| vidlink | yes | PASS | PASS | PASS | 3 |  |
| vidrock | yes | PASS | PASS | PASS | 4 |  |
| vidzee | yes | PASS | PASS | PASS | 0 |  |

## Interpretation

- Structural failures are actionable code/manifest problems.
- LIVE FAIL means the provider entered `getStreams()` but the remote source did not return usable results within the smoke-test window. This is not automatically treated as a code failure.
- Smoke tests never print returned stream URLs.
