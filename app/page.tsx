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

// ── Constantes ───────────────────────────────────────────
const STAKE = 20
const BANCA_INICIAL = 1000
const MAE_TOTAL = 15.530
const MAE_HANDICAP = 11.875
const MIN_MINUTOS = 24

// Thresholds fixos por mercado (bet365 style)
const THRESHOLDS_PTS  = [5, 10, 15, 20, 25, 30]
const THRESHOLDS_AST  = [3, 5, 7, 10, 13, 15]
const THRESHOLDS_REB  = [3, 5, 7, 10, 13, 15]
const THRESHOLDS_FG3M = [1, 2, 3, 4, 5, 6]

// MAEs por mercado de jogadores
const MAE_PTS  = 4.408
const MAE_AST  = 1.239
const MAE_REB  = 1.719
const MAE_FG3M = 0.755

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
  motivo: string; alerta: string | null; gameId: string | null
  playerId?: string; tipoJogo?: "winner" | "total" | "handicap"
}

// ── Helpers matemáticos ─────────────────────────────────
function normalCDF(x: number, mean: number, std: number): number {
  const z = (x - mean) / std
  return 0.5 * (1 + erf(z / Math.sqrt(2)))
}
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}

// Prob de superar threshold via distribuição normal
function probOver(proj: number, threshold: number, mae: number): number {
  return Math.max(0.001, Math.min(0.999, 1 - normalCDF(threshold, proj, mae)))
}

// Odd justa a partir de probabilidade
function oddJusta(prob: number): number {
  return Math.round((1 / prob) * 100) / 100
}

// ── Cores semáforo ──────────────────────────────────────
const C = {
  bg: "#080600", surface: "#0E0B04", surface2: "#14100A", surfaceRaised: "#1A1409",
  border: "#2A2010", border2: "#3A2D14", gold: "#C9982A", goldLight: "#E8B84B",
  goldDim: "#8B6514", goldBg: "#1A1205", goldAccent: "#C9982A22",
  text: "#EDE0C4", textMuted: "#8A7355", textDim: "#4A3C28", white: "#FAF0DC",
  green: "#22c55e", greenBg: "#14532d", yellow: "#f59e0b", yellowBg: "#78350f44",
  red: "#ef4444", redBg: "#7f1d1d",
}

// Score → cor semáforo
function semaforoScore(s: number | null): string {
  if (s == null) return C.textDim
  if (s >= 75) return C.green
  if (s >= 55) return C.yellow
  return C.red
}
function semaforoConf(c: number | null): string {
  if (c == null) return C.textDim
  if (c >= 70) return C.green
  if (c >= 40) return C.yellow
  return C.red
}
function semaforoEv(ev: number | null): string {
  if (ev == null) return C.textDim
  if (ev > 0.05) return C.green
  if (ev > 0) return C.yellow
  return C.red
}
function semaforoProb(p: number | null): string {
  if (p == null) return C.textDim
  if (p >= 0.65) return C.green
  if (p >= 0.55) return C.yellow
  return C.red
}

// ── Gerador de texto explicativo ────────────────────────
function gerarMotivo(
  mercado: string, titulo: string, lado: string,
  prob: number, projecao: number | null, ojusta: number,
  confianca: number | null, score: number | null
): string {
  const probPct = (prob * 100).toFixed(0)
  const confStr = confianca != null ? ` Confiança: ${confianca.toFixed(0)}.` : ""
  const scoreStr = score != null ? ` Score Jarvis: ${score.toFixed(0)}.` : ""
  if (mercado === "Vencedor")
    return `Jarvis projeta ${probPct}% de chance de vitória para ${titulo.replace(" ML", "")}. Probabilidade acima do limiar de confiança.${confStr}${scoreStr}`
  if (mercado === "Total de Pontos") {
    const dir = lado === "Over" ? "acima" : "abaixo"
    return `Jarvis projeta total de ${projecao?.toFixed(1)} pts — ${dir} da linha. Prob de ${lado}: ${probPct}%.${confStr}${scoreStr}`
  }
  if (mercado === "Handicap")
    return `Jarvis projeta spread de ${projecao?.toFixed(1)} pts. Prob de ${lado} cobrir: ${probPct}%.${confStr}${scoreStr}`
  const dir = lado === "Over" ? "superar" : "ficar abaixo d"
  return `Projeção: ${projecao?.toFixed(1)} — ${probPct}% de probabilidade de ${dir}a linha. Odd justa: ${ojusta.toFixed(2)}.${confStr}${scoreStr}`
}

function gerarAlerta(mercado: string, prob: number, confianca: number | null, score: number | null): string | null {
  if (mercado === "Vencedor" && prob < 0.63)
    return "Margem pequena — apostar apenas se odd da banca for atrativa."
  if ((mercado === "Total de Pontos" || mercado === "Handicap") && (confianca ?? 0) < 45)
    return "Confiança moderada — mercado de jogo com mais ruído em playoffs."
  if (score != null && score < 70)
    return "Score abaixo do ideal — considere apenas se odd da banca for muito boa."
  return null
}

// ── Thresholds por mercado ──────────────────────────────
function getThresholds(mercado: string): number[] {
  if (mercado === "Pontos") return THRESHOLDS_PTS
  if (mercado === "Assists") return THRESHOLDS_AST
  if (mercado === "Rebotes") return THRESHOLDS_REB
  return THRESHOLDS_FG3M
}
function getMae(mercado: string): number {
  if (mercado === "Pontos") return MAE_PTS
  if (mercado === "Assists") return MAE_AST
  if (mercado === "Rebotes") return MAE_REB
  return MAE_FG3M
}

// ── Componente principal ─────────────────────────────────
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
  const [activeSection, setActiveSection] = useState<"jogos" | "jogadores" | "ranking" | "apostas">("jogos")
  const [loading, setLoading] = useState(true)
  const [oddsMap, setOddsMap] = useState<Record<string, OddsInput>>({})
  const [sugestaoOdds, setSugestaoOdds] = useState<Record<string, { oddBanca?: number; linhaBanca?: number }>>({})
  const [thresholdOdds, setThresholdOdds] = useState<Record<string, number>>({})
  const [activeCell, setActiveCell] = useState<{ key: string; threshold: number; prob: number; oddJustaVal: number; mercado: string; titulo: string; subtitulo: string; projecao: number } | null>(null)
  const [salvando, setSalvando] = useState(false)
  
  // Filtros do Ranking (movidos de "Apostas")
  const [filtroTipo, setFiltroTipo] = useState<"simples" | "duplas" | "triplas" | "todas">("todas")
  const [filtroQtd, setFiltroQtd] = useState<number>(8)
  const [filtroOddMax, setFiltroOddMax] = useState<number>(3.0)
  
  // Apostas selecionadas para registro em lote
  const [apostasParaRegistrar, setApostasParaRegistrar] = useState<Set<string>>(new Set())

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
    const source = activePlayerMarket === "pts" ? playerPointsRows
      : activePlayerMarket === "ast" ? playerAssistsRows
      : activePlayerMarket === "reb" ? playerReboundsRows
      : playerThreesRows
    return source
      .filter((p) => String(p.game_id) === String(selectedGameId))
      .filter((p) => (getMinutesAverage(p) ?? 0) >= MIN_MINUTOS)
      .filter((p) => {
        if (activePlayerMarket === "fg3m") {
          const fg3aAvg = Number((p as any).player_fg3a_avg ?? 0)
          return fg3aAvg > 0.5
        }
        return true
      })
      .sort((a, b) => (getProjectionFromPlayer(b) ?? 0) - (getProjectionFromPlayer(a) ?? 0))
  }, [selectedGameId, activePlayerMarket, playerPointsRows, playerAssistsRows, playerReboundsRows, playerThreesRows])

  // ── Ranking ─────────────────────────────────────────────
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
          items.push({ 
            key: `${jogo.game_id}-winner-home`, 
            categoria: "Jogo", 
            mercado: "Vencedor", 
            titulo: `${jogo.casa} ML`, 
            subtitulo: `${jogo.casa} vs ${jogo.fora}`, 
            lado: jogo.casa, 
            odd: odds.oddHome, 
            prob: probCasa, 
            projecao: probCasa, 
            edge: probCasa - 1 / odds.oddHome, 
            ev, 
            confianca: conf, 
            scoreJarvis: calcularScoreJarvis(ev, probCasa, conf, "Vencedor"),
            linha: null
          })
        }
        if (probFora != null && odds.oddAway) {
          const ev = probFora * odds.oddAway - 1
          items.push({ 
            key: `${jogo.game_id}-winner-away`, 
            categoria: "Jogo", 
            mercado: "Vencedor", 
            titulo: `${jogo.fora} ML`, 
            subtitulo: `${jogo.casa} vs ${jogo.fora}`, 
            lado: jogo.fora, 
            odd: odds.oddAway, 
            prob: probFora, 
            projecao: probFora, 
            edge: probFora - 1 / odds.oddAway, 
            ev, 
            confianca: conf, 
            scoreJarvis: calcularScoreJarvis(ev, probFora, conf, "Vencedor"),
            linha: null
          })
        }
      }
      if (total) {
        const odds = oddsMap[`total-${jogo.game_id}`] || {}
        items.push(...getLineBetRankingItem({ 
          keyBase: `total-${jogo.game_id}`, 
          mercado: "Total de Pontos", 
          titulo: `${jogo.casa} vs ${jogo.fora}`, 
          subtitulo: "Mercado de jogos", 
          projecao: getProjectionFromGameTotal(total), 
          linha: odds.linha, 
          oddOver: odds.oddOver, 
          oddUnder: odds.oddUnder, 
          modelConfidence: getModelConfidence(total), 
          probOver: null, 
          probUnder: null, 
          tipo: "total" 
        }))
      }
      if (handicap) {
        const odds = oddsMap[`handicap-${jogo.game_id}`] || {}
        const proj = getProjectionFromGameHandicap(handicap)
        const linhaInput = odds.linha
        
        // Para handicap, vamos ajustar o "lado" para mostrar a linha corretamente
        const handicapItems = getLineBetRankingItem({ 
          keyBase: `handicap-${jogo.game_id}`, 
          mercado: "Handicap", 
          titulo: `${jogo.casa} vs ${jogo.fora}`, 
          subtitulo: "Mercado de jogos", 
          projecao: proj, 
          linha: linhaInput, 
          oddOver: odds.oddOver, 
          oddUnder: odds.oddUnder, 
          modelConfidence: getModelConfidence(handicap), 
          probOver: null, 
          probUnder: null, 
          tipo: "handicap" 
        })
        
        // Ajustar o "lado" para mostrar a linha em vez de Over/Under
        handicapItems.forEach(item => {
          if (item.mercado === "Handicap" && item.linha != null) {
            // Se é o favorito (linha negativa)
            if (item.lado === "Over") {
              item.lado = `-${Math.abs(item.linha).toFixed(1)}`
            } else {
              // Se é o azarão (linha positiva)
              item.lado = `+${Math.abs(item.linha).toFixed(1)}`
            }
          }
        })
        
        items.push(...handicapItems)
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
        if ((getMinutesAverage(row) ?? 0) < MIN_MINUTOS) continue
        const key = `player-${source.mercado}-${row.game_id}-${row.player_id}`
        const odds = oddsMap[key] || {}
        items.push(...getLineBetRankingItem({ 
          keyBase: key, 
          mercado: source.mercado, 
          titulo: row.player_name, 
          subtitulo: `${getPlayerTeam(row)} vs ${getPlayerOpponent(row)}`, 
          projecao: getProjectionFromPlayer(row), 
          linha: odds.linha, 
          oddOver: odds.oddOver, 
          oddUnder: odds.oddUnder, 
          modelConfidence: getModelConfidence(row), 
          probOver: getProbOver(row), 
          probUnder: getProbUnder(row) 
        }))

        // Células rápidas da tabela (ex.: 10+ pontos, 5+ assistências).
        // Elas entram no Ranking como valor identificado, mas NÃO são registradas como aposta.
        const proj = getProjectionFromPlayer(row)
        const conf = getModelConfidence(row)
        const mae = getMae(source.mercado)
        const thresholds = getThresholds(source.mercado)
        if (proj != null) {
          for (const threshold of thresholds) {
            const cellKey = `${key}-${threshold}`
            const oddBanca = thresholdOdds[cellKey]
            if (!oddBanca || Number.isNaN(oddBanca)) continue

            const prob = probOver(proj, threshold - 0.5, mae)
            const ev = prob * oddBanca - 1
            const scoreJarvis = calcularScoreJarvis(ev, prob, conf, source.mercado)

            items.push({
              key: cellKey,
              categoria: "Jogador",
              mercado: source.mercado,
              titulo: row.player_name,
              subtitulo: `${getPlayerTeam(row)} vs ${getPlayerOpponent(row)}`,
              lado: `${threshold}+`,
              linha: threshold,
              odd: oddBanca,
              projecao: proj,
              prob,
              edge: prob - 1 / oddBanca,
              ev,
              confianca: conf,
              scoreJarvis,
            })
          }
        }
      }
    }
    return items
      .filter((x) => x.odd && x.ev !== null)
      .sort((a, b) => {
        const evDiff = (b.ev ?? -999) - (a.ev ?? -999)
        if (Math.abs(evDiff) > 0.0001) return evDiff

        const scoreDiff = (b.scoreJarvis ?? -999) - (a.scoreJarvis ?? -999)
        if (Math.abs(scoreDiff) > 0.0001) return scoreDiff

        const confDiff = (b.confianca ?? -999) - (a.confianca ?? -999)
        if (Math.abs(confDiff) > 0.0001) return confDiff

        return String(a.mercado).localeCompare(String(b.mercado))
      })
  }, [games, winnerRows, totalRows, handicapRows, playerPointsRows, playerAssistsRows, playerReboundsRows, playerThreesRows, oddsMap, thresholdOdds])

  // ── Sugestões de múltiplas ───────────────────────────────
  const sugestoesMultiplas = useMemo(() => {
    const confirmadas = ranking.filter((r) => (r.scoreJarvis ?? 0) >= 75 && r.prob >= 0.60)
    const duplas: { items: RankingItem[]; oddCombinada: number; probCombinada: number }[] = []
    const triplas: { items: RankingItem[]; oddCombinada: number; probCombinada: number }[] = []
    
    // Duplas — jogos diferentes para independência
    for (let i = 0; i < confirmadas.length; i++) {
      for (let j = i + 1; j < confirmadas.length; j++) {
        const a = confirmadas[i], b = confirmadas[j]
        // Extrair game_id do key
        const gameIdA = a.key.split('-')[0]
        const gameIdB = b.key.split('-')[0]
        if (gameIdA === gameIdB) continue // mesmo jogo — não independente
        const oddCombinada = parseFloat(((a.odd ?? 1) * (b.odd ?? 1)).toFixed(2))
        const probCombinada = parseFloat((a.prob * b.prob).toFixed(4))
        if (oddCombinada <= filtroOddMax)
          duplas.push({ items: [a, b], oddCombinada, probCombinada })
      }
    }
    
    // Triplas
    for (let i = 0; i < confirmadas.length; i++) {
      for (let j = i + 1; j < confirmadas.length; j++) {
        for (let k = j + 1; k < confirmadas.length; k++) {
          const a = confirmadas[i], b = confirmadas[j], c = confirmadas[k]
          const gameIdA = a.key.split('-')[0]
          const gameIdB = b.key.split('-')[0]
          const gameIdC = c.key.split('-')[0]
          if (gameIdA === gameIdB || gameIdB === gameIdC || gameIdA === gameIdC) continue
          const oddCombinada = parseFloat(((a.odd ?? 1) * (b.odd ?? 1) * (c.odd ?? 1)).toFixed(2))
          const probCombinada = parseFloat((a.prob * b.prob * c.prob).toFixed(4))
          if (oddCombinada <= filtroOddMax)
            triplas.push({ items: [a, b, c], oddCombinada, probCombinada })
        }
      }
    }
    
    duplas.sort((a, b) => b.probCombinada - a.probCombinada)
    triplas.sort((a, b) => b.probCombinada - a.probCombinada)
    
    return { duplas: duplas.slice(0, 3), triplas: triplas.slice(0, 2) }
  }, [ranking, filtroOddMax])

  // ── Dashboard de apostas ─────────────────────────────────
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

  // ── Ações ────────────────────────────────────────────────
  function registrarThreshold(cell: NonNullable<typeof activeCell>, oddBanca: number) {
    // Valor identificado NÃO é aposta registrada.
    // Aqui apenas guardamos a odd da célula para ela aparecer no Ranking.
    // Só vai para apostas_tracker quando você selecionar no Ranking e clicar em registrar.
    setThresholdOdds((prev) => ({ ...prev, [cell.key]: oddBanca }))
    setActiveCell(null)
    setActiveSection("ranking")
  }

  async function registrarRanking(item: RankingItem, jogoGameId: string | null) {
    setSalvando(true)
    await supabase.from("apostas_tracker").insert({
      game_id: jogoGameId, game_date: new Date().toISOString().split("T")[0],
      liga: "NBA", mercado: item.mercado, titulo: item.titulo, subtitulo: item.subtitulo,
      lado: item.lado, linha: item.linha ?? null, odd: item.odd ?? null,
      projecao: item.projecao, prob: item.prob, ev: item.ev,
      score_jarvis: item.scoreJarvis, confianca: item.confianca,
      stake: STAKE, resultado: null, lucro: null,
    })
    await loadApostas()
    setSalvando(false)
  }

  async function registrarSelecionadas() {
    if (apostasParaRegistrar.size === 0) return
    setSalvando(true)
    
    const itensParaRegistrar = ranking.filter(item => apostasParaRegistrar.has(item.key))
    
    for (const item of itensParaRegistrar) {
      const jogo = games.find((g) => item.key.includes(g.game_id))
      await supabase.from("apostas_tracker").insert({
        game_id: jogo?.game_id ?? null, 
        game_date: new Date().toISOString().split("T")[0],
        liga: "NBA", 
        mercado: item.mercado, 
        titulo: item.titulo, 
        subtitulo: item.subtitulo,
        lado: item.lado, 
        linha: item.linha ?? null, 
        odd: item.odd ?? null,
        projecao: item.projecao, 
        prob: item.prob, 
        ev: item.ev,
        score_jarvis: item.scoreJarvis, 
        confianca: item.confianca,
        stake: STAKE, 
        resultado: null, 
        lucro: null,
      })
    }
    
    setApostasParaRegistrar(new Set())
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

  function toggleApostaParaRegistrar(key: string) {
    setApostasParaRegistrar(prev => {
      const novo = new Set(prev)
      if (novo.has(key)) {
        novo.delete(key)
      } else {
        novo.add(key)
      }
      return novo
    })
  }

  // ── Formatadores ─────────────────────────────────────────
  const fp = (n: number | null | undefined) => n == null ? "—" : `${(n * 100).toFixed(1)}%`
  const fn = (n: number | null | undefined, d = 1) => (n == null || Number.isNaN(n)) ? "—" : Number(n).toFixed(d)
  const fc = (n: number) => `R$ ${n.toFixed(2)}`

  const apostasJaRegistradas = new Set(apostas.map((a) => `${a.titulo}-${a.lado}-${a.mercado}`))
  const S = styles

  // ── RENDER ───────────────────────────────────────────────
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
        {(["jogos", "jogadores", "ranking", "apostas"] as const).map((s) => (
          <button key={s} onClick={() => setActiveSection(s)}
            style={{ ...S.navBtn, ...(activeSection === s ? S.navBtnActive : {}) }}>
            {s === "jogos" ? "⚡ Jogos" : s === "jogadores" ? "Jogadores" : s === "ranking" ? "Ranking" : "Apostas"}
            {s === "ranking" && ranking.length > 0 && <span style={S.navBadge}>{ranking.length}</span>}
            {s === "apostas" && apostas.filter((a) => !a.resultado).length > 0 && <span style={{ ...S.navBadge, background: C.yellow }}>{apostas.filter((a) => !a.resultado).length}</span>}
          </button>
        ))}
      </div>

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

          {activeGameMarket === "winner" && winnerRow && (() => {
            const { probCasa, probFora } = getProjectionFromGameWinner(winnerRow)
            const conf = getModelConfidence(winnerRow)
            const key = `winner-${selectedGame.game_id}`
            const odds = oddsMap[key] || {}
            const evHome = probCasa != null && odds.oddHome ? probCasa * odds.oddHome - 1 : null
            const evAway = probFora != null && odds.oddAway ? probFora * odds.oddAway - 1 : null
            const ojCasa = probCasa ? parseFloat((1 / probCasa).toFixed(2)) : null
            const ojFora = probFora ? parseFloat((1 / probFora).toFixed(2)) : null
            const favorito = probCasa != null && probFora != null ? (probCasa >= probFora ? selectedGame.casa : selectedGame.fora) : null
            return (
              <div style={S.card}>
                <div style={S.cardHeader}>
                  <span style={S.cardLabel}>Vencedor · Moneyline</span>
                  {conf != null && <span style={{ ...S.confBadge, color: semaforoConf(conf) }}>Conf {fn(conf, 0)}</span>}
                </div>
                {favorito && (
                  <div style={S.favoritoBanner}>
                    <span style={S.favoritoLabel}>FAVORITO JARVIS</span>
                    <span style={S.favoritoName}>{favorito}</span>
                    <span style={{ ...S.favoritoProb, color: semaforoProb(Math.max(probCasa ?? 0, probFora ?? 0)) }}>
                      {fp(Math.max(probCasa ?? 0, probFora ?? 0))}
                    </span>
                  </div>
                )}
                <div style={S.winnerGrid}>
                  <div style={S.winnerSide}>
                    <div style={S.winnerTeam}>{selectedGame.casa}</div>
                    <div style={{ ...S.winnerProb, color: semaforoProb(probCasa) }}>{fp(probCasa)}</div>
                    <div style={S.probBar}><div style={{ ...S.probFill, width: `${(probCasa ?? 0) * 100}%`, background: C.gold }} /></div>
                    {ojCasa && <div style={S.oddJustaLabel}>Odd justa: <strong style={{ color: C.gold }}>{ojCasa}</strong></div>}
                  </div>
                  <div style={S.winnerDivider}><span style={S.winnerVs}>VS</span></div>
                  <div style={{ ...S.winnerSide, alignItems: "flex-end" as any }}>
                    <div style={S.winnerTeam}>{selectedGame.fora}</div>
                    <div style={{ ...S.winnerProb, color: semaforoProb(probFora) }}>{fp(probFora)}</div>
                    <div style={S.probBar}><div style={{ ...S.probFill, width: `${(probFora ?? 0) * 100}%`, background: C.goldDim, marginLeft: "auto" }} /></div>
                    {ojFora && <div style={{ ...S.oddJustaLabel, textAlign: "right" as any }}>Odd justa: <strong style={{ color: C.gold }}>{ojFora}</strong></div>}
                  </div>
                </div>
                <div style={S.oddsRow}>
                  <div style={S.oddGroup}>
                    <div style={S.oddLabel}>{selectedGame.casa} (mín {ojCasa ?? "—"})</div>
                    <input type="number" step="0.01" placeholder={ojCasa?.toString() ?? "Odd"}
                      value={odds.oddHome ?? ""} onChange={(e) => handleOddsChange(key, "oddHome", e.target.value)}
                      style={{ ...S.oddInput, borderColor: odds.oddHome && ojCasa ? (odds.oddHome >= ojCasa ? C.green : C.red) : C.border2 }} />
                    {evHome != null && <div style={{ ...S.evTag, color: semaforoEv(evHome) }}>EV {evHome > 0 ? "+" : ""}{(evHome * 100).toFixed(1)}%</div>}
                  </div>
                  <div style={S.oddGroup}>
                    <div style={S.oddLabel}>{selectedGame.fora} (mín {ojFora ?? "—"})</div>
                    <input type="number" step="0.01" placeholder={ojFora?.toString() ?? "Odd"}
                      value={odds.oddAway ?? ""} onChange={(e) => handleOddsChange(key, "oddAway", e.target.value)}
                      style={{ ...S.oddInput, borderColor: odds.oddAway && ojFora ? (odds.oddAway >= ojFora ? C.green : C.red) : C.border2 }} />
                    {evAway != null && <div style={{ ...S.evTag, color: semaforoEv(evAway) }}>EV {evAway > 0 ? "+" : ""}{(evAway * 100).toFixed(1)}%</div>}
                  </div>
                </div>
              </div>
            )
          })()}

          {activeGameMarket === "total" && totalRow && (() => {
            const proj = getProjectionFromGameTotal(totalRow)
            const conf = getModelConfidence(totalRow)
            const key = `total-${selectedGame.game_id}`
            const odds = oddsMap[key] || {}
            const evOver = odds.linha && odds.oddOver && proj != null ? calcularEvOver(proj, odds.linha, odds.oddOver, "total") : null
            const evUnder = odds.linha && odds.oddUnder && proj != null ? calcularEvUnder(proj, odds.linha, odds.oddUnder, "total") : null
            const pOver = odds.linha && proj != null ? 1 - normalCDF(odds.linha, proj, MAE_TOTAL) : null
            const pUnder = odds.linha && proj != null ? normalCDF(odds.linha, proj, MAE_TOTAL) : null
            const ojOver = pOver ? parseFloat((1 / pOver).toFixed(2)) : null
            const ojUnder = pUnder ? parseFloat((1 / pUnder).toFixed(2)) : null
            return (
              <div style={S.card}>
                <div style={S.cardHeader}>
                  <span style={S.cardLabel}>Total de Pontos</span>
                  {conf != null && <span style={{ ...S.confBadge, color: semaforoConf(conf) }}>Conf {fn(conf, 0)}</span>}
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
                {ojOver && ojUnder && (
                  <div style={S.oddJustaRow}>
                    <span style={S.oddJustaItem}>Over — Odd justa: <strong style={{ color: C.gold }}>{ojOver}</strong></span>
                    <span style={S.oddJustaItem}>Under — Odd justa: <strong style={{ color: C.gold }}>{ojUnder}</strong></span>
                  </div>
                )}
                <div style={S.oddsRow}>
                  <div style={S.oddGroup}>
                    <div style={S.oddLabel}>Over {ojOver ? `(mín ${ojOver})` : ""}</div>
                    <input type="number" step="0.01" placeholder={ojOver?.toString() ?? "Odd"}
                      value={odds.oddOver ?? ""} onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                      style={{ ...S.oddInput, borderColor: odds.oddOver && ojOver ? (odds.oddOver >= ojOver ? C.green : C.red) : C.border2 }} />
                    {evOver != null && <div style={{ ...S.evTag, color: semaforoEv(evOver) }}>EV {evOver > 0 ? "+" : ""}{(evOver * 100).toFixed(1)}%</div>}
                  </div>
                  <div style={S.oddGroup}>
                    <div style={S.oddLabel}>Under {ojUnder ? `(mín ${ojUnder})` : ""}</div>
                    <input type="number" step="0.01" placeholder={ojUnder?.toString() ?? "Odd"}
                      value={odds.oddUnder ?? ""} onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                      style={{ ...S.oddInput, borderColor: odds.oddUnder && ojUnder ? (odds.oddUnder >= ojUnder ? C.green : C.red) : C.border2 }} />
                    {evUnder != null && <div style={{ ...S.evTag, color: semaforoEv(evUnder) }}>EV {evUnder > 0 ? "+" : ""}{(evUnder * 100).toFixed(1)}%</div>}
                  </div>
                </div>
              </div>
            )
          })()}

          {activeGameMarket === "handicap" && handicapRow && (() => {
            const proj = getProjectionFromGameHandicap(handicapRow)
            const conf = getModelConfidence(handicapRow)
            const key = `handicap-${selectedGame.game_id}`
            const odds = oddsMap[key] || {}
            const favorito = proj != null ? (proj > 0 ? selectedGame.casa : selectedGame.fora) : "—"
            const azarao = proj != null ? (proj > 0 ? selectedGame.fora : selectedGame.casa) : "—"
            const spreadFav = proj != null ? `-${Math.abs(proj).toFixed(1)}` : ""
            const spreadAz = proj != null ? `+${Math.abs(proj).toFixed(1)}` : ""

            const linhaNeg = odds.linha ? -Math.abs(odds.linha) : null
            const linhaPos = odds.linha ? Math.abs(odds.linha) : null
            const pFav = linhaNeg && proj != null ? normalCDF(proj, Math.abs(linhaNeg), MAE_HANDICAP) : null
            const pAz = linhaPos && proj != null ? 1 - normalCDF(proj, linhaPos, MAE_HANDICAP) : null
            const ojFav = pFav ? parseFloat((1 / pFav).toFixed(2)) : null
            const ojAz = pAz ? parseFloat((1 / pAz).toFixed(2)) : null
            const evFav = pFav && odds.oddOver ? pFav * odds.oddOver - 1 : null
            const evAz = pAz && odds.oddUnder ? pAz * odds.oddUnder - 1 : null

            return (
              <div style={S.card}>
                <div style={S.cardHeader}>
                  <span style={S.cardLabel}>Handicap · Spread</span>
                  {conf != null && <span style={{ ...S.confBadge, color: semaforoConf(conf) }}>Conf {fn(conf, 0)}</span>}
                </div>
                <div style={S.projCenter}>
                  <div style={S.projBig}>{spreadFav}</div>
                  <div style={S.projSub}>Favorito Jarvis: <strong style={{ color: C.gold }}>{favorito}</strong></div>
                </div>
                <div style={S.lineRow}>
                  <input type="number" step="0.5" placeholder="Linha (ex: 9.5)"
                    value={odds.linha ?? ""} onChange={(e) => handleOddsChange(key, "linha", e.target.value)}
                    style={{ ...S.oddInput, flex: 1 }} />
                </div>
                {ojFav && ojAz && (
                  <div style={S.oddJustaRow}>
                    <span style={S.oddJustaItem}>{favorito} {linhaNeg?.toFixed(1)} — OJ: <strong style={{ color: C.gold }}>{ojFav}</strong></span>
                    <span style={S.oddJustaItem}>{azarao} +{linhaPos?.toFixed(1)} — OJ: <strong style={{ color: C.gold }}>{ojAz}</strong></span>
                  </div>
                )}
                <div style={S.oddsRow}>
                  <div style={S.oddGroup}>
                    <div style={S.oddLabel}>{favorito} {linhaNeg?.toFixed(1) ?? spreadFav} {ojFav ? `(mín ${ojFav})` : ""}</div>
                    <input type="number" step="0.01" placeholder={ojFav?.toString() ?? "Odd"}
                      value={odds.oddOver ?? ""} onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                      style={{ ...S.oddInput, borderColor: odds.oddOver && ojFav ? (odds.oddOver >= ojFav ? C.green : C.red) : C.border2 }} />
                    {evFav != null && <div style={{ ...S.evTag, color: semaforoEv(evFav) }}>EV {evFav > 0 ? "+" : ""}{(evFav * 100).toFixed(1)}%</div>}
                  </div>
                  <div style={S.oddGroup}>
                    <div style={S.oddLabel}>{azarao} +{linhaPos?.toFixed(1) ?? spreadAz.replace("+", "")} {ojAz ? `(mín ${ojAz})` : ""}</div>
                    <input type="number" step="0.01" placeholder={ojAz?.toString() ?? "Odd"}
                      value={odds.oddUnder ?? ""} onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                      style={{ ...S.oddInput, borderColor: odds.oddUnder && ojAz ? (odds.oddUnder >= ojAz ? C.green : C.red) : C.border2 }} />
                    {evAz != null && <div style={{ ...S.evTag, color: semaforoEv(evAz) }}>EV {evAz > 0 ? "+" : ""}{(evAz * 100).toFixed(1)}%</div>}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── JOGADORES — Interface de colunas ── */}
      {activeSection === "jogadores" && selectedGame && (
        <div style={S.section}>
          <div style={S.playerMarketTabs}>
            {(["pts", "ast", "reb", "fg3m"] as const).map((m) => (
              <button key={m} onClick={() => { setActivePlayerMarket(m); setActiveCell(null) }}
                style={{ ...S.playerMarketTab, ...(activePlayerMarket === m ? S.playerMarketTabActive : {}) }}>
                {PLAYER_LABELS[m]}
              </button>
            ))}
          </div>
          <div style={S.filterNote}>Filtro: média ≥ {MIN_MINUTOS} min · {playersForSelectedGame.length} jogadores · Toque na célula para apostar</div>

          {/* Modal de célula ativa */}
          {activeCell && (
            <div style={S.cellModal}>
              <div style={S.cellModalHeader}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.white }}>{activeCell.titulo}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{activeCell.mercado} · {activeCell.threshold}+</div>
                </div>
                <button onClick={() => setActiveCell(null)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                <div style={S.metricBlock}>
                  <div style={S.metricLabel}>Prob Jarvis</div>
                  <div style={{ ...S.metricVal, color: semaforoProb(activeCell.prob) }}>{fp(activeCell.prob)}</div>
                </div>
                <div style={S.metricBlock}>
                  <div style={S.metricLabel}>Odd Justa</div>
                  <div style={{ ...S.metricVal, color: C.gold }}>{activeCell.oddJustaVal.toFixed(2)}</div>
                </div>
                <div style={S.metricBlock}>
                  <div style={S.metricLabel}>Projeção</div>
                  <div style={S.metricVal}>{fn(activeCell.projecao, 1)}</div>
                </div>
              </div>
              <div style={S.oddLabel}>Odd da banca (mín: {activeCell.oddJustaVal.toFixed(2)})</div>
              <input type="number" step="0.01" placeholder={activeCell.oddJustaVal.toFixed(2)}
                value={thresholdOdds[activeCell.key] ?? ""}
                onChange={(e) => setThresholdOdds(prev => ({ ...prev, [activeCell.key]: Number(e.target.value) }))}
                style={{ ...S.oddInput, marginBottom: 8, marginTop: 4 }} />
              {thresholdOdds[activeCell.key] != null && (() => {
                const ob = thresholdOdds[activeCell.key]
                const ev = activeCell.prob * ob - 1
                const temValor = ob >= activeCell.oddJustaVal
                return (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: temValor ? C.green : C.red, marginBottom: 8 }}>
                      {temValor
                        ? `✓ Valor confirmado · EV +${(ev * 100).toFixed(1)}%`
                        : `✗ Sem valor · Odd mínima: ${activeCell.oddJustaVal.toFixed(2)}`}
                    </div>
                    {temValor && (
                      <button onClick={() => registrarThreshold(activeCell, ob)} disabled={salvando}
                        style={S.registerBtnReady}>
                        ⚡ Adicionar ao Ranking — {activeCell.threshold}+ {activeCell.mercado}
                      </button>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {playersForSelectedGame.length === 0
            ? <div style={S.empty}>Nenhum jogador encontrado.</div>
            : (
              <div style={S.tableContainer}>
                <div style={S.tableHeader}>
                  <div style={S.tableColPlayer}>Jogador</div>
                  <div style={S.tableColProj}>Proj</div>
                  {getThresholds(PLAYER_LABELS[activePlayerMarket]).map((t) => (
                    <div key={t} style={S.tableColThreshold}>{t}+</div>
                  ))}
                  <div style={S.tableColOutra}>Outra</div>
                </div>

                {playersForSelectedGame.map((player) => {
                  const mercadoLabel = PLAYER_LABELS[activePlayerMarket]
                  const proj = getProjectionFromPlayer(player) ?? 0
                  const conf = getModelConfidence(player)
                  const mae = getMae(mercadoLabel)
                  const thresholds = getThresholds(mercadoLabel)
                  const playerKey = `player-${mercadoLabel}-${player.game_id}-${player.player_id}`
                  const odds = oddsMap[playerKey] || {}

                  return (
                    <div key={playerKey} style={S.tableRow}>
                      <div style={S.tableColPlayer}>
                        <div style={S.playerNameSmall}>{player.player_name}</div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <span style={S.playerTeam}>{getPlayerTeam(player)}</span>
                          {conf != null && (
                            <span style={{ fontSize: 9, color: semaforoConf(conf), fontWeight: 700 }}>
                              {fn(conf, 0)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={S.tableColProj}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: C.gold }}>{fn(proj, 1)}</span>
                      </div>

                      {thresholds.map((t) => {
                        const p = probOver(proj, t - 0.5, mae)
                        const oj = oddJusta(p)
                        const cellKey = `${playerKey}-${t}`
                        const isActive = activeCell?.key === cellKey
                        const cellColor = p >= 0.65 ? C.green : p >= 0.55 ? C.yellow : C.red
                        return (
                          <div key={t} style={S.tableColThreshold}>
                            <button
                              onClick={() => setActiveCell({
                                key: cellKey, threshold: t, prob: p,
                                oddJustaVal: oj, mercado: mercadoLabel,
                                titulo: player.player_name,
                                subtitulo: `${getPlayerTeam(player)} vs ${getPlayerOpponent(player)}`,
                                projecao: proj,
                              })}
                              style={{
                                ...S.thresholdCell,
                                borderColor: isActive ? C.gold : cellColor + "44",
                                background: isActive ? C.goldBg : cellColor + "11",
                              }}>
                              <span style={{ fontSize: 10, fontWeight: 800, color: cellColor }}>{oj.toFixed(2)}</span>
                              <span style={{ fontSize: 8, color: cellColor + "99" }}>{(p * 100).toFixed(0)}%</span>
                            </button>
                          </div>
                        )
                      })}

                      <div style={S.tableColOutra}>
                        <input type="number" step="0.5" placeholder=",5"
                          value={odds.linha ?? ""}
                          onChange={(e) => handleOddsChange(playerKey, "linha", e.target.value)}
                          style={{ ...S.playerInputSmall, width: "100%" }} />
                        {odds.linha && (() => {
                          const pO = getProbOver(player)
                          const pU = getProbUnder(player)
                          const ojO = pO ? parseFloat((1 / pO).toFixed(2)) : null
                          const ojU = pU ? parseFloat((1 / pU).toFixed(2)) : null
                          return (
                            <div style={{ display: "flex", gap: 2, marginTop: 3 }}>
                              <div style={{ flex: 1 }}>
                                <input type="number" step="0.01" placeholder={ojO?.toString() ?? "Over"}
                                  value={odds.oddOver ?? ""}
                                  onChange={(e) => handleOddsChange(playerKey, "oddOver", e.target.value)}
                                  style={{ ...S.playerInputSmall, borderColor: odds.oddOver && ojO ? (odds.oddOver >= ojO ? C.green : C.red) : C.border2 }} />
                              </div>
                              <div style={{ flex: 1 }}>
                                <input type="number" step="0.01" placeholder={ojU?.toString() ?? "Und"}
                                  value={odds.oddUnder ?? ""}
                                  onChange={(e) => handleOddsChange(playerKey, "oddUnder", e.target.value)}
                                  style={{ ...S.playerInputSmall, borderColor: odds.oddUnder && ojU ? (odds.oddUnder >= ojU ? C.green : C.red) : C.border2 }} />
                              </div>
                            </div>
                          )
                        })()}
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
          {/* Filtros */}
          <div style={S.filtrosRow}>
            <div style={S.filtroGroup}>
              <div style={S.oddLabel}>Tipo</div>
              <div style={{ display: "flex", gap: 4 }}>
                {(["todas", "simples", "duplas", "triplas"] as const).map((t) => (
                  <button key={t} onClick={() => setFiltroTipo(t)}
                    style={{ ...S.filtroBtn, ...(filtroTipo === t ? S.filtroBtnActive : {}) }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div style={S.filtroGroup}>
              <div style={S.oddLabel}>Odd máx</div>
              <input type="number" step="0.1" value={filtroOddMax}
                onChange={(e) => setFiltroOddMax(Number(e.target.value))}
                style={{ ...S.playerInputSmall, width: 60 }} />
            </div>
            <div style={S.filtroGroup}>
              <div style={S.oddLabel}>Qtd</div>
              <input type="number" step="1" min={1} max={20} value={filtroQtd}
                onChange={(e) => setFiltroQtd(Number(e.target.value))}
                style={{ ...S.playerInputSmall, width: 50 }} />
            </div>
          </div>

          {/* Apostas Simples */}
          {(filtroTipo === "todas" || filtroTipo === "simples") && ranking.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={S.rankingSecaoTitulo}>
                <span style={S.rankingSecaoLabel}>APOSTAS SIMPLES</span>
                <span style={S.rankingSecaoCount}>{ranking.length} oportunidades</span>
              </div>
              <div style={S.rankList}>
                {ranking.slice(0, filtroQtd).map((item, i) => {
                  const jaReg = apostasJaRegistradas.has(`${item.titulo}-${item.lado}-${item.mercado}`)
                  const selecionado = apostasParaRegistrar.has(item.key)
                  const jogo = games.find((g) => item.key.includes(g.game_id))
                  const scoreCor = semaforoScore(item.scoreJarvis)
                  
                  // Gerar motivo e alerta
                  const motivo = gerarMotivo(
                    item.mercado,
                    item.titulo,
                    item.lado,
                    item.prob,
                    item.projecao,
                    item.odd ?? 0,
                    item.confianca,
                    item.scoreJarvis
                  )
                  const alerta = gerarAlerta(item.mercado, item.prob, item.confianca, item.scoreJarvis)

                  return (
                    <div key={item.key} style={{
                      ...S.rankRow,
                      borderColor: selecionado ? C.gold : C.border,
                      background: selecionado ? C.goldBg : C.surfaceRaised
                    }}>
                      <div style={S.rankPos}>#{i + 1}</div>
                      <div style={S.rankInfo}>
                        <div style={S.rankTitle}>{item.titulo}</div>
                        <div style={S.rankMeta}>
                          <span style={S.rankMercado}>{item.mercado}</span>
                          <span style={S.rankSub}>{item.subtitulo}</span>
                        </div>
                        
                        {/* Motivo do Jarvis */}
                        <div style={S.motivoBox}>
                          <div style={S.motivoText}>{motivo}</div>
                          {alerta && <div style={S.alertaText}>⚠️ {alerta}</div>}
                        </div>

                        <div style={S.rankStats}>
                          <span style={S.rankStat}><span style={S.rankStatLabel}>Lado</span> {item.lado}</span>
                          {item.linha != null && <span style={S.rankStat}><span style={S.rankStatLabel}>Linha</span> {fn(item.linha, 1)}</span>}
                          <span style={S.rankStat}><span style={S.rankStatLabel}>Prob</span> <span style={{ color: semaforoProb(item.prob) }}>{fp(item.prob)}</span></span>
                          <span style={S.rankStat}><span style={S.rankStatLabel}>Odd</span> {fn(item.odd, 2)}</span>
                          <span style={S.rankStat}><span style={S.rankStatLabel}>Edge</span> {fn(item.edge, 3)}</span>
                        </div>

                        {!jaReg && (
                          <button 
                            onClick={() => toggleApostaParaRegistrar(item.key)}
                            style={{
                              ...S.registerBtn,
                              ...(selecionado ? { background: C.gold, color: C.bg, fontWeight: 800 } : {})
                            }}>
                            {selecionado ? "✓ Selecionada" : "📌 Selecionar"}
                          </button>
                        )}
                        {jaReg && (
                          <div style={S.registerBtnDone}>✓ Já em Apostas feitas</div>
                        )}
                      </div>
                      <div style={S.rankEvCol}>
                        <div style={{ ...S.rankEv, color: semaforoEv(item.ev) }}>
                          {item.ev != null ? `${item.ev > 0 ? "+" : ""}${(item.ev * 100).toFixed(1)}%` : "—"}
                        </div>
                        <div style={S.rankEvLabel}>EV</div>
                        {item.scoreJarvis != null && (
                          <div style={{ ...S.rankScoreBadge, borderColor: scoreCor + "44" }}>
                            <span style={{ ...S.rankScoreValue, color: scoreCor }}>{item.scoreJarvis.toFixed(0)}</span>
                            <span style={S.rankScoreLabel}>SCORE</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Apostas Duplas */}
          {(filtroTipo === "todas" || filtroTipo === "duplas") && sugestoesMultiplas.duplas.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={S.rankingSecaoTitulo}>
                <span style={S.rankingSecaoLabel}>APOSTAS DUPLAS</span>
                <span style={S.rankingSecaoCount}>Top {sugestoesMultiplas.duplas.length}</span>
              </div>
              {sugestoesMultiplas.duplas.map((dupla, idx) => (
                <div key={`dupla-${idx}`} style={S.multiplaCard}>
                  <div style={S.multiplaHeader}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.gold }}>DUPLA #{idx + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.gold }}>@{dupla.oddCombinada}</span>
                    <span style={{ fontSize: 11, color: semaforoProb(dupla.probCombinada) }}>
                      {fp(dupla.probCombinada)} prob
                    </span>
                  </div>
                  <div style={S.multiplaLegs}>
                    {dupla.items.map((item, i) => (
                      <div key={i} style={S.multiplaLeg}>
                        <div style={S.multiplaLegNome}>{item.titulo} · {item.lado}</div>
                        <div style={S.multiplaLegDetalhe}>
                          {item.mercado} · @{fn(item.odd, 2)} · {fp(item.prob)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Apostas Triplas */}
          {(filtroTipo === "todas" || filtroTipo === "triplas") && sugestoesMultiplas.triplas.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={S.rankingSecaoTitulo}>
                <span style={S.rankingSecaoLabel}>APOSTAS TRIPLAS</span>
                <span style={S.rankingSecaoCount}>Top {sugestoesMultiplas.triplas.length}</span>
              </div>
              {sugestoesMultiplas.triplas.map((tripla, idx) => (
                <div key={`tripla-${idx}`} style={S.multiplaCard}>
                  <div style={S.multiplaHeader}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.gold }}>TRIPLA #{idx + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.gold }}>@{tripla.oddCombinada}</span>
                    <span style={{ fontSize: 11, color: semaforoProb(tripla.probCombinada) }}>
                      {fp(tripla.probCombinada)} prob
                    </span>
                  </div>
                  <div style={S.multiplaLegs}>
                    {tripla.items.map((item, i) => (
                      <div key={i} style={S.multiplaLeg}>
                        <div style={S.multiplaLegNome}>{item.titulo} · {item.lado}</div>
                        <div style={S.multiplaLegDetalhe}>
                          {item.mercado} · @{fn(item.odd, 2)} · {fp(item.prob)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Botão de registrar selecionadas */}
          {apostasParaRegistrar.size > 0 && (
            <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 1000 }}>
              <button 
                onClick={registrarSelecionadas}
                disabled={salvando}
                style={{
                  ...S.registerBtnReady,
                  padding: "14px 28px",
                  fontSize: 14,
                  boxShadow: `0 4px 16px ${C.goldDim}`
                }}>
                ⚡ Registrar {apostasParaRegistrar.size} aposta{apostasParaRegistrar.size > 1 ? "s" : ""}
              </button>
            </div>
          )}

          {ranking.length === 0 && (
            <div style={S.emptyRanking}>
              <div style={S.emptyIcon}>⚡</div>
              <div style={S.emptyTitle}>Sem apostas calculadas</div>
              <div style={S.emptySub}>Preencha linhas e odds nos mercados para ver o ranking.</div>
            </div>
          )}
        </div>
      )}

      {/* ── APOSTAS ── */}
      {activeSection === "apostas" && (
        <div style={S.section}>
          {/* Dashboard */}
          <div style={S.dashGrid}>
            <div style={S.dashCard}><div style={S.dashValue}>{fc(dashApostas.banca)}</div><div style={S.dashLabel}>Banca</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: dashApostas.lucroTotal >= 0 ? C.green : C.red }}>{dashApostas.lucroTotal >= 0 ? "+" : ""}{fc(dashApostas.lucroTotal)}</div><div style={S.dashLabel}>Lucro</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: dashApostas.roi != null ? (dashApostas.roi >= 0 ? C.green : C.red) : C.textMuted }}>{dashApostas.roi != null ? `${dashApostas.roi >= 0 ? "+" : ""}${(dashApostas.roi * 100).toFixed(1)}%` : "—"}</div><div style={S.dashLabel}>ROI</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: dashApostas.winRate != null ? semaforoProb(dashApostas.winRate) : C.textMuted }}>{dashApostas.winRate != null ? `${(dashApostas.winRate * 100).toFixed(0)}%` : "—"}</div><div style={S.dashLabel}>Win Rate</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: C.green }}>{dashApostas.greens}</div><div style={S.dashLabel}>Greens</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: C.red }}>{dashApostas.reds}</div><div style={S.dashLabel}>Reds</div></div>
            <div style={S.dashCard}><div style={{ ...S.dashValue, color: C.yellow }}>{dashApostas.pendentes}</div><div style={S.dashLabel}>Pendentes</div></div>
            <div style={S.dashCard}><div style={S.dashValue}>{dashApostas.total}</div><div style={S.dashLabel}>Total</div></div>
          </div>

          {/* Breakdown por mercado */}
          {Object.keys(dashApostas.mercados).length > 0 && (
            <div style={S.mercadoGrid}>
              {Object.entries(dashApostas.mercados).map(([mercado, data]) => (
                <div key={mercado} style={S.mercadoCard}>
                  <div style={S.mercadoNome}>{mercado}</div>
                  <div style={{ ...S.mercadoLucro, color: data.lucro >= 0 ? C.green : C.red }}>{data.lucro >= 0 ? "+" : ""}{fc(data.lucro)}</div>
                  <div style={S.mercadoSub}>{data.greens}✓ / {data.total - data.greens}✗</div>
                </div>
              ))}
            </div>
          )}

          {/* Lista de apostas */}
          {apostas.length === 0 ? (
            <div style={S.emptyRanking}>
              <div style={S.emptyIcon}>📋</div>
              <div style={S.emptyTitle}>Nenhuma aposta registrada</div>
              <div style={S.emptySub}>Selecione apostas no Ranking para começar.</div>
            </div>
          ) : (
            <div style={S.apostasList}>
              {apostas.map((aposta) => (
                <div key={aposta.id} style={{
                  ...S.apostaCard,
                  borderColor: aposta.resultado === "green" ? C.green + "44"
                    : aposta.resultado === "red" ? C.red + "44"
                    : C.border,
                }}>
                  <div style={S.apostaHeader}>
                    <div>
                      <div style={S.apostaTitulo}>{aposta.titulo}</div>
                      <div style={S.apostaMeta}>
                        <span style={S.rankMercado}>{aposta.mercado}</span>
                        <span style={S.apostaSubtitulo}>{aposta.subtitulo}</span>
                      </div>
                    </div>
                    {aposta.resultado ? (
                      <div style={{ ...S.resultadoBadge, background: aposta.resultado === "green" ? C.greenBg : C.redBg, color: aposta.resultado === "green" ? C.green : C.red }}>
                        {aposta.resultado === "green" ? "✓ GREEN" : "✗ RED"}
                      </div>
                    ) : <div style={S.pendenteBadge}>PENDENTE</div>}
                  </div>
                  <div style={S.apostaStats}>
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Lado</span> {aposta.lado}</span>
                    {aposta.linha && <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Linha</span> {fn(aposta.linha, 1)}</span>}
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Odd</span> {fn(aposta.odd, 2)}</span>
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>EV</span> <span style={{ color: semaforoEv(aposta.ev) }}>{aposta.ev != null ? `${aposta.ev > 0 ? "+" : ""}${(aposta.ev * 100).toFixed(1)}%` : "—"}</span></span>
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Prob</span> <span style={{ color: semaforoProb(aposta.prob) }}>{fp(aposta.prob)}</span></span>
                    <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Score</span> <span style={{ color: semaforoScore(aposta.score_jarvis) }}>{fn(aposta.score_jarvis, 0)}</span></span>
                    {aposta.lucro != null && <span style={S.apostaStatItem}><span style={S.rankStatLabel}>Lucro</span> <span style={{ color: aposta.lucro >= 0 ? C.green : C.red }}>{aposta.lucro >= 0 ? "+" : ""}{fc(aposta.lucro)}</span></span>}
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

// ── Estilos ──────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'SF Pro Display', 'Helvetica Neue', sans-serif", fontSize: 14, paddingBottom: 80 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: `1px solid ${C.border2}`, background: C.surface },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  logo: { display: "flex", alignItems: "baseline", gap: 2 },
  logoJ: { fontSize: 22, fontWeight: 800, color: C.gold, letterSpacing: "-0.5px", textShadow: `0 0 12px ${C.goldDim}` },
  logoText: { fontSize: 15, fontWeight: 700, color: C.white, letterSpacing: "3px" },
  headerBadge: { fontSize: 10, fontWeight: 700, color: C.gold, background: C.goldAccent, border: `1px solid ${C.goldDim}`, borderRadius: 4, padding: "2px 7px" },
  headerRight: { display: "flex", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: "50%", background: C.gold, boxShadow: `0 0 6px ${C.gold}` },
  headerSub: { fontSize: 12, color: C.textMuted },
  gameSelector: { display: "flex", borderBottom: `1px solid ${C.border2}`, background: C.surface, overflowX: "auto" as any },
  gameTab: { position: "relative", display: "flex", flexDirection: "column" as any, alignItems: "center", gap: 2, padding: "10px 16px 8px", background: "none", border: "none", cursor: "pointer", minWidth: 120, color: C.textMuted },
  gameTabActive: { color: C.gold },
  gameTabHome: { fontSize: 13, fontWeight: 700 },
  gameTabVs: { fontSize: 10, color: C.textDim },
  gameTabAway: { fontSize: 13, fontWeight: 700 },
  gameTabBar: { position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: C.gold, borderRadius: "2px 2px 0 0", boxShadow: `0 0 8px ${C.gold}` },
  nav: { display: "flex", background: C.surface, borderBottom: `1px solid ${C.border2}` },
  navBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "10px 4px", background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontSize: 11, fontWeight: 500 },
  navBtnActive: { color: C.gold },
  navBadge: { fontSize: 9, fontWeight: 700, color: C.bg, background: C.gold, borderRadius: 10, padding: "1px 4px", minWidth: 14, textAlign: "center" as any },
  section: { padding: "12px 12px 0" },

  // Jogos
  marketTabs: { display: "flex", gap: 6, marginBottom: 10 },
  marketTab: { flex: 1, padding: "8px 4px", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", color: C.textMuted, fontSize: 12, fontWeight: 600, textAlign: "center" as any },
  marketTabActive: { background: C.goldBg, border: `1px solid ${C.gold}`, color: C.gold, boxShadow: `0 0 8px ${C.goldDim}` },
  card: { background: C.surfaceRaised, border: `1px solid ${C.border2}`, borderRadius: 12, padding: "14px 14px 12px", marginBottom: 10 },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cardLabel: { fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase" as any, letterSpacing: "1px" },
  confBadge: { fontSize: 11, fontWeight: 600 },
  favoritoBanner: { display: "flex", alignItems: "center", gap: 8, background: C.goldBg, border: `1px solid ${C.goldDim}`, borderRadius: 8, padding: "8px 12px", marginBottom: 14 },
  favoritoLabel: { fontSize: 9, fontWeight: 700, color: C.goldDim, letterSpacing: "1px", textTransform: "uppercase" as any },
  favoritoName: { fontSize: 14, fontWeight: 800, color: C.gold, flex: 1 },
  favoritoProb: { fontSize: 16, fontWeight: 800 },
  winnerGrid: { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center", marginBottom: 14 },
  winnerSide: { display: "flex", flexDirection: "column" as any, gap: 4 },
  winnerTeam: { fontSize: 14, fontWeight: 700, color: C.text },
  winnerProb: { fontSize: 20, fontWeight: 800 },
  winnerDivider: { display: "flex", alignItems: "center", justifyContent: "center" },
  winnerVs: { fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "2px" },
  probBar: { height: 3, background: C.border2, borderRadius: 2, overflow: "hidden", width: "100%" },
  probFill: { height: "100%", borderRadius: 2 },
  projCenter: { textAlign: "center" as any, marginBottom: 14, padding: "8px 0" },
  projBig: { fontSize: 36, fontWeight: 800, color: C.gold, letterSpacing: "-1px", textShadow: `0 0 20px ${C.goldDim}` },
  projSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  lineRow: { display: "flex", marginBottom: 10 },
  oddsRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  oddGroup: { display: "flex", flexDirection: "column" as any, gap: 4 },
  oddLabel: { fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase" as any, letterSpacing: "0.8px" },
  oddInput: { width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 6, color: C.text, fontSize: 13, padding: "7px 10px", outline: "none", boxSizing: "border-box" as any, fontFamily: "inherit" },
  oddJustaRow: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" as any },
  oddJustaLabel: { fontSize: 10, color: C.textMuted, marginTop: 3 },
  oddJustaItem: { fontSize: 11, color: C.textMuted, flex: 1 },
  evTag: { fontSize: 11, fontWeight: 700 },

  // Tabela de jogadores
  playerMarketTabs: { display: "flex", gap: 6, marginBottom: 8 },
  playerMarketTab: { flex: 1, padding: "6px 4px", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", color: C.textMuted, fontSize: 11, fontWeight: 600, textAlign: "center" as any },
  playerMarketTabActive: { background: C.goldBg, border: `1px solid ${C.gold}`, color: C.gold },
  filterNote: { fontSize: 11, color: C.textDim, marginBottom: 8 },
  tableContainer: { overflowX: "auto" as any, marginBottom: 12 },
  tableHeader: { display: "flex", gap: 4, padding: "6px 4px", borderBottom: `1px solid ${C.border2}`, marginBottom: 4 },
  tableColPlayer: { minWidth: 100, flex: 1.5 },
  tableColProj: { minWidth: 36, textAlign: "center" as any, fontSize: 9, fontWeight: 700, color: C.textMuted, letterSpacing: "0.5px", display: "flex", alignItems: "center", justifyContent: "center" },
  tableColThreshold: { minWidth: 48, flex: 1, textAlign: "center" as any, fontSize: 9, fontWeight: 700, color: C.textMuted, letterSpacing: "0.5px", display: "flex", alignItems: "center", justifyContent: "center" },
  tableColOutra: { minWidth: 80, flex: 1.2 },
  tableRow: { display: "flex", gap: 4, padding: "6px 4px", borderBottom: `1px solid ${C.border}`, alignItems: "center" },
  playerNameSmall: { fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 },
  playerTeam: { fontSize: 9, fontWeight: 700, color: C.bg, background: C.gold, borderRadius: 3, padding: "1px 4px" },
  thresholdCell: { width: "100%", padding: "4px 2px", background: "transparent", border: "1px solid", borderRadius: 5, cursor: "pointer", display: "flex", flexDirection: "column" as any, alignItems: "center", gap: 1 },
  playerInputSmall: { width: "100%", background: C.surface2, border: `1px solid ${C.border2}`, borderRadius: 4, color: C.text, fontSize: 10, padding: "4px 5px", outline: "none", boxSizing: "border-box" as any, fontFamily: "inherit" },

  // Modal de célula ativa
  cellModal: { background: C.surfaceRaised, border: `1px solid ${C.gold}`, borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: `0 0 16px ${C.goldDim}` },
  cellModalHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  metricBlock: { background: C.surface2, borderRadius: 8, padding: "6px 8px", textAlign: "center" as any },
  metricLabel: { fontSize: 9, color: C.textMuted, fontWeight: 600, letterSpacing: "0.5px", marginBottom: 2 },
  metricVal: { fontSize: 13, fontWeight: 800, color: C.text },

  // Ranking
  filtrosRow: { display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap" as any },
  filtroGroup: { display: "flex", flexDirection: "column" as any, gap: 4 },
  filtroBtn: { padding: "4px 8px", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 5, color: C.textMuted, fontSize: 10, fontWeight: 600, cursor: "pointer" },
  filtroBtnActive: { background: C.goldBg, border: `1px solid ${C.gold}`, color: C.gold },
  
  rankingSecaoTitulo: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "8px 0" },
  rankingSecaoLabel: { fontSize: 12, fontWeight: 800, color: C.gold, letterSpacing: "1.5px" },
  rankingSecaoCount: { fontSize: 10, fontWeight: 600, color: C.textMuted },
  
  rankList: { display: "flex", flexDirection: "column" as any, gap: 8 },
  rankRow: { display: "flex", alignItems: "flex-start", gap: 10, background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", transition: "all 0.2s" },
  rankPos: { fontSize: 11, fontWeight: 800, color: C.goldDim, minWidth: 24, paddingTop: 2 },
  rankInfo: { flex: 1, minWidth: 0 },
  rankTitle: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as any },
  rankMeta: { display: "flex", gap: 6, alignItems: "center", marginBottom: 8 },
  rankMercado: { fontSize: 9, fontWeight: 700, color: C.bg, background: C.gold, borderRadius: 3, padding: "1px 5px", textTransform: "uppercase" as any },
  rankSub: { fontSize: 10, color: C.textMuted },
  
  motivoBox: { background: C.surface2, borderRadius: 8, padding: "8px 10px", marginBottom: 10 },
  motivoText: { fontSize: 11, color: C.textMuted, lineHeight: 1.5 },
  alertaText: { fontSize: 10, color: C.yellow, marginTop: 4, lineHeight: 1.4 },
  
  rankStats: { display: "flex", gap: 8, flexWrap: "wrap" as any, marginBottom: 8 },
  rankStat: { fontSize: 11, color: C.textMuted },
  rankStatLabel: { color: C.textDim, marginRight: 2 },
  rankEvCol: { display: "flex", flexDirection: "column" as any, alignItems: "flex-end", gap: 2, paddingTop: 2 },
  rankEv: { fontSize: 16, fontWeight: 800 },
  rankEvLabel: { fontSize: 9, fontWeight: 600, color: C.textDim, letterSpacing: "1px" },
  rankScoreBadge: { display: "flex", flexDirection: "column" as any, alignItems: "center", marginTop: 6, padding: "4px 8px", background: C.surface2, border: "1px solid", borderRadius: 6 },
  rankScoreValue: { fontSize: 15, fontWeight: 800 },
  rankScoreLabel: { fontSize: 8, fontWeight: 700, color: C.textDim, letterSpacing: "1px" },

  registerBtn: { width: "100%", padding: "9px", background: C.goldBg, border: `1px solid ${C.goldDim}`, borderRadius: 8, color: C.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "center" as any, transition: "all 0.2s" },
  registerBtnDone: { width: "100%", padding: "9px", background: C.greenBg + "22", border: `1px solid ${C.green}44`, borderRadius: 8, color: C.green, fontSize: 12, fontWeight: 600, textAlign: "center" as any },
  registerBtnReady: { width: "100%", padding: "9px", background: C.gold, border: `1px solid ${C.goldLight}`, borderRadius: 8, color: C.bg, fontWeight: 800, cursor: "pointer", textAlign: "center" as any, fontSize: 12, transition: "all 0.2s" },

  // Múltiplas
  multiplaCard: { background: C.surfaceRaised, border: `1px solid ${C.border2}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 },
  multiplaHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" as any },
  multiplaLegs: { display: "flex", flexDirection: "column" as any, gap: 4 },
  multiplaLeg: { display: "flex", flexDirection: "column" as any, padding: "4px 8px", background: C.surface2, borderRadius: 6 },
  multiplaLegNome: { fontSize: 11, fontWeight: 700, color: C.text },
  multiplaLegDetalhe: { fontSize: 10, color: C.textMuted },

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
  apostaCard: { background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 },
  apostaHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, gap: 8 },
  apostaTitulo: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 },
  apostaMeta: { display: "flex", gap: 6, alignItems: "center" },
  apostaSubtitulo: { fontSize: 10, color: C.textMuted },
  apostaStats: { display: "flex", gap: 8, flexWrap: "wrap" as any, marginBottom: 10 },
  apostaStatItem: { fontSize: 11, color: C.textMuted },
  apostaActions: { display: "flex", gap: 6 },
  btnGreen: { flex: 1, padding: "8px", background: C.greenBg, border: `1px solid ${C.green}44`, borderRadius: 8, color: C.green, fontSize: 12, fontWeight: 700, cursor: "pointer" },
  btnRed: { flex: 1, padding: "8px", background: C.redBg, border: `1px solid ${C.red}44`, borderRadius: 8, color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer" },
  btnDelete: { padding: "8px 12px", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMuted, fontSize: 11, cursor: "pointer" },
  resultadoBadge: { fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "4px 8px", whiteSpace: "nowrap" as any },
  pendenteBadge: { fontSize: 10, fontWeight: 700, color: C.yellow, background: C.yellowBg, border: `1px solid ${C.yellow}44`, borderRadius: 6, padding: "4px 8px", whiteSpace: "nowrap" as any },

  // Empty
  empty: { padding: "20px 0", color: C.textMuted, fontSize: 13, textAlign: "center" as any },
  emptyRanking: { padding: "48px 20px", textAlign: "center" as any },
  emptyIcon: { fontSize: 32, marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: 700, color: C.gold, marginBottom: 6 },
  emptySub: { fontSize: 12, color: C.textMuted, lineHeight: 1.6 },
}