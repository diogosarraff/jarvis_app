"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import {
  Game,
  OddsInput,
  RankingItem,
  ResultadoJogo,
  ResultadoJogador,
  getLineBetRankingItem,
  getMinutesAverage,
  getPlayerOpponent,
  getPlayerTeam,
  getProjectionFromGameHandicap,
  getProjectionFromGameTotal,
  getProjectionFromPlayer,
  getProjectionFromGameWinner,
  getWinnerBetRankingItem,
} from "../lib/jarvis-ui"

type MarketKey = "winner" | "total" | "handicap" | "pts" | "ast" | "reb" | "fg3m"

const PLAYER_LABELS: Record<Exclude<MarketKey, "winner" | "total" | "handicap">, string> = {
  pts: "Pontos",
  ast: "Assistências",
  reb: "Rebotes",
  fg3m: "Cestas de 3",
}

export default function Home() {
  const [games, setGames] = useState<Game[]>([])
  const [winnerRows, setWinnerRows] = useState<ResultadoJogo[]>([])
  const [totalRows, setTotalRows] = useState<ResultadoJogo[]>([])
  const [handicapRows, setHandicapRows] = useState<ResultadoJogo[]>([])
  const [playerPointsRows, setPlayerPointsRows] = useState<ResultadoJogador[]>([])
  const [playerAssistsRows, setPlayerAssistsRows] = useState<ResultadoJogador[]>([])
  const [playerReboundsRows, setPlayerReboundsRows] = useState<ResultadoJogador[]>([])
  const [playerThreesRows, setPlayerThreesRows] = useState<ResultadoJogador[]>([])

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [activePlayerMarket, setActivePlayerMarket] = useState<"pts" | "ast" | "reb" | "fg3m">("pts")
  const [loading, setLoading] = useState(true)
  const [oddsMap, setOddsMap] = useState<Record<string, OddsInput>>({})
  const [showRanking, setShowRanking] = useState(false)

  useEffect(() => {
    async function loadData() {
      setLoading(true)

      const [
        { data: gamesRes },
        { data: winnerRes },
        { data: totalRes },
        { data: handicapRes },
        { data: pointsRes },
        { data: assistsRes },
        { data: reboundsRes },
        { data: threesRes },
      ] = await Promise.all([
        supabase.from("agenda_hoje").select("*").order("data", { ascending: true }),
        supabase.from("resultado_vencedor").select("*"),
        supabase.from("resultado_total_pontos").select("*"),
        supabase.from("resultado_handicap").select("*"),
        supabase.from("resultado_player_points").select("*"),
        supabase.from("resultado_player_assists").select("*"),
        supabase.from("resultado_player_rebounds").select("*"),
        supabase.from("resultado_player_threes").select("*"),
      ])

      const gamesData = (gamesRes || []) as Game[]

      setGames(gamesData)
      setWinnerRows((winnerRes || []) as ResultadoJogo[])
      setTotalRows((totalRes || []) as ResultadoJogo[])
      setHandicapRows((handicapRes || []) as ResultadoJogo[])
      setPlayerPointsRows((pointsRes || []) as ResultadoJogador[])
      setPlayerAssistsRows((assistsRes || []) as ResultadoJogador[])
      setPlayerReboundsRows((reboundsRes || []) as ResultadoJogador[])
      setPlayerThreesRows((threesRes || []) as ResultadoJogador[])

      if (gamesData.length > 0) {
        setSelectedGameId(gamesData[0].game_id)
      }

      setLoading(false)
    }

    loadData()
  }, [])

  const selectedGame = useMemo(() => {
    return games.find((g) => g.game_id === selectedGameId) || null
  }, [games, selectedGameId])

  const winnerRow = useMemo(
    () => winnerRows.find((r) => String(r.game_id) === String(selectedGameId)) || null,
    [winnerRows, selectedGameId]
  )

  const totalRow = useMemo(
    () => totalRows.find((r) => String(r.game_id) === String(selectedGameId)) || null,
    [totalRows, selectedGameId]
  )

  const handicapRow = useMemo(
    () => handicapRows.find((r) => String(r.game_id) === String(selectedGameId)) || null,
    [handicapRows, selectedGameId]
  )

  const playersForSelectedGame = useMemo(() => {
    if (!selectedGameId) return []

    const source =
      activePlayerMarket === "pts"
        ? playerPointsRows
        : activePlayerMarket === "ast"
        ? playerAssistsRows
        : activePlayerMarket === "reb"
        ? playerReboundsRows
        : playerThreesRows

    return source
      .filter((p) => String(p.game_id) === String(selectedGameId))
      .filter((p) => (getMinutesAverage(p) ?? 0) >= 20)
      .sort((a, b) => (getProjectionFromPlayer(b) ?? 0) - (getProjectionFromPlayer(a) ?? 0))
  }, [
    selectedGameId,
    activePlayerMarket,
    playerPointsRows,
    playerAssistsRows,
    playerReboundsRows,
    playerThreesRows,
  ])

  const ranking = useMemo(() => {
    const items: RankingItem[] = []

    for (const jogo of games) {
      const winner = winnerRows.find((r) => String(r.game_id) === String(jogo.game_id))
      const total = totalRows.find((r) => String(r.game_id) === String(jogo.game_id))
      const handicap = handicapRows.find((r) => String(r.game_id) === String(jogo.game_id))

      if (winner) {
        const odds = oddsMap[`winner-${jogo.game_id}`] || {}
        items.push(...getWinnerBetRankingItem({ row: winner, jogo, odds }))
      }

      if (total) {
        const odds = oddsMap[`total-${jogo.game_id}`] || {}
        items.push(
          ...getLineBetRankingItem({
            keyBase: `total-${jogo.game_id}`,
            mercado: "Total de Pontos",
            titulo: `${jogo.casa} vs ${jogo.fora}`,
            subtitulo: "Mercado de jogos",
            projecao: getProjectionFromGameTotal(total),
            linha: odds.linha,
            oddOver: odds.oddOver,
            oddUnder: odds.oddUnder,
          })
        )
      }

      if (handicap) {
        const odds = oddsMap[`handicap-${jogo.game_id}`] || {}
        items.push(
          ...getLineBetRankingItem({
            keyBase: `handicap-${jogo.game_id}`,
            mercado: "Handicap",
            titulo: `${jogo.casa} vs ${jogo.fora}`,
            subtitulo: "Mercado de jogos",
            projecao: getProjectionFromGameHandicap(handicap),
            linha: odds.linha,
            oddOver: odds.oddOver,
            oddUnder: odds.oddUnder,
          })
        )
      }
    }

    const playerSources = [
      { rows: playerPointsRows, mercado: "Pontos" },
      { rows: playerAssistsRows, mercado: "Assistências" },
      { rows: playerReboundsRows, mercado: "Rebotes" },
      { rows: playerThreesRows, mercado: "Cestas de 3" },
    ]

    for (const source of playerSources) {
      for (const row of source.rows) {
        const minutes = getMinutesAverage(row)
        if ((minutes ?? 0) < 20) continue

        const key = `player-${source.mercado}-${row.game_id}-${row.player_id}`
        const odds = oddsMap[key] || {}

        items.push(
          ...getLineBetRankingItem({
            keyBase: key,
            mercado: source.mercado,
            titulo: `${row.player_name}`,
            subtitulo: `${getPlayerTeam(row)} vs ${getPlayerOpponent(row)}`,
            projecao: getProjectionFromPlayer(row),
            linha: odds.linha,
            oddOver: odds.oddOver,
            oddUnder: odds.oddUnder,
          })
        )
      }
    }

    return items
      .filter((x) => x.odd && x.ev !== null)
      .sort((a, b) => (b.ev ?? -999) - (a.ev ?? -999))
  }, [
    games,
    winnerRows,
    totalRows,
    handicapRows,
    playerPointsRows,
    playerAssistsRows,
    playerReboundsRows,
    playerThreesRows,
    oddsMap,
  ])

  function handleOddsChange(key: string, field: keyof OddsInput, value: string) {
    setOddsMap((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value === "" ? undefined : Number(value),
      },
    }))
  }

  function formatProb(n: number | null | undefined) {
    if (n === null || n === undefined) return "-"
    return `${(n * 100).toFixed(1)}%`
  }

  function formatNum(n: number | null | undefined, digits = 2) {
    if (n === null || n === undefined || Number.isNaN(n)) return "-"
    return Number(n).toFixed(digits)
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Jarvis NBA</h1>
        <p style={styles.subtitle}>Versão treinada - central operacional diária</p>
      </div>

      <div style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Jogos do dia</h2>

        {loading ? (
          <p style={styles.emptyText}>Carregando...</p>
        ) : games.length === 0 ? (
          <p style={styles.emptyText}>Nenhum jogo encontrado.</p>
        ) : (
          <div style={styles.gamesList}>
            {games.map((game) => (
              <button
                key={game.game_id}
                onClick={() => setSelectedGameId(game.game_id)}
                style={{
                  ...styles.gameButton,
                  backgroundColor: selectedGameId === game.game_id ? "#ff6b00" : "#242934",
                }}
              >
                {game.casa} vs {game.fora}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedGame && (
        <>
          <div style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>Mercados de jogos</h2>

            <div style={styles.cardsList}>
              <div style={styles.playerCard}>
                <div style={styles.playerHeader}>
                  <div style={styles.playerName}>Vencedor</div>
                </div>

                {winnerRow ? (
                  <>
                    <div style={styles.dataRow}>
                      <div style={styles.dataLabel}>Probabilidade Jarvis</div>
                      <div style={styles.dataValue}>
                        {selectedGame.casa}: {formatProb(getProjectionFromGameWinner(winnerRow).probCasa)} |{" "}
                        {selectedGame.fora}: {formatProb(getProjectionFromGameWinner(winnerRow).probFora)}
                      </div>
                    </div>

                    <div style={styles.oddsGridTwo}>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={`Odd ${selectedGame.casa}`}
                        value={oddsMap[`winner-${selectedGame.game_id}`]?.oddHome ?? ""}
                        onChange={(e) =>
                          handleOddsChange(`winner-${selectedGame.game_id}`, "oddHome", e.target.value)
                        }
                        style={styles.input}
                      />

                      <input
                        type="number"
                        step="0.01"
                        placeholder={`Odd ${selectedGame.fora}`}
                        value={oddsMap[`winner-${selectedGame.game_id}`]?.oddAway ?? ""}
                        onChange={(e) =>
                          handleOddsChange(`winner-${selectedGame.game_id}`, "oddAway", e.target.value)
                        }
                        style={styles.input}
                      />
                    </div>
                  </>
                ) : (
                  <p style={styles.emptyText}>Sem resultado de vencedor para este jogo.</p>
                )}
              </div>

              <div style={styles.playerCard}>
                <div style={styles.playerHeader}>
                  <div style={styles.playerName}>Total de Pontos</div>
                </div>

                {totalRow ? (
                  <>
                    <div style={styles.dataRow}>
                      <div style={styles.dataLabel}>Projeção Jarvis</div>
                      <div style={styles.dataValue}>
                        {formatNum(getProjectionFromGameTotal(totalRow), 1)}
                      </div>
                    </div>

                    <div style={styles.oddsGridThree}>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="Linha da banca"
                        value={oddsMap[`total-${selectedGame.game_id}`]?.linha ?? ""}
                        onChange={(e) =>
                          handleOddsChange(`total-${selectedGame.game_id}`, "linha", e.target.value)
                        }
                        style={styles.input}
                      />

                      <input
                        type="number"
                        step="0.01"
                        placeholder="Odd Over"
                        value={oddsMap[`total-${selectedGame.game_id}`]?.oddOver ?? ""}
                        onChange={(e) =>
                          handleOddsChange(`total-${selectedGame.game_id}`, "oddOver", e.target.value)
                        }
                        style={styles.input}
                      />

                      <input
                        type="number"
                        step="0.01"
                        placeholder="Odd Under"
                        value={oddsMap[`total-${selectedGame.game_id}`]?.oddUnder ?? ""}
                        onChange={(e) =>
                          handleOddsChange(`total-${selectedGame.game_id}`, "oddUnder", e.target.value)
                        }
                        style={styles.input}
                      />
                    </div>
                  </>
                ) : (
                  <p style={styles.emptyText}>Sem resultado de total de pontos para este jogo.</p>
                )}
              </div>

              <div style={styles.playerCard}>
                <div style={styles.playerHeader}>
                  <div style={styles.playerName}>Handicap</div>
                </div>

                {handicapRow ? (
                  <>
                    <div style={styles.dataRow}>
                      <div style={styles.dataLabel}>Projeção Jarvis</div>
                      <div style={styles.dataValue}>
                        {formatNum(getProjectionFromGameHandicap(handicapRow), 1)}
                      </div>
                    </div>

                    <div style={styles.oddsGridThree}>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="Linha da banca"
                        value={oddsMap[`handicap-${selectedGame.game_id}`]?.linha ?? ""}
                        onChange={(e) =>
                          handleOddsChange(`handicap-${selectedGame.game_id}`, "linha", e.target.value)
                        }
                        style={styles.input}
                      />

                      <input
                        type="number"
                        step="0.01"
                        placeholder="Odd lado 1"
                        value={oddsMap[`handicap-${selectedGame.game_id}`]?.oddOver ?? ""}
                        onChange={(e) =>
                          handleOddsChange(`handicap-${selectedGame.game_id}`, "oddOver", e.target.value)
                        }
                        style={styles.input}
                      />

                      <input
                        type="number"
                        step="0.01"
                        placeholder="Odd lado 2"
                        value={oddsMap[`handicap-${selectedGame.game_id}`]?.oddUnder ?? ""}
                        onChange={(e) =>
                          handleOddsChange(`handicap-${selectedGame.game_id}`, "oddUnder", e.target.value)
                        }
                        style={styles.input}
                      />
                    </div>
                  </>
                ) : (
                  <p style={styles.emptyText}>Sem resultado de handicap para este jogo.</p>
                )}
              </div>
            </div>
          </div>

          <div style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>Mercados de jogadores</h2>

            <div style={styles.marketTabs}>
              {(["pts", "ast", "reb", "fg3m"] as const).map((market) => (
                <button
                  key={market}
                  onClick={() => setActivePlayerMarket(market)}
                  style={{
                    ...styles.marketTab,
                    backgroundColor: activePlayerMarket === market ? "#ff6b00" : "#2a2f3a",
                  }}
                >
                  {PLAYER_LABELS[market]}
                </button>
              ))}
            </div>

            <div style={styles.filterInfo}>
              Filtro ativo: apenas jogadores com média de 20 minutos ou mais
            </div>

            {playersForSelectedGame.length === 0 ? (
              <p style={styles.emptyText}>Nenhum jogador encontrado para esse filtro.</p>
            ) : (
              <div style={styles.cardsList}>
                {playersForSelectedGame.map((player) => {
                  const key = `player-${PLAYER_LABELS[activePlayerMarket]}-${player.game_id}-${player.player_id}`

                  return (
                    <div key={key} style={styles.playerCard}>
                      <div style={styles.playerHeader}>
                        <div style={styles.playerName}>
                          {player.player_name} ({getPlayerTeam(player)})
                        </div>
                      </div>

                      <div style={styles.dataRow}>
                        <div style={styles.dataLabel}>Adversário</div>
                        <div style={styles.dataValue}>{getPlayerOpponent(player)}</div>
                      </div>

                      <div style={styles.metricsRow}>
                        <div style={styles.metricBox}>
                          <div style={styles.metricLabel}>Projeção Jarvis</div>
                          <div style={styles.metricValue}>
                            {formatNum(getProjectionFromPlayer(player), 1)}
                          </div>
                        </div>

                        <div style={styles.metricBox}>
                          <div style={styles.metricLabel}>Média de minutos</div>
                          <div style={styles.metricValue}>
                            {formatNum(getMinutesAverage(player), 1)}
                          </div>
                        </div>
                      </div>

                      <div style={styles.oddsGridThree}>
                        <input
                          type="number"
                          step="0.5"
                          placeholder="Linha da banca"
                          value={oddsMap[key]?.linha ?? ""}
                          onChange={(e) => handleOddsChange(key, "linha", e.target.value)}
                          style={styles.input}
                        />

                        <input
                          type="number"
                          step="0.01"
                          placeholder="Odd Over"
                          value={oddsMap[key]?.oddOver ?? ""}
                          onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                          style={styles.input}
                        />

                        <input
                          type="number"
                          step="0.01"
                          placeholder="Odd Under"
                          value={oddsMap[key]?.oddUnder ?? ""}
                          onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                          style={styles.input}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div style={styles.sectionCard}>
            <button style={styles.calcButton} onClick={() => setShowRanking(true)}>
              Calcular ranking do dia
            </button>
          </div>
        </>
      )}

      {showRanking && (
        <div style={styles.sectionCard}>
          <h2 style={styles.sectionTitle}>Ranking das apostas do dia</h2>

          {ranking.length === 0 ? (
            <p style={styles.emptyText}>
              Nenhuma aposta calculada. Preencha pelo menos uma linha e odd da banca.
            </p>
          ) : (
            <div style={styles.cardsList}>
              {ranking.map((item, index) => (
                <div key={item.key} style={styles.playerCard}>
                  <div style={styles.playerHeader}>
                    <div style={styles.playerName}>
                      #{index + 1} {item.titulo}
                    </div>
                    <div style={styles.rankBadge}>
                      {item.categoria} • {item.mercado}
                    </div>
                  </div>

                  <div style={styles.dataRow}>
                    <div style={styles.dataLabel}>Contexto</div>
                    <div style={styles.dataValue}>{item.subtitulo}</div>
                  </div>

                  <div style={styles.metricsRow}>
                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Lado</div>
                      <div style={styles.metricValue}>{item.lado}</div>
                    </div>

                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Linha</div>
                      <div style={styles.metricValue}>{formatNum(item.linha, 1)}</div>
                    </div>

                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Projeção</div>
                      <div style={styles.metricValue}>{formatNum(item.projecao, 1)}</div>
                    </div>

                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Probabilidade</div>
                      <div style={styles.metricValue}>{formatProb(item.prob)}</div>
                    </div>

                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Odd</div>
                      <div style={styles.metricValue}>{formatNum(item.odd, 2)}</div>
                    </div>

                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Edge</div>
                      <div style={styles.metricValue}>{formatNum(item.edge, 2)}</div>
                    </div>

                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>EV</div>
                      <div style={styles.metricValue}>{formatNum(item.ev !== null ? item.ev * 100 : null, 1)}%</div>
                    </div>

                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Confiança</div>
                      <div style={styles.metricValue}>{formatNum(item.confianca, 1)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#0f1115",
    color: "white",
    padding: "20px 16px 40px",
    fontFamily: "Arial, sans-serif",
  },
  header: {
    marginBottom: 18,
  },
  title: {
    margin: 0,
    fontSize: 30,
    fontWeight: 700,
  },
  subtitle: {
    margin: "6px 0 0",
    color: "#9aa4b2",
    fontSize: 14,
  },
  sectionCard: {
    backgroundColor: "#1a1f28",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  },
  sectionTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
  },
  gamesList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 14,
  },
  gameButton: {
    width: "100%",
    border: "none",
    borderRadius: 12,
    padding: "14px 16px",
    color: "white",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 15,
  },
  marketTabs: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 14,
    marginBottom: 12,
  },
  marketTab: {
    border: "none",
    borderRadius: 10,
    padding: "10px 12px",
    color: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  filterInfo: {
    fontSize: 12,
    color: "#9aa4b2",
    marginBottom: 14,
  },
  cardsList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 14,
  },
  playerCard: {
    backgroundColor: "#11161d",
    borderRadius: 14,
    padding: 14,
  },
  playerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  playerName: {
    fontSize: 18,
    fontWeight: 700,
  },
  dataRow: {
    marginBottom: 10,
  },
  dataLabel: {
    fontSize: 12,
    color: "#9aa4b2",
    marginBottom: 4,
  },
  dataValue: {
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.5,
  },
  metricsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10,
    marginTop: 14,
  },
  metricBox: {
    backgroundColor: "#1f2530",
    borderRadius: 12,
    padding: 12,
  },
  metricLabel: {
    fontSize: 12,
    color: "#9aa4b2",
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 700,
  },
  oddsGridThree: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 8,
    marginTop: 14,
  },
  oddsGridTwo: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 8,
    marginTop: 14,
  },
  input: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid #2f3642",
    backgroundColor: "#1f2530",
    color: "white",
    padding: "12px 10px",
    fontSize: 14,
    outline: "none",
  },
  emptyText: {
    marginTop: 14,
    color: "#9aa4b2",
  },
  calcButton: {
    width: "100%",
    border: "none",
    borderRadius: 12,
    padding: "14px 16px",
    backgroundColor: "#ff6b00",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 16,
  },
  rankBadge: {
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    color: "white",
    backgroundColor: "#2a2f3a",
  },
}