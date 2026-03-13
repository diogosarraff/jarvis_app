"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"

type AgendaGame = {
  id: number
  data: string
  casa: string
  fora: string
  game_id: string
}

type PredJogo = {
  game_id: string
  proj_home_pts: number | null
  proj_away_pts: number | null
  proj_total: number | null
  proj_spread_home: number | null
  home_win_prob: number | null
  away_win_prob: number | null
}

type PredJogador = {
  game_id: string
  player_name: string
  team: string
  proj_pts: number | null
  proj_reb: number | null
  proj_ast: number | null
  proj_fg3m: number | null
}

type SavedBet = {
  id: string
  gameId: string
  jogo: string
  mercado: string
  selecao: string
  linha?: number | null
  oddCasa: number
  prob: number
  oddJusta: number
  ev: number
  farol: "verde" | "amarelo" | "vermelho"
}

type CalcResult = {
  prob: number
  oddJusta: number
  ev: number
  farol: "verde" | "amarelo" | "vermelho"
  detalhes?: string
}

const PLAYER_THRESHOLDS = {
  pts: [5, 10, 15, 20, 25, 30],
  ast: [3, 5, 7, 10, 13, 15],
  reb: [3, 5, 7, 10, 13, 15],
  fg3m: [1, 2, 3, 4, 5, 6],
}

const PLAYER_SIGMA: Record<string, number> = {
  pts: 6.5,
  reb: 3.0,
  ast: 2.5,
  fg3m: 1.5,
}

const TOTAL_SIGMA = 12
const SPREAD_SIGMA = 11.5

export default function Home() {
  const [jogos, setJogos] = useState<AgendaGame[]>([])
  const [predJogos, setPredJogos] = useState<Record<string, PredJogo>>({})
  const [predJogadores, setPredJogadores] = useState<PredJogador[]>([])

  const [jogoSelecionado, setJogoSelecionado] = useState<AgendaGame | null>(null)

  const [mercadoAtivo, setMercadoAtivo] = useState<"winner" | "total" | "handicap" | "players">("winner")

  // Winner
  const [timeWinner, setTimeWinner] = useState<string | null>(null)
  const [oddWinner, setOddWinner] = useState("")
  const [resultadoWinner, setResultadoWinner] = useState<CalcResult | null>(null)

  // Total
  const [sideTotal, setSideTotal] = useState<"over" | "under">("over")
  const [linhaTotal, setLinhaTotal] = useState("")
  const [oddTotal, setOddTotal] = useState("")
  const [resultadoTotal, setResultadoTotal] = useState<CalcResult | null>(null)

  // Handicap
  const [timeHandicap, setTimeHandicap] = useState<string | null>(null)
  const [linhaHandicap, setLinhaHandicap] = useState("")
  const [oddHandicap, setOddHandicap] = useState("")
  const [resultadoHandicap, setResultadoHandicap] = useState<CalcResult | null>(null)

  // Players
  const [playerMarket, setPlayerMarket] = useState<"pts" | "ast" | "reb" | "fg3m">("pts")
  const [playerName, setPlayerName] = useState("")
  const [playerLine, setPlayerLine] = useState("")
  const [playerOdd, setPlayerOdd] = useState("")
  const [resultadoPlayer, setResultadoPlayer] = useState<CalcResult | null>(null)

  // NOVO ESTADO PARA GUARDAR ODDS DIGITADAS
  const [playerOdds, setPlayerOdds] = useState<Record<string,string>>({})

  const [savedBets, setSavedBets] = useState<SavedBet[]>([])

  function normalCdf(x: number, mean: number, sd: number) {
    const z = (x - mean) / (sd * Math.sqrt(2))
    return 0.5 * (1 + erf(z))
  }

  function erf(x: number) {
    const sign = x >= 0 ? 1 : -1
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const absX = Math.abs(x)
    const t = 1 / (1 + p * absX)
    const y =
      1 -
      (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
        Math.exp(-absX * absX)

    return sign * y
  }

  function calcOddJusta(prob: number) {
    if (prob <= 0) return 999
    if (prob >= 1) return 1.01
    return 1 / prob
  }

  function calcEV(prob: number, odd: number) {
    return prob * odd - 1
  }

  function farolFromEV(ev: number): "verde" | "amarelo" | "vermelho" {
    if (ev > 0.05) return "verde"
    if (ev >= 0) return "amarelo"
    return "vermelho"
  }

  // NOVA FUNÃÃO PARA CALCULAR TODAS AS PLAYER PROPS
  function calcularTodas(jogadoresDoJogo:any[]) {

    jogadoresDoJogo.forEach((j:any) => {

      const props = [
        {stat:"pts", media:Number(j.proj_pts || 0), sigma:PLAYER_SIGMA.pts},
        {stat:"ast", media:Number(j.proj_ast || 0), sigma:PLAYER_SIGMA.ast},
        {stat:"reb", media:Number(j.proj_reb || 0), sigma:PLAYER_SIGMA.reb},
        {stat:"fg3m", media:Number(j.proj_fg3m || 0), sigma:PLAYER_SIGMA.fg3m},
      ]

      props.forEach((p)=>{

        const linhas = PLAYER_THRESHOLDS[p.stat as keyof typeof PLAYER_THRESHOLDS]

        linhas.forEach((linha)=>{

          const key = `${j.player_name}-${p.stat}-${linha}`
          const odd = Number(playerOdds[key])

          if(!odd || odd <= 1) return

          const prob = 1 - normalCdf(linha - 0.5, p.media, p.sigma)
          const oddJusta = calcOddJusta(prob)
          const ev = calcEV(prob, odd)
          const farol = farolFromEV(ev)

          console.log(j.player_name, p.stat, linha, prob, ev, farol)

        })

      })

    })

  }

  return <div>Arquivo completo do Jarvis (versÃ£o simplificada para correÃ§Ã£o da interface)</div>
}