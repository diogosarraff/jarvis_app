"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import {
  Game, OddsInput, RankingItem, ResultadoJogo, ResultadoJogador,
  calcularEvLocal, calcularScoreJarvis, calcularEvOver, calcularEvUnder,
  getLineBetRankingItem, getMinutesAverage, getModelConfidence,
  getPlayerOpponent, getPlayerTeam, getProbOver, getProbUnder,
  getProjectionFromGameHandicap, getProjectionFromGameTotal,
  getProjectionFromGameWinner, getProjectionFromPlayer, getWinnerBetRankingItem,
} from "../lib/jarvis-ui"

const STAKE = 20
const BANCA_INICIAL = 1000
const MAE_TOTAL = 15.530
const MAE_HANDICAP = 11.875

type MarketKey = "winner" | "total" | "handicap" | "pts" | "ast" | "reb" | "fg3m"
const PLAYER_LABELS: Record<Exclude<MarketKey, "winner" | "total" | "handicap">, string> = {
  pts: "Pontos", ast: "Assists", reb: "Rebotes", fg3m: "3 Pontos",
}
const MARKET_LABELS: Record<"winner" | "total" | "handicap", string> = {
  winner: "Vencedor", total: "Total", handicap: "Handicap",
}

type Aposta = {
  id: string; game_id: string; game_date: string; liga: string
  mercado: string; titulo: string; subtitulo: string; lado: string
  linha: number | null; odd: number | null; projecao: number | null
  prob: number | null; ev: number | null; score_jarvis: number | null
  confianca: number | null; stake: number; resultado: string | null
  lucro: number | null; created_at: string
}

type Sugestao = {
  key: string; mercado: string; titulo: string; subtitulo: string
  lado: string; projecao: number | null; prob: number; oddJusta: number
  scoreJarvis: number | null; confianca: number | null
  motivo: string; alerta: string | null
  gameId: string | null
  // campos de jogador
  playerId?: string
  // campos de jogo
  tipoJogo?: "winner" | "total" | "handicap"
}

// ── Gerador de texto explicativo ─────────────────────────
function gerarMotivo(
  mercado: string, titulo: string, lado: string,
  prob: number, projecao: number | null, oddJusta: number,
  confianca: number | null, score: number | null
): string {
  const probPct = (prob * 100).toFixed(0)
  const confStr = confianca != null ? ` Confiança do modelo: ${confianca.toFixed(0)}.` : ""
  const scoreStr = score != null ? ` Score Jarvis: ${score.toFixed(0)}.` : ""

  if (mercado === "Vencedor") {
    return `Jarvis projeta ${probPct}% de chance de vitória para ${titulo.replace(" ML", "")}. A probabilidade está acima do limiar de confiança.${confStr}${scoreStr}`
  }
  if (mercado === "Total de Pontos") {
    const dir = lado === "Over" ? "acima" : "abaixo"
    return `Jarvis projeta total de ${projecao?.toFixed(1)} pontos — ${dir} da linha da banca. Probabilidade de ${lado}: ${probPct}%.${confStr}${scoreStr}`
  }
  if (mercado === "Handicap") {
    return `Jarvis projeta spread de ${projecao?.toFixed(1)} pontos. Probabilidade de ${lado} cobrir: ${probPct}%.${confStr}${scoreStr}`
  }
  // Props de jogadores
  const dir = lado === "Over" ? "superar" : "ficar abaixo d"
  return `Modelo projeta ${projecao?.toFixed(1)} — probabilidade de ${probPct}% de ${dir}a linha da banca. Odd justa: ${oddJusta.toFixed(2)}.${confStr}${scoreStr}`
}

function gerarAlerta(
  mercado: string, prob: number, confianca: number | null, score: number | null
): string | null {
  if (mercado === "Vencedor" && prob < 0.63)
    return "Margem pequena — apostar apenas se odd da banca for atrativa."
  if ((mercado === "Total de Pontos" || mercado === "Handicap") && (confianca ?? 0) < 45)
    return "Confiança moderada — mercado de jogo com mais ruído em playoffs."
  if (score != null && score < 70)
    return "Score abaixo do ideal — considere apenas se odd da banca for muito boa."
  return null
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
  const [apostas, setApostas] = useState<Aposta[]>([])

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [activeGameMarket, setActiveGameMarket] = useState<"winner" | "total" | "handicap">("winner")
  const [activePlayerMarket, setActivePlayerMarket] = useState<"pts" | "ast" | "reb" | "fg3m">("pts")
  const [activeSection, setActiveSection] = useState<"sugestoes" | "jogos" | "jogadores" | "ranking" | "apostas">("sugestoes")
  const [loading, setLoading] = useState(true)
  const [oddsMap, setOddsMap] = useState<Record<string, OddsInput>>({})
  const [sugestaoOdds, setSugestaoOdds] = useState<Record<string, { oddBanca?: number; linhaBanca?: number }>>({})
  const [salvando, setSalvando] = useState(false)

  async function loadApostas() {
    const { data } = await supabase.from("apostas_tracker").select("*").order("created_at", { ascending: false })
    setApostas((data || []) as Aposta[])
  }

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const [
        { data: gamesRes }, { data: winnerRes }, { data: totalRes },
        { data: handicapRes }, { data: pointsRes }, { data: assistsRes },
        { data: reboundsRes }, { data: threesRes },
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
      if (gamesData.length > 0) setSelectedGameId(gamesData[0].game_id)
      setLoading(false)
    }
    loadData()
    loadApostas()
  }, [])

  const selectedGame = useMemo(() => games.find((g) => g.game_id === selectedGameId) || null, [games, selectedGameId])
  const winnerRow = useMemo(() => winnerRows.find((r) => String(r.game_id) === String(selectedGameId)) || null, [winnerRows, selectedGameId])
  const totalRow = useMemo(() => totalRows.find((r) => String(r.game_id) === String(selectedGameId)) || null, [totalRows, selectedGameId])
  const handicapRow = useMemo(() => handicapRows.find((r) => String(r.game_id) === String(selectedGameId)) || null, [handicapRows, selectedGameId])

  const playersForSelectedGame = useMemo(() => {
    if (!selectedGameId) return []
    const source = activePlayerMarket === "pts" ? playerPointsRows : activePlayerMarket === "ast" ? playerAssistsRows : activePlayerMarket === "reb" ? playerReboundsRows : playerThreesRows
    return source.filter((p) => String(p.game_id) === String(selectedGameId)).filter((p) => (getMinutesAverage(p) ?? 0) >= 20).sort((a, b) => (getProjectionFromPlayer(b) ?? 0) - (getProjectionFromPlayer(a) ?? 0))
  }, [selectedGameId, activePlayerMarket, playerPointsRows, playerAssistsRows, playerReboundsRows, playerThreesRows])

  // ── Sugestões automáticas ────────────────────────────────
  const sugestoes = useMemo((): Sugestao[] => {
    const items: Sugestao[] = []

    // Props de jogadores — filtro: prob ≥ 0.60, min ≥ 20, score ≥ 75
    const playerSources = [
      { rows: playerPointsRows, mercado: "Pontos" },
      { rows: playerAssistsRows, mercado: "Assistências" },
      { rows: playerReboundsRows, mercado: "Rebotes" },
      { rows: playerThreesRows, mercado: "Cestas de 3" },
    ]

    for (const source of playerSources) {
      for (const row of source.rows) {
        if ((getMinutesAverage(row) ?? 0) < 20) continue
        const proj = getProjectionFromPlayer(row)
        const probOver = getProbOver(row)
        const probUnder = getProbUnder(row)
        const conf = getModelConfidence(row)
        if (proj == null) continue

        for (const [prob, lado] of [[probOver, "Over"], [probUnder, "Under"]] as [number | null, string][]) {
          if (prob == null || prob < 0.60) continue
          const oddJusta = Math.round((1 / prob) * 100) / 100
          const score = calcularScoreJarvis(prob * oddJusta - 1, prob, conf, source.mercado)
          if ((score ?? 0) < 75) continue

          const jogo = games.find((g) => String(g.game_id) === String(row.game_id))
          items.push({
            key: `player-${source.mercado}-${row.game_id}-${row.player_id}-${lado}`,
            mercado: source.mercado,
            titulo: row.player_name,
            subtitulo: `${getPlayerTeam(row)} vs ${getPlayerOpponent(row)}`,
            lado, projecao: proj, prob, oddJusta, scoreJarvis: score, confianca: conf,
            motivo: gerarMotivo(source.mercado, row.player_name, lado, prob, proj, oddJusta, conf, score),
            alerta: gerarAlerta(source.mercado, prob, conf, score),
            gameId: row.game_id, playerId: row.player_id,
          })
        }
      }
    }

    // Mercados de jogo
    for (const jogo of games) {
      // Vencedor
      const winner = winnerRows.find((r) => String(r.game_id) === String(jogo.game_id))
      if (winner) {
        const { probCasa, probFora } = getProjectionFromGameWinner(winner)
        const conf = getModelConfidence(winner)
        for (const [prob, titulo, lado] of [
          [probCasa, `${jogo.casa} ML`, jogo.casa],
          [probFora, `${jogo.fora} ML`, jogo.fora],
        ] as [number | null, string, string][]) {
          if (prob == null || prob < 0.60) continue
          const oddJusta = Math.round((1 / prob) * 100) / 100
          const score = calcularScoreJarvis(prob * oddJusta - 1, prob, conf, "Vencedor")
          items.push({
            key: `winner-${jogo.game_id}-${lado}`,
            mercado: "Vencedor", titulo, subtitulo: `${jogo.casa} vs ${jogo.fora}`,
            lado, projecao: prob, prob, oddJusta, scoreJarvis: score, confianca: conf,
            motivo: gerarMotivo("Vencedor", titulo, lado, prob, prob, oddJusta, conf, score),
            alerta: gerarAlerta("Vencedor", prob, conf, score),
            gameId: jogo.game_id, tipoJogo: "winner",
          })
        }
      }

      // Total de Pontos
      const total = totalRows.find((r) => String(r.game_id) === String(jogo.game_id))
      if (total) {
        const proj = getProjectionFromGameTotal(total)
        const conf = getModelConfidence(total)
        if (proj != null) {
          // Calcular prob via distribuição normal com MAE
          const probOver = 1 - normalCDF(proj, proj, MAE_TOTAL) // prob de superar a própria projeção = 0.5 sem linha
          // Sem linha da banca ainda — mostrar com odd justa baseada na projeção
          const score = calcularScoreJarvis(0.05, 0.55, conf, "Total de Pontos")
          if ((conf ?? 0) >= 35) {
            items.push({
              key: `total-${jogo.game_id}`,
              mercado: "Total de Pontos", titulo: `${jogo.casa} vs ${jogo.fora}`,
              subtitulo: "Mercado de jogos", lado: "—",
              projecao: proj, prob: 0.55, oddJusta: parseFloat((1 / 0.55).toFixed(2)),
              scoreJarvis: score, confianca: conf,
              motivo: gerarMotivo("Total de Pontos", `${jogo.casa} vs ${jogo.fora}`, "—", 0.55, proj, 1.82, conf, score),
              alerta: gerarAlerta("Total de Pontos", 0.55, conf, score),
              gameId: jogo.game_id, tipoJogo: "total",
            })
          }
        }
      }

      // Handicap
      const handicap = handicapRows.find((r) => String(r.game_id) === String(jogo.game_id))
      if (handicap) {
        const proj = getProjectionFromGameHandicap(handicap)
        const conf = getModelConfidence(handicap)
        if (proj != null && (conf ?? 0) >= 40) {
          const favorito = proj > 0 ? jogo.casa : jogo.fora
          const spreadFav = `-${Math.abs(proj).toFixed(1)}`
          const score = calcularScoreJarvis(0.06, 0.58, conf, "Handicap")
          items.push({
            key: `handicap-${jogo.game_id}`,
            mercado: "Handicap", titulo: `${jogo.casa} vs ${jogo.fora}`,
            subtitulo: `Favorito: ${favorito} ${spreadFav}`, lado: favorito,
            projecao: proj, prob: 0.58, oddJusta: parseFloat((1 / 0.58).toFixed(2)),
            scoreJarvis: score, confianca: conf,
            motivo: gerarMotivo("Handicap", `${jogo.casa} vs ${jogo.fora}`, favorito, 0.58, proj, 1.72, conf, score),
            alerta: gerarAlerta("Handicap", 0.58, conf, score),
            gameId: jogo.game_id, tipoJogo: "handicap",
          })
        }
      }
    }

    // Ordenar por score e limitar a 8
    return items.sort((a, b) => (b.scoreJarvis ?? 0) - (a.scoreJarvis ?? 0)).slice(0, 8)
  }, [games, winnerRows, totalRows, handicapRows, playerPointsRows, playerAssistsRows, playerReboundsRows, playerThreesRows])

  // Distribuição normal CDF aproximada
  function normalCDF(x: number, mean: number, std: number): number {
    const z = (x - mean) / std
    return 0.5 * (1 + erf(z / Math.sqrt(2)))
  }
  function erf(x: number): number {
    const t = 1 / (1 + 0.3275911 * Math.abs(x))
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
    return x >= 0 ? y : -y
  }

  const ranking = useMemo(() => {
    const items: RankingItem[] = []
    for (const jogo of games) {
      const winner = winnerRows.find((r) => String(r.game_id) === String(jogo.game_id))
      const total = totalRows.find((r) => String(r.game_id) === String(jogo.game_id))
      const handicap = handicapRows.find((r) => String(r.game_id) === String(jogo.game_id))
      if (winner) {
        const { probCasa, probFora } = getProjectionFromGameWinner(winner)
        const odds = oddsMap[`winner-${jogo.game_id}`] || {}
        const conf = getModelConfidence(winner) ?? 0
        if (probCasa != null && odds.oddHome) {
          const ev = probCasa * odds.oddHome - 1
          items.push({ key: `${jogo.game_id}-winner-home`, categoria: "Jogo", mercado: "Vencedor", titulo: `${jogo.casa} ML`, subtitulo: `${jogo.casa} vs ${jogo.fora}`, lado: jogo.casa, odd: odds.oddHome, prob: probCasa, projecao: probCasa, edge: probCasa - 1 / odds.oddHome, ev, confianca: conf, scoreJarvis: calcularScoreJarvis(ev, probCasa, conf, "Vencedor") })
        }
        if (probFora != null && odds.oddAway) {
          const ev = probFora * odds.oddAway - 1
          items.push({ key: `${jogo.game_id}-winner-away`, categoria: "Jogo", mercado: "Vencedor", titulo: `${jogo.fora} ML`, subtitulo: `${jogo.casa} vs ${jogo.fora}`, lado: jogo.fora, odd: odds.oddAway, prob: probFora, projecao: probFora, edge: probFora - 1 / odds.oddAway, ev, confianca: conf, scoreJarvis: calcularScoreJarvis(ev, probFora, conf, "Vencedor") })
        }
      }
      if (total) {
        const odds = oddsMap[`total-${jogo.game_id}`] || {}
        items.push(...getLineBetRankingItem({ keyBase: `total-${jogo.game_id}`, mercado: "Total de Pontos", titulo: `${jogo.casa} vs ${jogo.fora}`, subtitulo: "Mercado de jogos", projecao: getProjectionFromGameTotal(total), linha: odds.linha, oddOver: odds.oddOver, oddUnder: odds.oddUnder, modelConfidence: getModelConfidence(total), probOver: null, probUnder: null, tipo: "total" }))
      }
      if (handicap) {
        const odds = oddsMap[`handicap-${jogo.game_id}`] || {}
        items.push(...getLineBetRankingItem({ keyBase: `handicap-${jogo.game_id}`, mercado: "Handicap", titulo: `${jogo.casa} vs ${jogo.fora}`, subtitulo: "Mercado de jogos", projecao: getProjectionFromGameHandicap(handicap), linha: odds.linha, oddOver: odds.oddOver, oddUnder: odds.oddUnder, modelConfidence: getModelConfidence(handicap), probOver: null, probUnder: null, tipo: "handicap" }))
      }
    }
    const playerSources = [{ rows: playerPointsRows, mercado: "Pontos" }, { rows: playerAssistsRows, mercado: "Assistências" }, { rows: playerReboundsRows, mercado: "Rebotes" }, { rows: playerThreesRows, mercado: "Cestas de 3" }]
    for (const source of playerSources) {
      for (const row of source.rows) {
        if ((getMinutesAverage(row) ?? 0) < 20) continue
        const key = `player-${source.mercado}-${row.game_id}-${row.player_id}`
        const odds = oddsMap[key] || {}
        items.push(...getLineBetRankingItem({ keyBase: key, mercado: source.mercado, titulo: row.player_name, subtitulo: `${getPlayerTeam(row)} vs ${getPlayerOpponent(row)}`, projecao: getProjectionFromPlayer(row), linha: odds.linha, oddOver: odds.oddOver, oddUnder: odds.oddUnder, modelConfidence: getModelConfidence(row), probOver: getProbOver(row), probUnder: getProbUnder(row) }))
      }
    }
    return items.filter((x) => x.odd && x.ev !== null).sort((a, b) => (b.scoreJarvis ?? -999) - (a.scoreJarvis ?? -999))
  }, [games, winnerRows, totalRows, handicapRows, playerPointsRows, playerAssistsRows, playerReboundsRows, playerThreesRows, oddsMap])

  const dashApostas = useMemo(() => {
    const resolvidas = apostas.filter((a) => a.resultado !== null)
    const greens = resolvidas.filter((a) => a.resultado === "green").length
    const reds = resolvidas.filter((a) => a.resultado === "red").length
    const stakeTotal = resolvidas.length * STAKE
    const lucroTotal = resolvidas.reduce((acc, a) => acc + (a.lucro ?? 0), 0)
    const roi = stakeTotal > 0 ? lucroTotal / stakeTotal : null
    const banca = BANCA_INICIAL + lucroTotal
    const winRate = resolvidas.length > 0 ? greens / resolvidas.length : null
    const mercados: Record<string, { greens: number; total: number; lucro: number }> = {}
    for (const a of resolvidas) {
      if (!mercados[a.mercado]) mercados[a.mercado] = { greens: 0, total: 0, lucro: 0 }
      mercados[a.mercado].total++
      mercados[a.mercado].lucro += a.lucro ?? 0
      if (a.resultado === "green") mercados[a.mercado].greens++
    }
    return { total: apostas.length, greens, reds, pendentes: apostas.filter((a) => !a.resultado).length, stakeTotal, lucroTotal, roi, banca, winRate, mercados }
  }, [apostas])

  async function registrarSugestao(s: Sugestao, oddBanca?: number, linhaBanca?: number) {
    setSalvando(true)
    const ev = oddBanca ? s.prob * oddBanca - 1 : null
    const record = {
      game_id: s.gameId, game_date: new Date().toISOString().split("T")[0],
      liga: "NBA", mercado: s.mercado, titulo: s.titulo, subtitulo: s.subtitulo,
      lado: s.lado, linha: linhaBanca ?? null, odd: oddBanca ?? null,
      projecao: s.projecao, prob: s.prob, ev, score_jarvis: s.scoreJarvis,
      confianca: s.confianca, stake: STAKE, resultado: null, lucro: null,
    }
    await supabase.from("apostas_tracker").insert(record)
    await loadApostas()
    setSalvando(false)
  }

  async function registrarRanking(item: RankingItem, jogoGameId: string | null) {
    setSalvando(true)
    const record = {
      game_id: jogoGameId, game_date: new Date().toISOString().split("T")[0],
      liga: "NBA", mercado: item.mercado, titulo: item.titulo, subtitulo: item.subtitulo,
      lado: item.lado, linha: item.linha ?? null, odd: item.odd ?? null,
      projecao: item.projecao, prob: item.prob, ev: item.ev,
      score_jarvis: item.scoreJarvis, confianca: item.confianca,
      stake: STAKE, resultado: null, lucro: null,
    }
    await supabase.from("apostas_tracker").insert(record)
    await loadApostas()
    setSalvando(false)
  }

  async function marcarResultado(id: string, resultado: "green" | "red", odd: number | null) {
    const lucro = resultado === "green" ? (odd ?? 0) * STAKE - STAKE : -STAKE
    await supabase.from("apostas_tracker").update({ resultado, lucro }).eq("id", id)
    await loadApostas()
  }

  async function deletarAposta(id: string) {
    await supabase.from("apostas_tracker").delete().eq("id", id)
    await loadApostas()
  }

  function handleOddsChange(key: string, field: keyof OddsInput, value: string) {
    setOddsMap((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value === "" ? undefined : Number(value) } }))
  }

  function handleSugestaoOdds(key: string, field: "oddBanca" | "linhaBanca", value: string) {
    setSugestaoOdds((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value === "" ? undefined : Number(value) } }))
  }

  const fp = (n: number | null | undefined) => n == null ? "—" : `${(n * 100).toFixed(1)}%`
  const fn = (n: number | null | undefined, d = 1) => (n == null || Number.isNaN(n)) ? "—" : Number(n).toFixed(d)
  const fc = (n: number) => `R$ ${n.toFixed(2)}`
  const evColor = (ev: number | null) => ev == null ? C.textDim : ev > 0.05 ? "#22c55e" : ev > 0 ? "#f59e0b" : "#ef4444"
  const confColor = (c: number | null) => c == null ? C.textDim : c >= 70 ? "#22c55e" : c >= 40 ? "#f59e0b" : C.textDim
  const scoreColor = (s: number | null) => s == null ? C.textDim : s >= 65 ? "#E8B84B" : s >= 45 ? "#C9982A" : C.textMuted
  const lucroColor = (l: number | null) => l == null ? C.textMuted : l > 0 ? "#22c55e" : "#ef4444"

  const apostasJaRegistradas = new Set(apostas.map((a) => `${a.titulo}-${a.lado}-${a.mercado}`))
  const S = styles

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.logo}><span style={S.logoJ}>J</span><span style={S.logoText}>ARVIS</span></div>
          <span style={S.headerBadge}>NBA · AO VIVO</span>
        </div>
        <div style={S.headerRight}><div style={S.dot} /><span style={S.headerSub}>Hoje</span></div>
      </div>

      {/* Game selector */}
      {!loading && (
        <div style={S.gameSelector}>
          {games.map((game) => {
            const active = selectedGameId === game.game_id
            return (
              <button key={game.game_id} onClick={() => setSelectedGameId(game.game_id)}
                style={{ ...S.gameTab, ...(active ? S.gameTabActive : {}) }}>
                <span style={S.gameTabHome}>{game.casa}</span>
                <span style={S.gameTabVs}>vs</span>
                <span style={S.gameTabAway}>{game.fora}</span>
                {active && <div style={S.gameTabBar} />}
              </button>
            )
          })}
        </div>
      )}

      {/* Nav */}
      <div style={S.nav}>
        {(["sugestoes", "jogos", "jogadores", "ranking", "apostas"] as const).map((s) => (
          <button key={s} onClick={() => setActiveSection(s)}
            style={{ ...S.navBtn, ...(activeSection === s ? S.navBtnActive : {}) }}>
            {s === "sugestoes" ? "⚡" : s === "jogos" ? "Jogos" : s === "jogadores" ? "Jogadores" : s === "ranking" ? "Ranking" : "Apostas"}
            {s === "sugestoes" && sugestoes.length > 0 && <span style={{ ...S.navBadge, background: C.gold }}>{sugestoes.length}</span>}
            {s === "ranking" && ranking.length > 0 && <span style={S.navBadge}>{ranking.length}</span>}
            {s === "apostas" && apostas.filter((a) => !a.resultado).length > 0 && <span style={{ ...S.navBadge, background: "#f59e0b" }}>{apostas.filter((a) => !a.resultado).length}</span>}
          </button>
        ))}
      </div>

      {/* ── SUGESTÕES ── */}
      {activeSection === "sugestoes" && (
        <div style={S.section}>
          <div style={S.sugestaoHeader}>
            <div style={S.sugestaoTitle}>Apostas do Dia</div>
            <div style={S.sugestaoSub}>Selecionadas automaticamente pelo Jarvis · Score ≥ 75 · Prob ≥ 60%</div>
          </div>

          {loading ? (
            <div style={S.empty}>Carregando...</div>
          ) : sugestoes.length === 0 ? (
            <div style={S.emptyRanking}>
              <div style={S.emptyIcon}>🔍</div>
              <div style={S.emptyTitle}>Nenhuma sugestão hoje</div>
              <div style={S.emptySub}>O Jarvis não encontrou apostas com confiança suficiente. Explore o Ranking para outras opções.</div>
            </div>
          ) : (
            <div style={S.sugestaoList}>
              {sugestoes.map((s, i) => {
                const jaReg = apostasJaRegistradas.has(`${s.titulo}-${s.lado}-${s.mercado}`)
                const sOdds = sugestaoOdds[s.key] || {}
                const evBanca = sOdds.oddBanca ? s.prob * sOdds.oddBanca - 1 : null
                const valorConfirmado = evBanca != null && evBanca > 0
                const precisaLinha = s.mercado === "Total de Pontos" || s.mercado === "Handicap"

                return (
                  <div key={s.key} style={{
                    ...S.sugestaoCard,
                    borderColor: jaReg ? "#22c55e44" : valorConfirmado ? C.gold : C.border2,
                    boxShadow: valorConfirmado ? `0 0 12px ${C.goldDim}` : "none",
                  }}>
                    {/* Rank + mercado */}
                    <div style={S.sugestaoTop}>
                      <div style={S.sugestaoRank}>#{i + 1}</div>
                      <span style={S.rankMercado}>{s.mercado}</span>
                      <span style={S.sugestaoSide}>{s.lado !== "—" ? s.lado : ""}</span>
                      {s.scoreJarvis != null && (
                        <span style={{ ...S.scorePill, color: scoreColor(s.scoreJarvis) }}>
                          Score {s.scoreJarvis.toFixed(0)}
                        </span>
                      )}
                    </div>

                    {/* Título */}
                    <div style={S.sugestaoNome}>{s.titulo}</div>
                    <div style={S.sugestaoSubtitulo}>{s.subtitulo}</div>

                    {/* Métricas */}
                    <div style={S.sugestaoMetrics}>
                      <div style={S.metricBlock}>
                        <div style={S.metricLabel}>Prob Jarvis</div>
                        <div style={S.metricVal}>{fp(s.prob)}</div>
                      </div>
                      <div style={S.metricBlock}>
                        <div style={S.metricLabel}>Odd Justa</div>
                        <div style={{ ...S.metricVal, color: C.gold }}>{s.oddJusta.toFixed(2)}</div>
                      </div>
                      {s.projecao != null && s.mercado !== "Vencedor" && (
                        <div style={S.metricBlock}>
                          <div style={S.metricLabel}>Projeção</div>
                          <div style={S.metricVal}>{fn(s.projecao, 1)}</div>
                        </div>
                      )}
                      {s.confianca != null && (
                        <div style={S.metricBlock}>
                          <div style={S.metricLabel}>Conf</div>
                          <div style={{ ...S.metricVal, color: confColor(s.confianca) }}>{fn(s.confianca, 0)}</div>
                        </div>
                      )}
                    </div>

                    {/* Motivo */}
                    <div style={S.motivoBox}>
                      <div style={S.motivoText}>{s.motivo}</div>
                      {s.alerta && <div style={S.alertaText}>⚠️ {s.alerta}</div>}
                    </div>

                    {/* Input odds da banca */}
                    <div style={S.sugestaoInputRow}>
                      {precisaLinha && (
                        <div style={S.sugestaoInputGroup}>
                          <div style={S.oddLabel}>Linha banca</div>
                          <input type="number" step="0.5" placeholder="Ex: 221.5"
                            value={sOdds.linhaBanca ?? ""}
                            onChange={(e) => handleSugestaoOdds(s.key, "linhaBanca", e.target.value)}
                            style={S.oddInput} />
                        </div>
                      )}
                      <div style={S.sugestaoInputGroup}>
                        <div style={S.oddLabel}>Odd banca</div>
                        <input type="number" step="0.01" placeholder={`Mín: ${s.oddJusta.toFixed(2)}`}
                          value={sOdds.oddBanca ?? ""}
                          onChange={(e) => handleSugestaoOdds(s.key, "oddBanca", e.target.value)}
                          style={{
                            ...S.oddInput,
                            borderColor: sOdds.oddBanca
                              ? sOdds.oddBanca >= s.oddJusta ? "#22c55e" : "#ef4444"
                              : C.border2,
                          }} />
                        {sOdds.oddBanca && (
                          <div style={{ fontSize: 10, fontWeight: 700, marginTop: 2, color: sOdds.oddBanca >= s.oddJusta ? "#22c55e" : "#ef4444" }}>
                            {sOdds.oddBanca >= s.oddJusta
                              ? `✓ Valor confirmado · EV ${evBanca != null ? `+${(evBanca * 100).toFixed(1)}%` : ""}`
                              : `✗ Abaixo do justo · Odd mínima: ${s.oddJusta.toFixed(2)}`}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Sem valor — banca abaixo do justo */}
                    {sOdds.oddBanca && !valorConfirmado && (
                      <div style={S.semValorBox}>
                        ❌ Sem valor — banca paga menos que o justo. Não apostar.
                      </div>
                    )}

                    {/* Botão registrar — só aparece sem odd digitada ou com valor confirmado */}
                    {(!sOdds.oddBanca || valorConfirmado) && (
                      <button
                        onClick={() => !jaReg && registrarSugestao(s, sOdds.oddBanca, sOdds.linhaBanca)}
                        disabled={jaReg || salvando}
                        style={{ ...S.registerBtn, ...(jaReg ? S.registerBtnDone : valorConfirmado ? S.registerBtnReady : {}) }}
                      >
                        {jaReg ? "✓ Registrada" : salvando ? "Salvando..." : valorConfirmado ? "⚡ Registrar — Valor Confirmado" : "+ Registrar aposta"}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── JOGOS ── */}
      {activeSection === "jogos" && selectedGame && (
        <div style={S.section}>
          <div style={S.marketTabs}>
            {(["winner", "total", "handicap"] as const).map((m) => (
              <button key={m} onClick={() => setActiveGameMarket(m)}
                style={{ ...S.marketTab, ...(activeGameMarket === m ? S.marketTabActive : {}) }}>
                {MARKET_LABELS[m]}
              </button>
            ))}
          </div>

          {activeGameMarket === "winner" && (
            <div style={S.card}>
              {winnerRow ? (() => {
                const { probCasa, probFora } = getProjectionFromGameWinner(winnerRow)
                const conf = getModelConfidence(winnerRow)
                const key = `winner-${selectedGame.game_id}`
                const odds = oddsMap[key] || {}
                const evHome = probCasa != null && odds.oddHome ? probCasa * odds.oddHome - 1 : null
                const evAway = probFora != null && odds.oddAway ? probFora * odds.oddAway - 1 : null
                const oddJustaCasa = probCasa ? parseFloat((1 / probCasa).toFixed(2)) : null
                const oddJustaFora = probFora ? parseFloat((1 / probFora).toFixed(2)) : null
                const favorito = probCasa != null && probFora != null ? (probCasa >= probFora ? selectedGame.casa : selectedGame.fora) : null
                return (
                  <>
                    <div style={S.cardHeader}>
                      <span style={S.cardLabel}>Vencedor · Moneyline</span>
                      {conf != null && <span style={{ ...S.confBadge, color: confColor(conf) }}>Conf {fn(conf, 0)}</span>}
                    </div>
                    {favorito && (
                      <div style={S.favoritoBanner}>
                        <span style={S.favoritoLabel}>FAVORITO JARVIS</span>
                        <span style={S.favoritoName}>{favorito}</span>
                        <span style={S.favoritoProb}>{fp(probCasa != null && probFora != null ? Math.max(probCasa, probFora) : null)}</span>
                      </div>
                    )}
                    <div style={S.winnerGrid}>
                      <div style={S.winnerSide}>
                        <div style={S.winnerTeam}>{selectedGame.casa}</div>
                        <div style={S.winnerProb}>{fp(probCasa)}</div>
                        <div style={S.probBar}><div style={{ ...S.probFill, width: `${(probCasa ?? 0) * 100}%`, background: C.gold }} /></div>
                        {oddJustaCasa && <div style={S.oddJustaLabel}>Odd justa: <strong style={{ color: C.gold }}>{oddJustaCasa}</strong></div>}
                      </div>
                      <div style={S.winnerDivider}><span style={S.winnerVs}>VS</span></div>
                      <div style={{ ...S.winnerSide, alignItems: "flex-end" as any }}>
                        <div style={S.winnerTeam}>{selectedGame.fora}</div>
                        <div style={S.winnerProb}>{fp(probFora)}</div>
                        <div style={S.probBar}><div style={{ ...S.probFill, width: `${(probFora ?? 0) * 100}%`, background: C.goldDim, marginLeft: "auto" }} /></div>
                        {oddJustaFora && <div style={{ ...S.oddJustaLabel, textAlign: "right" as any }}>Odd justa: <strong style={{ color: C.gold }}>{oddJustaFora}</strong></div>}
                      </div>
                    </div>
                    <div style={S.oddsRow}>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>{selectedGame.casa}</div>
                        <input type="number" step="0.01" placeholder={`Mín ${oddJustaCasa ?? ""}`}
                          value={odds.oddHome ?? ""} onChange={(e) => handleOddsChange(key, "oddHome", e.target.value)}
                          style={{ ...S.oddInput, borderColor: odds.oddHome && oddJustaCasa ? (odds.oddHome >= oddJustaCasa ? "#22c55e" : "#ef4444") : C.border2 }} />
                        {evHome != null && <div style={{ ...S.evTag, color: evColor(evHome) }}>EV {evHome > 0 ? "+" : ""}{(evHome * 100).toFixed(1)}%</div>}
                      </div>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>{selectedGame.fora}</div>
                        <input type="number" step="0.01" placeholder={`Mín ${oddJustaFora ?? ""}`}
                          value={odds.oddAway ?? ""} onChange={(e) => handleOddsChange(key, "oddAway", e.target.value)}
                          style={{ ...S.oddInput, borderColor: odds.oddAway && oddJustaFora ? (odds.oddAway >= oddJustaFora ? "#22c55e" : "#ef4444") : C.border2 }} />
                        {evAway != null && <div style={{ ...S.evTag, color: evColor(evAway) }}>EV {evAway > 0 ? "+" : ""}{(evAway * 100).toFixed(1)}%</div>}
                      </div>
                    </div>
                  </>
                )
              })() : <div style={S.empty}>Sem dados para este jogo.</div>}
            </div>
          )}

          {activeGameMarket === "total" && (
            <div style={S.card}>
              {totalRow ? (() => {
                const proj = getProjectionFromGameTotal(totalRow)
                const conf = getModelConfidence(totalRow)
                const key = `total-${selectedGame.game_id}`
                const odds = oddsMap[key] || {}
                const evOver = odds.linha && odds.oddOver && proj != null ? calcularEvOver(proj, odds.linha, odds.oddOver, "total") : null
                const evUnder = odds.linha && odds.oddUnder && proj != null ? calcularEvUnder(proj, odds.linha, odds.oddUnder, "total") : null
                const probOver = odds.linha && proj != null ? 1 - normalCDF(odds.linha, proj, MAE_TOTAL) : null
                const probUnder = odds.linha && proj != null ? normalCDF(odds.linha, proj, MAE_TOTAL) : null
                const oddJustaOver = probOver ? parseFloat((1 / probOver).toFixed(2)) : null
                const oddJustaUnder = probUnder ? parseFloat((1 / probUnder).toFixed(2)) : null
                return (
                  <>
                    <div style={S.cardHeader}>
                      <span style={S.cardLabel}>Total de Pontos</span>
                      {conf != null && <span style={{ ...S.confBadge, color: confColor(conf) }}>Conf {fn(conf, 0)}</span>}
                    </div>
                    <div style={S.projCenter}>
                      <div style={S.projBig}>{fn(proj, 1)}</div>
                      <div style={S.projSub}>Projeção Jarvis</div>
                    </div>
                    <div style={S.lineRow}>
                      <input type="number" step="0.5" placeholder="Linha da banca"
                        value={odds.linha ?? ""} onChange={(e) => handleOddsChange(key, "linha", e.target.value)}
                        style={{ ...S.oddInput, flex: 1 }} />
                    </div>
                    {odds.linha && proj != null && (
                      <div style={S.oddJustaRow}>
                        <span style={S.oddJustaItem}>Over — Odd justa: <strong style={{ color: C.gold }}>{oddJustaOver ?? "—"}</strong></span>
                        <span style={S.oddJustaItem}>Under — Odd justa: <strong style={{ color: C.gold }}>{oddJustaUnder ?? "—"}</strong></span>
                      </div>
                    )}
                    <div style={S.oddsRow}>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>Over</div>
                        <input type="number" step="0.01" placeholder={oddJustaOver ? `Mín ${oddJustaOver}` : "Odd"}
                          value={odds.oddOver ?? ""} onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                          style={{ ...S.oddInput, borderColor: odds.oddOver && oddJustaOver ? (odds.oddOver >= oddJustaOver ? "#22c55e" : "#ef4444") : C.border2 }} />
                        {evOver != null && <div style={{ ...S.evTag, color: evColor(evOver) }}>EV {evOver > 0 ? "+" : ""}{(evOver * 100).toFixed(1)}%</div>}
                      </div>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>Under</div>
                        <input type="number" step="0.01" placeholder={oddJustaUnder ? `Mín ${oddJustaUnder}` : "Odd"}
                          value={odds.oddUnder ?? ""} onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                          style={{ ...S.oddInput, borderColor: odds.oddUnder && oddJustaUnder ? (odds.oddUnder >= oddJustaUnder ? "#22c55e" : "#ef4444") : C.border2 }} />
                        {evUnder != null && <div style={{ ...S.evTag, color: evColor(evUnder) }}>EV {evUnder > 0 ? "+" : ""}{(evUnder * 100).toFixed(1)}%</div>}
                      </div>
                    </div>
                  </>
                )
              })() : <div style={S.empty}>Sem dados para este jogo.</div>}
            </div>
          )}

          {activeGameMarket === "handicap" && (
            <div style={S.card}>
              {handicapRow ? (() => {
                const proj = getProjectionFromGameHandicap(handicapRow)
                const conf = getModelConfidence(handicapRow)
                const key = `handicap-${selectedGame.game_id}`
                const odds = oddsMap[key] || {}
                const evOver = odds.linha && odds.oddOver && proj != null ? calcularEvOver(proj, odds.linha, odds.oddOver, "handicap") : null
                const evUnder = odds.linha && odds.oddUnder && proj != null ? calcularEvUnder(proj, odds.linha, odds.oddUnder, "handicap") : null
                const probOver = odds.linha && proj != null ? normalCDF(proj, odds.linha, MAE_HANDICAP) : null
                const probUnder = odds.linha && proj != null ? 1 - normalCDF(proj, odds.linha, MAE_HANDICAP) : null
                const oddJustaOver = probOver ? parseFloat((1 / probOver).toFixed(2)) : null
                const oddJustaUnder = probUnder ? parseFloat((1 / probUnder).toFixed(2)) : null
                const favorito = proj != null ? (proj > 0 ? selectedGame.casa : selectedGame.fora) : "—"
                const spreadFav = proj != null ? `-${Math.abs(proj).toFixed(1)}` : ""
                const spreadCasa = proj != null ? (proj > 0 ? `-${Math.abs(proj).toFixed(1)}` : `+${Math.abs(proj).toFixed(1)}`) : ""
                const spreadFora = proj != null ? (proj < 0 ? `-${Math.abs(proj).toFixed(1)}` : `+${Math.abs(proj).toFixed(1)}`) : ""
                return (
                  <>
                    <div style={S.cardHeader}>
                      <span style={S.cardLabel}>Handicap · Spread</span>
                      {conf != null && <span style={{ ...S.confBadge, color: confColor(conf) }}>Conf {fn(conf, 0)}</span>}
                    </div>
                    <div style={S.projCenter}>
                      <div style={S.projBig}>{spreadFav}</div>
                      <div style={S.projSub}>Favorito: <strong style={{ color: C.gold }}>{favorito}</strong></div>
                    </div>
                    <div style={S.lineRow}>
                      <input type="number" step="0.5" placeholder="Linha da banca"
                        value={odds.linha ?? ""} onChange={(e) => handleOddsChange(key, "linha", e.target.value)}
                        style={{ ...S.oddInput, flex: 1 }} />
                    </div>
                    {odds.linha && proj != null && (
                      <div style={S.oddJustaRow}>
                        <span style={S.oddJustaItem}>{selectedGame.casa} — Odd justa: <strong style={{ color: C.gold }}>{oddJustaOver ?? "—"}</strong></span>
                        <span style={S.oddJustaItem}>{selectedGame.fora} — Odd justa: <strong style={{ color: C.gold }}>{oddJustaUnder ?? "—"}</strong></span>
                      </div>
                    )}
                    <div style={S.oddsRow}>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>{selectedGame.casa} {spreadCasa}</div>
                        <input type="number" step="0.01" placeholder={oddJustaOver ? `Mín ${oddJustaOver}` : "Odd"}
                          value={odds.oddOver ?? ""} onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                          style={{ ...S.oddInput, borderColor: odds.oddOver && oddJustaOver ? (odds.oddOver >= oddJustaOver ? "#22c55e" : "#ef4444") : C.border2 }} />
                        {evOver != null && <div style={{ ...S.evTag, color: evColor(evOver) }}>EV {evOver > 0 ? "+" : ""}{(evOver * 100).toFixed(1)}%</div>}
                      </div>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>{selectedGame.fora} {spreadFora}</div>
                        <input type="number" step="0.01" placeholder={oddJustaUnder ? `Mín ${oddJustaUnder}` : "Odd"}
                          value={odds.oddUnder ?? ""} onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                          style={{ ...S.oddInput, borderColor: odds.oddUnder && oddJustaUnder ? (odds.oddUnder >= oddJustaUnder ? "#22c55e" : "#ef4444") : C.border2 }} />
                        {evUnder != null && <div style={{ ...S.evTag, color: evColor(evUnder) }}>EV {evUnder > 0 ? "+" : ""}{(evUnder * 100).toFixed(1)}%</div>}
                      </div>
                    </div>
                  </>
                )
              })() : <div style={S.empty}>Sem dados para este jogo.</div>}
            </div>
          )}
        </div>
      )}

      {/* ── JOGADORES ── */}
      {activeSection === "jogadores" && selectedGame && (
        <div style={S.section}>
          <div style={S.playerMarketTabs}>
            {(["pts", "ast", "reb", "fg3m"] as const).map((m) => (
              <button key={m} onClick={() => setActivePlayerMarket(m)}
                style={{ ...S.playerMarketTab, ...(activePlayerMarket === m ? S.playerMarketTabActive : {}) }}>
                {PLAYER_LABELS[m]}
              </button>
            ))}
          </div>
          <div style={S.filterNote}>Filtro: média ≥ 20 min · {playersForSelectedGame.length} jogadores</div>
          {playersForSelectedGame.length === 0 ? <div style={S.empty}>Nenhum jogador encontrado.</div> : (
            <div style={S.playerList}>
              {playersForSelectedGame.map((player) => {
                const key = `player-${PLAYER_LABELS[activePlayerMarket]}-${player.game_id}-${player.player_id}`
                const odds = oddsMap[key] || {}
                const proj = getProjectionFromPlayer(player)
                const probOver = getProbOver(player)
                const probUnder = getProbUnder(player)
                const conf = getModelConfidence(player)
                const evO = calcularEvLocal(probOver, odds.oddOver ?? null)
                const evU = calcularEvLocal(probUnder, odds.oddUnder ?? null)
                const oddJustaOver = probOver ? parseFloat((1 / probOver).toFixed(2)) : null
                const oddJustaUnder = probUnder ? parseFloat((1 / probUnder).toFixed(2)) : null
                return (
                  <div key={key} style={S.playerRow}>
                    <div style={S.playerInfo}>
                      <div style={S.playerName}>{player.player_name}</div>
                      <div style={S.playerMeta}>
                        <span style={S.playerTeam}>{getPlayerTeam(player)}</span>
                        <span style={S.playerVs}>vs {getPlayerOpponent(player)}</span>
                      </div>
                    </div>
                    <div style={S.playerStats}>
                      <div style={S.statPill}><span style={S.statLabel}>Proj</span><span style={S.statValue}>{fn(proj, 1)}</span></div>
                      <div style={S.statPill}><span style={S.statLabel}>Min</span><span style={S.statValue}>{fn(getMinutesAverage(player), 0)}</span></div>
                      {probOver != null && <div style={S.statPill}><span style={S.statLabel}>P↑</span><span style={S.statValue}>{fp(probOver)}</span></div>}
                      {oddJustaOver && <div style={{ ...S.statPill, borderColor: C.goldDim }}><span style={S.statLabel}>OJ Over</span><span style={{ ...S.statValue, color: C.gold }}>{oddJustaOver}</span></div>}
                      {oddJustaUnder && <div style={{ ...S.statPill, borderColor: C.goldDim }}><span style={S.statLabel}>OJ Under</span><span style={{ ...S.statValue, color: C.gold }}>{oddJustaUnder}</span></div>}
                      {conf != null && <div style={{ ...S.statPill, borderColor: confColor(conf) }}><span style={S.statLabel}>Conf</span><span style={{ ...S.statValue, color: confColor(conf) }}>{fn(conf, 0)}</span></div>}
                    </div>
                    <div style={S.playerOddsRow}>
                      <input type="number" step="0.5" placeholder="Linha"
                        value={odds.linha ?? ""} onChange={(e) => handleOddsChange(key, "linha", e.target.value)} style={S.playerInput} />
                      <div style={S.playerOddGroup}>
                        <input type="number" step="0.01" placeholder={oddJustaOver ? `Mín ${oddJustaOver}` : "Over"}
                          value={odds.oddOver ?? ""} onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                          style={{ ...S.playerInput, borderColor: odds.oddOver && oddJustaOver ? (odds.oddOver >= oddJustaOver ? "#22c55e" : "#ef4444") : C.border2 }} />
                        {evO != null && <div style={{ ...S.evMini, color: evColor(evO) }}>{evO > 0 ? "+" : ""}{(evO * 100).toFixed(1)}%</div>}
                      </div>
                      <div style={S.playerOddGroup}>
                        <input type="number" step="0.01" placeholder={oddJustaUnder ? `Mín ${oddJustaUnder}` : "Under"}
                          value={odds.oddUnder ?? ""} onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                          style={{ ...S.playerInput, borderColor: odds.oddUnder && oddJustaUnder ? (odds.oddUnder >= oddJustaUnder ? "#22c55e" : "#ef4444") : C.border2 }} />
                        {evU != null && <div style={{ ...S.evMini, color: evColor(evU) }}>{evU > 0 ? "+" : ""}{(evU * 100).toFixed(1)}%</div>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── RANKING ── */}
      {activeSection === "ranking" && (
        <div style={S.section}>
          {ranking.length === 0 ? (
            <div style={S.emptyRanking}>
              <div style={S.emptyIcon}>⚡</div>
              <div style={S.emptyTitle}>Sem apostas calculadas</div>
              <div style={S.emptySub}>Preencha linhas e odds nos mercados para ver o ranking.</div>
            </div>
          ) : (
            <div style={S.rankList}>
              {ranking.map((item, i) => {
                const jaReg = apostasJaRegistradas.has(`${item.titulo}-${item.lado}-${item.mercado}`)
                const jogo = games.find((g) => item.key.includes(g.game_id))
                return (
                  <div key={item.key} style={S.rankRow}>
                    <div style={S.rankPos}>#{i + 1}</div>
                    <div style={S.rankInfo}>
                      <div style={S.rankTitle}>{item.titulo}</div>
                      <div style={S.rankMeta}><span style={S.rankMercado}>{item.mercado}</span><span style={S.rankSub}>{item.subtitulo}</span></div>
                      <div style={S.rankStats}>
                        <span style={S.rankStat}><span style={S.rankStatLabel}>Lado</span> {item.lado}</span>
                        <span style={S.rankStat}><span style={S.rankStatLabel}>Prob</span> {fp(item.prob)}</span>
                        <span style={S.rankStat}><span style={S.rankStatLabel}>Odd</span> {fn(item.odd, 2)}</span>
                        <span style={S.rankStat}><span style={S.rankStatLabel}>Edge</span> {fn(item.edge, 3)}</span>
                      </div>
                      <button onClick={() => !jaReg && registrarRanking(item, jogo?.game_id ?? null)} disabled={jaReg || salvando}
                        style={{ ...S.registerBtn, ...(jaReg ? S.registerBtnDone : {}) }}>
                        {jaReg ? "✓ Registrada" : "+ Registrar aposta"}
                      </button>
                    </div>
                    <div style={S.rankEvCol}>
                      <div style={{ ...S.rankEv, color: evColor(item.ev) }}>{item.ev != null ? `${item.ev > 0 ? "+" : ""}${(item.ev * 100).toFixed(1)}%` : "—"}</div>
                      <div style={S.rankEvLabel}>EV</div>
                      {item.scoreJarvis != null && (
                        <div style={S.rankScoreBadge}>
                          <span style={{ ...S.rankScoreValue, color: scoreColor(item.scoreJarvis) }}>{item.scoreJarvis.toFixed(0)}</span>
                          <span style={S.rankScoreLabel}>SCORE</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── APOSTAS ── */}
      {activeSection === "apostas" && (
        <div style={S.section}>
          <div style={S.dashGrid}>
            <div style={S.dashCard}><div style={S.dashValue}>{fc(dashApostas.banca)}</div><div style={S.dashLabel}>Banca atual</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: dashApostas.lucroTotal >= 0 ? "#22c55e" : "#ef4444" }}>{dashApostas.lucroTotal >= 0 ? "+" : ""}{fc(dashApostas.lucroTotal)}</div><div style={S.dashLabel}>Lucro/Prej.</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: dashApostas.roi != null ? (dashApostas.roi >= 0 ? "#22c55e" : "#ef4444") : C.textMuted }}>{dashApostas.roi != null ? `${dashApostas.roi >= 0 ? "+" : ""}${(dashApostas.roi * 100).toFixed(1)}%` : "—"}</div><div style={S.dashLabel}>ROI</div></div>
            <div style={S.dashCard}><div style={S.dashValue}>{dashApostas.winRate != null ? `${(dashApostas.winRate * 100).toFixed(0)}%` : "—"}</div><div style={S.dashLabel}>Win Rate</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: "#22c55e" }}>{dashApostas.greens}</div><div style={S.dashLabel}>Greens</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: "#ef4444" }}>{dashApostas.reds}</div><div style={S.dashLabel}>Reds</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: "#f59e0b" }}>{dashApostas.pendentes}</div><div style={S.dashLabel}>Pendentes</div></div>
            <div style={S.dashCard}><div style={S.dashValue}>{dashApostas.total}</div><div style={S.dashLabel}>Total</div></div>
          </div>
          {Object.keys(dashApostas.mercados).length > 0 && (
            <div style={S.mercadoGrid}>
              {Object.entries(dashApostas.mercados).map(([mercado, data]) => (
                <div key={mercado} style={S.mercadoCard}>
                  <div style={S.mercadoNome}>{mercado}</div>
                  <div style={{ ...S.mercadoLucro, color: data.lucro >= 0 ? "#22c55e" : "#ef4444" }}>{data.lucro >= 0 ? "+" : ""}{fc(data.lucro)}</div>
                  <div style={S.mercadoSub}>{data.greens}✓ / {data.total - data.greens}✗</div>
                </div>
              ))}
            </div>
          )}
          {apostas.length === 0 ? (
            <div style={S.emptyRanking}>
              <div style={S.emptyIcon}>📋</div>
              <div style={S.emptyTitle}>Nenhuma aposta registrada</div>
              <div style={S.emptySub}>Vá às Sugestões e clique em Registrar para começar.</div>
            </div>
          ) : (
            <div style={S.apostasList}>
              {apostas.map((aposta) => (
                <div key={aposta.id} style={{ ...S.apostaCard, borderColor: aposta.resultado === "green" ? "#22c55e44" : aposta.resultado === "red" ? "#ef444444" : C.border }}>
                  <div style={S.apostaHeader}>
                    <div>
                      <div style={S.apostaTitulo}>{aposta.titulo}</div>
                      <div style={S.apostaMeta}><span style={S.rankMercado}>{aposta.mercado}</span><span style={S.apostaSubtitulo}>{aposta.subtitulo}</span></div>
                    </div>
                    {aposta.resultado ? (
                      <div style={{ ...S.resultadoBadge, background: aposta.resultado === "green" ? "#14532d" : "#7f1d1d", color: aposta.resultado === "green" ? "#22c55e" : "#ef4444" }}>
                        {aposta.resultado === "green" ? "✓ GREEN" : "✗ RED"}
                      </div>
                    ) : <div style={S.pendenteBadge}>PENDENTE</div>}
                  </div>
                  <div style={S.apostaStats}>
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Lado</span> {aposta.lado}</span>
                    {aposta.linha && <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Linha</span> {fn(aposta.linha, 1)}</span>}
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Odd</span> {fn(aposta.odd, 2)}</span>
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>EV</span> <span style={{ color: evColor(aposta.ev) }}>{aposta.ev != null ? `${aposta.ev > 0 ? "+" : ""}${(aposta.ev * 100).toFixed(1)}%` : "—"}</span></span>
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Score</span> <span style={{ color: scoreColor(aposta.score_jarvis) }}>{fn(aposta.score_jarvis, 0)}</span></span>
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Stake</span> {fc(aposta.stake)}</span>
                    {aposta.lucro != null && <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Lucro</span> <span style={{ color: lucroColor(aposta.lucro) }}>{aposta.lucro >= 0 ? "+" : ""}{fc(aposta.lucro)}</span></span>}
                  </div>
                  {!aposta.resultado && (
                    <div style={S.apostaActions}>
                      <button onClick={() => marcarResultado(aposta.id, "green", aposta.odd)} style={S.btnGreen}>✓ Green</button>
                      <button onClick={() => marcarResultado(aposta.id, "red", aposta.odd)} style={S.btnRed}>✗ Red</button>
                      <button onClick={() => deletarAposta(aposta.id)} style={S.btnDelete}>Excluir</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const C = {
  bg: "#080600", surface: "#0E0B04", surface2: "#14100A", surfaceRaised: "#1A1409",
  border: "#2A2010", border2: "#3A2D14", gold: "#C9982A", goldLight: "#E8B84B",
  goldDim: "#8B6514", goldBg: "#1A1205", goldAccent: "#C9982A22",
  text: "#EDE0C4", textMuted: "#8A7355", textDim: "#4A3C28", white: "#FAF0DC",
}

const styles: Record<string, React.CSSProperties> = {
  root: { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'SF Pro Display', 'Helvetica Neue', sans-serif", fontSize: 14, paddingBottom: 40 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: `1px solid ${C.border2}`, background: C.surface },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  logo: { display: "flex", alignItems: "baseline", gap: 2 },
  logoJ: { fontSize: 22, fontWeight: 800, color: C.gold, letterSpacing: "-0.5px", textShadow: `0 0 12px ${C.goldDim}` },
  logoText: { fontSize: 15, fontWeight: 700, color: C.white, letterSpacing: "3px" },
  headerBadge: { fontSize: 10, fontWeight: 700, color: C.gold, background: C.goldAccent, border: `1px solid ${C.goldDim}`, borderRadius: 4, padding: "2px 7px", letterSpacing: "0.5px" },
  headerRight: { display: "flex", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: "50%", background: C.gold, boxShadow: `0 0 6px ${C.gold}` },
  headerSub: { fontSize: 12, color: C.textMuted },
  gameSelector: { display: "flex", borderBottom: `1px solid ${C.border2}`, background: C.surface, overflowX: "auto" as any },
  gameTab: { position: "relative", display: "flex", flexDirection: "column" as any, alignItems: "center", gap: 2, padding: "10px 16px 8px", background: "none", border: "none", cursor: "pointer", minWidth: 120, color: C.textMuted, transition: "color 0.15s" },
  gameTabActive: { color: C.gold },
  gameTabHome: { fontSize: 13, fontWeight: 700 },
  gameTabVs: { fontSize: 10, color: C.textDim },
  gameTabAway: { fontSize: 13, fontWeight: 700 },
  gameTabBar: { position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: C.gold, borderRadius: "2px 2px 0 0", boxShadow: `0 0 8px ${C.gold}` },
  nav: { display: "flex", background: C.surface, borderBottom: `1px solid ${C.border2}` },
  navBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "10px 4px", background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 11, fontWeight: 500, transition: "color 0.15s" },
  navBtnActive: { color: C.gold },
  navBadge: { fontSize: 9, fontWeight: 700, color: C.bg, background: C.gold, borderRadius: 10, padding: "1px 4px", minWidth: 14, textAlign: "center" as any },
  section: { padding: "12px 12px 0" },

  // Sugestões
  sugestaoHeader: { marginBottom: 12 },
  sugestaoTitle: { fontSize: 16, fontWeight: 800, color: C.gold, marginBottom: 2 },
  sugestaoSub: { fontSize: 11, color: C.textMuted },
  sugestaoList: { display: "flex", flexDirection: "column" as any, gap: 10 },
  sugestaoCard: { background: C.surfaceRaised, border: `1px solid ${C.border2}`, borderRadius: 14, padding: "14px", transition: "border-color 0.2s, box-shadow 0.2s" },
  sugestaoTop: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" as any },
  sugestaoRank: { fontSize: 11, fontWeight: 800, color: C.goldDim, minWidth: 20 },
  sugestaoSide: { fontSize: 11, fontWeight: 600, color: C.textMuted },
  sugestaoNome: { fontSize: 15, fontWeight: 800, color: C.white, marginBottom: 2 },
  sugestaoSubtitulo: { fontSize: 11, color: C.textMuted, marginBottom: 10 },
  scorePill: { fontSize: 10, fontWeight: 800, marginLeft: "auto" },
  sugestaoMetrics: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 },
  metricBlock: { background: C.surface2, borderRadius: 8, padding: "6px 8px", textAlign: "center" as any },
  metricLabel: { fontSize: 9, color: C.textMuted, fontWeight: 600, letterSpacing: "0.5px", marginBottom: 2 },
  metricVal: { fontSize: 13, fontWeight: 800, color: C.text },
  motivoBox: { background: C.surface2, borderRadius: 8, padding: "8px 10px", marginBottom: 10 },
  motivoText: { fontSize: 11, color: C.textMuted, lineHeight: 1.5 },
  alertaText: { fontSize: 10, color: "#f59e0b", marginTop: 4, lineHeight: 1.4 },
  sugestaoInputRow: { display: "flex", gap: 8, marginBottom: 8 },
  sugestaoInputGroup: { flex: 1, display: "flex", flexDirection: "column" as any, gap: 4 },
  registerBtn: { width: "100%", padding: "9px", background: C.goldBg, border: `1px solid ${C.goldDim}`, borderRadius: 8, color: C.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "center" as any },
  registerBtnDone: { background: "#14532d22", border: "1px solid #22c55e44", color: "#22c55e", cursor: "default" },
  registerBtnReady: { background: C.gold, border: `1px solid ${C.goldLight}`, color: C.bg, fontWeight: 800 },

  // Odds justa
  oddJustaLabel: { fontSize: 10, color: C.textMuted, marginTop: 3 },
  oddJustaRow: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" as any },
  oddJustaItem: { fontSize: 11, color: C.textMuted, flex: 1 },

  // Jogos
  marketTabs: { display: "flex", gap: 6, marginBottom: 10 },
  marketTab: { flex: 1, padding: "8px 4px", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", color: C.textMuted, fontSize: 12, fontWeight: 600, letterSpacing: "0.3px", textAlign: "center" as any, transition: "all 0.15s" },
  marketTabActive: { background: C.goldBg, border: `1px solid ${C.gold}`, color: C.gold, boxShadow: `0 0 8px ${C.goldDim}` },
  card: { background: C.surfaceRaised, border: `1px solid ${C.border2}`, borderRadius: 12, padding: "14px 14px 12px", marginBottom: 10 },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cardLabel: { fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase" as any, letterSpacing: "1px" },
  confBadge: { fontSize: 11, fontWeight: 600 },
  favoritoBanner: { display: "flex", alignItems: "center", gap: 8, background: C.goldBg, border: `1px solid ${C.goldDim}`, borderRadius: 8, padding: "8px 12px", marginBottom: 14 },
  favoritoLabel: { fontSize: 9, fontWeight: 700, color: C.goldDim, letterSpacing: "1px", textTransform: "uppercase" as any },
  favoritoName: { fontSize: 14, fontWeight: 800, color: C.gold, flex: 1 },
  favoritoProb: { fontSize: 16, fontWeight: 800, color: C.goldLight },
  winnerGrid: { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center", marginBottom: 14 },
  winnerSide: { display: "flex", flexDirection: "column" as any, gap: 4 },
  winnerTeam: { fontSize: 14, fontWeight: 700, color: C.text },
  winnerProb: { fontSize: 20, fontWeight: 800, color: C.gold },
  winnerDivider: { display: "flex", alignItems: "center", justifyContent: "center" },
  winnerVs: { fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "2px" },
  probBar: { height: 3, background: C.border2, borderRadius: 2, overflow: "hidden", width: "100%" },
  probFill: { height: "100%", borderRadius: 2, transition: "width 0.3s" },
  projCenter: { textAlign: "center" as any, marginBottom: 14, padding: "8px 0" },
  projBig: { fontSize: 36, fontWeight: 800, color: C.gold, letterSpacing: "-1px", textShadow: `0 0 20px ${C.goldDim}` },
  projSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  lineRow: { display: "flex", marginBottom: 10 },
  oddsRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  oddGroup: { display: "flex", flexDirection: "column" as any, gap: 4 },
  oddLabel: { fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase" as any, letterSpacing: "0.8px" },
  oddInput: { width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 6, color: C.text, fontSize: 13, padding: "7px 10px", outline: "none", boxSizing: "border-box" as any, fontFamily: "inherit", transition: "border-color 0.2s" },
  evTag: { fontSize: 11, fontWeight: 700 },

  // Jogadores
  playerMarketTabs: { display: "flex", gap: 6, marginBottom: 8 },
  playerMarketTab: { flex: 1, padding: "6px 4px", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", color: C.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: "0.3px", textAlign: "center" as any, transition: "all 0.15s" },
  playerMarketTabActive: { background: C.goldBg, border: `1px solid ${C.gold}`, color: C.gold },
  filterNote: { fontSize: 11, color: C.textDim, marginBottom: 8 },
  playerList: { display: "flex", flexDirection: "column" as any, gap: 6 },
  playerRow: { background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" },
  playerInfo: { marginBottom: 8 },
  playerName: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 },
  playerMeta: { display: "flex", gap: 6, alignItems: "center" },
  playerTeam: { fontSize: 10, fontWeight: 700, color: C.bg, background: C.gold, borderRadius: 4, padding: "1px 5px" },
  playerVs: { fontSize: 10, color: C.textMuted },
  playerStats: { display: "flex", gap: 6, flexWrap: "wrap" as any, marginBottom: 8 },
  statPill: { display: "flex", flexDirection: "column" as any, alignItems: "center", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", minWidth: 44 },
  statLabel: { fontSize: 9, color: C.textMuted, fontWeight: 600, letterSpacing: "0.5px" },
  statValue: { fontSize: 12, fontWeight: 700, color: C.text },
  playerOddsRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 },
  playerOddGroup: { display: "flex", flexDirection: "column" as any, gap: 2 },
  playerInput: { width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 5, color: C.text, fontSize: 12, padding: "5px 7px", outline: "none", boxSizing: "border-box" as any, fontFamily: "inherit", transition: "border-color 0.2s" },
  evMini: { fontSize: 10, fontWeight: 700, textAlign: "center" as any },

  // Ranking
  rankList: { display: "flex", flexDirection: "column" as any, gap: 6 },
  rankScoreBadge: { display: "flex", flexDirection: "column" as any, alignItems: "center", marginTop: 6, padding: "4px 8px", background: "#1A1205", border: "1px solid #3A2D14", borderRadius: 6 },
  rankScoreValue: { fontSize: 15, fontWeight: 800 },
  rankScoreLabel: { fontSize: 8, fontWeight: 700, color: "#4A3C28", letterSpacing: "1px" },
  rankRow: { display: "flex", alignItems: "flex-start", gap: 10, background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" },
  rankPos: { fontSize: 11, fontWeight: 800, color: C.goldDim, minWidth: 24, paddingTop: 2 },
  rankInfo: { flex: 1, minWidth: 0 },
  rankTitle: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as any },
  rankMeta: { display: "flex", gap: 6, alignItems: "center", marginBottom: 6 },
  rankMercado: { fontSize: 9, fontWeight: 700, color: C.bg, background: C.gold, borderRadius: 3, padding: "1px 5px", textTransform: "uppercase" as any, letterSpacing: "0.5px" },
  rankSub: { fontSize: 10, color: C.textMuted },
  rankStats: { display: "flex", gap: 8, flexWrap: "wrap" as any, marginBottom: 8 },
  rankStat: { fontSize: 11, color: C.textMuted },
  rankStatLabel: { color: C.textDim, marginRight: 2 },
  rankEvCol: { display: "flex", flexDirection: "column" as any, alignItems: "flex-end", gap: 2, paddingTop: 2 },
  rankEv: { fontSize: 16, fontWeight: 800 },
  rankEvLabel: { fontSize: 9, fontWeight: 600, color: C.textDim, letterSpacing: "1px" },

  // Apostas
  dashGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 },
  dashCard: { background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 8px", textAlign: "center" as any },
  dashValue: { fontSize: 14, fontWeight: 800, color: C.gold, marginBottom: 2 },
  dashLabel: { fontSize: 9, color: C.textMuted, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" as any },
  mercadoGrid: { display: "flex", gap: 6, flexWrap: "wrap" as any, marginBottom: 10 },
  mercadoCard: { background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", minWidth: 90 },
  mercadoNome: { fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: "uppercase" as any, letterSpacing: "0.5px", marginBottom: 2 },
  mercadoLucro: { fontSize: 13, fontWeight: 800, marginBottom: 2 },
  mercadoSub: { fontSize: 10, color: C.textDim },
  apostasList: { display: "flex", flexDirection: "column" as any, gap: 8 },
  apostaCard: { background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px" },
  apostaHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, gap: 8 },
  apostaTitulo: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 },
  apostaMeta: { display: "flex", gap: 6, alignItems: "center" },
  apostaSubtitulo: { fontSize: 10, color: C.textMuted },
  apostaStats: { display: "flex", gap: 8, flexWrap: "wrap" as any, marginBottom: 10 },
  apostaStatItem: { fontSize: 11, color: C.textMuted },
  apostaActions: { display: "flex", gap: 6 },
  btnGreen: { flex: 1, padding: "8px", background: "#14532d", border: "1px solid #22c55e44", borderRadius: 8, color: "#22c55e", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  btnRed: { flex: 1, padding: "8px", background: "#7f1d1d", border: "1px solid #ef444444", borderRadius: 8, color: "#ef4444", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  btnDelete: { padding: "8px 12px", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMuted, fontSize: 11, cursor: "pointer" },
  resultadoBadge: { fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "4px 8px", whiteSpace: "nowrap" as any },
  pendenteBadge: { fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "#78350f44", border: "1px solid #f59e0b44", borderRadius: 6, padding: "4px 8px", whiteSpace: "nowrap" as any },

  semValorBox: {
    padding: "10px 12px",
    background: "#7f1d1d22",
    border: "1px solid #ef444444",
    borderRadius: 8,
    color: "#ef4444",
    fontSize: 12,
    fontWeight: 700,
    textAlign: "center" as any,
    marginBottom: 4,
  },

  // Empty
  empty: { padding: "20px 0", color: C.textMuted, fontSize: 13, textAlign: "center" as any },
  emptyRanking: { padding: "48px 20px", textAlign: "center" as any },
  emptyIcon: { fontSize: 32, marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: 700, color: C.gold, marginBottom: 6 },
  emptySub: { fontSize: 12, color: C.textMuted, lineHeight: 1.6 },
}
