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
}

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

export function getProjectionFromGameWinner(row: ResultadoJogo) {
  const probCasa = firstNumber(row, [
    "predicted_home_win_prob",
    "predicted_home_probability",
    "home_win_prob",
    "prob_casa",
    "prob_home",
    "probabilidade_casa",
  ])

  let probFora = firstNumber(row, [
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
    "predicted_player_fg3m",  // ← adicionado
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

// ── Leitura de probabilidades e EV do banco ──────────────
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

// ── EV calculado localmente quando prob vem do banco ─────
// prob já é a probabilidade real do modelo (distribuição normal + MAE)
// ev = prob * odd - 1
export function calcularEvLocal(prob: number | null, odd: number | null): number | null {
  if (prob === null || odd === null) return null
  return prob * odd - 1
}

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
      confianca: Math.round((Math.max(ev, 0) * 100 + modelConfidence * 0.5) * 10) / 10,
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
      confianca: Math.round((Math.max(ev, 0) * 100 + modelConfidence * 0.5) * 10) / 10,
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
  // probabilidades reais vindas do banco (calculadas com MAE do modelo)
  probOver?: number | null
  probUnder?: number | null
}): RankingItem[] {
  const {
    keyBase,
    mercado,
    titulo,
    subtitulo,
    projecao,
    linha,
    oddOver,
    oddUnder,
    modelConfidence,
    probOver,
    probUnder,
  } = params

  if (projecao === null || linha === undefined || linha === null) return []

  const edgeOver = projecao - linha
  const edgeUnder = linha - projecao
  const mc = modelConfidence ?? 0

  const isPlayerMarket = ["Pontos", "Assistências", "Rebotes", "Cestas de 3"].includes(mercado)
  const categoria: "Jogo" | "Jogador" = isPlayerMarket ? "Jogador" : "Jogo"

  const items: RankingItem[] = []

  if (oddOver) {
    // Usa prob do banco se disponível, senão fallback simples
    const prob = probOver !== null && probOver !== undefined
      ? probOver
      : 0.5 + Math.min(Math.abs(edgeOver) / Math.max(Math.abs(linha), 1), 0.25) * (edgeOver >= 0 ? 1 : -1)

    const ev = calcularEvLocal(prob, oddOver)

    items.push({
      key: `${keyBase}-over`,
      categoria,
      mercado,
      titulo,
      subtitulo,
      lado: "Over",
      linha,
      odd: oddOver,
      prob,
      projecao,
      edge: edgeOver,
      ev,
      confianca: Math.round((
        Math.abs(edgeOver) * 10 +
        Math.max(ev ?? 0, 0) * 100 +
        mc * 0.5
      ) * 10) / 10,
    })
  }

  if (oddUnder) {
    const prob = probUnder !== null && probUnder !== undefined
      ? probUnder
      : 0.5 + Math.min(Math.abs(edgeUnder) / Math.max(Math.abs(linha), 1), 0.25) * (edgeUnder >= 0 ? 1 : -1)

    const ev = calcularEvLocal(prob, oddUnder)

    items.push({
      key: `${keyBase}-under`,
      categoria,
      mercado,
      titulo,
      subtitulo,
      lado: "Under",
      linha,
      odd: oddUnder,
      prob,
      projecao,
      edge: edgeUnder,
      ev,
      confianca: Math.round((
        Math.abs(edgeUnder) * 10 +
        Math.max(ev ?? 0, 0) * 100 +
        mc * 0.5
      ) * 10) / 10,
    })
  }

  return items
}