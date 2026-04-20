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

function firstNumber(obj: Record<string, any>, candidates: string[]): number | null {
  for (const c of candidates) {
    if (obj[c] !== undefined && obj[c] !== null && obj[c] !== "") {
      const n = Number(obj[c])
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}

function firstString(obj: Record<string, any>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (obj[c] !== undefined && obj[c] !== null && obj[c] !== "") {
      return String(obj[c])
    }
  }
  return null
}

export function getProjectionFromGameWinner(row: ResultadoJogo) {
  const probCasa = firstNumber(row, [
    "prob_casa",
    "prob_home",
    "home_win_prob",
    "probabilidade_casa",
    "prob_vitoria_casa",
  ])

  const probFora = firstNumber(row, [
    "prob_fora",
    "prob_away",
    "away_win_prob",
    "probabilidade_fora",
    "prob_vitoria_fora",
  ])

  return {
    probCasa,
    probFora,
  }
}

export function getProjectionFromGameTotal(row: ResultadoJogo) {
  return firstNumber(row, [
    "pred_total",
    "projecao_total",
    "prediction_total",
    "total_pred",
    "total_points_pred",
    "previsao_total",
  ])
}

export function getProjectionFromGameHandicap(row: ResultadoJogo) {
  return firstNumber(row, [
    "pred_handicap",
    "projecao_handicap",
    "prediction_handicap",
    "handicap_pred",
    "previsao_handicap",
  ])
}

export function getProjectionFromPlayer(row: ResultadoJogador) {
  return firstNumber(row, [
    "predicao",
    "pred",
    "prediction",
    "projection",
    "projecao",
    "y_pred",
    "valor_previsto",
  ])
}

export function getMinutesAverage(row: ResultadoJogador) {
  return firstNumber(row, [
    "player_minutes_avg",
    "minutes_avg",
    "media_minutos",
    "player_minutes_last5",
    "minutes_l5",
  ])
}

export function getPlayerTeam(row: ResultadoJogador) {
  return firstString(row, [
    "team_abbr",
    "team",
    "time",
    "team_code",
  ]) || "-"
}

export function getPlayerOpponent(row: ResultadoJogador) {
  return firstString(row, [
    "opponent_team_abbr",
    "opponent",
    "adversario",
    "opp_team",
  ]) || "-"
}

export function getWinnerBetRankingItem(params: {
  row: ResultadoJogo
  jogo: Game
  odds: OddsInput
}): RankingItem[] {
  const { row, jogo, odds } = params
  const { probCasa, probFora } = getProjectionFromGameWinner(row)

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
      edge: probCasa - (1 / odds.oddHome),
      ev,
      confianca: Math.round(Math.abs(ev) * 1000) / 10,
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
      edge: probFora - (1 / odds.oddAway),
      ev,
      confianca: Math.round(Math.abs(ev) * 1000) / 10,
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
}): RankingItem[] {
  const { keyBase, mercado, titulo, subtitulo, projecao, linha, oddOver, oddUnder } = params
  if (projecao === null || linha === undefined || linha === null) return []

  const edgeOver = projecao - linha
  const edgeUnder = linha - projecao

  const items: RankingItem[] = []

  if (oddOver) {
    const probModelOver = 0.5 + Math.min(Math.abs(edgeOver) / Math.max(linha || 1, 1), 0.25)
    const ev = (edgeOver > 0 ? probModelOver : 1 - probModelOver) * oddOver - 1

    items.push({
      key: `${keyBase}-over`,
      categoria: mercado === "Pontos" || mercado === "Assistências" || mercado === "Rebotes" || mercado === "Cestas de 3" ? "Jogador" : "Jogo",
      mercado,
      titulo,
      subtitulo,
      lado: "Over",
      linha,
      odd: oddOver,
      prob: edgeOver > 0 ? probModelOver : 1 - probModelOver,
      projecao,
      edge: edgeOver,
      ev,
      confianca: Math.round((Math.abs(edgeOver) * 10 + Math.max(ev, 0) * 100) * 10) / 10,
    })
  }

  if (oddUnder) {
    const probModelUnder = 0.5 + Math.min(Math.abs(edgeUnder) / Math.max(linha || 1, 1), 0.25)
    const ev = (edgeUnder > 0 ? probModelUnder : 1 - probModelUnder) * oddUnder - 1

    items.push({
      key: `${keyBase}-under`,
      categoria: mercado === "Pontos" || mercado === "Assistências" || mercado === "Rebotes" || mercado === "Cestas de 3" ? "Jogador" : "Jogo",
      mercado,
      titulo,
      subtitulo,
      lado: "Under",
      linha,
      odd: oddUnder,
      prob: edgeUnder > 0 ? probModelUnder : 1 - probModelUnder,
      projecao,
      edge: edgeUnder,
      ev,
      confianca: Math.round((Math.abs(edgeUnder) * 10 + Math.max(ev, 0) * 100) * 10) / 10,
    })
  }

  return items
}