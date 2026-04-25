export type Game = {
  game_id: string
  casa: string
  fora: string
  data: string
}
 
export type ResultadoJogo = {
  game_id: string
  [key: string]: any
}
 
export type ResultadoJogador = {
  game_id: string
  player_id: string
  player_name: string
  [key: string]: any
}
 
export type OddsInput = {
  linha?: number
  oddOver?: number
  oddUnder?: number
  oddHome?: number
  oddAway?: number
}
 
export type RankingItem = {
  key: string
  categoria: "Jogo" | "Jogador"
  mercado: string
  titulo: string
  subtitulo: string
  lado: string
  linha?: number
  odd?: number | null
  projecao?: number | null
  prob?: number | null
  edge: number
  ev: number | null
  confianca: number
  scoreJarvis: number | null
}
 
// ── Score Jarvis ──────────────────────────────────────────
// Score de 0 a 100 que combina:
// 1. Probabilidade do evento (30%) — quanto maior, melhor
// 2. Qualidade do modelo/mercado (30%) — baseado no R² real de cada modelo
// 3. EV na zona ideal 5%-20% (25%) — penaliza abaixo e acima (curva em sino)
// 4. Confiança do modelo (15%) — score interno 0-100
//
// Pesos de qualidade por mercado (baseados nos R² reais):
// Pontos: 0.558 → 1.00 | Assists: 0.551 → 1.00 | Rebounds: 0.525 → 0.95
// Threes: 0.482 → 0.87 | Handicap: 0.152 → 0.45 | Vencedor AUC 0.695 → 0.55
// Total: 0.067 → 0.20
 
const QUALIDADE_MERCADO: Record<string, number> = {
  "Pontos":          1.00,
  "Assistências":    1.00,
  "Rebotes":         0.95,
  "Cestas de 3":     0.87,
  "Handicap":        0.45,
  "Vencedor":        0.55,
  "Total de Pontos": 0.20,
}
 
export function calcularScoreJarvis(
  ev: number | null,
  prob: number | null,
  confianca: number | null,
  mercado: string
): number | null {
  if (ev === null || prob === null) return null
 
  // 1. Probabilidade (0-100): prob 50% = 0pts, prob 75%+ = 100pts
  const compProb = Math.min(Math.max((prob - 0.5) / 0.25, 0), 1) * 100
 
  // 2. Qualidade do mercado (0-100)
  const qualidade = QUALIDADE_MERCADO[mercado] ?? 0.5
  const compQualidade = qualidade * 100
 
  // 3. EV na zona ideal — pico em 12%, penaliza <3% e >25%
  const evPct = ev * 100
  let compEv = 0
  if (evPct >= 3 && evPct <= 30) {
    const distancia = Math.abs(evPct - 12)
    compEv = Math.max(0, 100 - distancia * 6)
  } else if (evPct > 30) {
    // EV muito alto = suspeito, penaliza progressivamente
    compEv = Math.max(0, 100 - (evPct - 30) * 8)
  }
  // evPct < 3 = compEv permanece 0
 
  // 4. Confiança do modelo (já 0-100)
  const compConfianca = Math.min(Math.max(confianca ?? 0, 0), 100)
 
  const score =
    compProb      * 0.30 +
    compQualidade * 0.30 +
    compEv        * 0.25 +
    compConfianca * 0.15
 
  return Math.round(score * 10) / 10
}
 
// ── EV unificado ─────────────────────────────────────────
export function calcularEvOver(
  proj: number,
  linha: number,
  odd: number,
  tipo: "total" | "handicap" | "jogador",
  probBanco?: number | null
): number {
  if (probBanco != null) return probBanco * odd - 1
  const d = tipo === "handicap" ? linha - proj : proj - linha
  const prob = 0.5 + Math.min(Math.abs(d) / Math.max(Math.abs(linha), 1), 0.25) * (d >= 0 ? 1 : -1)
  return prob * odd - 1
}
 
export function calcularEvUnder(
  proj: number,
  linha: number,
  odd: number,
  tipo: "total" | "handicap" | "jogador",
  probBanco?: number | null
): number {
  if (probBanco != null) return probBanco * odd - 1
  const d = tipo === "handicap" ? proj - linha : linha - proj
  const prob = 0.5 + Math.min(Math.abs(d) / Math.max(Math.abs(linha), 1), 0.25) * (d >= 0 ? 1 : -1)
  return prob * odd - 1
}
 
export function calcularEvLocal(prob: number | null, odd: number | null): number | null {
  if (prob === null || odd === null) return null
  return prob * odd - 1
}
 
// ── Projeções ─────────────────────────────────────────────
export function getProjectionFromGameWinner(row: ResultadoJogo) {
  const probCasa = firstNumber(row, [
    "prob_home_win",
    "predicted_home_win_prob",
    "predicted_home_probability",
    "home_win_prob",
    "prob_casa",
    "prob_home",
    "probabilidade_casa",
  ])
 
  let probFora = firstNumber(row, [
    "prob_away_win",
    "predicted_away_win_prob",
    "predicted_away_probability",
    "away_win_prob",
    "prob_fora",
    "prob_away",
    "probabilidade_fora",
  ])
 
  if (probCasa !== null && probFora === null) {
    probFora = 1 - probCasa
  }
 
  return { probCasa, probFora }
}
 
export function getProjectionFromGameTotal(row: ResultadoJogo) {
  return firstNumber(row, [
    "predicted_total_points",
    "predicted_total",
    "projecao_total",
    "prediction_total",
    "total_pred",
    "total_points_pred",
  ])
}
 
export function getProjectionFromGameHandicap(row: ResultadoJogo) {
  return firstNumber(row, [
    "predicted_point_diff",
    "predicted_handicap",
    "predicted_spread",
    "projecao_handicap",
    "prediction_handicap",
    "handicap_pred",
  ])
}
 
export function getProjectionFromPlayer(row: ResultadoJogador) {
  return firstNumber(row, [
    "predicted_player_points",
    "predicted_player_assists",
    "predicted_player_rebounds",
    "predicted_player_fg3m",
    "predicted_player_threes",
    "predicted_value",
    "prediction",
    "projection",
    "projecao",
    "predicao",
  ])
}
 
export function getMinutesAverage(row: ResultadoJogador) {
  return firstNumber(row, [
    "player_minutes_avg",
    "minutes_avg",
    "media_minutos",
    "minutes_l5",
  ])
}
 
export function getPlayerTeam(row: ResultadoJogador) {
  return firstString(row, ["team_abbr", "team", "time"]) || "-"
}
 
export function getPlayerOpponent(row: ResultadoJogador) {
  return firstString(row, ["opponent_team_abbr", "opponent", "adversario"]) || "-"
}
 
export function getModelConfidence(row: Record<string, any>): number | null {
  return firstNumber(row, ["model_confidence", "confidence", "confianca_modelo"])
}
 
export function getProbOver(row: Record<string, any>): number | null {
  return firstNumber(row, ["prob_over"])
}
 
export function getProbUnder(row: Record<string, any>): number | null {
  return firstNumber(row, ["prob_under"])
}
 
export function getEvOver(row: Record<string, any>): number | null {
  return firstNumber(row, ["ev_over"])
}
 
export function getEvUnder(row: Record<string, any>): number | null {
  return firstNumber(row, ["ev_under"])
}
 
export function getDiffProjecaoLinha(row: Record<string, any>): number | null {
  return firstNumber(row, ["diff_projecao_linha"])
}
 
// ── Helpers internos ──────────────────────────────────────
function normalizeObject(obj: Record<string, any>) {
  const normalized: Record<string, any> = {}
  for (const key of Object.keys(obj || {})) {
    normalized[key] = obj[key]
    normalized[key.toLowerCase()] = obj[key]
  }
  return normalized
}
 
function firstNumber(obj: Record<string, any>, candidates: string[]): number | null {
  const row = normalizeObject(obj)
  for (const c of candidates) {
    const key = c.toLowerCase()
    const value = row[key]
    if (value !== undefined && value !== null && value !== "") {
      const n = Number(value)
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}
 
function firstString(obj: Record<string, any>, candidates: string[]): string | null {
  const row = normalizeObject(obj)
  for (const c of candidates) {
    const key = c.toLowerCase()
    const value = row[key]
    if (value !== undefined && value !== null && value !== "") {
      return String(value)
    }
  }
  return null
}
 
// ── Ranking items ─────────────────────────────────────────
export function getWinnerBetRankingItem(params: {
  row: ResultadoJogo
  jogo: Game
  odds: OddsInput
}): RankingItem[] {
  const { row, jogo, odds } = params
  const { probCasa, probFora } = getProjectionFromGameWinner(row)
  const modelConfidence = getModelConfidence(row) ?? 0
  const items: RankingItem[] = []
 
  if (probCasa !== null && odds.oddHome) {
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
      projecao: null,
      edge: probCasa - 1 / odds.oddHome,
      ev,
      confianca: modelConfidence,
      scoreJarvis: calcularScoreJarvis(ev, probCasa, modelConfidence, "Vencedor"),
    })
  }
 
  if (probFora !== null && odds.oddAway) {
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
      projecao: null,
      edge: probFora - 1 / odds.oddAway,
      ev,
      confianca: modelConfidence,
      scoreJarvis: calcularScoreJarvis(ev, probFora, modelConfidence, "Vencedor"),
    })
  }
 
  return items
}
 
export function getLineBetRankingItem(params: {
  keyBase: string
  mercado: string
  titulo: string
  subtitulo: string
  projecao: number | null
  linha?: number
  oddOver?: number
  oddUnder?: number
  modelConfidence?: number | null
  probOver?: number | null
  probUnder?: number | null
  tipo?: "total" | "handicap" | "jogador"
}): RankingItem[] {
  const {
    keyBase, mercado, titulo, subtitulo, projecao,
    linha, oddOver, oddUnder, modelConfidence,
    probOver, probUnder, tipo,
  } = params
 
  if (projecao === null || linha === undefined || linha === null) return []
 
  const mc = modelConfidence ?? 0
  const isPlayerMarket = ["Pontos", "Assistências", "Rebotes", "Cestas de 3"].includes(mercado)
  const categoria: "Jogo" | "Jogador" = isPlayerMarket ? "Jogador" : "Jogo"
 
  const tipoEfetivo: "total" | "handicap" | "jogador" =
    tipo ?? (mercado === "Handicap" ? "handicap" : isPlayerMarket ? "jogador" : "total")
 
  const edgeOver  = tipoEfetivo === "handicap" ? linha - projecao : projecao - linha
  const edgeUnder = tipoEfetivo === "handicap" ? projecao - linha : linha - projecao
 
  const items: RankingItem[] = []
 
  if (oddOver) {
    const ev   = calcularEvOver(projecao, linha, oddOver, tipoEfetivo, probOver)
    const prob = probOver != null ? probOver
      : 0.5 + Math.min(Math.abs(edgeOver) / Math.max(Math.abs(linha), 1), 0.25) * (edgeOver >= 0 ? 1 : -1)
    items.push({
      key: `${keyBase}-over`,
      categoria, mercado, titulo, subtitulo,
      lado: "Over", linha, odd: oddOver, prob, projecao,
      edge: edgeOver, ev,
      confianca: mc,
      scoreJarvis: calcularScoreJarvis(ev, prob, mc, mercado),
    })
  }
 
  if (oddUnder) {
    const ev   = calcularEvUnder(projecao, linha, oddUnder, tipoEfetivo, probUnder)
    const prob = probUnder != null ? probUnder
      : 0.5 + Math.min(Math.abs(edgeUnder) / Math.max(Math.abs(linha), 1), 0.25) * (edgeUnder >= 0 ? 1 : -1)
    items.push({
      key: `${keyBase}-under`,
      categoria, mercado, titulo, subtitulo,
      lado: "Under", linha, odd: oddUnder, prob, projecao,
      edge: edgeUnder, ev,
      confianca: mc,
      scoreJarvis: calcularScoreJarvis(ev, prob, mc, mercado),
    })
  }
 
  return items
}