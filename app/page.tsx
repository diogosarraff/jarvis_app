"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"

type Game = {
  game_id: string
  casa: string
  fora: string
  data: string
}

type Prop = {
  game_id: string
  game_date: string
  player_id: string
  player_name: string
  team: string
  opponent: string
  market: "pts" | "reb" | "ast" | "fg3m"
  vs_opp_1: number | null
  vs_opp_2: number | null
  vs_opp_3: number | null
  vs_opp_4: number | null
  vs_opp_5: number | null
  recent_1: number | null
  recent_2: number | null
  recent_3: number | null
  recent_4: number | null
  recent_5: number | null
  avg_final: number | null
  linha_minima: number | null
  farol: "verde" | "amarelo" | "vermelho" | string
}

type PrePlayer = {
  game_id: string
  player_id: string
  player_name: string
  team: string
  opponent: string
  minutes_l5: number | null
}

const MARKET_LABELS: Record<Prop["market"], string> = {
  pts: "Pontos",
  reb: "Rebotes",
  ast: "Assistências",
  fg3m: "Cestas de 3",
}

export default function Home() {
  const [games, setGames] = useState<Game[]>([])
  const [propsData, setPropsData] = useState<Prop[]>([])
  const [prePlayers, setPrePlayers] = useState<PrePlayer[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [activeMarket, setActiveMarket] = useState<Prop["market"]>("pts")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      setLoading(true)

      const [{ data: gamesRes }, { data: propsRes }, { data: preRes }] = await Promise.all([
        supabase.from("agenda_hoje").select("*").order("data", { ascending: true }),
        supabase.from("props_jogadores_matchup_dia").select("*"),
        supabase.from("pre_jogadores_matchup_dia").select("*"),
      ])

      const gamesData = (gamesRes || []) as Game[]
      const propsRows = (propsRes || []) as Prop[]
      const preRows = (preRes || []) as PrePlayer[]

      setGames(gamesData)
      setPropsData(propsRows)
      setPrePlayers(preRows)

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

  const playersForSelectedGame = useMemo(() => {
    if (!selectedGameId) return []

    return propsData
      .filter((p) => p.game_id === selectedGameId && p.market === activeMarket)
      .filter((p) => {
        const playerPre = prePlayers.find(
          (x) => x.game_id === p.game_id && x.player_id === p.player_id
        )

        return (playerPre?.minutes_l5 ?? 0) >= 24
      })
      .sort((a, b) => (b.avg_final ?? 0) - (a.avg_final ?? 0))
  }, [selectedGameId, propsData, prePlayers, activeMarket])

  function formatList(values: Array<number | null>) {
    return values.map((v) => (v === null ? "-" : Number(v).toFixed(0))).join(" | ")
  }

  function getFarolColor(farol: string) {
    if (farol === "verde") return "#00d26a"
    if (farol === "amarelo") return "#ffb020"
    return "#ff5c5c"
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Jarvis</h1>
        <p style={styles.subtitle}>Props automáticas por confronto</p>
      </div>

      <div style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Jogos de hoje</h2>

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
                  backgroundColor:
                    selectedGameId === game.game_id ? "#ff6b00" : "#242934",
                }}
              >
                {game.casa} vs {game.fora}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedGame && (
        <div style={styles.sectionCard}>
          <h2 style={styles.sectionTitle}>
            {selectedGame.casa} vs {selectedGame.fora}
          </h2>

          <div style={styles.marketTabs}>
            {(Object.keys(MARKET_LABELS) as Prop["market"][]).map((market) => (
              <button
                key={market}
                onClick={() => setActiveMarket(market)}
                style={{
                  ...styles.marketTab,
                  backgroundColor: activeMarket === market ? "#ff6b00" : "#2a2f3a",
                }}
              >
                {MARKET_LABELS[market]}
              </button>
            ))}
          </div>

          <div style={styles.filterInfo}>
            Filtro ativo: apenas jogadores com média de 24+ minutos nos últimos 5 jogos
          </div>

          {playersForSelectedGame.length === 0 ? (
            <p style={styles.emptyText}>Nenhum jogador encontrado para esse filtro.</p>
          ) : (
            <div style={styles.cardsList}>
              {playersForSelectedGame.map((player) => (
                <div
                  key={`${player.game_id}-${player.player_id}-${player.market}`}
                  style={styles.playerCard}
                >
                  <div style={styles.playerHeader}>
                    <div style={styles.playerName}>
                      {player.player_name} ({player.team})
                    </div>
                    <div
                      style={{
                        ...styles.farolBadge,
                        backgroundColor: getFarolColor(player.farol),
                      }}
                    >
                      {player.farol.toUpperCase()}
                    </div>
                  </div>

                  <div style={styles.dataRow}>
                    <div style={styles.dataLabel}>Últimos 5 contra o adversário</div>
                    <div style={styles.dataValue}>
                      {formatList([
                        player.vs_opp_1,
                        player.vs_opp_2,
                        player.vs_opp_3,
                        player.vs_opp_4,
                        player.vs_opp_5,
                      ])}
                    </div>
                  </div>

                  <div style={styles.dataRow}>
                    <div style={styles.dataLabel}>Últimos 5 mais recentes</div>
                    <div style={styles.dataValue}>
                      {formatList([
                        player.recent_1,
                        player.recent_2,
                        player.recent_3,
                        player.recent_4,
                        player.recent_5,
                      ])}
                    </div>
                  </div>

                  <div style={styles.metricsRow}>
                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Média</div>
                      <div style={styles.metricValue}>
                        {player.avg_final !== null ? player.avg_final.toFixed(1) : "-"}
                      </div>
                    </div>

                    <div style={styles.metricBox}>
                      <div style={styles.metricLabel}>Linha</div>
                      <div style={styles.metricValue}>
                        {player.linha_minima !== null ? player.linha_minima.toFixed(1) : "-"}
                      </div>
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

  farolBadge: {
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    color: "#111",
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

  emptyText: {
    marginTop: 14,
    color: "#9aa4b2",
  },
}