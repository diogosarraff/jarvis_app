"use client"

import { useEffect, useState } from "react"
import { supabase } from "../lib/supabase"

type Game = {
  game_id: string
  casa: string
  fora: string
  data: string
}

type Prop = {
  game_id: string
  player_name: string
  team: string
  opponent: string
  market: string

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
  farol: string
}

type Pre = {
  game_id: string
  player_id: string
  minutes_l5: number
}

export default function Home() {
  const [games, setGames] = useState<Game[]>([])
  const [props, setProps] = useState<Prop[]>([])
  const [pre, setPre] = useState<Pre[]>([])
  const [selectedGame, setSelectedGame] = useState<string | null>(null)
  const [market, setMarket] = useState<"pts" | "reb" | "ast" | "fg3m">("pts")

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const { data: g } = await supabase.from("agenda_hoje").select("*")
    const { data: p } = await supabase.from("props_jogadores_matchup_dia").select("*")
    const { data: pre } = await supabase.from("pre_jogadores_matchup_dia").select("*")

    setGames(g || [])
    setProps(p || [])
    setPre(pre || [])
  }

  const players = props.filter(p => {
    if (!selectedGame) return false
    if (p.game_id !== selectedGame) return false
    if (p.market !== market) return false

    const playerPre = pre.find(
      x => x.game_id === p.game_id && x.player_id === p.player_name
    )

    return playerPre?.minutes_l5 >= 24
  })

  function getFarolColor(f: string) {
    if (f === "verde") return "#00d26a"
    if (f === "amarelo") return "#ffb020"
    return "#ff5c5c"
  }

  function formatArray(arr: (number | null)[]) {
    return arr.map(x => (x ? x.toFixed(0) : "-")).join(" | ")
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Jarvis</h1>

      {/* JOGOS */}
      <div style={styles.section}>
        {games.map(g => (
          <button
            key={g.game_id}
            onClick={() => setSelectedGame(g.game_id)}
            style={{
              ...styles.game,
              background: selectedGame === g.game_id ? "#ff6b00" : "#1f2530"
            }}
          >
            {g.casa} vs {g.fora}
          </button>
        ))}
      </div>

      {/* MERCADO */}
      <div style={styles.tabs}>
        {["pts","reb","ast","fg3m"].map(m => (
          <button
            key={m}
            onClick={() => setMarket(m as any)}
            style={{
              ...styles.tab,
              background: market === m ? "#ff6b00" : "#2a2f3a"
            }}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      {/* JOGADORES */}
      <div>
        {players.map((p, i) => (
          <div key={i} style={styles.card}>
            <strong>{p.player_name} ({p.team})</strong>

            <div style={styles.row}>
              <span>VS:</span>
              <span>{formatArray([
                p.vs_opp_1,p.vs_opp_2,p.vs_opp_3,p.vs_opp_4,p.vs_opp_5
              ])}</span>
            </div>

            <div style={styles.row}>
              <span>REC:</span>
              <span>{formatArray([
                p.recent_1,p.recent_2,p.recent_3,p.recent_4,p.recent_5
              ])}</span>
            </div>

            <div style={styles.metrics}>
              <div>Média: {p.avg_final?.toFixed(1)}</div>
              <div>Linha: {p.linha_minima?.toFixed(1)}</div>
              <div style={{ color: getFarolColor(p.farol) }}>
                {p.farol.toUpperCase()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles:any = {
  container: {
    background: "#0f1115",
    minHeight: "100vh",
    color: "white",
    padding: 20
  },
  title: {
    fontSize: 28,
    marginBottom: 20
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 20
  },
  game: {
    padding: 12,
    borderRadius: 10,
    border: "none",
    color: "white"
  },
  tabs: {
    display: "flex",
    gap: 8,
    marginBottom: 20
  },
  tab: {
    padding: 10,
    borderRadius: 8,
    border: "none",
    color: "white"
  },
  card: {
    background: "#1a1f28",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    marginTop: 4
  },
  metrics: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 8,
    fontWeight: "bold"
  }
}